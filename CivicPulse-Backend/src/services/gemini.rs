use std::{
    sync::{atomic::Ordering, Arc},
    time::Duration,
};

use base64::{engine::general_purpose::STANDARD as BASE64_STANDARD, Engine as _};
use reqwest::Client;
use serde::{Deserialize, Serialize};
use serde_json::json;

use crate::{
    error::{AppError, AppResult},
    middleware::metrics::AppMetrics,
    models::{AiChatResponse, Category, ChatSourceSummary, Post, TravelAdvisory},
    services::{
        algorithms::{compute_media_fingerprint, verify_media_magic_bytes, DuplicateSignal},
        geofence::haversine_distance_km,
        media::compute_image_dhash,
    },
};

const ALLOWED_MEDIA_MIMES: &[&str] = &[
    "image/jpeg",
    "image/png",
    "image/webp",
    "image/gif",
    "image/heic",
    "image/heif",
    "video/webm",
    "video/mp4",
    "video/quicktime",
];

#[derive(Debug, Clone)]
pub struct ParsedMedia {
    pub data_uri: String,
    pub mime_type: String,
    pub base64_data: String,
    pub decoded_bytes: Vec<u8>,
    pub sha256_fingerprint: String,
    pub perceptual_dhash: Option<String>,
}

#[derive(Debug, Clone)]
pub struct ForensicsInput<'a> {
    pub title: &'a str,
    pub description: &'a str,
    pub category: Category,
    pub location_name: &'a str,
    pub lat: f64,
    pub lng: f64,
    pub is_live_captured: bool,
    pub is_on_site: bool,
    pub distance_km: Option<f64>,
    pub media: Option<&'a ParsedMedia>,
    pub duplicate_signal: Option<&'a DuplicateSignal>,
}

#[derive(Debug, Clone)]
pub struct ForensicsResult {
    pub ai_authenticity_score: u8,
    pub ai_reasoning: String,
    pub translated_description: String,
    pub travel_advisory: TravelAdvisory,
    pub severity: u8,
    pub used_fallback: bool,
}

#[derive(Debug, Deserialize)]
struct GeminiGenerateResponse {
    #[serde(default)]
    candidates: Vec<GeminiCandidate>,
}

#[derive(Debug, Deserialize)]
struct GeminiCandidate {
    content: Option<GeminiContent>,
}

#[derive(Debug, Deserialize)]
struct GeminiContent {
    #[serde(default)]
    parts: Vec<GeminiPart>,
}

#[derive(Debug, Deserialize)]
struct GeminiPart {
    text: Option<String>,
}

#[derive(Debug, Deserialize)]
struct GeminiForensicsJson {
    ai_authenticity_score: i64,
    ai_reasoning: String,
    translated_description: String,
    travel_advisory: String,
    severity: i64,
}

#[derive(Debug, Clone, Serialize)]
struct ContextPostItem<'a> {
    id: &'a str,
    title: &'a str,
    location_name: &'a str,
    category: &'a str,
    lat: f64,
    lng: f64,
    #[serde(skip_serializing_if = "Option::is_none")]
    distance_from_user_km: Option<f64>,
    travel_advisory: &'a str,
    severity: u8,
    verification_status: &'a str,
    is_resolved: bool,
    is_live_captured: bool,
    is_on_site: bool,
    confirmations: u32,
    translated_description: &'a str,
    created_at: &'a str,
}

/// Shared pooled client for Gemini 2.5 Flash Multimodal Forensics and Tactical Safety Chat.
#[derive(Clone)]
pub struct GeminiClient {
    http: Client,
    api_key: Option<String>,
    endpoint: String,
    metrics: Arc<AppMetrics>,
}

impl GeminiClient {
    pub fn new(
        api_key: Option<String>,
        endpoint: String,
        timeout_secs: u64,
        metrics: Arc<AppMetrics>,
    ) -> AppResult<Self> {
        let http = Client::builder()
            .timeout(Duration::from_secs(timeout_secs))
            .pool_max_idle_per_host(8)
            .build()
            .map_err(|e| AppError::internal(format!("Failed to initialize HTTP client: {e}")))?;

        Ok(Self {
            http,
            api_key,
            endpoint,
            metrics,
        })
    }

