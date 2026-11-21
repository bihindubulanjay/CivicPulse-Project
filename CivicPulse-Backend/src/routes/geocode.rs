use std::{
    collections::HashMap,
    net::IpAddr,
    sync::{atomic::Ordering, Mutex, OnceLock},
    time::{Duration, Instant},
};

use axum::{
    extract::{Query, State},
    http::HeaderMap,
    Json,
};
use serde::{Deserialize, Serialize};

use crate::{
    error::{AppError, AppResult},
    middleware::rate_limit::{extract_client_ip, IpRateLimiter, OptionalConnectIp},
    services::geofence::validate_coordinates,
    state::AppState,
};

const NOMINATIM_SEARCH_URL: &str = "https://nominatim.openstreetmap.org/search";
const NOMINATIM_REVERSE_URL: &str = "https://nominatim.openstreetmap.org/reverse";
const NOMINATIM_USER_AGENT: &str = "CivicPulse/0.1 (CivicPulse Community Safety Network)";
const GEOCODE_TIMEOUT: Duration = Duration::from_secs(6);
const CACHE_TTL: Duration = Duration::from_secs(600);
const MAX_CACHE_ENTRIES: usize = 256;
const GEOCODE_RATE_LIMIT_PER_MIN: usize = 30;
const MIN_QUERY_LEN: usize = 2;
const MAX_QUERY_LEN: usize = 200;

/// Structured Google-Maps-style address breakdown extracted from OpenStreetMap Nominatim.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Default)]
pub struct AddressDetails {
    pub road: Option<String>,
    pub suburb: Option<String>,
    pub city: Option<String>,
    pub district: Option<String>,
    pub state: Option<String>,
    pub postcode: Option<String>,
    pub country: Option<String>,
    pub country_code: Option<String>,
}

/// Public suggestion item returned by `GET /api/geocode/search`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct GeocodeSuggestion {
    pub display_name: String,
    pub short_name: String,
    pub lat: f64,
    pub lng: f64,
    pub category: Option<String>,
    pub place_type: Option<String>,
    pub address: AddressDetails,
}

/// Public reverse-geocoded place label & structured address returned by `GET /api/geocode/reverse`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ReverseGeocodeResponse {
    pub display_name: String,
    pub short_name: String,
    pub lat: f64,
    pub lng: f64,
    pub category: Option<String>,
    pub place_type: Option<String>,
    pub address: AddressDetails,
}

#[derive(Debug, Deserialize)]
pub struct GeocodeSearchQuery {
    pub q: String,
    pub limit: Option<usize>,
}

#[derive(Debug, Deserialize)]
pub struct ReverseGeocodeQuery {
    pub lat: f64,
    pub lng: f64,
}

#[derive(Debug, Clone, Deserialize, Default)]
pub struct NominatimAddress {
    pub road: Option<String>,
    pub suburb: Option<String>,
    pub neighbourhood: Option<String>,
    pub hamlet: Option<String>,
    pub village: Option<String>,
    pub town: Option<String>,
    pub city: Option<String>,
    pub state_district: Option<String>,
    pub state: Option<String>,
    pub postcode: Option<String>,
    pub country: Option<String>,
    pub country_code: Option<String>,
    pub amenity: Option<String>,
    pub tourism: Option<String>,
    pub natural: Option<String>,
    pub building: Option<String>,
}

#[derive(Debug, Deserialize)]
struct NominatimSearchItem {
    lat: String,
    lon: String,
    display_name: String,
    name: Option<String>,
    category: Option<String>,
    #[serde(rename = "type")]
    place_type: Option<String>,
    address: Option<NominatimAddress>,
}

#[derive(Debug, Deserialize)]
struct NominatimReverseItem {
    lat: Option<String>,
    lon: Option<String>,
    display_name: Option<String>,
    name: Option<String>,
    category: Option<String>,
    #[serde(rename = "type")]
    place_type: Option<String>,
    address: Option<NominatimAddress>,
}

struct CachedValue<V> {
    value: V,
    inserted_at: Instant,
}

struct TtlCache<V> {
    entries: HashMap<String, CachedValue<V>>,
    ttl: Duration,
    max_entries: usize,
}

