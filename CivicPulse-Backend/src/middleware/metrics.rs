use std::{
    sync::{
        atomic::{AtomicU64, Ordering},
        Arc,
    },
    time::Instant,
};

use axum::{
    extract::{Request, State},
    http::header,
    middleware::Next,
    response::{IntoResponse, Response},
};

use crate::{error::AppResult, state::AppState};

/// Lock-free atomic counters exported via Prometheus `/metrics`.
#[derive(Debug, Default)]
pub struct AppMetrics {
    pub http_requests_total: AtomicU64,
    pub http_4xx_total: AtomicU64,
    pub http_5xx_total: AtomicU64,
    pub http_duration_ms_sum: AtomicU64,
    pub gemini_calls_total: AtomicU64,
    pub gemini_fallbacks_total: AtomicU64,
    pub rate_limit_rejections_total: AtomicU64,
    pub webhooks_sent_total: AtomicU64,
    pub ai_retries_succeeded_total: AtomicU64,
}

impl AppMetrics {
    pub fn new_shared() -> Arc<Self> {
        Arc::new(Self::default())
    }
}

/// Measure HTTP request count, error bucket, and duration in milliseconds.
pub async fn metrics_middleware(
    State(state): State<AppState>,
    req: Request,
    next: Next,
) -> Response {
    let start = Instant::now();
    let res = next.run(req).await;
    let elapsed_ms = start.elapsed().as_millis() as u64;
    let status = res.status().as_u16();

    state
        .metrics
        .http_requests_total
        .fetch_add(1, Ordering::Relaxed);
    state
        .metrics
        .http_duration_ms_sum
        .fetch_add(elapsed_ms, Ordering::Relaxed);

    if (400..500).contains(&status) {
        state.metrics.http_4xx_total.fetch_add(1, Ordering::Relaxed);
    } else if status >= 500 {
        state.metrics.http_5xx_total.fetch_add(1, Ordering::Relaxed);
    }

    res
}

/// `GET /metrics` — Prometheus text exposition format (`0.0.4`).
pub async fn prometheus_metrics(State(state): State<AppState>) -> AppResult<impl IntoResponse> {
    let counts = state.repo.get_status_counts().await?;
    let m = &state.metrics;
    let sse_clients = state.events_tx.receiver_count();

    let body = format!(
        "# HELP civicpulse_http_requests_total Total HTTP requests handled.\n\
         # TYPE civicpulse_http_requests_total counter\n\
         civicpulse_http_requests_total {}\n\
         # HELP civicpulse_http_4xx_total Total HTTP 4xx client errors.\n\
         # TYPE civicpulse_http_4xx_total counter\n\
         civicpulse_http_4xx_total {}\n\
         # HELP civicpulse_http_5xx_total Total HTTP 5xx server errors.\n\
         # TYPE civicpulse_http_5xx_total counter\n\
         civicpulse_http_5xx_total {}\n\
         # HELP civicpulse_http_duration_ms_sum Cumulative HTTP handling duration in milliseconds.\n\
         # TYPE civicpulse_http_duration_ms_sum counter\n\
         civicpulse_http_duration_ms_sum {}\n\
         # HELP civicpulse_gemini_calls_total Total Gemini API requests attempted.\n\
         # TYPE civicpulse_gemini_calls_total counter\n\
         civicpulse_gemini_calls_total {}\n\
         # HELP civicpulse_gemini_fallbacks_total Total Gemini API fallback invocations.\n\
         # TYPE civicpulse_gemini_fallbacks_total counter\n\
         civicpulse_gemini_fallbacks_total {}\n\
         # HELP civicpulse_rate_limit_rejections_total Total requests rejected with HTTP 429.\n\
         # TYPE civicpulse_rate_limit_rejections_total counter\n\
         civicpulse_rate_limit_rejections_total {}\n\
         # HELP civicpulse_webhooks_sent_total Total emergency webhooks delivered.\n\
         # TYPE civicpulse_webhooks_sent_total counter\n\
         civicpulse_webhooks_sent_total {}\n\
         # HELP civicpulse_ai_retries_succeeded_total Total fallback posts upgraded by background AI retry.\n\
         # TYPE civicpulse_ai_retries_succeeded_total counter\n\
         civicpulse_ai_retries_succeeded_total {}\n\
         # HELP civicpulse_posts_total Current posts stored in database.\n\
         # TYPE civicpulse_posts_total gauge\n\
         civicpulse_posts_total {}\n\
         # HELP civicpulse_posts_verified Current verified posts.\n\
         # TYPE civicpulse_posts_verified gauge\n\
         civicpulse_posts_verified {}\n\
         # HELP civicpulse_posts_pending_admin Current posts awaiting admin approval.\n\
         # TYPE civicpulse_posts_pending_admin gauge\n\
         civicpulse_posts_pending_admin {}\n\
         # HELP civicpulse_posts_quarantined Current quarantined posts.\n\
         # TYPE civicpulse_posts_quarantined gauge\n\
         civicpulse_posts_quarantined {}\n\
         # HELP civicpulse_posts_disputed Current disputed posts.\n\
         # TYPE civicpulse_posts_disputed gauge\n\
         civicpulse_posts_disputed {}\n\
         # HELP civicpulse_posts_resolved Current resolved posts.\n\
         # TYPE civicpulse_posts_resolved gauge\n\
         civicpulse_posts_resolved {}\n\
         # HELP civicpulse_posts_needs_ai_retry Current posts queued for background AI re-verification.\n\
         # TYPE civicpulse_posts_needs_ai_retry gauge\n\
         civicpulse_posts_needs_ai_retry {}\n\
         # HELP civicpulse_users_total Total registered users.\n\
         # TYPE civicpulse_users_total gauge\n\
         civicpulse_users_total {}\n\
         # HELP civicpulse_active_sessions Current unexpired auth sessions.\n\
         # TYPE civicpulse_active_sessions gauge\n\
         civicpulse_active_sessions {}\n\
         # HELP civicpulse_sse_subscribers Active SSE stream subscribers.\n\
         # TYPE civicpulse_sse_subscribers gauge\n\
         civicpulse_sse_subscribers {}\n",
        m.http_requests_total.load(Ordering::Relaxed),
        m.http_4xx_total.load(Ordering::Relaxed),
        m.http_5xx_total.load(Ordering::Relaxed),
        m.http_duration_ms_sum.load(Ordering::Relaxed),
        m.gemini_calls_total.load(Ordering::Relaxed),
        m.gemini_fallbacks_total.load(Ordering::Relaxed),
        m.rate_limit_rejections_total.load(Ordering::Relaxed),
        m.webhooks_sent_total.load(Ordering::Relaxed),
        m.ai_retries_succeeded_total.load(Ordering::Relaxed),
        counts.total,
        counts.verified,
        counts.pending_admin,
        counts.quarantined,
        counts.disputed,
        counts.resolved,
        counts.needs_ai_retry,
        counts.users_count,
        counts.active_sessions_count,
        sse_clients,
    );

    Ok((
        [(
            header::CONTENT_TYPE,
            "text/plain; version=0.0.4; charset=utf-8",
        )],
        body,
    ))
}
