use std::{
    collections::{HashMap, VecDeque},
    convert::Infallible,
    net::{IpAddr, Ipv4Addr, SocketAddr},
    sync::{atomic::Ordering, Arc, Mutex},
    time::{Duration, Instant},
};

use axum::{
    extract::{ConnectInfo, FromRequestParts, Request, State},
    http::{request::Parts, HeaderMap, HeaderValue, Method},
    middleware::Next,
    response::Response,
};

/// Optional peer IP extractor that never fails in unit/integration `oneshot` tests without `ConnectInfo`.
#[derive(Debug, Clone, Copy)]
pub struct OptionalConnectIp(pub Option<IpAddr>);

impl<S> FromRequestParts<S> for OptionalConnectIp
where
    S: Send + Sync,
{
    type Rejection = Infallible;

    async fn from_request_parts(parts: &mut Parts, _state: &S) -> Result<Self, Self::Rejection> {
        let ip = parts
            .extensions
            .get::<ConnectInfo<SocketAddr>>()
            .map(|c| c.0.ip());
        Ok(Self(ip))
    }
}

use crate::{error::AppError, state::AppState};

const MAX_TRACKED_IPS_BEFORE_SWEEP: usize = 4096;

#[derive(Debug, Clone)]
pub struct RateLimitDecision {
    pub allowed: bool,
    pub limit: usize,
    pub remaining: usize,
    pub retry_after_secs: u64,
}

/// Sliding-window in-memory per-IP rate limiter with configurable quota & window.
#[derive(Clone)]
pub struct IpRateLimiter {
    buckets: Arc<Mutex<HashMap<IpAddr, VecDeque<Instant>>>>,
    max_requests: usize,
    window: Duration,
}

impl IpRateLimiter {
    pub fn new(max_requests: usize) -> Self {
        Self::with_window(max_requests, Duration::from_secs(60))
    }

    pub fn with_window(max_requests: usize, window: Duration) -> Self {
        Self {
            buckets: Arc::new(Mutex::new(HashMap::new())),
            max_requests: max_requests.max(1),
            window,
        }
    }

    pub fn check_and_record(&self, ip: IpAddr) -> RateLimitDecision {
        self.check_and_record_at(ip, Instant::now())
    }

    pub fn check_and_record_at(&self, ip: IpAddr, now: Instant) -> RateLimitDecision {
        let mut buckets = match self.buckets.lock() {
            Ok(guard) => guard,
            Err(poisoned) => poisoned.into_inner(),
        };

        if buckets.len() > MAX_TRACKED_IPS_BEFORE_SWEEP {
            let window = self.window;
            buckets.retain(|_, queue| {
                while let Some(&front) = queue.front() {
                    if now.saturating_duration_since(front) >= window {
                        queue.pop_front();
                    } else {
                        break;
                    }
                }
                !queue.is_empty()
            });
        }

        let queue = buckets.entry(ip).or_default();
        while let Some(&front) = queue.front() {
            if now.saturating_duration_since(front) >= self.window {
                queue.pop_front();
            } else {
                break;
            }
        }

        if queue.len() >= self.max_requests {
            let oldest = queue.front().copied().unwrap_or(now);
            let elapsed = now.saturating_duration_since(oldest);
            let remaining_wait = self.window.saturating_sub(elapsed);
            let retry_after_secs = remaining_wait.as_secs().max(1);
            return RateLimitDecision {
                allowed: false,
                limit: self.max_requests,
                remaining: 0,
                retry_after_secs,
            };
        }

        queue.push_back(now);
        let remaining = self.max_requests.saturating_sub(queue.len());
        RateLimitDecision {
            allowed: true,
            limit: self.max_requests,
            remaining,
            retry_after_secs: 0,
        }
    }
}