impl<V: Clone> TtlCache<V> {
    fn new(ttl: Duration, max_entries: usize) -> Self {
        Self {
            entries: HashMap::new(),
            ttl,
            max_entries: max_entries.max(1),
        }
    }

    fn get(&mut self, key: &str, now: Instant) -> Option<V> {
        let expired = self
            .entries
            .get(key)
            .is_some_and(|entry| now.saturating_duration_since(entry.inserted_at) >= self.ttl);
        if expired {
            self.entries.remove(key);
            return None;
        }
        self.entries.get(key).map(|entry| entry.value.clone())
    }

    fn insert(&mut self, key: String, value: V, now: Instant) {
        self.entries
            .retain(|_, entry| now.saturating_duration_since(entry.inserted_at) < self.ttl);

        if !self.entries.contains_key(&key) && self.entries.len() >= self.max_entries {
            if let Some(oldest_key) = self
                .entries
                .iter()
                .min_by_key(|(_, entry)| entry.inserted_at)
                .map(|(k, _)| k.clone())
            {
                self.entries.remove(&oldest_key);
            }
        }

        self.entries.insert(
            key,
            CachedValue {
                value,
                inserted_at: now,
            },
        );
    }
}

fn search_cache() -> &'static Mutex<TtlCache<Vec<GeocodeSuggestion>>> {
    static CACHE: OnceLock<Mutex<TtlCache<Vec<GeocodeSuggestion>>>> = OnceLock::new();
    CACHE.get_or_init(|| Mutex::new(TtlCache::new(CACHE_TTL, MAX_CACHE_ENTRIES)))
}

fn reverse_cache() -> &'static Mutex<TtlCache<ReverseGeocodeResponse>> {
    static CACHE: OnceLock<Mutex<TtlCache<ReverseGeocodeResponse>>> = OnceLock::new();
    CACHE.get_or_init(|| Mutex::new(TtlCache::new(CACHE_TTL, MAX_CACHE_ENTRIES)))
}

fn cache_get<V: Clone>(cache: &Mutex<TtlCache<V>>, key: &str) -> Option<V> {
    let mut guard = match cache.lock() {
        Ok(g) => g,
        Err(poisoned) => poisoned.into_inner(),
    };
    guard.get(key, Instant::now())
}

fn cache_insert<V: Clone>(cache: &Mutex<TtlCache<V>>, key: String, value: V) {
    let mut guard = match cache.lock() {
        Ok(g) => g,
        Err(poisoned) => poisoned.into_inner(),
    };
    guard.insert(key, value, Instant::now());
}

fn normalize_search_query(raw: &str) -> AppResult<String> {
    let trimmed = raw.trim();
    let len = trimmed.chars().count();
    if !(MIN_QUERY_LEN..=MAX_QUERY_LEN).contains(&len) {
        return Err(AppError::bad_request(format!(
            "Search query 'q' must be between {MIN_QUERY_LEN} and {MAX_QUERY_LEN} characters"
        )));
    }
    Ok(trimmed.to_string())
}

fn push_unique_part(parts: &mut Vec<String>, candidate: Option<&str>) {
    let Some(raw) = candidate else {
        return;
    };
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return;
    }
    let lowered = trimmed.to_lowercase();
    let already_present = parts.iter().any(|existing| {
        let existing_lower = existing.to_lowercase();
        existing_lower == lowered
            || existing_lower.contains(&lowered)
            || lowered.contains(&existing_lower)
    });
    if !already_present {
        parts.push(trimmed.to_string());
    }
}

fn coalesce_trimmed(options: &[Option<&str>]) -> Option<String> {
    options
        .iter()
        .flatten()
        .map(|s| s.trim())
        .find(|s| !s.is_empty())
        .map(ToOwned::to_owned)
}