    pub fn is_configured(&self) -> bool {
        self.api_key.is_some()
    }

    /// Run Layer 2 Gemini 2.5 Flash multimodal forensics, translation, and safety scoring.
    /// Never fails or panics: gracefully falls back to score=55 on missing key, HTTP 429, timeout, or bad JSON.
    pub async fn analyze_post_forensics(&self, input: &ForensicsInput<'_>) -> ForensicsResult {
        self.analyze_with_optional_inline_media(
            input,
            input
                .media
                .map(|m| (m.mime_type.as_str(), m.base64_data.as_str())),
        )
        .await
    }

    /// Re-run Gemini forensics from stored report metadata & media for background 429 recovery.
    pub async fn retry_post_forensics(
        &self,
        post: &Post,
        inline_media: Option<(String, String)>,
    ) -> ForensicsResult {
        let input = ForensicsInput {
            title: &post.title,
            description: &post.description,
            category: post.category,
            location_name: &post.location_name,
            lat: post.lat,
            lng: post.lng,
            is_live_captured: post.is_live_captured,
            is_on_site: post.is_on_site,
            distance_km: None,
            media: None,
            duplicate_signal: None,
        };
        self.analyze_with_optional_inline_media(
            &input,
            inline_media
                .as_ref()
                .map(|(m, b)| (m.as_str(), b.as_str())),
        )
        .await
    }

