use std::net::SocketAddr;

use civicpulse_backend::{
    build_app, config::Config, db::PostRepository, services::workers::spawn_background_workers,
};
use tokio::{net::TcpListener, sync::watch};
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt, EnvFilter};

#[tokio::main]
async fn main() {
    dotenvy::dotenv().ok();

    let env_filter = EnvFilter::try_from_default_env()
        .unwrap_or_else(|_| EnvFilter::new("civicpulse_backend=info,tower_http=info"));
    tracing_subscriber::registry()
        .with(env_filter)
        .with(tracing_subscriber::fmt::layer())
        .init();

    let config = Config::from_env();
    let bind_addr = config.bind_addr();

    let repo = match PostRepository::open_file(&config.database_path, config.db_pool_size) {
        Ok(repo) => repo,
        Err(err) => {
            tracing::error!(error = %err, path = %config.database_path, "Failed to initialize SQLite database");
            std::process::exit(1);
        }
    };

    let (app, state) = match build_app(config, repo).await {
        Ok(res) => res,
        Err(err) => {
            tracing::error!(error = %err, "Failed to build CivicPulse server");
            std::process::exit(1);
        }
    };

    let (shutdown_tx, shutdown_rx) = watch::channel(false);
    spawn_background_workers(state.clone(), shutdown_rx);

    let listener = match TcpListener::bind(&bind_addr).await {
        Ok(l) => l,
        Err(err) => {
            tracing::error!(error = %err, addr = %bind_addr, "Failed to bind TCP listener");
            std::process::exit(1);
        }
    };

    tracing::info!(
        addr = %bind_addr,
        database_path = %state.config.database_path,
        db_pool_size = state.config.db_pool_size,
        media_storage_mode = ?state.config.media_storage_mode,
        gemini_configured = state.gemini.is_configured(),
        geofence_radius_km = state.config.geofence_radius_km,
        rate_limit_post_per_min = state.config.rate_limit_post_per_min,
        trust_proxy_headers = state.config.trust_proxy_headers,
        strict_unique_voters = state.config.strict_unique_voters,
        "CivicPulse Rust backend listening"
    );

    if let Err(err) = axum::serve(
        listener,
        app.into_make_service_with_connect_info::<SocketAddr>(),
    )
    .with_graceful_shutdown(shutdown_signal(shutdown_tx))
    .await
    {
        tracing::error!(error = %err, "HTTP server terminated with error");
        std::process::exit(1);
    }

    tracing::info!("CivicPulse Rust backend shut down cleanly");
}

async fn shutdown_signal(shutdown_tx: watch::Sender<bool>) {
    let ctrl_c = async {
        let _ = tokio::signal::ctrl_c().await;
    };

    #[cfg(unix)]
    let terminate = async {
        if let Ok(mut sig) =
            tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())
        {
            sig.recv().await;
        }
    };

    #[cfg(not(unix))]
    let terminate = std::future::pending::<()>();

    tokio::select! {
        _ = ctrl_c => {},
        _ = terminate => {},
    }
    let _ = shutdown_tx.send(true);
}
