use axum::{
    extract::{Path, Query, State},
    http::{HeaderMap, HeaderValue, StatusCode},
    response::IntoResponse,
    Json,
};
use chrono::{SecondsFormat, Utc};

use crate::{
    error::{AppError, AppResult},
    middleware::rate_limit::{extract_client_ip, OptionalConnectIp},
    models::{
        AddCommentRequest, AuditLogEntry, Comment, CreatePostRequest, IntegrityVerifyResponse,
        ListPostsQuery, Post, VerificationStatus,
    },
    services::{
        auth::UserRole,
        integrity::verify_post_integrity,
        trust_engine::{normalize_required_text, process_new_post},
        webhook::maybe_dispatch_emergency_webhook,
    },
    state::AppState,
};

const MAX_AUTHOR_LEN: usize = 100;
const MAX_COMMENT_LEN: usize = 2000;

pub async fn list_posts(
    State(state): State<AppState>,
    Query(query): Query<ListPostsQuery>,
) -> AppResult<impl IntoResponse> {
    let paged = state.repo.list_posts_paged(&query).await?;
    let mut headers = HeaderMap::new();
    if let Ok(v) = HeaderValue::from_str(&paged.total_count.to_string()) {
        headers.insert("x-total-count", v);
    }
    if let Ok(v) = HeaderValue::from_str(&paged.limit.to_string()) {
        headers.insert("x-limit", v);
    }
    if let Ok(v) = HeaderValue::from_str(&paged.offset.to_string()) {
        headers.insert("x-offset", v);
    }
    Ok((headers, Json(paged.posts)))
}