    async fn analyze_with_optional_inline_media(
        &self,
        input: &ForensicsInput<'_>,
        inline_media: Option<(&str, &str)>,
    ) -> ForensicsResult {
        let Some(api_key) = self.api_key.as_deref() else {
            self.metrics
                .gemini_fallbacks_total
                .fetch_add(1, Ordering::Relaxed);
            return fallback_forensics(
                input,
                "Gemini AI key is not configured; queued for community verification fallback.",
            );
        };

        self.metrics
            .gemini_calls_total
            .fetch_add(1, Ordering::Relaxed);

        let distance_text = match input.distance_km {
            Some(d) => format!("{d:.2} km"),
            None => "unknown (browser GPS not provided)".to_string(),
        };

        let duplicate_note = match input.duplicate_signal {
            Some(sig) if sig.exact_media_match => format!(
                "ALERT: Identical SHA-256 media bytes were previously uploaded in post '{}' ({:.2} km away, quarantined={}). Strongly penalize if reused from a distant or quarantined post.",
                sig.matched_title, sig.distance_km, sig.matched_is_quarantined
            ),
            Some(sig) if sig.perceptual_match => format!(
                "ALERT: Perceptual image hash (dHash distance={:?}/64 bits) visually matches previously uploaded post '{}' ({:.2} km away, quarantined={}). Indicates possible resized, recompressed, or screenshot-spoofed media.",
                sig.dhash_hamming_distance, sig.matched_title, sig.distance_km, sig.matched_is_quarantined
            ),
            Some(sig) => format!(
                "NOTE: Similar report '{}' exists {:.2} km away (text similarity {:.0}%). Could be independent corroboration or duplicate.",
                sig.matched_title,
                sig.distance_km,
                sig.text_similarity * 100.0
            ),
            None => "None detected.".to_string(),
        };

        let prompt = format!(
            "You are CivicPulse's Zero-Fake Forensic & Eco-Tourism Safety Engine.\n\
             Inspect this community hazard/tourism report and optional visual evidence, then return STRICT JSON.\n\
             \n\
             Report Metadata:\n\
             - Title: {title}\n\
             - Category: {category}\n\
             - Location: {location} ({lat:.5}, {lng:.5})\n\
             - Live Browser Camera Capture: {live}\n\
             - On-Site Geofence Verified: {onsite} (distance from reporter GPS: {distance})\n\
             - Original Description: {desc}\n\
             - Visual Media Attached: {has_media}\n\
             - Cross-Report Forensic Signal: {dup_note}\n\
             \n\
             Forensic & Intelligence Tasks:\n\
             1. ai_authenticity_score (integer 0-100): Evaluate credibility, image-text consistency, and screen-spoofing signs (e.g., photos of monitors/phones, moire glare, UI chrome, watermarks, stock photo mismatch, recycled/perceptually matched distant media, or synthetic AI artifacts). Reward coherent real-world evidence paired with live capture & on-site GPS; penalize contradictions, spam, or spoofing (<40 for likely fake/spoofed).\n\
             2. ai_reasoning: Concise 1-2 sentence forensic justification.\n\
             3. translated_description: Translate the description into clear natural English if written in Sinhala, Tamil, or another language; if already English, return a clean English summary/restatement preserving all facts.\n\
             4. travel_advisory: One of exactly 'Safe', 'Caution', or 'Danger' for citizens and eco-tourists.\n\
             5. severity (integer 1-10): 1 = informational/safe, 10 = immediate life-threatening emergency.",
            title = input.title,
            category = input.category.as_str(),
            location = input.location_name,
            lat = input.lat,
            lng = input.lng,
            live = input.is_live_captured,
            onsite = input.is_on_site,
            distance = distance_text,
            desc = input.description,
            has_media = inline_media.is_some(),
            dup_note = duplicate_note,
        );

        let mut parts = vec![json!({ "text": prompt })];
        if let Some((mime_type, b64_data)) = inline_media {
            parts.push(json!({
                "inlineData": {
                    "mimeType": mime_type,
                    "data": b64_data,
                }
            }));
        }

        let payload = json!({
            "contents": [{
                "role": "user",
                "parts": parts
            }],
            "generationConfig": {
                "responseMimeType": "application/json",
                "temperature": 0.2,
                "responseSchema": {
                    "type": "OBJECT",
                    "properties": {
                        "ai_authenticity_score": { "type": "INTEGER" },
                        "ai_reasoning": { "type": "STRING" },
                        "translated_description": { "type": "STRING" },
                        "travel_advisory": {
                            "type": "STRING",
                            "enum": ["Safe", "Caution", "Danger"]
                        },
                        "severity": { "type": "INTEGER" }
                    },
                    "required": [
                        "ai_authenticity_score",
                        "ai_reasoning",
                        "translated_description",
                        "travel_advisory",
                        "severity"
                    ]
                }
            }
        });

        let response = match self
            .http
            .post(&self.endpoint)
            .header("x-goog-api-key", api_key)
            .json(&payload)
            .send()
            .await
        {
            Ok(resp) => resp,
            Err(err) => {
                tracing::warn!(error = %err, "Gemini forensics request failed; activating fallback");
                self.metrics
                    .gemini_fallbacks_total
                    .fetch_add(1, Ordering::Relaxed);
                return fallback_forensics(
                    input,
                    "AI forensic verification temporarily unavailable (network timeout/error); queued for community verification.",
                );
            }
        };

        let status = response.status();
        if !status.is_success() {
            let body_snippet = response.text().await.unwrap_or_default();
            tracing::warn!(
                status = %status,
                body = %truncate_for_log(&body_snippet, 240),
                "Gemini forensics returned non-2xx status; activating fallback"
            );
            self.metrics
                .gemini_fallbacks_total
                .fetch_add(1, Ordering::Relaxed);
            let reason = if status.as_u16() == 429 {
                "Gemini AI rate-limited (HTTP 429); gracefully queued for community verification."
            } else {
                "Gemini AI returned a temporary upstream error; queued for community verification."
            };
            return fallback_forensics(input, reason);
        }

        let parsed: GeminiGenerateResponse = match response.json().await {
            Ok(p) => p,
            Err(err) => {
                tracing::warn!(error = %err, "Failed to parse Gemini HTTP response JSON; activating fallback");
                self.metrics
                    .gemini_fallbacks_total
                    .fetch_add(1, Ordering::Relaxed);
                return fallback_forensics(
                    input,
                    "Unable to parse Gemini AI response envelope; queued for community verification.",
                );
            }
        };

        let Some(raw_text) = extract_response_text(&parsed) else {
            tracing::warn!("Gemini forensics returned empty candidate text; activating fallback");
            self.metrics
                .gemini_fallbacks_total
                .fetch_add(1, Ordering::Relaxed);
            return fallback_forensics(
                input,
                "Gemini AI returned empty forensic output; queued for community verification.",
            );
        };

        match parse_forensics_json(&raw_text, input) {
            Ok(result) => result,
            Err(err) => {
                tracing::warn!(
                    error = %err,
                    raw = %truncate_for_log(&raw_text, 240),
                    "Gemini forensics inner JSON validation failed; activating fallback"
                );
                self.metrics
                    .gemini_fallbacks_total
                    .fetch_add(1, Ordering::Relaxed);
                fallback_forensics(
                    input,
                    "Gemini AI returned non-conforming JSON output; queued for community verification.",
                )
            }
        }
    }

