use std::env;

/// Default Gemini 2.5 Flash REST endpoint.
pub const DEFAULT_GEMINI_ENDPOINT: &str =
    "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MediaStorageMode {
    File,
    Inline,
}

/// Runtime configuration loaded entirely from environment variables with safe defaults.
#[derive(Debug, Clone)]
pub struct Config {
    pub host: String,
    pub port: u16,
    pub database_path: String,
    pub db_pool_size: u32,
    pub upload_dir: String,
    pub media_storage_mode: MediaStorageMode,
    pub public_base_url: Option<String>,
    pub max_body_size_bytes: usize,
    pub max_decoded_media_bytes: usize,
    pub allowed_origins: Option<Vec<String>>,
    pub trust_proxy_headers: bool,
    pub geofence_radius_km: f64,
    pub rate_limit_post_per_min: usize,
    pub auth_rate_limit_per_15min: usize,
    pub strict_unique_voters: bool,
    pub session_ttl_hours: i64,
    pub allow_guest_uploads_default: bool,
    pub seed_initial_posts: bool,
    pub admin_seed_email: String,
    pub admin_seed_password: String,
    pub admin_seed_name: String,
    pub user_seed_email: String,
    pub user_seed_password: String,
    pub user_seed_name: String,
    pub gemini_api_key: Option<String>,
    pub gemini_endpoint: String,
    pub gemini_timeout_secs: u64,
    pub ai_retry_interval_secs: u64,
    pub stale_alert_hours: i64,
    pub webhook_url: Option<String>,
    pub webhook_secret: Option<String>,
}

impl Config {
    /// Load configuration from environment variables (zero hardcoded production secrets).
    pub fn from_env() -> Self {
        let host = non_empty_env("HOST").unwrap_or_else(|| "0.0.0.0".to_string());
        let port = parse_u16("PORT", 8080);

        let database_path =
            non_empty_env("DATABASE_PATH").unwrap_or_else(|| "./data/civicpulse.db".to_string());
        let db_pool_size = parse_u32("DB_POOL_SIZE", 8).clamp(1, 64);

        let upload_dir =
            non_empty_env("UPLOAD_DIR").unwrap_or_else(|| "./data/uploads".to_string());
        let media_storage_mode = match non_empty_env("MEDIA_STORAGE_MODE")
            .unwrap_or_else(|| "file".to_string())
            .to_ascii_lowercase()
            .as_str()
        {
            "inline" => MediaStorageMode::Inline,
            _ => MediaStorageMode::File,
        };
        let public_base_url =
            non_empty_env("PUBLIC_BASE_URL").map(|u| u.trim_end_matches('/').to_string());

        let max_body_size_bytes =
            parse_usize("MAX_BODY_SIZE_BYTES", 15 * 1024 * 1024).clamp(1024 * 1024, 100 * 1024 * 1024);
        let max_decoded_media_bytes =
            parse_usize("MAX_DECODED_MEDIA_BYTES", 12 * 1024 * 1024).clamp(1024, max_body_size_bytes);

        let allowed_origins = non_empty_env("ALLOWED_ORIGINS").and_then(|raw| {
            if raw.trim() == "*" {
                None
            } else {
                let list: Vec<String> = raw
                    .split(',')
                    .map(str::trim)
                    .filter(|s| !s.is_empty())
                    .map(ToOwned::to_owned)
                    .collect();
                if list.is_empty() {
                    None
                } else {
                    Some(list)
                }
            }
        });

        let trust_proxy_headers = parse_bool("TRUST_PROXY_HEADERS", false);

        let geofence_radius_km = env::var("GEOFENCE_RADIUS_KM")
            .ok()
            .and_then(|v| v.trim().parse::<f64>().ok())
            .filter(|&r| r.is_finite() && r > 0.0)
            .unwrap_or(15.0);

        let rate_limit_post_per_min = parse_usize("RATE_LIMIT_POST_PER_MIN", 10).max(1);
        let auth_rate_limit_per_15min = parse_usize("AUTH_RATE_LIMIT_PER_15MIN", 15).max(1);
        let strict_unique_voters = parse_bool("STRICT_UNIQUE_VOTERS", true);
        let session_ttl_hours = parse_i64("SESSION_TTL_HOURS", 24).clamp(1, 8760);
        let allow_guest_uploads_default = parse_bool("ALLOW_GUEST_UPLOADS_DEFAULT", true);
        let seed_initial_posts = parse_bool("SEED_INITIAL_POSTS", true);

        let admin_seed_email =
            non_empty_env("ADMIN_SEED_EMAIL").unwrap_or_else(|| "admin@civicpulse.org".to_string());
        let admin_seed_password =
            non_empty_env("ADMIN_SEED_PASSWORD").unwrap_or_else(|| "admin123".to_string());
        let admin_seed_name =
            non_empty_env("ADMIN_SEED_NAME").unwrap_or_else(|| "CivicPulse Admin".to_string());

        let user_seed_email =
            non_empty_env("USER_SEED_EMAIL").unwrap_or_else(|| "user@civicpulse.org".to_string());
        let user_seed_password =
            non_empty_env("USER_SEED_PASSWORD").unwrap_or_else(|| "user123".to_string());
        let user_seed_name =
            non_empty_env("USER_SEED_NAME").unwrap_or_else(|| "CivicPulse Reporter".to_string());

        let gemini_api_key = non_empty_env("GEMINI_API_KEY").filter(|k| {
            !k.eq_ignore_ascii_case("your_gemini_api_key_here")
                && !k.eq_ignore_ascii_case("changeme")
        });
        let gemini_endpoint =
            non_empty_env("GEMINI_ENDPOINT").unwrap_or_else(|| DEFAULT_GEMINI_ENDPOINT.to_string());
        let gemini_timeout_secs = parse_u64("GEMINI_TIMEOUT_SECS", 20).clamp(2, 120);
        let ai_retry_interval_secs = parse_u64("AI_RETRY_INTERVAL_SECS", 60).clamp(5, 3600);
        let stale_alert_hours = parse_i64("STALE_ALERT_HOURS", 72).clamp(1, 8760);

        let webhook_url = non_empty_env("WEBHOOK_URL");
        let webhook_secret = non_empty_env("WEBHOOK_SECRET");

        Self {
            host,
            port,
            database_path,
            db_pool_size,
            upload_dir,
            media_storage_mode,
            public_base_url,
            max_body_size_bytes,
            max_decoded_media_bytes,
            allowed_origins,
            trust_proxy_headers,
            geofence_radius_km,
            rate_limit_post_per_min,
            auth_rate_limit_per_15min,
            strict_unique_voters,
            session_ttl_hours,
            allow_guest_uploads_default,
            seed_initial_posts,
            admin_seed_email,
            admin_seed_password,
            admin_seed_name,
            user_seed_email,
            user_seed_password,
            user_seed_name,
            gemini_api_key,
            gemini_endpoint,
            gemini_timeout_secs,
            ai_retry_interval_secs,
            stale_alert_hours,
            webhook_url,
            webhook_secret,
        }
    }

