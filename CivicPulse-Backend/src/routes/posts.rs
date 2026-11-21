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
        auth::{AuthSession, UserRole},
        integrity::verify_post_integrity,
        trust_engine::{normalize_required_text, process_new_post},
        webhook::maybe_dispatch_emergency_webhook,
    },
    state::AppState,
};

const MAX_AUTHOR_LEN: usize = 100;
const MAX_COMMENT_LEN: usize = 2000;

fn can_view_post(post: &Post, session: Option<&AuthSession>) -> bool {
    if !post.verification_status.is_hidden_from_public() {
        return true;
    }
    match session {
        Some(s) if s.role == UserRole::Admin => true,
        Some(s) => post.author_id.as_deref() == Some(s.user_id.as_str()),
        None => false,
    }
}

/// Strip raw user/admin email addresses before returning audit entries to non-admin callers.
fn redact_audit_emails(details: &str) -> String {
    let mut sanitized = details.to_string();

    if let Some(start) = sanitized.find("admin='") {
        let val_start = start + "admin='".len();
        if let Some(rel_end) = sanitized[val_start..].find('\'') {
            sanitized.replace_range(val_start..val_start + rel_end, "[redacted]");
        }
    }

    for marker in ["auth(admin:", "auth(user:"] {
        if let Some(start) = sanitized.find(marker) {
            let role = if marker.starts_with("auth(admin") {
                "admin"
            } else {
                "user"
            };
            if let Some(rel_end) = sanitized[start..].find(')') {
                sanitized.replace_range(start..start + rel_end + 1, &format!("auth({role})"));
            }
        }
    }

    for marker in ["actor=admin:", "actor=user:"] {
        if let Some(start) = sanitized.find(marker) {
            let email_start = start + marker.len();
            let rel_end = sanitized[email_start..]
                .find(|c: char| c == ',' || c.is_whitespace())
                .unwrap_or(sanitized.len() - email_start);
            let role = &marker[..marker.len() - 1];
            sanitized.replace_range(start..email_start + rel_end, role);
        }
    }

    sanitized
}

pub async fn list_posts(
    State(state): State<AppState>,
    headers: HeaderMap,
    OptionalConnectIp(peer_ip): OptionalConnectIp,
    Query(query): Query<ListPostsQuery>,
) -> AppResult<impl IntoResponse> {
    let session = state.auth.extract_optional_session(&headers).await?;
    let mut paged = state.repo.list_posts_paged(&query).await?;

    let voter_key = extract_voter_key(
        &headers,
        peer_ip,
        state.config.trust_proxy_headers,
        session.as_ref().map(|s| s.user_id.as_str()),
    );
    let viewer_votes = state.repo.get_viewer_votes(&voter_key).await?;
    for post in &mut paged.posts {
        post.viewer_vote = viewer_votes.get(&post.id).cloned();
    }

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
    headers: HeaderMap,
    OptionalConnectIp(peer_ip): OptionalConnectIp,
    Path(id): Path<String>,
) -> AppResult<Json<Post>> {
    let session = state.auth.extract_optional_session(&headers).await?;
    let mut post = state
        .repo
        .get_post(&id)
        .await?
        .ok_or_else(|| AppError::not_found(format!("Post '{id}' not found")))?;

    if !can_view_post(&post, session.as_ref()) {
        return Err(AppError::not_found(format!("Post '{id}' not found")));
    }

    let voter_key = extract_voter_key(
        &headers,
        peer_ip,
        state.config.trust_proxy_headers,
        session.as_ref().map(|s| s.user_id.as_str()),
    );
    post.viewer_vote = state
        .repo
        .get_viewer_vote_for_post(&post.id, &voter_key)
        .await?;

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
    processed.post.author_id = author_user_id.clone();

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

    if saved.verification_status.is_hidden_from_public()
        || saved.verification_status.is_quarantined()
    {
        state.publish_redacted_event("admin_queue_updated", &saved);
    } else {
        state.publish_event("post_created", &saved);
    }

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
    let session = state.auth.extract_optional_session(&headers).await?;
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
    let voter_user_id = session.as_ref().map(|s| s.user_id.clone());

    let updated = state
        .repo
        .increment_verify(
            &id,
            voter_key,
            voter_user_id,
            state.config.strict_unique_voters,
            weight,
        )
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
    let session = state.auth.extract_optional_session(&headers).await?;
    let voter_key = extract_voter_key(
        &headers,
        peer_ip,
        state.config.trust_proxy_headers,
        session.as_ref().map(|s| s.user_id.as_str()),
    );
    let voter_user_id = session.as_ref().map(|s| s.user_id.clone());

    let updated = state
        .repo
        .increment_flag(
            &id,
            voter_key,
            voter_user_id,
            state.config.strict_unique_voters,
        )
        .await?
        .ok_or_else(|| AppError::not_found(format!("Post '{id}' not found")))?;

    state.publish_event("post_flagged", &updated);
    Ok(Json(updated))
}

