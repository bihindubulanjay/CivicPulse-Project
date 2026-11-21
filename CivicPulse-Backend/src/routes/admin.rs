use axum::{
    extract::{Path, State},
    http::HeaderMap,
    Json,
};
use chrono::{SecondsFormat, Utc};
use serde::{Deserialize, Serialize};

use crate::{
    error::{AppError, AppResult},
    models::{AdminUserSummary, DbOverviewCounts, Post, VerificationStatus},
    services::{auth::UserRole, webhook::maybe_dispatch_emergency_webhook},
    state::AppState,
};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AdminSettingsPayload {
    pub allow_guest_uploads: bool,
}

#[derive(Debug, Clone, Deserialize)]
pub struct UpdateUserRolePayload {
    pub role: UserRole,
}

#[derive(Debug, Clone, Serialize)]
pub struct AdminOverviewResponse {
    pub database_engine: &'static str,
    pub database_path: String,
    pub counts: DbOverviewCounts,
    pub allow_guest_uploads: bool,
    pub strict_unique_voters: bool,
    pub geofence_radius_km: f64,
    pub gemini_configured: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct DeletePostResponse {
    pub deleted: bool,
    pub id: String,
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

/// `GET /api/admin/overview` (Admin only) — return live SQLite database & table overview.
pub async fn get_overview(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> AppResult<Json<AdminOverviewResponse>> {
    state.auth.require_admin(&headers).await?;
    let now_iso = Utc::now().to_rfc3339_opts(SecondsFormat::Secs, true);
    let counts = state.repo.get_admin_database_overview(&now_iso).await?;
    Ok(Json(AdminOverviewResponse {
        database_engine: "SQLite (WAL + FTS5)",
        database_path: state.config.database_path.clone(),
        counts,
        allow_guest_uploads: state.guest_uploads_allowed(),
        strict_unique_voters: state.config.strict_unique_voters,
        geofence_radius_km: state.config.geofence_radius_km,
        gemini_configured: state.gemini.is_configured(),
    }))
}

/// `GET /api/admin/users` (Admin only) — list registered accounts & live activity counts.
pub async fn list_users(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> AppResult<Json<Vec<AdminUserSummary>>> {
    state.auth.require_admin(&headers).await?;
    let now_iso = Utc::now().to_rfc3339_opts(SecondsFormat::Secs, true);
    let users = state.repo.list_users_with_stats(&now_iso).await?;
    Ok(Json(users))
}

/// `POST /api/admin/users/{id}/role` (Admin only) — promote/demote user role safely.
pub async fn update_user_role(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(payload): Json<UpdateUserRolePayload>,
) -> AppResult<Json<AdminUserSummary>> {
    let admin = state.auth.require_admin(&headers).await?;
    let now_iso = Utc::now().to_rfc3339_opts(SecondsFormat::Secs, true);
    let updated = state
        .repo
        .update_user_role(&id, payload.role, &now_iso)
        .await?
        .ok_or_else(|| AppError::not_found(format!("User '{id}' not found")))?;

    tracing::info!(
        admin = %admin.email,
        target_user_id = %id,
        new_role = payload.role.as_str(),
        "Updated user role"
    );
    Ok(Json(updated))
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

/// `DELETE /api/admin/posts/{id}` (Admin only) — permanently delete a report and its FTS/audit/comment rows.
pub async fn delete_post(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> AppResult<Json<DeletePostResponse>> {
    let admin = state.auth.require_admin(&headers).await?;
    let deleted = state
        .repo
        .delete_post(&id)
        .await?
        .ok_or_else(|| AppError::not_found(format!("Post '{id}' not found")))?;

    tracing::info!(
        admin = %admin.email,
        post_id = %deleted.id,
        title = %deleted.title,
        "Admin permanently deleted report"
    );
    state.publish_redacted_event("post_deleted", &deleted);
    Ok(Json(DeletePostResponse {
        deleted: true,
        id: deleted.id,
    }))
}