    /// Answer real-time community safety and eco-tourism questions using all active non-quarantined posts.
    pub async fn answer_safety_chat(
        &self,
        message: &str,
        posts: &[Post],
        user_coords: Option<(f64, f64)>,
    ) -> AiChatResponse {
        // Strict defense-in-depth: never inject Quarantined, Pending Admin Approval, or Rejected posts into AI context.
        let mut active_posts: Vec<&Post> = posts
            .iter()
            .filter(|p| {
                !p.verification_status.is_quarantined()
                    && !p.verification_status.is_hidden_from_public()
            })
            .collect();

        // Sort so unresolved/high-severity/recent reports appear first for clarity and source listing.
        active_posts.sort_by(|a, b| {
            a.is_resolved
                .cmp(&b.is_resolved)
                .then_with(|| b.severity.cmp(&a.severity))
                .then_with(|| b.created_at.cmp(&a.created_at))
        });

        let referenced_posts_count = active_posts.len();
        let sources: Vec<ChatSourceSummary> = active_posts
            .iter()
            .take(10)
            .map(|p| ChatSourceSummary {
                id: p.id.clone(),
                title: p.title.clone(),
                location_name: p.location_name.clone(),
                category: p.category,
                travel_advisory: p.travel_advisory,
                severity: p.severity,
                verification_status: p.verification_status,
                is_resolved: p.is_resolved,
            })
            .collect();

        let Some(api_key) = self.api_key.as_deref() else {
            self.metrics
                .gemini_fallbacks_total
                .fetch_add(1, Ordering::Relaxed);
            return AiChatResponse {
                reply: build_deterministic_chat_fallback(message, &active_posts, user_coords),
                referenced_posts_count,
                sources,
                fallback_used: true,
            };
        };

        self.metrics
            .gemini_calls_total
            .fetch_add(1, Ordering::Relaxed);

        let context_items: Vec<ContextPostItem<'_>> = active_posts
            .iter()
            .map(|p| ContextPostItem {
                id: &p.id,
                title: &p.title,
                location_name: &p.location_name,
                category: p.category.as_str(),
                lat: p.lat,
                lng: p.lng,
                distance_from_user_km: user_coords
                    .map(|(ulat, ulng)| (haversine_distance_km(ulat, ulng, p.lat, p.lng) * 10.0).round() / 10.0),
                travel_advisory: p.travel_advisory.as_str(),
                severity: p.severity,
                verification_status: p.verification_status.as_str(),
                is_resolved: p.is_resolved,
                is_live_captured: p.is_live_captured,
                is_on_site: p.is_on_site,
                confirmations: p.confirmations,
                translated_description: &p.translated_description,
                created_at: &p.created_at,
            })
            .collect();

        let context_json = serde_json::to_string(&context_items).unwrap_or_else(|_| "[]".into());
        let user_gps_note = match user_coords {
            Some((ulat, ulng)) => format!("User GPS coordinates: ({ulat:.5}, {ulng:.5})."),
            None => "User GPS coordinates: not provided.".to_string(),
        };

        let prompt = format!(
            "You are the CivicPulse Live Tactical & Eco-Tourism Safety Advisor.\n\
             Answer the user's question accurately using ONLY the live active verified/pending reports below \
             (quarantined fake posts have already been removed). Respond in the same language as the user \
             (English, Sinhala, or Tamil). Highlight active 'Danger' or 'Caution' advisories, verification status, \
             whether an incident is resolved, and clear actionable safety guidance. If no live alert matches a region, \
             state clearly that no active CivicPulse incidents are reported there right now while advising normal precaution.\n\
             \n\
             {user_gps_note}\n\
             Active Live Reports JSON ({referenced_posts_count} total):\n\
             {context_json}\n\
             \n\
             User Question: {message}"
        );

        let payload = json!({
            "contents": [{
                "role": "user",
                "parts": [{ "text": prompt }]
            }],
            "generationConfig": {
                "temperature": 0.3
            }
        });

        let response = match self
            .http
            .post(&self.endpoint)
            .header("x-goog-api-key", api_key)
            .json(&payload)
            .send()
            .await
        {
            Ok(r) => r,
            Err(err) => {
                tracing::warn!(error = %err, "Gemini chat request failed; using deterministic live-data summary");
                self.metrics
                    .gemini_fallbacks_total
                    .fetch_add(1, Ordering::Relaxed);
                return AiChatResponse {
                    reply: build_deterministic_chat_fallback(message, &active_posts, user_coords),
                    referenced_posts_count,
                    sources,
                    fallback_used: true,
                };
            }
        };

        if !response.status().is_success() {
            let status = response.status();
            let body_snippet = response.text().await.unwrap_or_default();
            tracing::warn!(
                status = %status,
                body = %truncate_for_log(&body_snippet, 240),
                "Gemini chat returned non-2xx; using deterministic live-data summary"
            );
            self.metrics
                .gemini_fallbacks_total
                .fetch_add(1, Ordering::Relaxed);
            return AiChatResponse {
                reply: build_deterministic_chat_fallback(message, &active_posts, user_coords),
                referenced_posts_count,
                sources,
                fallback_used: true,
            };
        }

        let parsed: GeminiGenerateResponse = match response.json().await {
            Ok(p) => p,
            Err(err) => {
                tracing::warn!(error = %err, "Failed to parse Gemini chat response; using deterministic fallback");
                self.metrics
                    .gemini_fallbacks_total
                    .fetch_add(1, Ordering::Relaxed);
                return AiChatResponse {
                    reply: build_deterministic_chat_fallback(message, &active_posts, user_coords),
                    referenced_posts_count,
                    sources,
                    fallback_used: true,
                };
            }
        };

        match extract_response_text(&parsed) {
            Some(reply) if !reply.trim().is_empty() => AiChatResponse {
                reply: reply.trim().to_string(),
                referenced_posts_count,
                sources,
                fallback_used: false,
            },
            _ => {
                self.metrics
                    .gemini_fallbacks_total
                    .fetch_add(1, Ordering::Relaxed);
                AiChatResponse {
                    reply: build_deterministic_chat_fallback(message, &active_posts, user_coords),
                    referenced_posts_count,
                    sources,
                    fallback_used: true,
                }
            }
        }
    }
}