/// Extract structured Google-Maps-style address fields from Nominatim `addressdetails`.
pub fn build_address_details(address: Option<&NominatimAddress>) -> AddressDetails {
    let Some(addr) = address else {
        return AddressDetails::default();
    };
    AddressDetails {
        road: coalesce_trimmed(&[
            addr.road.as_deref(),
            addr.amenity.as_deref(),
            addr.tourism.as_deref(),
            addr.natural.as_deref(),
            addr.building.as_deref(),
        ]),
        suburb: coalesce_trimmed(&[
            addr.suburb.as_deref(),
            addr.neighbourhood.as_deref(),
            addr.hamlet.as_deref(),
            addr.village.as_deref(),
        ]),
        city: coalesce_trimmed(&[
            addr.city.as_deref(),
            addr.town.as_deref(),
            addr.village.as_deref(),
        ]),
        district: coalesce_trimmed(&[addr.state_district.as_deref()]),
        state: coalesce_trimmed(&[addr.state.as_deref()]),
        postcode: coalesce_trimmed(&[addr.postcode.as_deref()]),
        country: coalesce_trimmed(&[addr.country.as_deref()]),
        country_code: coalesce_trimmed(&[addr.country_code.as_deref()])
            .map(|code| code.to_ascii_uppercase()),
    }
}

/// Build a concise human-readable place label from Nominatim structured address fields,
/// falling back to the first 2-3 segments of `display_name`.
pub fn format_short_name(
    name: Option<&str>,
    address: Option<&NominatimAddress>,
    display_name: &str,
) -> String {
    let mut parts: Vec<String> = Vec::with_capacity(3);
    push_unique_part(&mut parts, name);

    if let Some(addr) = address {
        push_unique_part(&mut parts, addr.road.as_deref());
        let neighborhood = addr
            .suburb
            .as_deref()
            .or(addr.neighbourhood.as_deref())
            .or(addr.hamlet.as_deref())
            .or(addr.village.as_deref());
        push_unique_part(&mut parts, neighborhood);

        let locality = addr.city.as_deref().or(addr.town.as_deref());
        push_unique_part(&mut parts, locality);

        if parts.len() < 3 {
            let region = addr.state_district.as_deref().or(addr.state.as_deref());
            push_unique_part(&mut parts, region);
        }
    }

    if !parts.is_empty() {
        parts.truncate(3);
        return parts.join(", ");
    }

    let fallback_segments: Vec<&str> = display_name
        .split(',')
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .take(3)
        .collect();
    if !fallback_segments.is_empty() {
        return fallback_segments.join(", ");
    }

    display_name.trim().to_string()
}

async fn query_nominatim_search(
    http: &reqwest::Client,
    q: &str,
    limit: usize,
    country_codes: Option<&str>,
) -> AppResult<Vec<GeocodeSuggestion>> {
    let limit_str = limit.to_string();
    let mut params: Vec<(&str, &str)> = vec![
        ("q", q),
        ("format", "jsonv2"),
        ("addressdetails", "1"),
        ("limit", &limit_str),
    ];
    if let Some(cc) = country_codes {
        params.push(("countrycodes", cc));
    }

    let resp = http
        .get(NOMINATIM_SEARCH_URL)
        .timeout(GEOCODE_TIMEOUT)
        .header(reqwest::header::USER_AGENT, NOMINATIM_USER_AGENT)
        .header(reqwest::header::ACCEPT_LANGUAGE, "en")
        .query(&params)
        .send()
        .await
        .map_err(|e| {
            tracing::warn!(error = %e, "Nominatim search request failed");
            AppError::service_unavailable("Geocoding service temporarily unavailable")
        })?;

    if !resp.status().is_success() {
        tracing::warn!(status = %resp.status(), "Nominatim search returned non-success status");
        return Err(AppError::service_unavailable(
            "Geocoding service temporarily unavailable",
        ));
    }

    let items: Vec<NominatimSearchItem> = resp.json().await.map_err(|e| {
        tracing::warn!(error = %e, "Failed to parse Nominatim search JSON");
        AppError::service_unavailable("Geocoding service temporarily unavailable")
    })?;

    let mut suggestions = Vec::with_capacity(items.len());
    for item in items {
        let Ok(lat) = item.lat.parse::<f64>() else {
            continue;
        };
        let Ok(lng) = item.lon.parse::<f64>() else {
            continue;
        };
        if !lat.is_finite()
            || !lng.is_finite()
            || !(-90.0..=90.0).contains(&lat)
            || !(-180.0..=180.0).contains(&lng)
        {
            continue;
        }
        let short_name = format_short_name(
            item.name.as_deref(),
            item.address.as_ref(),
            &item.display_name,
        );
        let address = build_address_details(item.address.as_ref());
        suggestions.push(GeocodeSuggestion {
            display_name: item.display_name,
            short_name,
            lat,
            lng,
            category: item.category,
            place_type: item.place_type,
            address,
        });
    }

    Ok(suggestions)
}

