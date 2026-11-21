use std::collections::{HashSet, VecDeque};

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use crate::{
    error::{AppError, AppResult},
    models::{Category, Post, TravelAdvisory, VerificationStatus},
    services::{
        geofence::{haversine_distance_km, validate_coordinates},
        media::dhash_hamming_distance,
    },
};

/// Verify that decoded binary bytes actually match the declared image/video MIME type.
/// Prevents MIME-spoofing (e.g., disguising scripts/HTML as `image/jpeg`).
pub fn verify_media_magic_bytes(mime_type: &str, bytes: &[u8]) -> AppResult<()> {
    let valid = match mime_type {
        "image/jpeg" => bytes.len() >= 3 && bytes[0..3] == [0xFF, 0xD8, 0xFF],
        "image/png" => {
            bytes.len() >= 8 && bytes[0..8] == [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]
        }
        "image/gif" => {
            bytes.len() >= 6 && (&bytes[0..6] == b"GIF87a" || &bytes[0..6] == b"GIF89a")
        }
        "image/webp" => {
            bytes.len() >= 12 && &bytes[0..4] == b"RIFF" && &bytes[8..12] == b"WEBP"
        }
        "image/heic" | "image/heif" | "video/mp4" | "video/quicktime" => {
            bytes.len() >= 12 && &bytes[4..8] == b"ftyp"
        }
        "video/webm" => bytes.len() >= 4 && bytes[0..4] == [0x1A, 0x45, 0xDF, 0xA3],
        _ => false,
    };

    if !valid {
        return Err(AppError::bad_request(format!(
            "Media binary signature does not match declared MIME type '{mime_type}'"
        )));
    }
    Ok(())
}

/// Compute SHA-256 cryptographic fingerprint of decoded media bytes for recycled-media detection.
pub fn compute_media_fingerprint(bytes: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    hex::encode(hasher.finalize())
}

/// Exponential time-decay dynamic priority ranking score (0.0 ..= 100.0).
/// Combines severity, verification trust weight, live/on-site telemetry, community quorum,
/// resolution state, and half-life decay (18h half-life for active crisis relevance).
pub fn compute_priority_score(post: &Post, now: DateTime<Utc>) -> f64 {
    let base_severity = f64::from(post.severity.clamp(1, 10)) * 7.0; // up to 70.0

    let trust_multiplier = match post.verification_status {
        VerificationStatus::CommunityVerified | VerificationStatus::AdminApproved => 1.25,
        VerificationStatus::AiVerified => 1.12,
        VerificationStatus::PendingCommunityVerification => 0.85,
        VerificationStatus::Unverified => 0.75,
        VerificationStatus::Disputed => 0.55,
        VerificationStatus::Quarantined
        | VerificationStatus::PendingAdminApproval
        | VerificationStatus::Rejected => 0.05,
    };

    let advisory_bonus = match post.travel_advisory {
        TravelAdvisory::Danger => 15.0,
        TravelAdvisory::Caution => 7.0,
        TravelAdvisory::Safe => 0.0,
    };

    let telemetry_bonus =
        if post.is_live_captured { 5.0 } else { 0.0 } + if post.is_on_site { 5.0 } else { 0.0 };

    let quorum_bonus = (f64::from(post.confirmations) * 1.5).min(10.0);

    let age_hours = DateTime::parse_from_rfc3339(&post.created_at)
        .map(|dt| {
            let secs = now.signed_duration_since(dt.with_timezone(&Utc)).num_seconds();
            (secs.max(0) as f64) / 3600.0
        })
        .unwrap_or(24.0);

    // 18-hour half-life: lambda = ln(2) / 18
    let decay = (-std::f64::consts::LN_2 * (age_hours / 18.0)).exp();
    let resolution_factor = if post.is_resolved { 0.25 } else { 1.0 };

    let raw = (base_severity + advisory_bonus + telemetry_bonus + quorum_bonus)
        * trust_multiplier
        * decay
        * resolution_factor;

    (raw.clamp(0.0, 100.0) * 100.0).round() / 100.0
}

