use std::{str::FromStr, sync::OnceLock};

use argon2::{
    password_hash::{PasswordHash, PasswordHasher, PasswordVerifier, SaltString},
    Argon2,
};
use axum::http::{header, HeaderMap};
use chrono::{Duration, SecondsFormat, Utc};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use uuid::Uuid;

use crate::{
    config::Config,
    db::PostRepository,
    error::{AppError, AppResult},
    middleware::security::sanitize_text,
};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum UserRole {
    Admin,
    User,
}

impl UserRole {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Admin => "admin",
            Self::User => "user",
        }
    }
}

impl FromStr for UserRole {
    type Err = String;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s.trim().to_ascii_lowercase().as_str() {
            "admin" => Ok(Self::Admin),
            "user" => Ok(Self::User),
            other => Err(format!("Invalid user role '{other}'")),
        }
    }
}

/// Persistent user record stored in SQLite (`users` table).
#[derive(Debug, Clone)]
pub struct StoredUser {
    pub id: String,
    pub name: String,
    pub email: String,
    pub role: UserRole,
    pub password_hash: String,
    pub reputation_score: u32,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AuthSession {
    pub user_id: String,
    pub role: UserRole,
    pub name: String,
    pub email: String,
    pub reputation_score: u32,
    pub expires_at: String,
    #[serde(skip_serializing)]
    pub token_hash: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct RegisterRequest {
    pub name: String,
    pub email: String,
    pub password: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct LoginRequest {
    pub email: String,
    pub password: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct ChangePasswordRequest {
    pub current_password: String,
    pub new_password: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AuthResponse {
    pub user_id: String,
    pub token: String,
    pub role: UserRole,
    pub name: String,
    pub email: String,
    pub reputation_score: u32,
    pub expires_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CurrentUserResponse {
    pub user_id: String,
    pub role: UserRole,
    pub name: String,
    pub email: String,
    pub reputation_score: u32,
}

/// Persistent Argon2id + SQLite session auth service (survives restarts cleanly).
#[derive(Clone)]
pub struct AuthService {
    repo: PostRepository,
    session_ttl_hours: i64,
}

impl AuthService {
    pub fn new(repo: PostRepository, session_ttl_hours: i64) -> Self {
        Self {
            repo,
            session_ttl_hours: session_ttl_hours.clamp(1, 8760),
        }
    }

    /// Seed configured Admin & Reporter accounts if not already in SQLite.
    pub async fn seed_default_accounts(&self, config: &Config) -> AppResult<()> {
        let now = Utc::now().to_rfc3339_opts(SecondsFormat::Secs, true);

        let admin_hash = hash_password_argon2id(&config.admin_seed_password)?;
        self.repo
            .seed_user_if_missing(StoredUser {
                id: Uuid::new_v4().to_string(),
                name: config.admin_seed_name.clone(),
                email: config.admin_seed_email.trim().to_ascii_lowercase(),
                role: UserRole::Admin,
                password_hash: admin_hash,
                reputation_score: 100,
                created_at: now.clone(),
            })
            .await?;

        let user_hash = hash_password_argon2id(&config.user_seed_password)?;
        self.repo
            .seed_user_if_missing(StoredUser {
                id: Uuid::new_v4().to_string(),
                name: config.user_seed_name.clone(),
                email: config.user_seed_email.trim().to_ascii_lowercase(),
                role: UserRole::User,
                password_hash: user_hash,
                reputation_score: 25,
                created_at: now,
            })
            .await?;

        Ok(())
    }

    pub async fn register(&self, req: RegisterRequest) -> AppResult<AuthResponse> {
        let name = sanitize_text(&req.name);
        if name.is_empty() || name.chars().count() > 100 {
            return Err(AppError::bad_request(
                "name must be between 1 and 100 characters",
            ));
        }

        let email = normalize_email(&req.email)?;
        validate_password(&req.password)?;

        let password_hash = tokio::task::spawn_blocking({
            let pw = req.password.clone();
            move || hash_password_argon2id(&pw)
        })
        .await
        .map_err(|e| AppError::internal(format!("Argon2 join error: {e}")))??;

        let now = Utc::now().to_rfc3339_opts(SecondsFormat::Secs, true);
        let user = StoredUser {
            id: Uuid::new_v4().to_string(),
            name,
            email,
            role: UserRole::User,
            password_hash,
            reputation_score: 10,
            created_at: now,
        };

        let created = self.repo.create_user(user).await?;
        self.create_session_for_user(&created).await
    }

    pub async fn login(&self, req: LoginRequest) -> AppResult<AuthResponse> {
        let email = normalize_email(&req.email)?;
        if req.password.is_empty() {
            return Err(AppError::unauthorized("Invalid email or password"));
        }

        let maybe_user = self.repo.get_user_by_email(&email).await?;
        let dummy_hash = dummy_argon2_hash()?.to_string();

        let (pw_ok, found_user) = tokio::task::spawn_blocking({
            let pw = req.password.clone();
            move || match maybe_user {
                Some(user) => {
                    let ok = verify_password_argon2id(&pw, &user.password_hash);
                    (ok, Some(user))
                }
                None => {
                    let _ = verify_password_argon2id(&pw, &dummy_hash);
                    (false, None)
                }
            }
        })
        .await
        .map_err(|e| AppError::internal(format!("Argon2 verify join error: {e}")))?;

        match (pw_ok, found_user) {
            (true, Some(user)) => self.create_session_for_user(&user).await,
            _ => Err(AppError::unauthorized("Invalid email or password")),
        }
    }

    pub async fn logout(&self, headers: &HeaderMap) -> AppResult<()> {
        let session = self.require_authenticated(headers).await?;
        self.repo.delete_session(&session.token_hash).await
    }

    pub async fn change_password(
        &self,
        headers: &HeaderMap,
        req: ChangePasswordRequest,
    ) -> AppResult<()> {
        let session = self.require_authenticated(headers).await?;
        validate_password(&req.new_password)?;

        let Some(user) = self.repo.get_user_by_id(&session.user_id).await? else {
            return Err(AppError::unauthorized("Session user not found"));
        };

        let current_ok = tokio::task::spawn_blocking({
            let pw = req.current_password.clone();
            let stored_hash = user.password_hash.clone();
            move || verify_password_argon2id(&pw, &stored_hash)
        })
        .await
        .map_err(|e| AppError::internal(format!("Argon2 verify join error: {e}")))?;

        if !current_ok {
            return Err(AppError::unauthorized("Current password is incorrect"));
        }

        let new_hash = tokio::task::spawn_blocking({
            let pw = req.new_password.clone();
            move || hash_password_argon2id(&pw)
        })
        .await
        .map_err(|e| AppError::internal(format!("Argon2 hash join error: {e}")))??;

        self.repo
            .update_password_and_revoke_other_sessions(
                &session.user_id,
                &new_hash,
                &session.token_hash,
            )
            .await
    }

    async fn create_session_for_user(&self, user: &StoredUser) -> AppResult<AuthResponse> {
        let raw_token = format!("cp_{}{}", Uuid::new_v4().simple(), Uuid::new_v4().simple());
        let token_hash = hash_token(&raw_token);
        let now = Utc::now();
        let created_at = now.to_rfc3339_opts(SecondsFormat::Secs, true);
        let expires_at =
            (now + Duration::hours(self.session_ttl_hours)).to_rfc3339_opts(SecondsFormat::Secs, true);

        self.repo
            .insert_session(token_hash, user.id.clone(), expires_at.clone(), created_at)
            .await?;

        Ok(AuthResponse {
            user_id: user.id.clone(),
            token: raw_token,
            role: user.role,
            name: user.name.clone(),
            email: user.email.clone(),
            reputation_score: user.reputation_score,
            expires_at,
        })
    }

    /// Parse `Authorization: Bearer <token>` if present and look up unexpired SQLite session.
    pub async fn extract_optional_session(
        &self,
        headers: &HeaderMap,
    ) -> AppResult<Option<AuthSession>> {
        let Some(raw_header) = headers.get(header::AUTHORIZATION) else {
            return Ok(None);
        };
        let header_str = raw_header
            .to_str()
            .map_err(|_| AppError::unauthorized("Invalid Authorization header encoding"))?
            .trim();

        let raw_token = parse_bearer_token(header_str)
            .ok_or_else(|| AppError::unauthorized("Expected 'Authorization: Bearer <token>'"))?;

        let token_hash = hash_token(raw_token);
        let now_iso = Utc::now().to_rfc3339_opts(SecondsFormat::Secs, true);

        let Some((user, expires_at)) = self
            .repo
            .get_active_session_user(&token_hash, &now_iso)
            .await?
        else {
            return Err(AppError::unauthorized("Invalid or expired bearer token"));
        };

        Ok(Some(AuthSession {
            user_id: user.id,
            role: user.role,
            name: user.name,
            email: user.email,
            reputation_score: user.reputation_score,
            expires_at,
            token_hash,
        }))
    }

    pub async fn require_authenticated(&self, headers: &HeaderMap) -> AppResult<AuthSession> {
        self.extract_optional_session(headers)
            .await?
            .ok_or_else(|| AppError::unauthorized("Authentication required"))
    }

    pub async fn require_admin(&self, headers: &HeaderMap) -> AppResult<AuthSession> {
        let session = self.require_authenticated(headers).await?;
        if session.role != UserRole::Admin {
            return Err(AppError::forbidden("Administrator privileges required"));
        }
        Ok(session)
    }
}

pub fn hash_password_argon2id(password: &str) -> AppResult<String> {
    let salt = SaltString::encode_b64(Uuid::new_v4().as_bytes())
        .map_err(|e| AppError::internal(format!("Salt encoding failure: {e}")))?;
    Argon2::default()
        .hash_password(password.as_bytes(), &salt)
        .map(|h| h.to_string())
        .map_err(|e| AppError::internal(format!("Argon2 hashing failure: {e}")))
}

pub fn verify_password_argon2id(password: &str, phc_hash: &str) -> bool {
    let Ok(parsed) = PasswordHash::new(phc_hash) else {
        return false;
    };
    Argon2::default()
        .verify_password(password.as_bytes(), &parsed)
        .is_ok()
}

pub fn hash_token(raw_token: &str) -> String {
    let digest = Sha256::digest(raw_token.trim().as_bytes());
    hex::encode(digest)
}

fn dummy_argon2_hash() -> AppResult<&'static str> {
    static DUMMY: OnceLock<String> = OnceLock::new();
    if let Some(existing) = DUMMY.get() {
        return Ok(existing.as_str());
    }
    let generated = hash_password_argon2id("civicpulse-dummy-timing-guard")?;
    let _ = DUMMY.set(generated);
    Ok(DUMMY
        .get()
        .map(String::as_str)
        .unwrap_or("$argon2id$v=19$m=19456,t=2,p=1$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"))
}

fn normalize_email(raw: &str) -> AppResult<String> {
    let email = sanitize_text(raw).to_ascii_lowercase();
    if email.len() < 5
        || email.len() > 254
        || email.chars().any(|c| c.is_whitespace() || c.is_control())
    {
        return Err(AppError::bad_request("Please provide a valid email address"));
    }

    let Some((local, domain)) = email.split_once('@') else {
        return Err(AppError::bad_request("Please provide a valid email address"));
    };
    if domain.contains('@')
        || local.is_empty()
        || local.len() > 64
        || local.starts_with('.')
        || local.ends_with('.')
        || local.contains("..")
    {
        return Err(AppError::bad_request("Please provide a valid email address"));
    }

    if domain.len() > 253
        || !domain.contains('.')
        || domain.starts_with('.')
        || domain.ends_with('.')
        || domain.contains("..")
    {
        return Err(AppError::bad_request("Please provide a valid email address"));
    }

    let labels: Vec<&str> = domain.split('.').collect();
    let valid_labels = labels.iter().all(|label| {
        !label.is_empty()
            && !label.starts_with('-')
            && !label.ends_with('-')
            && label
                .chars()
                .all(|c| c.is_ascii_alphanumeric() || c == '-')
    });
    let valid_tld = labels
        .last()
        .is_some_and(|tld| tld.len() >= 2 && tld.chars().all(|c| c.is_ascii_alphabetic()));

    if !valid_labels || !valid_tld {
        return Err(AppError::bad_request("Please provide a valid email address"));
    }

    Ok(email)
}

fn validate_password(password: &str) -> AppResult<()> {
    if password.len() < 6 || password.len() > 128 {
        return Err(AppError::bad_request(
            "password must be between 6 and 128 characters",
        ));
    }
    Ok(())
}

fn parse_bearer_token(header_val: &str) -> Option<&str> {
    let mut parts = header_val.splitn(2, ' ');
    let scheme = parts.next()?.trim();
    let token = parts.next()?.trim();
    if scheme.eq_ignore_ascii_case("bearer") && !token.is_empty() {
        Some(token)
    } else {
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn argon2id_seeded_accounts_persist_and_logout_works() {
        let repo = PostRepository::open_in_memory().unwrap();
        let auth = AuthService::new(repo, 24);
        let cfg = Config::for_test("http://127.0.0.1:9".into(), None);
        auth.seed_default_accounts(&cfg).await.unwrap();

        let admin = auth
            .login(LoginRequest {
                email: "ADMIN@civicpulse.org".into(),
                password: "admin123".into(),
            })
            .await
            .unwrap();
        assert_eq!(admin.role, UserRole::Admin);

        let mut headers = HeaderMap::new();
        headers.insert(
            header::AUTHORIZATION,
            format!("Bearer {}", admin.token).parse().unwrap(),
        );
        assert!(auth.require_admin(&headers).await.is_ok());

        auth.logout(&headers).await.unwrap();
        assert!(auth.require_admin(&headers).await.is_err());
    }

    #[test]
    fn email_validation_rejects_malformed_addresses() {
        assert_eq!(
            normalize_email("  Kasun@Example.COM ").unwrap(),
            "kasun@example.com"
        );
        for bad in [
            "a@b",
            "@example.com",
            "user@",
            "user@.com",
            ".user@example.com",
            "user..name@example.com",
            "user@sub..example.com",
            "user@-bad.com",
            "user@example.123",
            "two@at@example.com",
        ] {
            assert!(normalize_email(bad).is_err(), "expected {bad} to fail");
        }
    }
}
