use std::sync::{atomic::Ordering, Arc};

use reqwest::Client;
use serde_json::json;
use sha2::{Digest, Sha256};

use crate::{
    config::Config,
    middleware::metrics::AppMetrics,
    models::{Post, TravelAdvisory},
};

/// RFC 2104 HMAC-SHA256 hex signature.
pub fn hmac_sha256_hex(secret: &str, payload: &[u8]) -> String {
    const BLOCK_SIZE: usize = 64;
    let key_bytes = secret.as_bytes();
    let mut key_block = [0u8; BLOCK_SIZE];

    if key_bytes.len() > BLOCK_SIZE {
        let hashed = Sha256::digest(key_bytes);
        key_block[..32].copy_from_slice(&hashed);
    } else {
        key_block[..key_bytes.len()].copy_from_slice(key_bytes);
    }

    let mut ipad = [0x36u8; BLOCK_SIZE];
    let mut opad = [0x5cu8; BLOCK_SIZE];
    for i in 0..BLOCK_SIZE {
        ipad[i] ^= key_block[i];
        opad[i] ^= key_block[i];
    }

    let mut inner = Sha256::new();
    inner.update(ipad);
    inner.update(payload);
    let inner_hash = inner.finalize();

    let mut outer = Sha256::new();
    outer.update(opad);
    outer.update(inner_hash);
    hex::encode(outer.finalize())
}

/// Dispatch an asynchronous HMAC-signed emergency webhook when a verified high-severity
/// (`severity >= 8`, `Danger`) alert becomes active.
pub fn maybe_dispatch_emergency_webhook(
    client: Client,
    config: Arc<Config>,
    metrics: Arc<AppMetrics>,
    post: Post,
    event_name: &'static str,
) {
    let Some(webhook_url) = config.webhook_url.clone() else {
        return;
    };

    if !post.verification_status.is_verified()
        || post.travel_advisory != TravelAdvisory::Danger
        || post.severity < 8
        || post.is_resolved
    {
        return;
    }

    tokio::spawn(async move {
        let body = json!({
            "event": event_name,
            "post_id": post.id,
            "title": post.title,
            "translated_description": post.translated_description,
            "category": post.category,
            "location_name": post.location_name,
            "lat": post.lat,
            "lng": post.lng,
            "travel_advisory": post.travel_advisory,
            "severity": post.severity,
            "verification_status": post.verification_status,
            "integrity_hash": post.integrity_hash,
            "created_at": post.created_at,
        });

        let payload_bytes = match serde_json::to_vec(&body) {
            Ok(b) => b,
            Err(err) => {
                tracing::warn!(error = %err, "Failed to serialize emergency webhook payload");
                return;
            }
        };

        let mut req = client
            .post(&webhook_url)
            .header("content-type", "application/json")
            .header("x-civicpulse-event", event_name);

        if let Some(ref secret) = config.webhook_secret {
            let sig = hmac_sha256_hex(secret, &payload_bytes);
            req = req.header("x-civicpulse-signature", format!("sha256={sig}"));
        }

        match req.body(payload_bytes).send().await {
            Ok(resp) if resp.status().is_success() => {
                metrics.webhooks_sent_total.fetch_add(1, Ordering::Relaxed);
                tracing::info!(
                    post_id = %post.id,
                    event = event_name,
                    status = %resp.status(),
                    "Dispatched emergency responder webhook"
                );
            }
            Ok(resp) => {
                tracing::warn!(
                    post_id = %post.id,
                    status = %resp.status(),
                    "Emergency webhook endpoint returned non-2xx status"
                );
            }
            Err(err) => {
                tracing::warn!(
                    post_id = %post.id,
                    error = %err,
                    "Failed to deliver emergency webhook"
                );
            }
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hmac_sha256_matches_rfc4231_vector() {
        // RFC 4231 Test Case 2: key="Jefe", data="what do ya want for nothing?"
        let sig = hmac_sha256_hex("Jefe", b"what do ya want for nothing?");
        assert_eq!(
            sig,
            "5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843"
        );
    }
}