/// Validate and normalize base64 image/video input (accepts full data URI or raw base64).
pub fn parse_and_validate_media(raw: &str, max_decoded_bytes: usize) -> AppResult<ParsedMedia> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Err(AppError::bad_request("media_base64 cannot be blank when provided"));
    }

    let (raw_mime, b64_slice) = if let Some(rest) = trimmed.strip_prefix("data:") {
        let Some((header, payload)) = rest.split_once(',') else {
            return Err(AppError::bad_request(
                "Invalid media data URI: missing comma separator before base64 payload",
            ));
        };
        let mime = header
            .split(';')
            .next()
            .map(str::trim)
            .unwrap_or("")
            .to_ascii_lowercase();
        if !header.to_ascii_lowercase().contains(";base64") {
            return Err(AppError::bad_request(
                "Media data URI must use ';base64' encoding",
            ));
        }
        (mime, payload)
    } else {
        ("image/jpeg".to_string(), trimmed)
    };

    let normalized_mime = match raw_mime.as_str() {
        "image/jpg" => "image/jpeg".to_string(),
        other => other.to_string(),
    };

    if !ALLOWED_MEDIA_MIMES.contains(&normalized_mime.as_str()) {
        return Err(AppError::bad_request(format!(
            "Unsupported media MIME type '{normalized_mime}'. Allowed image/video formats: {}",
            ALLOWED_MEDIA_MIMES.join(", ")
        )));
    }

    let cleaned_b64: String = b64_slice
        .chars()
        .filter(|c| !c.is_ascii_whitespace())
        .collect();

    if cleaned_b64.is_empty() {
        return Err(AppError::bad_request("Empty base64 media payload"));
    }

    let decoded = BASE64_STANDARD
        .decode(&cleaned_b64)
        .map_err(|e| AppError::bad_request(format!("Invalid base64 media payload: {e}")))?;

    if decoded.is_empty() || decoded.len() > max_decoded_bytes {
        return Err(AppError::bad_request(format!(
            "Decoded media size must be between 1 byte and {} bytes",
            max_decoded_bytes
        )));
    }

    // Security check: validate binary magic bytes match declared MIME type
    verify_media_magic_bytes(&normalized_mime, &decoded)?;
    let sha256_fingerprint = compute_media_fingerprint(&decoded);
    let perceptual_dhash = compute_image_dhash(&decoded);

    let data_uri = format!("data:{normalized_mime};base64,{cleaned_b64}");

    Ok(ParsedMedia {
        data_uri,
        mime_type: normalized_mime,
        base64_data: cleaned_b64,
        decoded_bytes: decoded,
        sha256_fingerprint,
        perceptual_dhash,
    })
}