fn geocode_rate_limiter() -> &'static IpRateLimiter {
    static LIMITER: OnceLock<IpRateLimiter> = OnceLock::new();
    LIMITER.get_or_init(|| IpRateLimiter::new(GEOCODE_RATE_LIMIT_PER_MIN))
}

fn enforce_geocode_rate_limit(
    state: &AppState,
    headers: &HeaderMap,
    peer_ip: Option<IpAddr>,
) -> AppResult<()> {
    let ip = extract_client_ip(headers, peer_ip, state.config.trust_proxy_headers);
    let decision = geocode_rate_limiter().check_and_record(ip);
    if !decision.allowed {
        state
            .metrics
            .rate_limit_rejections_total
            .fetch_add(1, Ordering::Relaxed);
        return Err(AppError::RateLimited {
            retry_after_secs: decision.retry_after_secs,
            message: format!(
                "Too many location lookups. Try again in {}s.",
                decision.retry_after_secs
            ),
        });
    }
    Ok(())
}

/// Search places via OpenStreetMap Nominatim (prioritizing Sri Lanka, with global fallback).
pub async fn search_places(
    State(state): State<AppState>,
    headers: HeaderMap,
    OptionalConnectIp(peer_ip): OptionalConnectIp,
    Query(query): Query<GeocodeSearchQuery>,
) -> AppResult<Json<Vec<GeocodeSuggestion>>> {
    let q = normalize_search_query(&query.q)?;
    let limit = query.limit.unwrap_or(5).clamp(1, 8);
    let cache_key = format!("{}::{}", q.to_lowercase(), limit);

    if let Some(cached) = cache_get(search_cache(), &cache_key) {
        return Ok(Json(cached));
    }

    enforce_geocode_rate_limit(&state, &headers, peer_ip)?;

    let mut results =
        query_nominatim_search(&state.webhook_http, &q, limit, Some("lk")).await?;
    if results.is_empty() {
        results = query_nominatim_search(&state.webhook_http, &q, limit, None).await?;
    }

    cache_insert(search_cache(), cache_key, results.clone());
    Ok(Json(results))
}

