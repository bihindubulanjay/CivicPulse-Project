use std::{net::IpAddr, sync::atomic::Ordering};

use axum::{
    extract::State,
    http::{HeaderMap, StatusCode},
    Json,
};
use serde_json::{json, Value};

use crate::{
    error::{AppError, AppResult},
    middleware::rate_limit::{extract_client_ip, OptionalConnectIp},
    services::auth::{
        AuthResponse, ChangePasswordRequest, CurrentUserResponse, LoginRequest, RegisterRequest,
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

/// `POST /api/auth/register` — create a new user account with Argon2id password hash.
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

/// `GET /api/auth/me` — inspect the currently authenticated session.
pub async fn me(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> AppResult<Json<CurrentUserResponse>> {
    let session = state.auth.require_authenticated(&headers).await?;
    Ok(Json(CurrentUserResponse {
        role: session.role,
        name: session.name,
        email: session.email,
        reputation_score: session.reputation_score,
    }))
}

/// `POST /api/auth/change-password` — verify current Argon2id password, update hash, and revoke other sessions.
pub async fn change_password(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(payload): Json<ChangePasswordRequest>,
) -> AppResult<Json<Value>> {
    state.auth.change_password(&headers, payload).await?;
    Ok(Json(json!({ "password_updated": true })))
}