fn parse_forensics_json(raw_text: &str, input: &ForensicsInput<'_>) -> Result<ForensicsResult, String> {
    let json_text = strip_markdown_fences(raw_text);
    let parsed: GeminiForensicsJson =
        serde_json::from_str(json_text).map_err(|e| format!("JSON parse error: {e}"))?;

    let score = parsed.ai_authenticity_score.clamp(0, 100) as u8;
    let severity = parsed.severity.clamp(1, 10) as u8;

    let advisory = parsed
        .travel_advisory
        .parse::<TravelAdvisory>()
        .unwrap_or_else(|_| default_advisory_for_category(input.category));

    let reasoning = if parsed.ai_reasoning.trim().is_empty() {
        "Forensic assessment completed by Gemini 2.5 Flash.".to_string()
    } else {
        parsed.ai_reasoning.trim().to_string()
    };

    let translated = if parsed.translated_description.trim().is_empty() {
        input.description.to_string()
    } else {
        parsed.translated_description.trim().to_string()
    };

    Ok(ForensicsResult {
        ai_authenticity_score: score,
        ai_reasoning: reasoning,
        translated_description: translated,
        travel_advisory: advisory,
        severity,
        used_fallback: false,
    })
}

fn fallback_forensics(input: &ForensicsInput<'_>, reason: &str) -> ForensicsResult {
    ForensicsResult {
        ai_authenticity_score: 55,
        ai_reasoning: reason.to_string(),
        translated_description: input.description.to_string(),
        travel_advisory: default_advisory_for_category(input.category),
        severity: default_severity_for_category(input.category),
        used_fallback: true,
    }
}

const fn default_advisory_for_category(category: Category) -> TravelAdvisory {
    match category {
        Category::Disaster => TravelAdvisory::Danger,
        Category::Road | Category::Nature => TravelAdvisory::Caution,
        Category::Tourism => TravelAdvisory::Caution,
    }
}

const fn default_severity_for_category(category: Category) -> u8 {
    match category {
        Category::Disaster => 7,
        Category::Road => 5,
        Category::Nature | Category::Tourism => 4,
    }
}

fn extract_response_text(resp: &GeminiGenerateResponse) -> Option<String> {
    let candidate = resp.candidates.first()?;
    let content = candidate.content.as_ref()?;
    let joined: String = content
        .parts
        .iter()
        .filter_map(|p| p.text.as_deref())
        .collect::<Vec<_>>()
        .join("\n");
    if joined.trim().is_empty() {
        None
    } else {
        Some(joined)
    }
}

fn strip_markdown_fences(raw: &str) -> &str {
    let trimmed = raw.trim();
    if let Some(after_start) = trimmed.strip_prefix("```") {
        let without_lang = if let Some(idx) = after_start.find('\n') {
            &after_start[idx + 1..]
        } else {
            after_start
        };
        return without_lang
            .trim()
            .strip_suffix("```")
            .map(str::trim)
            .unwrap_or_else(|| without_lang.trim());
    }
    trimmed
}

fn truncate_for_log(s: &str, max_chars: usize) -> String {
    let mut out: String = s.chars().take(max_chars).collect();
    if s.chars().count() > max_chars {
        out.push_str("...");
    }
    out
}