/// Combined Token Jaccard + Character Trigram Dice similarity (0.0 ..= 1.0)
/// for detecting near-duplicate or corroborating incident reports.
pub fn text_similarity(a: &str, b: &str) -> f64 {
    let norm_a = normalize_for_similarity(a);
    let norm_b = normalize_for_similarity(b);
    if norm_a.is_empty() || norm_b.is_empty() {
        return 0.0;
    }
    if norm_a == norm_b {
        return 1.0;
    }

    let tokens_a: HashSet<&str> = norm_a.split_whitespace().filter(|t| t.len() >= 2).collect();
    let tokens_b: HashSet<&str> = norm_b.split_whitespace().filter(|t| t.len() >= 2).collect();
    let jaccard = if tokens_a.is_empty() && tokens_b.is_empty() {
        0.0
    } else {
        let inter = tokens_a.intersection(&tokens_b).count() as f64;
        let union = tokens_a.union(&tokens_b).count() as f64;
        if union > 0.0 { inter / union } else { 0.0 }
    };

    let tri_a = char_trigrams(&norm_a);
    let tri_b = char_trigrams(&norm_b);
    let dice = if tri_a.is_empty() && tri_b.is_empty() {
        0.0
    } else {
        let inter = tri_a.intersection(&tri_b).count() as f64;
        (2.0 * inter) / ((tri_a.len() + tri_b.len()) as f64)
    };

    (0.55 * jaccard + 0.45 * dice).clamp(0.0, 1.0)
}