pub async fn resolve_post(
    State(state): State<AppState>,
    headers: HeaderMap,
    OptionalConnectIp(peer_ip): OptionalConnectIp,
    Path(id): Path<String>,
) -> AppResult<Json<Post>> {
    let session = state.auth.require_authenticated(&headers).await?;
    let actor_label = format!("{}:{}", session.role.as_str(), session.email);
    let mut updated = state
        .repo
        .toggle_resolve(&id, &session.user_id, session.role, &actor_label)
        .await?
        .ok_or_else(|| AppError::not_found(format!("Post '{id}' not found")))?;

    let voter_key = extract_voter_key(
        &headers,
        peer_ip,
        state.config.trust_proxy_headers,
        Some(session.user_id.as_str()),
    );
    updated.viewer_vote = state
        .repo
        .get_viewer_vote_for_post(&updated.id, &voter_key)
        .await?;

    state.publish_event("post_resolved", &updated);
    Ok(Json(updated))
}

pub async fn add_comment(
    State(state): State<AppState>,
    headers: HeaderMap,
    OptionalConnectIp(peer_ip): OptionalConnectIp,
    Path(id): Path<String>,
    Json(payload): Json<AddCommentRequest>,
) -> AppResult<(StatusCode, Json<Post>)> {
    let session = state.auth.extract_optional_session(&headers).await?;
    let text = normalize_required_text(&payload.text, "text", MAX_COMMENT_LEN)?;

    let author = match &session {
        Some(s) => s.name.clone(),
        None => {
            if !state.guest_uploads_allowed() {
                return Err(AppError::forbidden(
                    "Guest commenting is disabled while guest uploads are off. Please sign in.",
                ));
            }
            match payload.author.as_deref().map(str::trim) {
                Some(a) if !a.is_empty() => {
                    let normalized = normalize_required_text(a, "author", MAX_AUTHOR_LEN)?;
                    let lower = normalized.to_ascii_lowercase();
                    if lower.contains("admin") || lower == "moderator" {
                        return Err(AppError::bad_request(
                            "Sign in with an administrator account to use an admin name",
                        ));
                    }
                    normalized
                }
                _ => "Community Member".to_string(),
            }
        }
    };

    let comment = Comment {
        author,
        text,
        created_at: Utc::now().to_rfc3339_opts(SecondsFormat::Secs, true),
    };

    let mut updated = state
        .repo
        .add_comment(&id, comment)
        .await?
        .ok_or_else(|| AppError::not_found(format!("Post '{id}' not found")))?;

    let voter_key = extract_voter_key(
        &headers,
        peer_ip,
        state.config.trust_proxy_headers,
        session.as_ref().map(|s| s.user_id.as_str()),
    );
    updated.viewer_vote = state
        .repo
        .get_viewer_vote_for_post(&updated.id, &voter_key)
        .await?;

    state.publish_event("comment_added", &updated);
    Ok((StatusCode::CREATED, Json(updated)))
}

pub async fn verify_integrity(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> AppResult<Json<IntegrityVerifyResponse>> {
    let session = state.auth.extract_optional_session(&headers).await?;
    let post = state
        .repo
        .get_post(&id)
        .await?
        .ok_or_else(|| AppError::not_found(format!("Post '{id}' not found")))?;

    if !can_view_post(&post, session.as_ref()) {
        return Err(AppError::not_found(format!("Post '{id}' not found")));
    }

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
    headers: HeaderMap,
    Path(id): Path<String>,
) -> AppResult<Json<Vec<AuditLogEntry>>> {
    let session = state.auth.extract_optional_session(&headers).await?;
    let post = state
        .repo
        .get_post(&id)
        .await?
        .ok_or_else(|| AppError::not_found(format!("Post '{id}' not found")))?;

    if !can_view_post(&post, session.as_ref()) {
        return Err(AppError::not_found(format!("Post '{id}' not found")));
    }

    let mut logs = state
        .repo
        .list_audit_logs(&id)
        .await?
        .ok_or_else(|| AppError::not_found(format!("Post '{id}' not found")))?;

    let is_admin = session.as_ref().is_some_and(|s| s.role == UserRole::Admin);
    if !is_admin {
        for entry in &mut logs {
            entry.details = redact_audit_emails(&entry.details);
        }
    }

    Ok(Json(logs))
}

/// Bind each vote strictly to the authenticated account ID, or to client IP when unauthenticated.
fn extract_voter_key(
    headers: &HeaderMap,
    connect_ip: Option<std::net::IpAddr>,
    trust_proxy_headers: bool,
    user_id: Option<&str>,
) -> String {
    if let Some(uid) = user_id {
        return format!("user:{uid}");
    }
    let ip = extract_client_ip(headers, connect_ip, trust_proxy_headers);
    format!("ip:{ip}")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn redact_audit_emails_strips_user_and_admin_addresses() {
        let created = "actor=auth(user:kasun@example.com), status='AI Verified', ai_score=90";
        assert_eq!(
            redact_audit_emails(created),
            "actor=auth(user), status='AI Verified', ai_score=90"
        );

        let mod_log = "admin='admin@civicpulse.org', status='Admin Approved' (was 'Pending Admin Approval')";
        assert_eq!(
            redact_audit_emails(mod_log),
            "admin='[redacted]', status='Admin Approved' (was 'Pending Admin Approval')"
        );

        let resolve_log = "actor=admin:admin@civicpulse.org, is_resolved=true";
        assert_eq!(
            redact_audit_emails(resolve_log),
            "actor=admin, is_resolved=true"
        );
    }
}