pub async fn get_post(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> AppResult<Json<Post>> {
    let post = state
        .repo
        .get_post(&id)
        .await?
        .ok_or_else(|| AppError::not_found(format!("Post '{id}' not found")))?;
    Ok(Json(post))
}

pub async fn create_post(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(payload): Json<CreatePostRequest>,
) -> AppResult<(StatusCode, Json<Post>)> {
    let session = state.auth.extract_optional_session(&headers).await?;
    let is_guest = session.is_none();

    if is_guest && !state.guest_uploads_allowed() {
        return Err(AppError::forbidden(
            "Guest uploads are currently disabled by administrator. Please sign in to submit a report.",
        ));
    }

    let existing = state.repo.list_posts_with_fingerprints().await?;
    let mut processed = process_new_post(payload, &existing, &state.gemini, &state.config).await?;

    if is_guest {
        processed.post.verification_status = VerificationStatus::PendingAdminApproval;
    }

    let (actor_label, author_user_id) = match &session {
        Some(s) => (
            format!("auth({}:{})", s.role.as_str(), s.email),
            Some(s.user_id.clone()),
        ),
        None => ("guest".to_string(), None),
    };

    let mut audit_details = format!(
        "actor={actor_label}, status='{}', ai_score={}, on_site={}, live={}, retry={}",
        processed.post.verification_status,
        processed.post.ai_authenticity_score,
        processed.post.is_on_site,
        processed.post.is_live_captured,
        processed.needs_ai_retry,
    );
    if let Some(ref sig) = processed.duplicate_signal {
        audit_details.push_str(&format!(
            ", duplicate_signal(matched={}, dist_km={:.2}, exact_media={}, perceptual={}, dhash_dist={:?})",
            sig.matched_post_id,
            sig.distance_km,
            sig.exact_media_match,
            sig.perceptual_match,
            sig.dhash_hamming_distance
        ));
    }

    let saved = state
        .repo
        .insert_post(
            processed.post,
            processed.media_hash,
            processed.media_dhash,
            processed.needs_ai_retry,
            author_user_id,
            audit_details,
        )
        .await?;

    state.publish_event("post_created", &saved);
    maybe_dispatch_emergency_webhook(
        state.webhook_http.clone(),
        state.config.clone(),
        state.metrics.clone(),
        saved.clone(),
        "post_created",
    );

    Ok((StatusCode::CREATED, Json(saved)))
}

pub async fn verify_post(
    State(state): State<AppState>,
    headers: HeaderMap,
    OptionalConnectIp(peer_ip): OptionalConnectIp,
    Path(id): Path<String>,
) -> AppResult<Json<Post>> {
    let session = state.auth.extract_optional_session(&headers).await.ok().flatten();
    let weight = match &session {
        Some(s) if s.role == UserRole::Admin || s.reputation_score >= 50 => 2,
        _ => 1,
    };
    let voter_key = extract_voter_key(
        &headers,
        peer_ip,
        state.config.trust_proxy_headers,
        session.as_ref().map(|s| s.user_id.as_str()),
    );

    let updated = state
        .repo
        .increment_verify(&id, voter_key, state.config.strict_unique_voters, weight)
        .await?
        .ok_or_else(|| AppError::not_found(format!("Post '{id}' not found")))?;

    state.publish_event("post_verified", &updated);
    maybe_dispatch_emergency_webhook(
        state.webhook_http.clone(),
        state.config.clone(),
        state.metrics.clone(),
        updated.clone(),
        "post_verified",
    );
    Ok(Json(updated))
}

pub async fn flag_post(
    State(state): State<AppState>,
    headers: HeaderMap,
    OptionalConnectIp(peer_ip): OptionalConnectIp,
    Path(id): Path<String>,
) -> AppResult<Json<Post>> {
    let session = state.auth.extract_optional_session(&headers).await.ok().flatten();
    let voter_key = extract_voter_key(
        &headers,
        peer_ip,
        state.config.trust_proxy_headers,
        session.as_ref().map(|s| s.user_id.as_str()),
    );
    let updated = state
        .repo
        .increment_flag(&id, voter_key, state.config.strict_unique_voters)
        .await?
        .ok_or_else(|| AppError::not_found(format!("Post '{id}' not found")))?;
    state.publish_event("post_flagged", &updated);
    Ok(Json(updated))
}

pub async fn resolve_post(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> AppResult<Json<Post>> {
    let updated = state
        .repo
        .toggle_resolve(&id)
        .await?
        .ok_or_else(|| AppError::not_found(format!("Post '{id}' not found")))?;
    state.publish_event("post_resolved", &updated);
    Ok(Json(updated))
}

pub async fn add_comment(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Json(payload): Json<AddCommentRequest>,
) -> AppResult<(StatusCode, Json<Post>)> {
    let text = normalize_required_text(&payload.text, "text", MAX_COMMENT_LEN)?;
    let author = match payload.author.as_deref().map(str::trim) {
        Some(a) if !a.is_empty() => normalize_required_text(a, "author", MAX_AUTHOR_LEN)?,
        _ => "Community Member".to_string(),
    };

    let comment = Comment {
        author,
        text,
        created_at: Utc::now().to_rfc3339_opts(SecondsFormat::Secs, true),
    };

    let updated = state
        .repo
        .add_comment(&id, comment)
        .await?
        .ok_or_else(|| AppError::not_found(format!("Post '{id}' not found")))?;
    state.publish_event("comment_added", &updated);
    Ok((StatusCode::CREATED, Json(updated)))
}

pub async fn verify_integrity(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> AppResult<Json<IntegrityVerifyResponse>> {
    let post = state
        .repo
        .get_post(&id)
        .await?
        .ok_or_else(|| AppError::not_found(format!("Post '{id}' not found")))?;

    let (valid, recomputed_hash) = verify_post_integrity(&post);
    Ok(Json(IntegrityVerifyResponse {
        id: post.id,
        valid,
        integrity_hash: post.integrity_hash,
        recomputed_hash,
    }))
}

pub async fn list_audit_logs(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> AppResult<Json<Vec<AuditLogEntry>>> {
    let logs = state
        .repo
        .list_audit_logs(&id)
        .await?
        .ok_or_else(|| AppError::not_found(format!("Post '{id}' not found")))?;
    Ok(Json(logs))
}

fn extract_voter_key(
    headers: &HeaderMap,
    connect_ip: Option<std::net::IpAddr>,
    trust_proxy_headers: bool,
    user_id: Option<&str>,
) -> String {
    if let Some(uid) = user_id {
        return format!("user:{uid}");
    }
    if let Some(cid) = headers.get("x-client-id").and_then(|v| v.to_str().ok()) {
        let trimmed = cid.trim();
        if !trimmed.is_empty() && trimmed.len() <= 128 {
            return format!("client:{trimmed}");
        }
    }
    let ip = extract_client_ip(headers, connect_ip, trust_proxy_headers);
    format!("ip:{ip}")
}
