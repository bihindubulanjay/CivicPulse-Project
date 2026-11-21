use std::{borrow::Cow, fmt, str::FromStr};

use serde::{de, Deserialize, Deserializer, Serialize};

/// Supported incident / eco-tourism report categories.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize)]
pub enum Category {
    Disaster,
    Nature,
    Tourism,
    Road,
}

impl Category {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Disaster => "Disaster",
            Self::Nature => "Nature",
            Self::Tourism => "Tourism",
            Self::Road => "Road",
        }
    }
}

impl fmt::Display for Category {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.as_str())
    }
}

impl FromStr for Category {
    type Err = String;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s.trim().to_ascii_lowercase().as_str() {
            "disaster" => Ok(Self::Disaster),
            "nature" => Ok(Self::Nature),
            "tourism" => Ok(Self::Tourism),
            "road" => Ok(Self::Road),
            other => Err(format!(
                "Invalid category '{other}'. Expected one of: Disaster, Nature, Tourism, Road"
            )),
        }
    }
}

impl<'de> Deserialize<'de> for Category {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        let raw = String::deserialize(deserializer)?;
        raw.parse::<Self>().map_err(de::Error::custom)
    }
}

/// Eco-tourism / public safety travel advisory level.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize)]
pub enum TravelAdvisory {
    Safe,
    Caution,
    Danger,
}

impl TravelAdvisory {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Safe => "Safe",
            Self::Caution => "Caution",
            Self::Danger => "Danger",
        }
    }
}

impl fmt::Display for TravelAdvisory {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.as_str())
    }
}

impl FromStr for TravelAdvisory {
    type Err = String;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s.trim().to_ascii_lowercase().as_str() {
            "safe" => Ok(Self::Safe),
            "caution" => Ok(Self::Caution),
            "danger" => Ok(Self::Danger),
            other => Err(format!(
                "Invalid travel_advisory '{other}'. Expected one of: Safe, Caution, Danger"
            )),
        }
    }
}

impl<'de> Deserialize<'de> for TravelAdvisory {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        let raw = String::deserialize(deserializer)?;
        raw.parse::<Self>().map_err(de::Error::custom)
    }
}

/// Trust Engine verification lifecycle status.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize)]
pub enum VerificationStatus {
    Unverified,
    #[serde(rename = "Pending Community Verification")]
    PendingCommunityVerification,
    #[serde(rename = "Pending Admin Approval")]
    PendingAdminApproval,
    #[serde(rename = "AI Verified")]
    AiVerified,
    #[serde(rename = "Community Verified")]
    CommunityVerified,
    #[serde(rename = "Admin Approved")]
    AdminApproved,
    Disputed,
    Quarantined,
    Rejected,
}

impl VerificationStatus {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Unverified => "Unverified",
            Self::PendingCommunityVerification => "Pending Community Verification",
            Self::PendingAdminApproval => "Pending Admin Approval",
            Self::AiVerified => "AI Verified",
            Self::CommunityVerified => "Community Verified",
            Self::AdminApproved => "Admin Approved",
            Self::Disputed => "Disputed",
            Self::Quarantined => "Quarantined",
            Self::Rejected => "Rejected",
        }
    }

    pub const fn is_verified(self) -> bool {
        matches!(
            self,
            Self::AiVerified | Self::CommunityVerified | Self::AdminApproved
        )
    }

    pub const fn is_quarantined(self) -> bool {
        matches!(self, Self::Quarantined)
    }

    /// Posts in `Pending Admin Approval` or `Rejected` are hidden from the public feed, AI chat, and GeoJSON.
    pub const fn is_hidden_from_public(self) -> bool {
        matches!(self, Self::PendingAdminApproval | Self::Rejected)
    }

    /// Posts awaiting moderator review in `GET /api/admin/pending`.
    pub const fn is_pending_admin_review(self) -> bool {
        matches!(
            self,
            Self::PendingAdminApproval | Self::Quarantined | Self::Disputed
        )
    }
}

impl fmt::Display for VerificationStatus {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.as_str())
    }
}

