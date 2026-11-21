use chrono::{SecondsFormat, Utc};
use uuid::Uuid;

use crate::{
    config::{Config, MediaStorageMode},
    error::{AppError, AppResult},
    middleware::security::sanitize_text,
    models::{CreatePostRequest, Post, VerificationStatus},
    services::{
        algorithms::{detect_duplicate_or_recycled_signal, DuplicateSignal},
        gemini::{parse_and_validate_media, ForensicsInput, GeminiClient},
        geofence::{evaluate_on_site, validate_coordinates},
        integrity::compute_integrity_hash,
        media::store_media_on_disk,
    },
};

const MAX_TITLE_LEN: usize = 200;
const MAX_DESCRIPTION_LEN: usize = 5000;
const MAX_LOCATION_LEN: usize = 200;

/// Layer 3 initial status gate based on Gemini authenticity score.
pub const fn status_from_ai_score(score: u8) -> VerificationStatus {
    if score < 40 {
        VerificationStatus::Quarantined
    } else if score <= 65 {
        VerificationStatus::PendingCommunityVerification
    } else {
        VerificationStatus::AiVerified
    }
}

/// Crowd Quorum upgrade when community confirmations reach 3+.
/// Preserves moderation & terminal states (`Admin Approved`, `Pending Admin Approval`, `Rejected`, `Quarantined`, `Disputed`).
pub const fn status_after_verify(
    current: VerificationStatus,
    confirmations: u32,
) -> VerificationStatus {
    match current {
        VerificationStatus::AdminApproved
        | VerificationStatus::PendingAdminApproval
        | VerificationStatus::Rejected
        | VerificationStatus::Quarantined
        | VerificationStatus::Disputed => current,
        VerificationStatus::Unverified
        | VerificationStatus::PendingCommunityVerification
        | VerificationStatus::AiVerified
        | VerificationStatus::CommunityVerified => {
            if confirmations >= 3 {
                VerificationStatus::CommunityVerified
            } else {
                current
            }
        }
    }
}

/// Crowd Quorum flag rule when false_flags reach 3+:
/// Preserves hidden/quarantined states, escalates `Admin Approved` to `Disputed`,
/// and otherwise sets `Disputed` if `is_live_captured && ai_authenticity_score > 80` else `Quarantined`.
pub const fn status_after_flag(
    current: VerificationStatus,
    false_flags: u32,
    is_live_captured: bool,
    ai_authenticity_score: u8,
) -> VerificationStatus {
    match current {
        VerificationStatus::PendingAdminApproval
        | VerificationStatus::Rejected
        | VerificationStatus::Quarantined => current,
        _ if false_flags >= 3 => {
            if matches!(current, VerificationStatus::AdminApproved)
                || (is_live_captured && ai_authenticity_score > 80)
            {
                VerificationStatus::Disputed
            } else {
                VerificationStatus::Quarantined
            }
        }
        _ => current,
    }
}

/// Processed post along with cryptographic media fingerprints, forensic signal, and retry flag.
pub struct ProcessedPost {
    pub post: Post,
    pub media_hash: Option<String>,
    pub media_dhash: Option<String>,
    pub duplicate_signal: Option<DuplicateSignal>,
    pub needs_ai_retry: bool,
}

/// Execute the full 4-Layer Zero-Fake Trust Engine on a new incoming report.
pub async fn process_new_post(
    req: CreatePostRequest,
    existing_posts: &[(Post, Option<String>, Option<String>)],
    gemini: &GeminiClient,
    config: &Config,
) -> AppResult<ProcessedPost> {
    let title = normalize_required_text(&req.title, "title", MAX_TITLE_LEN)?;
    let description = normalize_required_text(&req.description, "description", MAX_DESCRIPTION_LEN)?;
    let location_name =
        normalize_required_text(&req.location_name, "location_name", MAX_LOCATION_LEN)?;

    validate_coordinates(req.lat, req.lng, "report")?;

    // Layer 1: Haversine Geofence Verification
    let (is_on_site, distance_km) = evaluate_on_site(
        req.user_lat,
        req.user_lng,
        req.lat,
        req.lng,
        config.geofence_radius_km,
    )?;

    // Optional base64 image/frame validation (MIME whitelist + magic bytes + SHA-256 + dHash)
    let parsed_media = match req.media_base64.as_deref() {
        Some(raw) if !raw.trim().is_empty() => {
            Some(parse_and_validate_media(raw, config.max_decoded_media_bytes)?)
        }
        _ => None,
    };
    let media_hash = parsed_media.as_ref().map(|m| m.sha256_fingerprint.clone());
    let media_dhash = parsed_media
        .as_ref()
        .and_then(|m| m.perceptual_dhash.clone());

    // Cross-report forensic algorithm: exact SHA-256, perceptual dHash, and near-duplicate text
    let duplicate_signal = detect_duplicate_or_recycled_signal(
        &title,
        &description,
        req.lat,
        req.lng,
        media_hash.as_deref(),
        media_dhash.as_deref(),
        existing_posts,
    );

    // Layer 2: Gemini 2.5 Flash Multimodal Forensics + Translation + Advisory (never crashes)
    let forensics_input = ForensicsInput {
        title: &title,
        description: &description,
        category: req.category,
        location_name: &location_name,
        lat: req.lat,
        lng: req.lng,
        is_live_captured: req.is_live_captured,
        is_on_site,
        distance_km,
        media: parsed_media.as_ref(),
        duplicate_signal: duplicate_signal.as_ref(),
    };
    let forensics = gemini.analyze_post_forensics(&forensics_input).await;

    // Layer 3: Auto-Status Gate
    let verification_status = status_from_ai_score(forensics.ai_authenticity_score);

    // Persist media either on disk (`/uploads/<uuid>.<ext>`) or inline data URI based on config
    let media_url = match parsed_media {
        Some(media) => match config.media_storage_mode {
            MediaStorageMode::File => Some(store_media_on_disk(
                &config.upload_dir,
                &media.mime_type,
                &media.decoded_bytes,
                config.public_base_url.as_deref(),
            )?),
            MediaStorageMode::Inline => Some(media.data_uri),
        },
        None => None,
    };

    // Layer 4: Cryptographic SHA-256 Integrity Hash
    let created_at = Utc::now().to_rfc3339_opts(SecondsFormat::Secs, true);
    let integrity_hash =
        compute_integrity_hash(&title, &description, req.lat, req.lng, &created_at);

    let post = Post {
        id: Uuid::new_v4().to_string(),
        title,
        description,
        translated_description: forensics.translated_description,
        category: req.category,
        lat: req.lat,
        lng: req.lng,
        location_name,
        media_url,
        is_live_captured: req.is_live_captured,
        is_on_site,
        ai_authenticity_score: forensics.ai_authenticity_score,
        ai_reasoning: forensics.ai_reasoning,
        travel_advisory: forensics.travel_advisory,
        severity: forensics.severity,
        verification_status,
        confirmations: 0,
        false_flags: 0,
        is_resolved: false,
        integrity_hash,
        author_id: None,
        viewer_vote: None,
        comments: Vec::new(),
        created_at,
    };

    Ok(ProcessedPost {
        post,
        media_hash,
        media_dhash,
        duplicate_signal,
        needs_ai_retry: forensics.used_fallback && gemini.is_configured(),
    })
}

