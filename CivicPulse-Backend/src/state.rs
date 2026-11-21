use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc,
};

use chrono::{SecondsFormat, Utc};
use reqwest::Client;
use tokio::sync::broadcast;

use crate::{
    config::Config,
    db::PostRepository,
    middleware::{metrics::AppMetrics, rate_limit::IpRateLimiter},
    models::{Post, RealtimeEvent},
    services::{auth::AuthService, gemini::GeminiClient},
};

/// Shared application state injected into Axum handlers, middleware, and workers.
#[derive(Clone)]
pub struct AppState {
    pub repo: PostRepository,
    pub gemini: GeminiClient,
    pub webhook_http: Client,
    pub rate_limiter: IpRateLimiter,
    pub auth_rate_limiter: IpRateLimiter,
    pub auth: AuthService,
    pub allow_guest_uploads: Arc<AtomicBool>,
    pub events_tx: broadcast::Sender<RealtimeEvent>,
    pub metrics: Arc<AppMetrics>,
    pub config: Arc<Config>,
}

impl AppState {
    pub fn guest_uploads_allowed(&self) -> bool {
        self.allow_guest_uploads.load(Ordering::Relaxed)
    }

    pub fn set_guest_uploads_allowed(&self, allowed: bool) {
        self.allow_guest_uploads.store(allowed, Ordering::Relaxed);
    }

    /// Broadcast a real-time lifecycle event to all connected SSE subscribers.
    pub fn publish_event(&self, event_type: &str, post: &Post) {
        let event = RealtimeEvent {
            event_type: event_type.to_string(),
            post_id: post.id.clone(),
            title: post.title.clone(),
            category: post.category,
            verification_status: post.verification_status,
            travel_advisory: post.travel_advisory,
            severity: post.severity,
            is_resolved: post.is_resolved,
            timestamp: Utc::now().to_rfc3339_opts(SecondsFormat::Secs, true),
        };
        let _ = self.events_tx.send(event);
    }
}