fn build_deterministic_chat_fallback(
    message: &str,
    active_posts: &[&Post],
    user_coords: Option<(f64, f64)>,
) -> String {
    if active_posts.is_empty() {
        return "There are currently no active non-quarantined alerts in the CivicPulse network."
            .to_string();
    }

    let tokens: Vec<String> = message
        .split(|c: char| !c.is_alphanumeric())
        .filter(|w| w.len() >= 3)
        .map(|w| w.to_ascii_lowercase())
        .collect();

    let mut matched: Vec<(&Post, usize, Option<f64>)> = active_posts
        .iter()
        .map(|&p| {
            let haystack = format!(
                "{} {} {} {} {}",
                p.title, p.location_name, p.category, p.translated_description, p.description
            )
            .to_ascii_lowercase();
            let hits = tokens.iter().filter(|t| haystack.contains(t.as_str())).count();
            let dist = user_coords.map(|(ulat, ulng)| haversine_distance_km(ulat, ulng, p.lat, p.lng));
            (p, hits, dist)
        })
        .collect();

    matched.sort_by(|a, b| {
        b.1.cmp(&a.1)
            .then_with(|| a.0.is_resolved.cmp(&b.0.is_resolved))
            .then_with(|| b.0.severity.cmp(&a.0.severity))
    });

    let top: Vec<(&Post, usize, Option<f64>)> = matched.into_iter().take(4).collect();
    let mut lines = vec![format!(
        "Live CivicPulse Advisory (summarized directly from {} active verified/pending reports):",
        active_posts.len()
    )];

    for (post, _, dist) in top {
        let status_label = if post.is_resolved { "Resolved" } else { "Active" };
        let dist_note = dist
            .map(|d| format!(", ~{d:.1} km away"))
            .unwrap_or_default();
        lines.push(format!(
            "- [{} | Severity {}/10 | {} | {}{}] {} ({}): {}",
            post.travel_advisory,
            post.severity,
            status_label,
            post.verification_status,
            dist_note,
            post.title,
            post.location_name,
            post.translated_description
        ));
    }

    lines.join("\n")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validates_data_uri_and_raw_base64() {
        let png_b64 = BASE64_STANDARD.encode(b"\x89PNG\r\n\x1a\nvalid-png-header");
        let uri = format!("data:image/png;base64,{png_b64}");
        let parsed = parse_and_validate_media(&uri, 1024 * 1024).unwrap();
        assert_eq!(parsed.mime_type, "image/png");
        assert_eq!(parsed.base64_data, png_b64);
        assert_eq!(parsed.sha256_fingerprint.len(), 64);

        let jpeg_b64 = BASE64_STANDARD.encode(b"\xFF\xD8\xFF\xE0valid-jpeg");
        let raw_parsed = parse_and_validate_media(&jpeg_b64, 1024 * 1024).unwrap();
        assert_eq!(raw_parsed.mime_type, "image/jpeg");
        assert!(raw_parsed.data_uri.starts_with("data:image/jpeg;base64,"));
    }

    #[test]
    fn rejects_svg_xss_payload() {
        let svg_b64 = BASE64_STANDARD.encode(b"<svg onload=alert(1)>");
        let uri = format!("data:image/svg+xml;base64,{svg_b64}");
        assert!(parse_and_validate_media(&uri, 1024 * 1024).is_err());
    }

    #[test]
    fn parses_fenced_gemini_json_and_clamps_values() {
        let input = ForensicsInput {
            title: "Test",
            description: "Original desc",
            category: Category::Disaster,
            location_name: "Ella",
            lat: 6.86,
            lng: 81.04,
            is_live_captured: true,
            is_on_site: true,
            distance_km: Some(1.2),
            media: None,
            duplicate_signal: None,
        };
        let raw = "```json\n{\"ai_authenticity_score\":120,\"ai_reasoning\":\"Strong live match\",\"translated_description\":\"Mudslide reported\",\"travel_advisory\":\"Danger\",\"severity\":14}\n```";
        let res = parse_forensics_json(raw, &input).unwrap();
        assert_eq!(res.ai_authenticity_score, 100);
        assert_eq!(res.severity, 10);
        assert_eq!(res.travel_advisory, TravelAdvisory::Danger);
        assert_eq!(res.translated_description, "Mudslide reported");
        assert!(!res.used_fallback);
    }
}