fn normalize_for_similarity(s: &str) -> String {
    s.to_lowercase()
        .chars()
        .map(|c| if c.is_alphanumeric() || c.is_whitespace() { c } else { ' ' })
        .collect::<String>()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

fn char_trigrams(s: &str) -> HashSet<String> {
    let chars: Vec<char> = s.chars().collect();
    if chars.len() < 3 {
        let mut set = HashSet::new();
        if !chars.is_empty() {
            set.insert(s.to_string());
        }
        return set;
    }
    chars
        .windows(3)
        .map(|w| w.iter().collect::<String>())
        .collect()
}

const PERCEPTUAL_DHASH_MAX_DISTANCE: u32 = 6;

/// Detected duplicate or corroborating post within spatial proximity or visual match.
#[derive(Debug, Clone)]
pub struct DuplicateSignal {
    pub matched_post_id: String,
    pub matched_title: String,
    pub distance_km: f64,
    pub text_similarity: f64,
    pub exact_media_match: bool,
    pub perceptual_match: bool,
    pub dhash_hamming_distance: Option<u32>,
    pub matched_is_quarantined: bool,
}

/// Inspect existing posts `(post, media_sha256, media_dhash)` to detect:
/// 1. Exact SHA-256 recycled media bytes,
/// 2. Perceptual `dHash` visual matches (catches resized/cropped/recompressed spoofed photos), or
/// 3. High-similarity near-duplicate text within `3.0 km`.
pub fn detect_duplicate_or_recycled_signal(
    title: &str,
    description: &str,
    lat: f64,
    lng: f64,
    media_hash: Option<&str>,
    media_dhash: Option<&str>,
    existing: &[(Post, Option<String>, Option<String>)],
) -> Option<DuplicateSignal> {
    let combined_new = format!("{title} {description}");

    // Highest priority: exact cryptographic media reuse
    if let Some(new_hash) = media_hash {
        for (post, existing_hash, _) in existing {
            if existing_hash.as_deref() == Some(new_hash) {
                let dist = haversine_distance_km(lat, lng, post.lat, post.lng);
                let sim = text_similarity(
                    &combined_new,
                    &format!("{} {}", post.title, post.description),
                );
                return Some(DuplicateSignal {
                    matched_post_id: post.id.clone(),
                    matched_title: post.title.clone(),
                    distance_km: (dist * 100.0).round() / 100.0,
                    text_similarity: (sim * 100.0).round() / 100.0,
                    exact_media_match: true,
                    perceptual_match: false,
                    dhash_hamming_distance: Some(0),
                    matched_is_quarantined: post.verification_status.is_quarantined(),
                });
            }
        }
    }

    // Second priority: perceptual dHash visual similarity (resized/re-encoded/screenshot spoofing)
    if let Some(new_dhash) = media_dhash {
        let mut best_perceptual: Option<(u32, &Post, f64, f64)> = None;
        for (post, _, existing_dhash) in existing {
            if let Some(ref ex_dhash) = existing_dhash {
                if let Some(hdist) = dhash_hamming_distance(new_dhash, ex_dhash) {
                    if hdist <= PERCEPTUAL_DHASH_MAX_DISTANCE {
                        let dist = haversine_distance_km(lat, lng, post.lat, post.lng);
                        let sim = text_similarity(
                            &combined_new,
                            &format!("{} {}", post.title, post.description),
                        );
                        let replace = best_perceptual
                            .as_ref()
                            .map(|(best_d, _, _, _)| hdist < *best_d)
                            .unwrap_or(true);
                        if replace {
                            best_perceptual = Some((hdist, post, dist, sim));
                        }
                    }
                }
            }
        }

        if let Some((hdist, post, dist, sim)) = best_perceptual {
            return Some(DuplicateSignal {
                matched_post_id: post.id.clone(),
                matched_title: post.title.clone(),
                distance_km: (dist * 100.0).round() / 100.0,
                text_similarity: (sim * 100.0).round() / 100.0,
                exact_media_match: false,
                perceptual_match: true,
                dhash_hamming_distance: Some(hdist),
                matched_is_quarantined: post.verification_status.is_quarantined(),
            });
        }
    }

    // Tertiary: close proximity (<= 3.0 km) + high text similarity (>= 0.65)
    let mut best: Option<DuplicateSignal> = None;
    for (post, _, _) in existing {
        let dist = haversine_distance_km(lat, lng, post.lat, post.lng);
        if dist <= 3.0 {
            let sim = text_similarity(
                &combined_new,
                &format!("{} {}", post.title, post.description),
            );
            if sim >= 0.65 {
                let replace = best
                    .as_ref()
                    .map(|b| sim > b.text_similarity)
                    .unwrap_or(true);
                if replace {
                    best = Some(DuplicateSignal {
                        matched_post_id: post.id.clone(),
                        matched_title: post.title.clone(),
                        distance_km: (dist * 100.0).round() / 100.0,
                        text_similarity: (sim * 100.0).round() / 100.0,
                        exact_media_match: false,
                        perceptual_match: false,
                        dhash_hamming_distance: None,
                        matched_is_quarantined: post.verification_status.is_quarantined(),
                    });
                }
            }
        }
    }

    best
}

/// Geospatial hazard cluster produced by DBSCAN-style proximity clustering.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HazardHotspot {
    pub cluster_id: usize,
    pub center_lat: f64,
    pub center_lng: f64,
    pub radius_km: f64,
    pub primary_location: String,
    pub dominant_category: Category,
    pub risk_level: TravelAdvisory,
    pub risk_index: u8,
    pub max_severity: u8,
    pub active_reports_count: usize,
    pub verified_reports_count: usize,
    pub post_ids: Vec<String>,
}

/// Network-wide dynamic analytics & hotspot intelligence response.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NetworkHotspotsResponse {
    pub generated_at: String,
    pub total_posts: usize,
    pub active_non_quarantined: usize,
    pub verified_posts: usize,
    pub quarantined_posts: usize,
    pub resolved_posts: usize,
    pub cluster_radius_km: f64,
    pub hotspots: Vec<HazardHotspot>,
}

