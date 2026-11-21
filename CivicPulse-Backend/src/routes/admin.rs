use axum::{
    extract::{Path, State},
    http::HeaderMap,
    Json,
};
use serde::{Deserialize, Serialize};

use crate::{
    error::{AppError, AppResult},
    models::{Post, VerificationStatus},
    services::webhook::maybe_dispatch_emergency_webhook,
    state::AppState,
};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AdminSettingsPayload {
    pub allow_guest_uploads: bool,
}

/// `GET /api/admin/settings` (Admin only) — read persisted guest upload policy.
pub async fn get_settings(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> AppResult<Json<AdminSettingsPayload>> {
    state.auth.require_admin(&headers).await?;
    Ok(Json(AdminSettingsPayload {
        allow_guest_uploads: state.guest_uploads_allowed(),
    }))
}

/// `POST /api/admin/settings` (Admin only) — persist & toggle `allow_guest_uploads`.
pub async fn update_settings(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(payload): Json<AdminSettingsPayload>,
) -> AppResult<Json<AdminSettingsPayload>> {
    let admin = state.auth.require_admin(&headers).await?;
    state
        .repo
        .set_bool_setting("allow_guest_uploads", payload.allow_guest_uploads)
        .await?;
    state.set_guest_uploads_allowed(payload.allow_guest_uploads);

    tracing::info!(
        admin = %admin.email,
        allow_guest_uploads = payload.allow_guest_uploads,
        "Persisted guest upload policy"
    );
    Ok(Json(AdminSettingsPayload {
        allow_guest_uploads: state.guest_uploads_allowed(),
    }))
}

/// `GET /api/admin/pending` (Admin only) — returns `Pending Admin Approval`, `Quarantined`, and `Disputed` posts.
pub async fn list_pending(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> AppResult<Json<Vec<Post>>> {
    state.auth.require_admin(&headers).await?;
    let posts = state.repo.list_pending_admin_posts().await?;
    Ok(Json(posts))
}

/// `POST /api/admin/posts/{id}/approve` (Admin only) — sets status to `Admin Approved` and makes post public.
pub async fn approve_post(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> AppResult<Json<Post>> {
    let admin = state.auth.require_admin(&headers).await?;
    let updated = state
        .repo
        .set_admin_moderation_status(
            &id,
            VerificationStatus::AdminApproved,
            &admin.email,
            "admin_approved",
        )
        .await?
        .ok_or_else(|| AppError::not_found(format!("Post '{id}' not found")))?;

    state.publish_event("post_approved", &updated);
    maybe_dispatch_emergency_webhook(
        state.webhook_http.clone(),
        state.config.clone(),
        state.metrics.clone(),
        updated.clone(),
        "post_approved",
    );
    Ok(Json(updated))
}

/// `POST /api/admin/posts/{id}/reject` (Admin only) — marks post as `Rejected` and hides it from public & pending queues.
pub async fn reject_post(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> AppResult<Json<Post>> {
    let admin = state.auth.require_admin(&headers).await?;
    let updated = state
        .repo
        .set_admin_moderation_status(
            &id,
            VerificationStatus::Rejected,
            &admin.email,
            "admin_rejected",
        )
        .await?
        .ok_or_else(|| AppError::not_found(format!("Post '{id}' not found")))?;
    state.publish_redacted_event("post_rejected", &updated);
    Ok(Json(updated))
}
