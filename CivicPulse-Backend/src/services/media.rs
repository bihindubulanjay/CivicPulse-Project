use std::{io::ErrorKind, path::Path};

use base64::{engine::general_purpose::STANDARD as BASE64_STANDARD, Engine as _};
use image::imageops::FilterType;
use uuid::Uuid;

use crate::error::{AppError, AppResult};

/// Compute a 64-bit perceptual difference hash (`dHash`) encoded as 16 lowercase hex chars.
/// Returns `None` for non-image payloads (e.g., video) or incomplete headers.
pub fn compute_image_dhash(bytes: &[u8]) -> Option<String> {
    let img = image::load_from_memory(bytes).ok()?;
    let luma = img.resize_exact(9, 8, FilterType::Triangle).into_luma8();

    let mut hash: u64 = 0;
    for y in 0..8 {
        for x in 0..8 {
            let left = luma.get_pixel(x, y)[0];
            let right = luma.get_pixel(x + 1, y)[0];
            if left > right {
                hash |= 1u64 << (y * 8 + x);
            }
        }
    }

    Some(format!("{hash:016x}"))
}

/// Compute Hamming distance (0..=64) between two 64-bit hex dHashes.
pub fn dhash_hamming_distance(a: &str, b: &str) -> Option<u32> {
    let ha = u64::from_str_radix(a.trim(), 16).ok()?;
    let hb = u64::from_str_radix(b.trim(), 16).ok()?;
    Some((ha ^ hb).count_ones())
}

/// Atomically persist uploaded media bytes under `upload_dir` and return its serving URL.
pub fn store_media_on_disk(
    upload_dir: &str,
    mime_type: &str,
    bytes: &[u8],
    public_base_url: Option<&str>,
) -> AppResult<String> {
    let ext = mime_to_extension(mime_type)?;
    let dir = Path::new(upload_dir);
    std::fs::create_dir_all(dir)
        .map_err(|e| AppError::internal(format!("Failed to create upload directory: {e}")))?;

    let filename = format!("{}.{ext}", Uuid::new_v4());
    let temp_path = dir.join(format!(".tmp_{filename}"));
    let final_path = dir.join(&filename);

    std::fs::write(&temp_path, bytes)
        .map_err(|e| AppError::internal(format!("Failed to write media upload: {e}")))?;
    if let Err(err) = std::fs::rename(&temp_path, &final_path) {
        let _ = std::fs::remove_file(&temp_path);
        return Err(AppError::internal(format!(
            "Failed to finalize media upload: {err}"
        )));
    }

    Ok(match public_base_url {
        Some(base) if !base.trim().is_empty() => {
            format!("{}/uploads/{filename}", base.trim_end_matches('/'))
        }
        _ => format!("/uploads/{filename}"),
    })
}

/// Read a stored media file safely (rejecting path traversal or unknown extensions).
pub fn read_stored_media(upload_dir: &str, filename: &str) -> AppResult<(Vec<u8>, &'static str)> {
    validate_safe_filename(filename)?;
    let mime = extension_to_mime(filename)?;
    let full_path = Path::new(upload_dir).join(filename);

    let bytes = std::fs::read(&full_path).map_err(|e| {
        if e.kind() == ErrorKind::NotFound {
            AppError::not_found(format!("Media file '{filename}' not found"))
        } else {
            AppError::internal(format!("Failed to read media file '{filename}': {e}"))
        }
    })?;

    Ok((bytes, mime))
}

/// Load `(mime_type, base64_data)` from either an inline data URI or a `/uploads/<filename>` URL
/// so background AI retry workers can re-analyze deferred reports.
pub fn load_media_base64_for_retry(media_url: &str, upload_dir: &str) -> Option<(String, String)> {
    let trimmed = media_url.trim();
    if let Some(rest) = trimmed.strip_prefix("data:") {
        let (header, payload) = rest.split_once(',')?;
        let mime = header.split(';').next()?.trim().to_ascii_lowercase();
        let cleaned: String = payload.chars().filter(|c| !c.is_ascii_whitespace()).collect();
        return Some((mime, cleaned));
    }

    if let Some((_, fname)) = trimmed.rsplit_once("/uploads/") {
        if let Ok((bytes, mime)) = read_stored_media(upload_dir, fname) {
            return Some((mime.to_string(), BASE64_STANDARD.encode(bytes)));
        }
    }

    None
}