impl FromStr for VerificationStatus {
    type Err = String;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s.trim().to_ascii_lowercase().as_str() {
            "unverified" => Ok(Self::Unverified),
            "pending community verification" => Ok(Self::PendingCommunityVerification),
            "pending admin approval" => Ok(Self::PendingAdminApproval),
            "ai verified" => Ok(Self::AiVerified),
            "community verified" => Ok(Self::CommunityVerified),
            "admin approved" => Ok(Self::AdminApproved),
            "disputed" => Ok(Self::Disputed),
            "quarantined" => Ok(Self::Quarantined),
            "rejected" => Ok(Self::Rejected),
            other => Err(format!("Invalid verification_status '{other}'")),
        }
    }
}

impl<'de> Deserialize<'de> for VerificationStatus {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        let raw = String::deserialize(deserializer)?;
        raw.parse::<Self>().map_err(de::Error::custom)
    }
}

/// Community discussion comment attached to a post.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Comment {
    pub author: String,
    pub text: String,
    pub created_at: String,
}

/// Core CivicPulse report entity.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Post {
    pub id: String,
    pub title: String,
    pub description: String,
    pub translated_description: String,
    pub category: Category,
    pub lat: f64,
    pub lng: f64,
    pub location_name: String,
    pub media_url: Option<String>,
    pub is_live_captured: bool,
    pub is_on_site: bool,
    pub ai_authenticity_score: u8,
    pub ai_reasoning: String,
    pub travel_advisory: TravelAdvisory,
    pub severity: u8,
    pub verification_status: VerificationStatus,
    pub confirmations: u32,
    pub false_flags: u32,
    pub is_resolved: bool,
    pub integrity_hash: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub author_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub viewer_vote: Option<String>,
    pub comments: Vec<Comment>,
    pub created_at: String,
}

/// Request payload for `POST /api/posts`.
#[derive(Debug, Clone, Deserialize)]
pub struct CreatePostRequest {
    pub user_lat: Option<f64>,
    pub user_lng: Option<f64>,
    pub lat: f64,
    pub lng: f64,
    pub title: String,
    pub description: String,
    pub category: Category,
    pub location_name: String,
    #[serde(alias = "media_url")]
    pub media_base64: Option<String>,
    #[serde(default)]
    pub is_live_captured: bool,
}

/// Query parameters for `GET /api/posts`.
#[derive(Debug, Clone, Default, Deserialize)]
pub struct ListPostsQuery {
    pub category: Option<String>,
    pub verified_only: Option<bool>,
    pub search: Option<String>,
    pub exclude_quarantined: Option<bool>,
    pub lat: Option<f64>,
    pub lng: Option<f64>,
    pub radius_km: Option<f64>,
    /// Sort mode: `newest` (default), `priority` (time-decay risk score), `nearest`, or `severity`.
    pub sort: Option<String>,
    /// Pagination page limit (1..=500).
    pub limit: Option<usize>,
    /// Pagination offset.
    pub offset: Option<usize>,
}

/// Paginated post list result returned by repository queries.
#[derive(Debug, Clone)]
pub struct PagedPosts {
    pub posts: Vec<Post>,
    pub total_count: usize,
    pub limit: usize,
    pub offset: usize,
}

/// Aggregate database counts exposed by `/metrics`.
#[derive(Debug, Clone, Default)]
pub struct StatusCounts {
    pub total: usize,
    pub verified: usize,
    pub pending_admin: usize,
    pub quarantined: usize,
    pub disputed: usize,
    pub resolved: usize,
    pub needs_ai_retry: usize,
    pub users_count: usize,
    pub active_sessions_count: usize,
}

/// Request payload for `POST /api/posts/:id/comment`.
#[derive(Debug, Clone, Deserialize)]
pub struct AddCommentRequest {
    #[serde(default)]
    pub author: Option<String>,
    pub text: String,
}

/// Prior conversation turn sent from the frontend for multi-turn live AI chat.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatHistoryTurn {
    pub role: String,
    pub text: String,
}

/// Request payload for `POST /api/ai/chat`.
#[derive(Debug, Clone, Deserialize)]
pub struct AiChatRequest {
    #[serde(alias = "prompt", alias = "query")]
    pub message: String,
    pub user_lat: Option<f64>,
    pub user_lng: Option<f64>,
    #[serde(default)]
    pub history: Vec<ChatHistoryTurn>,
}