/// Cluster active unresolved non-quarantined hazards using connected-component spatial clustering
/// (DBSCAN with `min_pts = 1`, Haversine epsilon = `cluster_radius_km`).
pub fn compute_network_hotspots(
    all_posts: &[Post],
    cluster_radius_km: f64,
    now: DateTime<Utc>,
) -> NetworkHotspotsResponse {
    let total_posts = all_posts.len();
    let quarantined_posts = all_posts
        .iter()
        .filter(|p| p.verification_status.is_quarantined())
        .count();
    let verified_posts = all_posts
        .iter()
        .filter(|p| p.verification_status.is_verified())
        .count();
    let resolved_posts = all_posts.iter().filter(|p| p.is_resolved).count();

    let active_candidates: Vec<&Post> = all_posts
        .iter()
        .filter(|p| {
            !p.verification_status.is_quarantined()
                && !p.verification_status.is_hidden_from_public()
                && !p.is_resolved
        })
        .collect();

    let n = active_candidates.len();
    let mut visited = vec![false; n];
    let mut hotspots = Vec::new();

    for i in 0..n {
        if visited[i] {
            continue;
        }
        visited[i] = true;
        let mut queue = VecDeque::new();
        queue.push_back(i);
        let mut cluster_indices = Vec::new();

        while let Some(curr) = queue.pop_front() {
            cluster_indices.push(curr);
            let p_curr = active_candidates[curr];
            for j in 0..n {
                if !visited[j] {
                    let p_other = active_candidates[j];
                    if haversine_distance_km(p_curr.lat, p_curr.lng, p_other.lat, p_other.lng)
                        <= cluster_radius_km
                    {
                        visited[j] = true;
                        queue.push_back(j);
                    }
                }
            }
        }

        let members: Vec<&Post> = cluster_indices
            .iter()
            .map(|&idx| active_candidates[idx])
            .collect();

        // Severity-weighted centroid
        let mut weight_sum = 0.0;
        let mut lat_sum = 0.0;
        let mut lng_sum = 0.0;
        for p in &members {
            let w = f64::from(p.severity.max(1));
            weight_sum += w;
            lat_sum += p.lat * w;
            lng_sum += p.lng * w;
        }
        let center_lat = ((lat_sum / weight_sum) * 1_000_000.0).round() / 1_000_000.0;
        let center_lng = ((lng_sum / weight_sum) * 1_000_000.0).round() / 1_000_000.0;

        let max_dist = members
            .iter()
            .map(|p| haversine_distance_km(center_lat, center_lng, p.lat, p.lng))
            .fold(0.0_f64, f64::max);

        let highest_severity_post = members
            .iter()
            .max_by_key(|p| (p.severity, p.confirmations))
            .copied()
            .unwrap_or(members[0]);

        let max_severity = highest_severity_post.severity;
        let verified_count = members
            .iter()
            .filter(|p| p.verification_status.is_verified())
            .count();

        let avg_priority = members
            .iter()
            .map(|p| compute_priority_score(p, now))
            .sum::<f64>()
            / (members.len() as f64);

        let density_boost = ((members.len().saturating_sub(1)) as f64 * 8.0).min(24.0);
        let risk_index = (avg_priority + density_boost).clamp(0.0, 100.0).round() as u8;

        let risk_level = if members
            .iter()
            .any(|p| p.travel_advisory == TravelAdvisory::Danger)
            || risk_index >= 70
        {
            TravelAdvisory::Danger
        } else if members
            .iter()
            .any(|p| p.travel_advisory == TravelAdvisory::Caution)
            || risk_index >= 35
        {
            TravelAdvisory::Caution
        } else {
            TravelAdvisory::Safe
        };

        hotspots.push(HazardHotspot {
            cluster_id: 0, // assigned after sorting
            center_lat,
            center_lng,
            radius_km: (max_dist.max(0.5) * 100.0).round() / 100.0,
            primary_location: highest_severity_post.location_name.clone(),
            dominant_category: highest_severity_post.category,
            risk_level,
            risk_index,
            max_severity,
            active_reports_count: members.len(),
            verified_reports_count: verified_count,
            post_ids: members.iter().map(|p| p.id.clone()).collect(),
        });
    }

    hotspots.sort_by(|a, b| {
        b.risk_index
            .cmp(&a.risk_index)
            .then_with(|| b.max_severity.cmp(&a.max_severity))
    });
    for (idx, cluster) in hotspots.iter_mut().enumerate() {
        cluster.cluster_id = idx + 1;
    }

    NetworkHotspotsResponse {
        generated_at: now.to_rfc3339_opts(chrono::SecondsFormat::Secs, true),
        total_posts,
        active_non_quarantined: all_posts.len().saturating_sub(quarantined_posts),
        verified_posts,
        quarantined_posts,
        resolved_posts,
        cluster_radius_km,
        hotspots,
    }
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct RouteWaypoint {
    pub lat: f64,
    pub lng: f64,
}

#[derive(Debug, Clone, Deserialize)]
pub struct RouteSafetyRequest {
    pub waypoints: Vec<RouteWaypoint>,
    #[serde(default = "default_corridor_km")]
    pub corridor_km: f64,
    #[serde(default)]
    pub verified_only: bool,
}

const fn default_corridor_km() -> f64 {
    10.0
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RouteHazardMatch {
    pub post_id: String,
    pub title: String,
    pub location_name: String,
    pub category: Category,
    pub travel_advisory: TravelAdvisory,
    pub severity: u8,
    pub verification_status: VerificationStatus,
    pub distance_to_route_km: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RouteSafetyResponse {
    pub overall_advisory: TravelAdvisory,
    pub risk_score: u8,
    pub total_route_km: f64,
    pub corridor_km: f64,
    pub hazards_on_route: Vec<RouteHazardMatch>,
}

/// Analyze whether an eco-tourism or responder travel corridor intersects active hazards
/// using point-to-segment distance over each waypoint leg.
pub fn analyze_route_safety(
    req: &RouteSafetyRequest,
    active_posts: &[Post],
) -> AppResult<RouteSafetyResponse> {
    if req.waypoints.len() < 2 || req.waypoints.len() > 100 {
        return Err(AppError::bad_request(
            "waypoints must contain between 2 and 100 coordinates",
        ));
    }
    if !req.corridor_km.is_finite() || req.corridor_km <= 0.0 || req.corridor_km > 200.0 {
        return Err(AppError::bad_request(
            "corridor_km must be between 0.1 and 200.0",
        ));
    }
    for (idx, wp) in req.waypoints.iter().enumerate() {
        validate_coordinates(wp.lat, wp.lng, &format!("waypoint[{idx}]"))?;
    }

    let mut total_route_km = 0.0;
    for pair in req.waypoints.windows(2) {
        total_route_km += haversine_distance_km(pair[0].lat, pair[0].lng, pair[1].lat, pair[1].lng);
    }

    let mut hazards = Vec::new();
    for post in active_posts {
        if post.verification_status.is_quarantined()
            || post.verification_status.is_hidden_from_public()
            || post.is_resolved
        {
            continue;
        }
        if req.verified_only && !post.verification_status.is_verified() {
            continue;
        }

        let min_dist = req
            .waypoints
            .windows(2)
            .map(|seg| point_to_segment_distance_km(post.lat, post.lng, &seg[0], &seg[1]))
            .fold(f64::INFINITY, f64::min);

        if min_dist <= req.corridor_km {
            hazards.push(RouteHazardMatch {
                post_id: post.id.clone(),
                title: post.title.clone(),
                location_name: post.location_name.clone(),
                category: post.category,
                travel_advisory: post.travel_advisory,
                severity: post.severity,
                verification_status: post.verification_status,
                distance_to_route_km: (min_dist * 100.0).round() / 100.0,
            });
        }
    }

    hazards.sort_by(|a, b| {
        b.severity
            .cmp(&a.severity)
            .then_with(|| a.distance_to_route_km.total_cmp(&b.distance_to_route_km))
    });

    let max_sev = hazards.iter().map(|h| h.severity).max().unwrap_or(0);
    let risk_score = if hazards.is_empty() {
        0
    } else {
        let base = f64::from(max_sev) * 8.5;
        let count_factor = ((hazards.len().saturating_sub(1)) as f64 * 6.0).min(15.0);
        (base + count_factor).clamp(0.0, 100.0).round() as u8
    };

    let overall_advisory = if hazards
        .iter()
        .any(|h| h.travel_advisory == TravelAdvisory::Danger)
        || risk_score >= 70
    {
        TravelAdvisory::Danger
    } else if !hazards.is_empty() {
        TravelAdvisory::Caution
    } else {
        TravelAdvisory::Safe
    };

    Ok(RouteSafetyResponse {
        overall_advisory,
        risk_score,
        total_route_km: (total_route_km * 100.0).round() / 100.0,
        corridor_km: req.corridor_km,
        hazards_on_route: hazards,
    })
}

/// Shortest distance in km from point `(plat, plng)` to line segment `a -> b`
/// using local equirectangular tangent-plane projection (accurate to <0.5% for regional corridors).
fn point_to_segment_distance_km(
    plat: f64,
    plng: f64,
    a: &RouteWaypoint,
    b: &RouteWaypoint,
) -> f64 {
    let ref_lat = ((a.lat + b.lat) / 2.0).to_radians();
    let cos_lat = ref_lat.cos().max(1e-6);

    let ax = a.lng * cos_lat;
    let ay = a.lat;
    let bx = b.lng * cos_lat;
    let by = b.lat;
    let px = plng * cos_lat;
    let py = plat;

    let dx = bx - ax;
    let dy = by - ay;
    let len_sq = dx * dx + dy * dy;

    if len_sq < 1e-12 {
        return haversine_distance_km(plat, plng, a.lat, a.lng);
    }

    let t = (((px - ax) * dx + (py - ay) * dy) / len_sq).clamp(0.0, 1.0);
    let proj_lat = a.lat + t * (b.lat - a.lat);
    let proj_lng = a.lng + t * (b.lng - a.lng);
    haversine_distance_km(plat, plng, proj_lat, proj_lng)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::seed::initial_seed_posts;

    #[test]
    fn magic_bytes_verify_png_and_reject_spoofed_jpeg() {
        let valid_png = b"\x89PNG\r\n\x1a\nrest-of-image";
        assert!(verify_media_magic_bytes("image/png", valid_png).is_ok());

        let fake_jpeg = b"<script>alert(1)</script>";
        assert!(verify_media_magic_bytes("image/jpeg", fake_jpeg).is_err());
    }

    #[test]
    fn text_similarity_detects_near_duplicates() {
        let sim = text_similarity(
            "Landslide blocking A7 highway near Nuwara Eliya",
            "Landslide blocking A7 highway near Nuwara Eliya town",
        );
        assert!(sim > 0.75, "expected high similarity, got {sim}");

        let diff = text_similarity(
            "Landslide blocking A7 highway",
            "Clear sunny trail on Mount Fuji Japan",
        );
        assert!(diff < 0.25, "expected low similarity, got {diff}");
    }

    #[test]
    fn hotspot_clustering_and_route_safety_work_on_seed_data() {
        let posts = initial_seed_posts();
        let now = DateTime::parse_from_rfc3339("2026-11-21T06:00:00Z")
            .unwrap()
            .with_timezone(&Utc);

        let report = compute_network_hotspots(&posts, 25.0, now);
        assert_eq!(report.total_posts, 6);
        assert!(!report.hotspots.is_empty());
        assert_eq!(report.hotspots[0].risk_level, TravelAdvisory::Danger);

        // Corridor from Hatton (6.8916, 80.5955) to Ella (6.8667, 81.0466) passes near Nuwara Eliya A7 landslide
        let route_req = RouteSafetyRequest {
            waypoints: vec![
                RouteWaypoint { lat: 6.8916, lng: 80.5955 },
                RouteWaypoint { lat: 6.9497, lng: 80.7891 },
                RouteWaypoint { lat: 6.8667, lng: 81.0466 },
            ],
            corridor_km: 15.0,
            verified_only: true,
        };
        let route_res = analyze_route_safety(&route_req, &posts).unwrap();
        assert_eq!(route_res.overall_advisory, TravelAdvisory::Danger);
        assert!(route_res.hazards_on_route.len() >= 2);
    }
}