/// Axum middleware enforcing per-IP POST rate limits while respecting `trust_proxy_headers`.
pub async fn post_rate_limit_middleware(
    State(state): State<AppState>,
    req: Request,
    next: Next,
) -> Result<Response, AppError> {
    if req.method() != Method::POST {
        return Ok(next.run(req).await);
    }

    let connect_ip = req
        .extensions()
        .get::<ConnectInfo<SocketAddr>>()
        .map(|ci| ci.0.ip());
    let ip = extract_client_ip(req.headers(), connect_ip, state.config.trust_proxy_headers);
    let decision = state.rate_limiter.check_and_record(ip);

    if !decision.allowed {
        state
            .metrics
            .rate_limit_rejections_total
            .fetch_add(1, Ordering::Relaxed);
        tracing::warn!(client_ip = %ip, limit = decision.limit, "POST rate limit exceeded");
        return Err(AppError::RateLimited {
            retry_after_secs: decision.retry_after_secs,
            message: format!(
                "Rate limit exceeded: max {} POST requests per minute allowed. Try again in {}s.",
                decision.limit, decision.retry_after_secs
            ),
        });
    }

    let mut response = next.run(req).await;
    let headers = response.headers_mut();
    if let Ok(val) = HeaderValue::from_str(&decision.limit.to_string()) {
        headers.insert("x-ratelimit-limit", val);
    }
    if let Ok(val) = HeaderValue::from_str(&decision.remaining.to_string()) {
        headers.insert("x-ratelimit-remaining", val);
    }
    Ok(response)
}

/// Extract client IP, trusting `X-Forwarded-For` / `X-Real-IP` ONLY when `trust_proxy_headers == true`.
pub fn extract_client_ip(
    headers: &HeaderMap,
    connect_ip: Option<IpAddr>,
    trust_proxy_headers: bool,
) -> IpAddr {
    if trust_proxy_headers {
        if let Some(ip) = parse_forwarded_ip(headers) {
            return ip;
        }
    }
    connect_ip.unwrap_or(IpAddr::V4(Ipv4Addr::LOCALHOST))
}

fn parse_forwarded_ip(headers: &HeaderMap) -> Option<IpAddr> {
    if let Some(xff) = headers.get("x-forwarded-for").and_then(|v| v.to_str().ok()) {
        for part in xff.split(',') {
            if let Ok(ip) = part.trim().parse::<IpAddr>() {
                return Some(ip);
            }
        }
    }
    if let Some(real_ip) = headers.get("x-real-ip").and_then(|v| v.to_str().ok()) {
        if let Ok(ip) = real_ip.trim().parse::<IpAddr>() {
            return Some(ip);
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn allows_10_posts_then_blocks_11th_within_60s() {
        let limiter = IpRateLimiter::new(10);
        let ip = IpAddr::V4(Ipv4Addr::new(192, 168, 1, 10));
        let start = Instant::now();

        for i in 0..10 {
            let d = limiter.check_and_record_at(ip, start + Duration::from_secs(i));
            assert!(d.allowed, "request {i} should be allowed");
            assert_eq!(d.remaining, 9 - i as usize);
        }

        let blocked = limiter.check_and_record_at(ip, start + Duration::from_secs(15));
        assert!(!blocked.allowed);
        assert_eq!(blocked.remaining, 0);
        assert!(blocked.retry_after_secs >= 1);

        let other_ip = IpAddr::V4(Ipv4Addr::new(10, 0, 0, 5));
        assert!(limiter
            .check_and_record_at(other_ip, start + Duration::from_secs(15))
            .allowed);

        let after_window = limiter.check_and_record_at(ip, start + Duration::from_secs(61));
        assert!(after_window.allowed);
    }

    #[test]
    fn ignores_spoofed_proxy_headers_when_untrusted() {
        let mut headers = HeaderMap::new();
        headers.insert("x-forwarded-for", "203.0.113.55".parse().unwrap());
        let peer = Some(IpAddr::V4(Ipv4Addr::new(198, 51, 100, 10)));

        assert_eq!(
            extract_client_ip(&headers, peer, false),
            IpAddr::V4(Ipv4Addr::new(198, 51, 100, 10))
        );
        assert_eq!(
            extract_client_ip(&headers, peer, true),
            IpAddr::V4(Ipv4Addr::new(203, 0, 113, 55))
        );
    }
}