pub fn normalize_required_text(raw: &str, field: &str, max_len: usize) -> AppResult<String> {
    let sanitized = sanitize_text(raw);
    if sanitized.is_empty() {
        return Err(AppError::bad_request(format!("{field} cannot be empty")));
    }
    if sanitized.chars().count() > max_len {
        return Err(AppError::bad_request(format!(
            "{field} exceeds maximum length of {max_len} characters"
        )));
    }
    Ok(sanitized)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ai_score_boundaries() {
        assert_eq!(status_from_ai_score(0), VerificationStatus::Quarantined);
        assert_eq!(status_from_ai_score(39), VerificationStatus::Quarantined);
        assert_eq!(
            status_from_ai_score(40),
            VerificationStatus::PendingCommunityVerification
        );
        assert_eq!(
            status_from_ai_score(55),
            VerificationStatus::PendingCommunityVerification
        );
        assert_eq!(
            status_from_ai_score(65),
            VerificationStatus::PendingCommunityVerification
        );
        assert_eq!(status_from_ai_score(66), VerificationStatus::AiVerified);
        assert_eq!(status_from_ai_score(100), VerificationStatus::AiVerified);
    }

    #[test]
    fn quorum_flag_rules() {
        // Below threshold -> unchanged
        assert_eq!(
            status_after_flag(VerificationStatus::AiVerified, 2, true, 90),
            VerificationStatus::AiVerified
        );
        // Live + score > 80 + >= 3 flags -> Disputed
        assert_eq!(
            status_after_flag(VerificationStatus::AiVerified, 3, true, 81),
            VerificationStatus::Disputed
        );
        // Live + score == 80 + >= 3 flags -> Quarantined
        assert_eq!(
            status_after_flag(VerificationStatus::AiVerified, 3, true, 80),
            VerificationStatus::Quarantined
        );
        // Non-live + score > 80 + >= 3 flags -> Quarantined
        assert_eq!(
            status_after_flag(VerificationStatus::AiVerified, 3, false, 95),
            VerificationStatus::Quarantined
        );
        // AdminApproved + >= 3 flags escalates to Disputed even if score <= 80
        assert_eq!(
            status_after_flag(VerificationStatus::AdminApproved, 3, false, 60),
            VerificationStatus::Disputed
        );
        // Pending/Rejected/Quarantined remain protected on flag
        for protected in [
            VerificationStatus::PendingAdminApproval,
            VerificationStatus::Rejected,
            VerificationStatus::Quarantined,
        ] {
            assert_eq!(status_after_flag(protected, 5, false, 20), protected);
        }
    }

    #[test]
    fn quorum_verify_preserves_moderation_and_terminal_statuses() {
        for protected in [
            VerificationStatus::AdminApproved,
            VerificationStatus::PendingAdminApproval,
            VerificationStatus::Rejected,
            VerificationStatus::Quarantined,
            VerificationStatus::Disputed,
        ] {
            assert_eq!(status_after_verify(protected, 10), protected);
        }

        for promotable in [
            VerificationStatus::Unverified,
            VerificationStatus::PendingCommunityVerification,
            VerificationStatus::AiVerified,
        ] {
            assert_eq!(
                status_after_verify(promotable, 3),
                VerificationStatus::CommunityVerified
            );
        }
    }
}
