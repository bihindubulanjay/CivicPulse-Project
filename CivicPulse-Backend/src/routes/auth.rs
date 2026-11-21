use std::{net::IpAddr, sync::atomic::Ordering};

use axum::{
    extract::State,
    http::{HeaderMap, StatusCode},
    Json,
};
use chrono::{SecondsFormat, Utc};
use serde_json::{json, Value};

use crate::{
    error::{AppError, AppResult},
    middleware::rate_limit::{extract_client_ip, OptionalConnectIp},
    services::auth::{
        AuthResponse, AuthStatusResponse, ChangePasswordRequest, CurrentUserResponse,
        LoginRequest, RegisterRequest,
    },
    state::AppState,
};

fn enforce_auth_rate_limit(
    state: &AppState,
    headers: &HeaderMap,
    peer_ip: Option<IpAddr>,
) -> AppResult<()> {
    let ip = extract_client_ip(headers, peer_ip, state.config.trust_proxy_headers);
    let decision = state.auth_rate_limiter.check_and_record(ip);
    if !decision.allowed {
        state
            .metrics
            .rate_limit_rejections_total
            .fetch_add(1, Ordering::Relaxed);
        return Err(AppError::RateLimited {
            retry_after_secs: decision.retry_after_secs,
            message: format!(
                "Too many authentication attempts. Try again in {}s.",
                decision.retry_after_secs
            ),
        });
    }
    Ok(())
}

/// `GET /api/auth/status` — report whether an Administrator account has already been initialized.
pub async fn status(State(state): State<AppState>) -> AppResult<Json<AuthStatusResponse>> {
    let res = state.auth.status().await?;
    Ok(Json(res))
}

/// `POST /api/auth/register` — create a new user account with Argon2id password hash.
/// Automatically promotes the very first account on a fresh database to `admin`.
pub async fn register(
    State(state): State<AppState>,
    headers: HeaderMap,
    OptionalConnectIp(peer_ip): OptionalConnectIp,
    Json(payload): Json<RegisterRequest>,
) -> AppResult<(StatusCode, Json<AuthResponse>)> {
    enforce_auth_rate_limit(&state, &headers, peer_ip)?;
    let response = state.auth.register(payload).await?;
    Ok((StatusCode::CREATED, Json(response)))
}

/// `POST /api/auth/login` — authenticate user or admin and issue an expiring Bearer session.
pub async fn login(
    State(state): State<AppState>,
    headers: HeaderMap,
    OptionalConnectIp(peer_ip): OptionalConnectIp,
    Json(payload): Json<LoginRequest>,
) -> AppResult<Json<AuthResponse>> {
    enforce_auth_rate_limit(&state, &headers, peer_ip)?;
    let response = state.auth.login(payload).await?;
    Ok(Json(response))
}

/// `POST /api/auth/logout` — revoke the active Bearer token in SQLite.
pub async fn logout(State(state): State<AppState>, headers: HeaderMap) -> AppResult<Json<Value>> {
    state.auth.logout(&headers).await?;
    Ok(Json(json!({ "logged_out": true })))
}

/// `POST /api/auth/logout-all` — revoke all other active sessions for this account while preserving current session.
pub async fn logout_all(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> AppResult<Json<Value>> {
    let revoked_sessions = state.auth.logout_all_other_sessions(&headers).await?;
    Ok(Json(json!({ "revoked_sessions": revoked_sessions })))
}

/// `GET /api/auth/me` — inspect the currently authenticated session & live SQLite profile metrics.
pub async fn me(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> AppResult<Json<CurrentUserResponse>> {
    let session = state.auth.require_authenticated(&headers).await?;
    let now_iso = Utc::now().to_rfc3339_opts(SecondsFormat::Secs, true);
    let (active_sessions_count, reports_submitted, votes_cast) = state
        .repo
        .get_user_profile_stats(&session.user_id, &now_iso)
        .await?;

    Ok(Json(CurrentUserResponse {
        user_id: session.user_id,
        role: session.role,
        name: session.name,
        email: session.email,
        reputation_score: session.reputation_score,
        created_at: session.created_at,
        expires_at: session.expires_at,
        active_sessions_count,
        reports_submitted,
        votes_cast,
    }))
}

/// `POST /api/auth/change-password` — verify current Argon2id password, update hash, and revoke other sessions.
pub async fn change_password(
    State(state): State<AppState>,
    headers: HeaderMap,
    OptionalConnectIp(peer_ip): OptionalConnectIp,
    Json(payload): Json<ChangePasswordRequest>,
) -> AppResult<Json<Value>> {
    enforce_auth_rate_limit(&state, &headers, peer_ip)?;
    state.auth.change_password(&headers, payload).await?;
    Ok(Json(json!({ "password_updated": true })))
}
