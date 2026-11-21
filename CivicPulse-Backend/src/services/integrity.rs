use sha2::{Digest, Sha256};

use crate::models::Post;

/// Compute deterministic lowercase SHA-256 hex digest over canonical post metadata.
pub fn compute_integrity_hash(
    title: &str,
    description: &str,
    lat: f64,
    lng: f64,
    created_at: &str,
) -> String {
    let canonical = format!("{title}|{description}|{lat:.6}|{lng:.6}|{created_at}");
    let mut hasher = Sha256::new();
    hasher.update(canonical.as_bytes());
    hex::encode(hasher.finalize())
}

/// Recompute and verify whether a post's stored SHA-256 integrity hash matches its payload.
pub fn verify_post_integrity(post: &Post) -> (bool, String) {
    let recomputed = compute_integrity_hash(
        &post.title,
        &post.description,
        post.lat,
        post.lng,
        &post.created_at,
    );
    let valid = constant_time_eq(post.integrity_hash.as_bytes(), recomputed.as_bytes());
    (valid, recomputed)
}

fn constant_time_eq(a: &[u8], b: &[u8]) -> bool {
    if a.len() != b.len() {
        return false;
    }
    let mut diff = 0u8;
    for (x, y) in a.iter().zip(b.iter()) {
        diff |= x ^ y;
    }
    diff == 0
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hash_is_deterministic_64_hex_chars() {
        let h1 = compute_integrity_hash(
            "Ella Rock Trail",
            "Dense mist on ridge",
            6.8667,
            81.0466,
            "2026-11-21T06:00:00Z",
        );
        let h2 = compute_integrity_hash(
            "Ella Rock Trail",
            "Dense mist on ridge",
            6.8667,
            81.0466,
            "2026-11-21T06:00:00Z",
        );
        assert_eq!(h1, h2);
        assert_eq!(h1.len(), 64);
        assert!(h1.chars().all(|c| c.is_ascii_hexdigit()));
    }

    #[test]
    fn hash_changes_on_tamper() {
        let h1 = compute_integrity_hash(
            "Ella Rock Trail",
            "Dense mist",
            6.8667,
            81.0466,
            "2026-11-21T06:00:00Z",
        );
        let h2 = compute_integrity_hash(
            "Ella Rock Trail",
            "Clear skies",
            6.8667,
            81.0466,
            "2026-11-21T06:00:00Z",
        );
        assert_ne!(h1, h2);
    }
}