/// Compact summary of a live report referenced by the AI tactical chat.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatSourceSummary {
    pub id: String,
    pub title: String,
    pub location_name: String,
    pub category: Category,
    pub travel_advisory: TravelAdvisory,
    pub severity: u8,
    pub verification_status: VerificationStatus,
    pub is_resolved: bool,
}

/// Response payload for `POST /api/ai/chat`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AiChatResponse {
    pub reply: String,
    pub referenced_posts_count: usize,
    pub sources: Vec<ChatSourceSummary>,
    pub fallback_used: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub model_used: Option<String>,
}

/// Query parameters for `GET /api/export/geojson`.
#[derive(Debug, Clone, Default, Deserialize)]
pub struct ExportGeoJsonQuery {
    pub verified_only: Option<bool>,
    pub category: Option<String>,
}

/// RFC 7946 GeoJSON FeatureCollection.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GeoJsonFeatureCollection {
    #[serde(rename = "type")]
    pub collection_type: Cow<'static, str>,
    pub features: Vec<GeoJsonFeature>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GeoJsonFeature {
    #[serde(rename = "type")]
    pub feature_type: Cow<'static, str>,
    pub id: String,
    pub geometry: GeoJsonPoint,
    pub properties: GeoJsonProperties,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GeoJsonPoint {
    #[serde(rename = "type")]
    pub geometry_type: Cow<'static, str>,
    /// RFC 7946 coordinate order: `[longitude, latitude]`.
    pub coordinates: [f64; 2],
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GeoJsonProperties {
    pub title: String,
    pub description: String,
    pub translated_description: String,
    pub category: Category,
    pub location_name: String,
    pub is_live_captured: bool,
    pub is_on_site: bool,
    pub ai_authenticity_score: u8,
    pub ai_reasoning: String,
    pub travel_advisory: TravelAdvisory,
    pub severity: u8,
    pub verification_status: VerificationStatus,
    pub confirmations: u32,
    pub false_flags: u32,
    pub is_resolved: bool,
    pub integrity_hash: String,
    pub comments_count: usize,
    pub created_at: String,
}

/// Health endpoint response payload.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HealthResponse {
    pub status: Cow<'static, str>,
    pub service: Cow<'static, str>,
    pub version: Cow<'static, str>,
    pub posts_count: usize,
    pub gemini_configured: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub gemini_model: Option<String>,
    pub geofence_radius_km: f64,
    pub rate_limit_post_per_min: usize,
    pub allow_guest_uploads: bool,
}

/// Cryptographic integrity verification endpoint response payload.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IntegrityVerifyResponse {
    pub id: String,
    pub valid: bool,
    pub integrity_hash: String,
    pub recomputed_hash: String,
}

/// Immutable audit trail entry recorded for post lifecycle actions.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AuditLogEntry {
    pub id: i64,
    pub post_id: String,
    pub action: String,
    pub details: String,
    pub created_at: String,
}

/// Real-time Server-Sent Event payload broadcast to subscribed clients (`GET /api/events`).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RealtimeEvent {
    pub event_type: String,
    pub post_id: String,
    pub title: String,
    pub category: Category,
    pub verification_status: VerificationStatus,
    pub travel_advisory: TravelAdvisory,
    pub severity: u8,
    pub is_resolved: bool,
    pub timestamp: String,
}

/// Publicly sanitized user summary exposed on `GET /api/admin/users` (never exposes `password_hash`).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AdminUserSummary {
    pub id: String,
    pub name: String,
    pub email: String,
    pub role: String,
    pub reputation_score: u32,
    pub created_at: String,
    pub posts_count: usize,
    pub active_sessions_count: usize,
}

/// Live SQLite table and schema metrics returned by `GET /api/admin/overview`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DbOverviewCounts {
    pub schema_version: i64,
    pub total_users: usize,
    pub admins_count: usize,
    pub active_sessions_count: usize,
    pub total_posts: usize,
    pub verified_posts: usize,
    pub pending_admin_posts: usize,
    pub quarantined_posts: usize,
    pub disputed_posts: usize,
    pub resolved_posts: usize,
    pub total_comments: usize,
    pub total_votes: usize,
    pub total_audit_logs: usize,
}