/// Reverse-geocode WGS84 coordinates into a concise human-readable place name.
pub async fn reverse_geocode(
    State(state): State<AppState>,
    headers: HeaderMap,
    OptionalConnectIp(peer_ip): OptionalConnectIp,
    Query(query): Query<ReverseGeocodeQuery>,
) -> AppResult<Json<ReverseGeocodeResponse>> {
    validate_coordinates(query.lat, query.lng, "geocode")?;

    let cache_key = format!("{:.5},{:.5}", query.lat, query.lng);
    if let Some(cached) = cache_get(reverse_cache(), &cache_key) {
        return Ok(Json(cached));
    }

    enforce_geocode_rate_limit(&state, &headers, peer_ip)?;

    let lat_str = format!("{:.6}", query.lat);
    let lng_str = format!("{:.6}", query.lng);

    let resp = state
        .webhook_http
        .get(NOMINATIM_REVERSE_URL)
        .timeout(GEOCODE_TIMEOUT)
        .header(reqwest::header::USER_AGENT, NOMINATIM_USER_AGENT)
        .header(reqwest::header::ACCEPT_LANGUAGE, "en")
        .query(&[
            ("lat", lat_str.as_str()),
            ("lon", lng_str.as_str()),
            ("format", "jsonv2"),
            ("addressdetails", "1"),
        ])
        .send()
        .await
        .map_err(|e| {
            tracing::warn!(error = %e, "Nominatim reverse request failed");
            AppError::service_unavailable("Geocoding service temporarily unavailable")
        })?;

    if !resp.status().is_success() {
        tracing::warn!(status = %resp.status(), "Nominatim reverse returned non-success status");
        return Err(AppError::service_unavailable(
            "Geocoding service temporarily unavailable",
        ));
    }

    let item: NominatimReverseItem = resp.json().await.map_err(|e| {
        tracing::warn!(error = %e, "Failed to parse Nominatim reverse JSON");
        AppError::service_unavailable("Geocoding service temporarily unavailable")
    })?;

    let resolved_lat = item
        .lat
        .as_deref()
        .and_then(|v| v.parse::<f64>().ok())
        .filter(|v| v.is_finite() && (-90.0..=90.0).contains(v))
        .unwrap_or(query.lat);
    let resolved_lng = item
        .lon
        .as_deref()
        .and_then(|v| v.parse::<f64>().ok())
        .filter(|v| v.is_finite() && (-180.0..=180.0).contains(v))
        .unwrap_or(query.lng);

    let fallback_coord = format!("{:.5}, {:.5}", query.lat, query.lng);
    let display_name = item
        .display_name
        .filter(|s| !s.trim().is_empty())
        .unwrap_or_else(|| fallback_coord.clone());
    let short_name = format_short_name(
        item.name.as_deref(),
        item.address.as_ref(),
        &display_name,
    );
    let address = build_address_details(item.address.as_ref());

    let response = ReverseGeocodeResponse {
        display_name,
        short_name,
        lat: resolved_lat,
        lng: resolved_lng,
        category: item.category,
        place_type: item.place_type,
        address,
    };

    cache_insert(reverse_cache(), cache_key, response.clone());
    Ok(Json(response))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn address_details_extracts_suburb_city_district_postcode_country() {
        let raw = NominatimAddress {
            road: Some("Parakrama Road".into()),
            hamlet: Some("Bendiyamulla".into()),
            city: Some("Gampaha".into()),
            state_district: Some("Gampaha District".into()),
            state: Some("Western Province".into()),
            postcode: Some("11000".into()),
            country: Some("Sri Lanka".into()),
            country_code: Some("lk".into()),
            ..Default::default()
        };
        let details = build_address_details(Some(&raw));
        assert_eq!(details.road.as_deref(), Some("Parakrama Road"));
        assert_eq!(details.suburb.as_deref(), Some("Bendiyamulla"));
        assert_eq!(details.city.as_deref(), Some("Gampaha"));
        assert_eq!(details.district.as_deref(), Some("Gampaha District"));
        assert_eq!(details.state.as_deref(), Some("Western Province"));
        assert_eq!(details.postcode.as_deref(), Some("11000"));
        assert_eq!(details.country.as_deref(), Some("Sri Lanka"));
        assert_eq!(details.country_code.as_deref(), Some("LK"));
    }

    #[test]
    fn format_short_name_deduplicates_parts() {
        let addr = NominatimAddress {
            road: Some("Parakrama Road".into()),
            suburb: Some("Bendiyamulla".into()),
            city: Some("Gampaha".into()),
            state_district: Some("Gampaha District".into()),
            ..Default::default()
        };
        let label = format_short_name(
            Some("Parakrama Road"),
            Some(&addr),
            "Parakrama Road, Bendiyamulla, Gampaha, Sri Lanka",
        );
        assert_eq!(label, "Parakrama Road, Bendiyamulla, Gampaha");
    }

    #[test]
    fn format_short_name_falls_back_to_display_name_segments() {
        let label = format_short_name(
            None,
            None,
            "Ella Rock Trail, Ella, Badulla District, Uva Province, Sri Lanka",
        );
        assert_eq!(label, "Ella Rock Trail, Ella, Badulla District");
    }

    #[test]
    fn search_query_validation_enforces_bounds() {
        assert!(normalize_search_query(" ").is_err());
        assert!(normalize_search_query("a").is_err());
        assert!(normalize_search_query(&"x".repeat(201)).is_err());
        assert_eq!(normalize_search_query("  Ella  ").unwrap(), "Ella");
    }

    #[test]
    fn ttl_cache_expires_and_evicts_oldest_at_capacity() {
        let mut cache: TtlCache<String> = TtlCache::new(Duration::from_secs(10), 2);
        let t0 = Instant::now();

        cache.insert("k1".into(), "v1".into(), t0);
        cache.insert("k2".into(), "v2".into(), t0 + Duration::from_secs(1));
        cache.insert("k3".into(), "v3".into(), t0 + Duration::from_secs(2));

        assert!(cache.get("k1", t0 + Duration::from_secs(2)).is_none());
        assert_eq!(
            cache.get("k2", t0 + Duration::from_secs(2)).as_deref(),
            Some("v2")
        );
        assert!(cache.get("k2", t0 + Duration::from_secs(12)).is_none());
    }
}