    /// Construct an isolated test configuration (inline media by default so unit/integration tests are clean).
    pub fn for_test(gemini_endpoint: String, gemini_api_key: Option<String>) -> Self {
        Self {
            host: "127.0.0.1".to_string(),
            port: 0,
            database_path: ":memory:".to_string(),
            db_pool_size: 1,
            upload_dir: std::env::temp_dir()
                .join(format!("civicpulse_uploads_{}", uuid::Uuid::new_v4()))
                .to_string_lossy()
                .into_owned(),
            media_storage_mode: MediaStorageMode::Inline,
            public_base_url: None,
            max_body_size_bytes: 15 * 1024 * 1024,
            max_decoded_media_bytes: 12 * 1024 * 1024,
            allowed_origins: None,
            trust_proxy_headers: true,
            geofence_radius_km: 15.0,
            rate_limit_post_per_min: 10,
            auth_rate_limit_per_15min: 15,
            strict_unique_voters: true,
            session_ttl_hours: 24,
            allow_guest_uploads_default: true,
            seed_initial_posts: true,
            admin_seed_email: "admin@civicpulse.org".to_string(),
            admin_seed_password: "admin123".to_string(),
            admin_seed_name: "CivicPulse Admin".to_string(),
            user_seed_email: "user@civicpulse.org".to_string(),
            user_seed_password: "user123".to_string(),
            user_seed_name: "CivicPulse Reporter".to_string(),
            gemini_api_key,
            gemini_endpoint,
            gemini_timeout_secs: 5,
            ai_retry_interval_secs: 60,
            stale_alert_hours: 72,
            webhook_url: None,
            webhook_secret: None,
        }
    }

    pub fn bind_addr(&self) -> String {
        format!("{}:{}", self.host, self.port)
    }
}

fn non_empty_env(key: &str) -> Option<String> {
    env::var(key)
        .ok()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
}

fn parse_bool(key: &str, default: bool) -> bool {
    env::var(key)
        .ok()
        .map(|v| match v.trim().to_ascii_lowercase().as_str() {
            "1" | "true" | "yes" | "on" => true,
            "0" | "false" | "no" | "off" => false,
            _ => default,
        })
        .unwrap_or(default)
}

fn parse_u16(key: &str, default: u16) -> u16 {
    env::var(key)
        .ok()
        .and_then(|v| v.trim().parse::<u16>().ok())
        .filter(|&p| p > 0)
        .unwrap_or(default)
}

fn parse_u32(key: &str, default: u32) -> u32 {
    env::var(key)
        .ok()
        .and_then(|v| v.trim().parse::<u32>().ok())
        .unwrap_or(default)
}

fn parse_u64(key: &str, default: u64) -> u64 {
    env::var(key)
        .ok()
        .and_then(|v| v.trim().parse::<u64>().ok())
        .unwrap_or(default)
}

fn parse_i64(key: &str, default: i64) -> i64 {
    env::var(key)
        .ok()
        .and_then(|v| v.trim().parse::<i64>().ok())
        .unwrap_or(default)
}

fn parse_usize(key: &str, default: usize) -> usize {
    env::var(key)
        .ok()
        .and_then(|v| v.trim().parse::<usize>().ok())
        .unwrap_or(default)
}