fn validate_safe_filename(filename: &str) -> AppResult<()> {
    if filename.is_empty()
        || filename.len() > 128
        || filename.contains("..")
        || filename.contains('/')
        || filename.contains('\\')
        || !filename
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'.' || b == b'-' || b == b'_')
    {
        return Err(AppError::bad_request("Invalid media filename"));
    }
    Ok(())
}

fn mime_to_extension(mime_type: &str) -> AppResult<&'static str> {
    match mime_type {
        "image/jpeg" => Ok("jpg"),
        "image/png" => Ok("png"),
        "image/webp" => Ok("webp"),
        "image/gif" => Ok("gif"),
        "image/heic" => Ok("heic"),
        "image/heif" => Ok("heif"),
        "video/webm" => Ok("webm"),
        "video/mp4" => Ok("mp4"),
        "video/quicktime" => Ok("mov"),
        other => Err(AppError::bad_request(format!(
            "Unsupported media MIME type '{other}'"
        ))),
    }
}

fn extension_to_mime(filename: &str) -> AppResult<&'static str> {
    let ext = filename
        .rsplit_once('.')
        .map(|(_, e)| e.to_ascii_lowercase())
        .ok_or_else(|| AppError::bad_request("Missing file extension"))?;

    match ext.as_str() {
        "jpg" | "jpeg" => Ok("image/jpeg"),
        "png" => Ok("image/png"),
        "webp" => Ok("image/webp"),
        "gif" => Ok("image/gif"),
        "heic" => Ok("image/heic"),
        "heif" => Ok("image/heif"),
        "webm" => Ok("video/webm"),
        "mp4" => Ok("video/mp4"),
        "mov" => Ok("video/quicktime"),
        _ => Err(AppError::bad_request("Unsupported media extension")),
    }
}

#[cfg(test)]
mod tests {
    use std::io::Cursor;

    use image::{ImageFormat, Rgba, RgbaImage};

    use super::*;

    #[test]
    fn perceptual_dhash_matches_resized_and_reencoded_images() {
        // Build a synthetic natural gradient + asymmetric landmark pattern (64x64)
        let mut img = RgbaImage::new(64, 64);
        for y in 0..64 {
            for x in 0..64 {
                let r = ((x * 4) % 256) as u8;
                let g = ((y * 4) % 256) as u8;
                let b = if x > 32 && y < 32 { 220 } else { 30 };
                img.put_pixel(x, y, Rgba([r, g, b, 255]));
            }
        }

        let mut png_bytes = Vec::new();
        img.write_to(&mut Cursor::new(&mut png_bytes), ImageFormat::Png)
            .unwrap();

        // Resize to 40x40 and save as JPEG (simulating social-media recompression/resizing)
        let resized = image::DynamicImage::ImageRgba8(img).resize_exact(40, 40, FilterType::Lanczos3);
        let mut jpg_bytes = Vec::new();
        resized
            .to_rgb8()
            .write_to(&mut Cursor::new(&mut jpg_bytes), ImageFormat::Jpeg)
            .unwrap();

        let h1 = compute_image_dhash(&png_bytes).unwrap();
        let h2 = compute_image_dhash(&jpg_bytes).unwrap();
        let dist = dhash_hamming_distance(&h1, &h2).unwrap();
        assert!(dist <= 6, "expected low Hamming distance for resized JPEG, got {dist}");
    }

    #[test]
    fn store_and_read_media_blocks_traversal() {
        let dir = std::env::temp_dir().join(format!("cp_media_test_{}", Uuid::new_v4()));
        let dir_str = dir.to_str().unwrap();

        let url = store_media_on_disk(dir_str, "image/png", b"\x89PNG\r\n\x1a\ntest", None).unwrap();
        assert!(url.starts_with("/uploads/"));
        let fname = url.strip_prefix("/uploads/").unwrap();
        let (read_bytes, mime) = read_stored_media(dir_str, fname).unwrap();
        assert_eq!(mime, "image/png");
        assert_eq!(read_bytes, b"\x89PNG\r\n\x1a\ntest");

        assert!(read_stored_media(dir_str, "../etc/passwd").is_err());
        let _ = std::fs::remove_dir_all(&dir);
    }
}
