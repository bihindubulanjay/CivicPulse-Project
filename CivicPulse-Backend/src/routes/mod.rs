pub mod admin;
pub mod ai;
pub mod analytics;
pub mod auth;
pub mod docs;
pub mod events;
pub mod export;
pub mod geocode;
pub mod posts;
pub mod uploads;

use std::borrow::Cow;

use axum::{
    extract::{DefaultBodyLimit, State},
    http::HeaderValue,
    middleware,
    routing::{delete, get, post},
    Json, Router,
};
use tower_http::{
    cors::{AllowOrigin, Any, CorsLayer},
    trace::TraceLayer,
};

use crate::{
    error::AppResult,
    middleware::{
        metrics::{metrics_middleware, prometheus_metrics},
        rate_limit::post_rate_limit_middleware,
        security::security_headers_middleware,
    },
    models::HealthResponse,
    state::AppState,
};

/// Assemble the complete Axum router with env-driven CORS, body limit, rate limiting,
/// Prometheus metrics, OpenAPI docs, security headers, and tracing.
pub fn create_router(state: AppState) -> Router {
    let cors = build_cors_layer(state.config.allowed_origins.as_deref());
    let body_limit = state.config.max_body_size_bytes;

    Router::new()
        .route("/health", get(health_check))
        .route("/metrics", get(prometheus_metrics))
        .route("/openapi.json", get(docs::openapi_spec))
        .route("/docs", get(docs::swagger_docs))
        .route("/uploads/{filename}", get(uploads::serve_upload))
        .route("/api/events", get(events::sse_events))
        // Role-Based Auth
        .route("/api/auth/status", get(auth::status))
        .route("/api/auth/register", post(auth::register))
        .route("/api/auth/login", post(auth::login))
        .route("/api/auth/logout", post(auth::logout))
        .route("/api/auth/logout-all", post(auth::logout_all))
        .route("/api/auth/me", get(auth::me))
        .route("/api/auth/change-password", post(auth::change_password))
        // Admin Settings, Users, DB Overview & Moderation (Admin role required)
        .route("/api/admin/overview", get(admin::get_overview))
        .route("/api/admin/users", get(admin::list_users))
        .route("/api/admin/users/{id}/role", post(admin::update_user_role))
        .route(
            "/api/admin/settings",
            get(admin::get_settings).post(admin::update_settings),
        )
        .route("/api/admin/pending", get(admin::list_pending))
        .route("/api/admin/posts/{id}", delete(admin::delete_post))
        .route("/api/admin/posts/{id}/approve", post(admin::approve_post))
        .route("/api/admin/posts/{id}/reject", post(admin::reject_post))
        // Public & Authenticated Posts
        .route("/api/posts", get(posts::list_posts).post(posts::create_post))
        .route("/api/posts/{id}", get(posts::get_post))
        .route(
            "/api/posts/{id}/verify-integrity",
            get(posts::verify_integrity),
        )
        .route("/api/posts/{id}/audit", get(posts::list_audit_logs))
        .route("/api/posts/{id}/verify", post(posts::verify_post))
        .route("/api/posts/{id}/flag", post(posts::flag_post))
        .route("/api/posts/{id}/resolve", post(posts::resolve_post))
        .route("/api/posts/{id}/comment", post(posts::add_comment))
        // AI Tactical Chat, GeoJSON & Analytics
        .route("/api/ai/chat", post(ai::ai_chat))
        .route("/api/export/geojson", get(export::export_geojson))
        .route("/api/geocode/search", get(geocode::search_places))
        .route("/api/geocode/reverse", get(geocode::reverse_geocode))
        .route("/api/analytics/hotspots", get(analytics::get_hotspots))
        .route(
            "/api/analytics/route-safety",
            post(analytics::post_route_safety),
        )
        .layer(middleware::from_fn_with_state(
            state.clone(),
            post_rate_limit_middleware,
        ))
        .layer(DefaultBodyLimit::max(body_limit))
        .layer(middleware::from_fn(security_headers_middleware))
        .layer(middleware::from_fn_with_state(
            state.clone(),
            metrics_middleware,
        ))
        .layer(TraceLayer::new_for_http())
        .layer(cors)
        .with_state(state)
}

fn build_cors_layer(allowed_origins: Option<&[String]>) -> CorsLayer {
    let Some(origins) = allowed_origins else {
        return CorsLayer::permissive();
    };

    let parsed: Vec<HeaderValue> = origins
        .iter()
        .filter_map(|o| HeaderValue::from_str(o).ok())
        .collect();

    if parsed.is_empty() {
        CorsLayer::permissive()
    } else {
        CorsLayer::new()
            .allow_origin(AllowOrigin::list(parsed))
            .allow_methods(Any)
            .allow_headers(Any)
            .expose_headers(Any)
    }
}

async fn health_check(State(state): State<AppState>) -> AppResult<Json<HealthResponse>> {
    let posts_count = state.repo.count_posts().await?;
    Ok(Json(HealthResponse {
        status: Cow::Borrowed("ok"),
        service: Cow::Borrowed("civicpulse-backend"),
        version: Cow::Borrowed(env!("CARGO_PKG_VERSION")),
        posts_count,
        gemini_configured: state.gemini.is_configured(),
        gemini_model: state.gemini.primary_model_name(),
        geofence_radius_km: state.config.geofence_radius_km,
        rate_limit_post_per_min: state.config.rate_limit_post_per_min,
        allow_guest_uploads: state.guest_uploads_allowed(),
    }))
}
