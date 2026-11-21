pub mod config;
pub mod db;
pub mod error;
pub mod middleware;
pub mod models;
pub mod routes;
pub mod seed;
pub mod services;
pub mod state;

use std::{
    sync::{atomic::AtomicBool, Arc},
    time::Duration,
};

use axum::Router;
use reqwest::Client;
use tokio::sync::broadcast;

use crate::{
    config::Config,
    db::PostRepository,
    error::{AppError, AppResult},
    middleware::{metrics::AppMetrics, rate_limit::IpRateLimiter},
    seed::initial_seed_posts,
    services::{auth::AuthService, gemini::GeminiClient},
    state::AppState,
};

const SETTING_ALLOW_GUEST_UPLOADS: &str = "allow_guest_uploads";

/// Build the configured Axum application, run migrations, seed initial accounts & posts,
/// and restore persisted settings.
pub async fn build_app(config: Config, repo: PostRepository) -> AppResult<(Router, AppState)> {
    if config.seed_initial_posts {
        let seeded = repo.seed_if_empty(initial_seed_posts()).await?;
        if seeded > 0 {
            tracing::info!(seeded_posts = seeded, "Initialized CivicPulse seed dataset");
        }
    }

    let auth = AuthService::new(repo.clone(), config.session_ttl_hours);
    auth.seed_default_accounts(&config).await?;

    let persisted_guest_uploads = repo
        .get_or_init_bool_setting(
            SETTING_ALLOW_GUEST_UPLOADS,
            config.allow_guest_uploads_default,
        )
        .await?;

    let metrics = AppMetrics::new_shared();
    let gemini = GeminiClient::new(
        config.gemini_api_key.clone(),
        config.gemini_endpoint.clone(),
        config.gemini_timeout_secs,
        Arc::clone(&metrics),
    )?;

    let webhook_http = Client::builder()
        .timeout(Duration::from_secs(10))
        .build()
        .map_err(|e| AppError::internal(format!("Failed to initialize webhook HTTP client: {e}")))?;

    let rate_limiter = IpRateLimiter::new(config.rate_limit_post_per_min);
    let auth_rate_limiter =
        IpRateLimiter::with_window(config.auth_rate_limit_per_15min, Duration::from_secs(900));
    let allow_guest_uploads = Arc::new(AtomicBool::new(persisted_guest_uploads));
    let (events_tx, _) = broadcast::channel(256);

    let state = AppState {
        repo,
        gemini,
        webhook_http,
        rate_limiter,
        auth_rate_limiter,
        auth,
        allow_guest_uploads,
        events_tx,
        metrics,
        config: Arc::new(config),
    };

    let router = routes::create_router(state.clone());
    Ok((router, state))
}
