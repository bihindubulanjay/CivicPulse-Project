use std::{sync::atomic::Ordering, time::Duration};

use chrono::{SecondsFormat, Utc};
use tokio::sync::watch;

use crate::{
    db::AiRetryUpdate,
    services::{
        media::load_media_base64_for_retry,
        trust_engine::status_from_ai_score,
        webhook::maybe_dispatch_emergency_webhook,
    },
    state::AppState,
};

/// Execute one AI retry sweep for fallback reports (`needs_ai_retry = 1`).
/// Exposed publicly so integration tests can trigger deterministic retry passes.
pub async fn run_ai_retry_pass(state: &AppState) -> usize {
    if !state.gemini.is_configured() {
        return 0;
    }

    let pending = match state.repo.list_posts_needing_ai_retry(10).await {
        Ok(list) => list,
        Err(err) => {
            tracing::warn!(error = %err, "Failed to query posts needing AI retry");
            return 0;
        }
    };

    let mut updated_count = 0usize;
    for post in pending {
        let media = post
            .media_url
            .as_deref()
            .and_then(|u| load_media_base64_for_retry(u, &state.config.upload_dir));

        let forensics = state.gemini.retry_post_forensics(&post, media).await;
        if forensics.used_fallback {
            continue;
        }

        let new_status = status_from_ai_score(forensics.ai_authenticity_score);
        match state
            .repo
            .apply_ai_retry_result(
                &post.id,
                AiRetryUpdate {
                    ai_score: forensics.ai_authenticity_score,
                    ai_reasoning: forensics.ai_reasoning,
                    translated_description: forensics.translated_description,
                    travel_advisory: forensics.travel_advisory,
                    severity: forensics.severity,
                    new_status,
                },
            )
            .await
        {
            Ok(Some(updated)) => {
                updated_count += 1;
                state
                    .metrics
                    .ai_retries_succeeded_total
                    .fetch_add(1, Ordering::Relaxed);
                state.publish_event("post_ai_updated", &updated);
                maybe_dispatch_emergency_webhook(
                    state.webhook_http.clone(),
                    state.config.clone(),
                    state.metrics.clone(),
                    updated,
                    "post_ai_updated",
                );
            }
            Ok(None) => {}
            Err(err) => {
                tracing::warn!(post_id = %post.id, error = %err, "Failed to persist AI retry result");
            }
        }
    }

    updated_count
}

/// Spawn background maintenance workers (Gemini 429 retry + expired session cleanup).
pub fn spawn_background_workers(state: AppState, mut shutdown_rx: watch::Receiver<bool>) {
    let retry_interval = Duration::from_secs(state.config.ai_retry_interval_secs);

    tokio::spawn(async move {
        let mut retry_tick = tokio::time::interval(retry_interval);
        let mut cleanup_tick = tokio::time::interval(Duration::from_secs(600));
        retry_tick.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
        cleanup_tick.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);

        // Skip immediate tick at t=0 so startup stays fast.
        retry_tick.tick().await;
        cleanup_tick.tick().await;

        loop {
            tokio::select! {
                _ = shutdown_rx.changed() => {
                    if *shutdown_rx.borrow() {
                        tracing::info!("Background maintenance workers shutting down");
                        break;
                    }
                }
                _ = retry_tick.tick() => {
                    let count = run_ai_retry_pass(&state).await;
                    if count > 0 {
                        tracing::info!(retried = count, "Completed background Gemini AI retry pass");
                    }
                }
                _ = cleanup_tick.tick() => {
                    let now_iso = Utc::now().to_rfc3339_opts(SecondsFormat::Secs, true);
                    if let Ok(removed) = state.repo.cleanup_expired_sessions(&now_iso).await {
                        if removed > 0 {
                            tracing::info!(removed_sessions = removed, "Purged expired auth sessions");
                        }
                    }
                }
            }
        }
    });
}
