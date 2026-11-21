use std::{
    collections::{HashMap, HashSet},
    path::Path,
};

use chrono::{SecondsFormat, Utc};
use r2d2::{Pool, PooledConnection};
use r2d2_sqlite::SqliteConnectionManager;
use rusqlite::{params, Connection, OptionalExtension};

use crate::{
    error::{AppError, AppResult},
    models::{
        AuditLogEntry, Category, Comment, ListPostsQuery, PagedPosts, Post, StatusCounts,
        TravelAdvisory, VerificationStatus,
    },
    services::{
        algorithms::compute_priority_score,
        auth::{StoredUser, UserRole},
        geofence::{haversine_distance_km, validate_coordinates},
        trust_engine::{status_after_flag, status_after_verify},
    },
};

/// Post bundled with optional SHA-256 and perceptual dHash media fingerprints.
pub type PostWithFingerprints = (Post, Option<String>, Option<String>);

/// Parameters for persisting a recovered background Gemini AI verification update.
#[derive(Debug, Clone)]
pub struct AiRetryUpdate {
    pub ai_score: u8,
    pub ai_reasoning: String,
    pub translated_description: String,
    pub travel_advisory: TravelAdvisory,
    pub severity: u8,
    pub new_status: VerificationStatus,
}

/// Pooled SQLite WAL repository supporting posts, FTS5 search, persistent users/sessions/settings,
/// anti-Sybil vote tracking, perceptual media hashes, AI retry queue, and immutable audit logs.
#[derive(Clone)]
pub struct PostRepository {
    pool: Pool<SqliteConnectionManager>,
}

impl PostRepository {
    /// Open or create a file-backed SQLite database with WAL mode and connection pooling.
    pub fn open_file(path: &str, pool_size: u32) -> AppResult<Self> {
        if path == ":memory:" {
            return Self::open_in_memory();
        }
        if let Some(parent) = Path::new(path).parent() {
            if !parent.as_os_str().is_empty() {
                std::fs::create_dir_all(parent).map_err(|e| {
                    AppError::internal(format!("Failed to create database directory: {e}"))
                })?;
            }
        }
        let manager = SqliteConnectionManager::file(path).with_init(|conn| {
            conn.execute_batch(
                "PRAGMA foreign_keys = ON;\n\
                 PRAGMA busy_timeout = 5000;\n\
                 PRAGMA journal_mode = WAL;\n\
                 PRAGMA synchronous = NORMAL;",
            )
        });
        let pool = Pool::builder()
            .max_size(pool_size.max(1))
            .build(manager)
            .map_err(|e| AppError::internal(format!("Failed to build SQLite pool: {e}")))?;

        let repo = Self { pool };
        repo.run_migrations_sync()?;
        Ok(repo)
    }

    /// Open an isolated in-memory SQLite database (pool size 1 so all queries share the DB).
    pub fn open_in_memory() -> AppResult<Self> {
        let manager = SqliteConnectionManager::memory().with_init(|conn| {
            conn.execute_batch("PRAGMA foreign_keys = ON;\nPRAGMA busy_timeout = 5000;")
        });
        let pool = Pool::builder()
            .max_size(1)
            .build(manager)
            .map_err(|e| AppError::internal(format!("Failed to build in-memory SQLite pool: {e}")))?;

        let repo = Self { pool };
        repo.run_migrations_sync()?;
        Ok(repo)
    }

    fn run_migrations_sync(&self) -> AppResult<()> {
        let mut conn = self
            .pool
            .get()
            .map_err(|e| AppError::internal(format!("Failed to get SQLite connection: {e}")))?;

        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS schema_migrations (
                version INTEGER PRIMARY KEY,
                applied_at TEXT NOT NULL
            );",
        )
        .map_err(|e| AppError::internal(format!("Failed to create schema_migrations: {e}")))?;

        let current_version: i64 = conn
            .query_row(
                "SELECT COALESCE(MAX(version), 0) FROM schema_migrations",
                [],
                |row| row.get(0),
            )
            .map_err(|e| AppError::internal(format!("Failed to read schema version: {e}")))?;

        let now = Utc::now().to_rfc3339_opts(SecondsFormat::Secs, true);

        if current_version < 1 {
            let tx = conn
                .transaction()
                .map_err(|e| AppError::internal(format!("Migration v1 tx error: {e}")))?;
            tx.execute_batch(
                "CREATE TABLE IF NOT EXISTS posts (
                    id TEXT PRIMARY KEY,
                    title TEXT NOT NULL,
                    description TEXT NOT NULL,
                    translated_description TEXT NOT NULL,
                    category TEXT NOT NULL,
                    lat REAL NOT NULL,
                    lng REAL NOT NULL,
                    location_name TEXT NOT NULL,
                    media_url TEXT,
                    media_hash TEXT,
                    is_live_captured INTEGER NOT NULL,
                    is_on_site INTEGER NOT NULL,
                    ai_authenticity_score INTEGER NOT NULL,
                    ai_reasoning TEXT NOT NULL,
                    travel_advisory TEXT NOT NULL,
                    severity INTEGER NOT NULL,
                    verification_status TEXT NOT NULL,
                    confirmations INTEGER NOT NULL,
                    false_flags INTEGER NOT NULL,
                    is_resolved INTEGER NOT NULL,
                    integrity_hash TEXT NOT NULL,
                    created_at TEXT NOT NULL
                );
                CREATE INDEX IF NOT EXISTS idx_posts_created_at ON posts(created_at DESC);
                CREATE INDEX IF NOT EXISTS idx_posts_category ON posts(category);
                CREATE INDEX IF NOT EXISTS idx_posts_status ON posts(verification_status);
                CREATE INDEX IF NOT EXISTS idx_posts_media_hash ON posts(media_hash);

                CREATE TABLE IF NOT EXISTS comments (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    post_id TEXT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
                    author TEXT NOT NULL,
                    text TEXT NOT NULL,
                    created_at TEXT NOT NULL
                );
                CREATE INDEX IF NOT EXISTS idx_comments_post_id ON comments(post_id, id);

                CREATE TABLE IF NOT EXISTS post_votes (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    post_id TEXT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
                    voter_key TEXT NOT NULL,
                    vote_type TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    UNIQUE(post_id, voter_key, vote_type)
                );
                CREATE INDEX IF NOT EXISTS idx_post_votes_lookup ON post_votes(post_id, vote_type);

                CREATE TABLE IF NOT EXISTS audit_logs (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    post_id TEXT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
                    action TEXT NOT NULL,
                    details TEXT NOT NULL,
                    created_at TEXT NOT NULL
                );
                CREATE INDEX IF NOT EXISTS idx_audit_logs_post_id ON audit_logs(post_id, id);",
            )
            .map_err(|e| AppError::internal(format!("Migration v1 SQL error: {e}")))?;
            tx.execute(
                "INSERT INTO schema_migrations (version, applied_at) VALUES (1, ?1)",
                params![&now],
            )
            .map_err(|e| AppError::internal(format!("Migration v1 record error: {e}")))?;
            tx.commit()
                .map_err(|e| AppError::internal(format!("Migration v1 commit error: {e}")))?;
        }

        if current_version < 2 {
            let tx = conn
                .transaction()
                .map_err(|e| AppError::internal(format!("Migration v2 tx error: {e}")))?;
            tx.execute_batch(
                "CREATE TABLE IF NOT EXISTS users (
                    id TEXT PRIMARY KEY,
                    name TEXT NOT NULL,
                    email TEXT NOT NULL UNIQUE,
                    role TEXT NOT NULL,
                    password_hash TEXT NOT NULL,
                    reputation_score INTEGER NOT NULL DEFAULT 10,
                    created_at TEXT NOT NULL
                );
                CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email ON users(email);

                CREATE TABLE IF NOT EXISTS sessions (
                    token_hash TEXT PRIMARY KEY,
                    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                    expires_at TEXT NOT NULL,
                    created_at TEXT NOT NULL
                );
                CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
                CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);

                CREATE TABLE IF NOT EXISTS system_settings (
                    key TEXT PRIMARY KEY,
                    value TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                );",
            )
            .map_err(|e| AppError::internal(format!("Migration v2 SQL error: {e}")))?;
            tx.execute(
                "INSERT INTO schema_migrations (version, applied_at) VALUES (2, ?1)",
                params![&now],
            )
            .map_err(|e| AppError::internal(format!("Migration v2 record error: {e}")))?;
            tx.commit()
                .map_err(|e| AppError::internal(format!("Migration v2 commit error: {e}")))?;
        }

        if current_version < 3 {
            let tx = conn
                .transaction()
                .map_err(|e| AppError::internal(format!("Migration v3 tx error: {e}")))?;

            ensure_post_column(&tx, "media_hash", "TEXT")?;
            ensure_post_column(&tx, "media_dhash", "TEXT")?;
            ensure_post_column(&tx, "needs_ai_retry", "INTEGER NOT NULL DEFAULT 0")?;
            ensure_post_column(&tx, "author_user_id", "TEXT")?;

            tx.execute_batch(
                "CREATE INDEX IF NOT EXISTS idx_posts_media_dhash ON posts(media_dhash);
                 CREATE INDEX IF NOT EXISTS idx_posts_ai_retry ON posts(needs_ai_retry);
                 CREATE VIRTUAL TABLE IF NOT EXISTS posts_fts USING fts5(
                     post_id UNINDEXED,
                     title,
                     description,
                     translated_description,
                     location_name,
                     category
                 );
                 DELETE FROM posts_fts;
                 INSERT INTO posts_fts (post_id, title, description, translated_description, location_name, category)
                 SELECT id, title, description, translated_description, location_name, category FROM posts;",
            )
            .map_err(|e| AppError::internal(format!("Migration v3 FTS5 error: {e}")))?;

            tx.execute(
                "INSERT INTO schema_migrations (version, applied_at) VALUES (3, ?1)",
                params![&now],
            )
            .map_err(|e| AppError::internal(format!("Migration v3 record error: {e}")))?;
            tx.commit()
                .map_err(|e| AppError::internal(format!("Migration v3 commit error: {e}")))?;
        }

        if current_version < 4 {
            let tx = conn
                .transaction()
                .map_err(|e| AppError::internal(format!("Migration v4 tx error: {e}")))?;
            tx.execute_batch(
                "DELETE FROM post_votes
                 WHERE id NOT IN (SELECT MIN(id) FROM post_votes GROUP BY post_id, voter_key);
                 CREATE UNIQUE INDEX IF NOT EXISTS idx_post_votes_one_per_voter
                 ON post_votes(post_id, voter_key);",
            )
            .map_err(|e| AppError::internal(format!("Migration v4 SQL error: {e}")))?;
            tx.execute(
                "INSERT INTO schema_migrations (version, applied_at) VALUES (4, ?1)",
                params![&now],
            )
            .map_err(|e| AppError::internal(format!("Migration v4 record error: {e}")))?;
            tx.commit()
                .map_err(|e| AppError::internal(format!("Migration v4 commit error: {e}")))?;
        }

        Ok(())
    }

    async fn with_conn<F, R>(&self, op: F) -> AppResult<R>
    where
        F: FnOnce(&mut PooledConnection<SqliteConnectionManager>) -> AppResult<R> + Send + 'static,
        R: Send + 'static,
    {
        let pool = self.pool.clone();
        tokio::task::spawn_blocking(move || {
            let mut conn = pool
                .get()
                .map_err(|e| AppError::internal(format!("SQLite pool acquire error: {e}")))?;
            op(&mut conn)
        })
        .await
        .map_err(|e| AppError::internal(format!("Database task join error: {e}")))?
    }

    // =========================================================================
    // System Settings Persistence
    // =========================================================================

    pub async fn get_or_init_bool_setting(&self, key: &str, default_val: bool) -> AppResult<bool> {
        let key = key.to_string();
        let now = Utc::now().to_rfc3339_opts(SecondsFormat::Secs, true);
        self.with_conn(move |conn| {
            let existing: Option<String> = conn
                .query_row(
                    "SELECT value FROM system_settings WHERE key = ?1",
                    params![&key],
                    |row| row.get(0),
                )
                .optional()
                .map_err(|e| AppError::internal(format!("Setting read error: {e}")))?;

            match existing {
                Some(val) => Ok(val == "true" || val == "1"),
                None => {
                    let serialized = if default_val { "true" } else { "false" };
                    conn.execute(
                        "INSERT OR IGNORE INTO system_settings (key, value, updated_at) VALUES (?1, ?2, ?3)",
                        params![&key, serialized, &now],
                    )
                    .map_err(|e| AppError::internal(format!("Setting init error: {e}")))?;
                    Ok(default_val)
                }
            }
        })
        .await
    }

    pub async fn set_bool_setting(&self, key: &str, val: bool) -> AppResult<bool> {
        let key = key.to_string();
        let serialized = if val { "true" } else { "false" }.to_string();
        let now = Utc::now().to_rfc3339_opts(SecondsFormat::Secs, true);
        self.with_conn(move |conn| {
            conn.execute(
                "INSERT INTO system_settings (key, value, updated_at) VALUES (?1, ?2, ?3)
                 ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
                params![&key, &serialized, &now],
            )
            .map_err(|e| AppError::internal(format!("Setting write error: {e}")))?;
            Ok(val)
        })
        .await
    }

    // =========================================================================
    // Persistent Users & Sessions
    // =========================================================================

    pub async fn seed_user_if_missing(&self, user: StoredUser) -> AppResult<bool> {
        self.with_conn(move |conn| {
            let exists: Option<String> = conn
                .query_row(
                    "SELECT id FROM users WHERE email = ?1",
                    params![&user.email],
                    |row| row.get(0),
                )
                .optional()
                .map_err(|e| AppError::internal(format!("User check error: {e}")))?;
            if exists.is_some() {
                return Ok(false);
            }
            conn.execute(
                "INSERT INTO users (id, name, email, role, password_hash, reputation_score, created_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
                params![
                    user.id,
                    user.name,
                    user.email,
                    user.role.as_str(),
                    user.password_hash,
                    user.reputation_score,
                    user.created_at
                ],
            )
            .map_err(|e| AppError::internal(format!("User seed error: {e}")))?;
            Ok(true)
        })
        .await
    }

    /// Return `(has_admin, users_count)` for initial first-run setup detection.
    pub async fn get_auth_status(&self) -> AppResult<(bool, usize)> {
        self.with_conn(|conn| {
            let admins_count: i64 = conn
                .query_row(
                    "SELECT COUNT(*) FROM users WHERE role = 'admin'",
                    [],
                    |row| row.get(0),
                )
                .map_err(|e| AppError::internal(format!("Admin count query error: {e}")))?;
            let users_count: i64 = conn
                .query_row("SELECT COUNT(*) FROM users", [], |row| row.get(0))
                .map_err(|e| AppError::internal(format!("User count query error: {e}")))?;
            Ok((admins_count > 0, users_count.max(0) as usize))
        })
        .await
    }

    pub async fn create_user(&self, mut user: StoredUser) -> AppResult<StoredUser> {
        self.with_conn(move |conn| {
            let tx = conn
                .transaction()
                .map_err(|e| AppError::internal(format!("User create tx error: {e}")))?;
            let exists: Option<String> = tx
                .query_row(
                    "SELECT id FROM users WHERE email = ?1",
                    params![&user.email],
                    |row| row.get(0),
                )
                .optional()
                .map_err(|e| AppError::internal(format!("User lookup error: {e}")))?;
            if exists.is_some() {
                return Err(AppError::conflict(format!(
                    "Account with email '{}' already exists",
                    user.email
                )));
            }

            // First registered user on a clean database automatically bootstraps as Administrator.
            let existing_admins: i64 = tx
                .query_row(
                    "SELECT COUNT(*) FROM users WHERE role = 'admin'",
                    [],
                    |row| row.get(0),
                )
                .map_err(|e| AppError::internal(format!("Admin check error: {e}")))?;
            if existing_admins == 0 {
                user.role = UserRole::Admin;
                user.reputation_score = 100;
            }

            tx.execute(
                "INSERT INTO users (id, name, email, role, password_hash, reputation_score, created_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
                params![
                    user.id,
                    user.name,
                    user.email,
                    user.role.as_str(),
                    user.password_hash,
                    user.reputation_score,
                    user.created_at
                ],
            )
            .map_err(|e| AppError::internal(format!("User insert error: {e}")))?;
            tx.commit()
                .map_err(|e| AppError::internal(format!("User create commit error: {e}")))?;
            Ok(user)
        })
        .await
    }

    pub async fn get_user_by_email(&self, email: &str) -> AppResult<Option<StoredUser>> {
        let email = email.to_string();
        self.with_conn(move |conn| {
            conn.query_row(
                "SELECT id, name, email, role, password_hash, reputation_score, created_at
                 FROM users WHERE email = ?1",
                params![&email],
                row_to_user,
            )
            .optional()
            .map_err(|e| AppError::internal(format!("User fetch error: {e}")))
        })
        .await
    }

    pub async fn get_user_by_id(&self, id: &str) -> AppResult<Option<StoredUser>> {
        let id = id.to_string();
        self.with_conn(move |conn| {
            conn.query_row(
                "SELECT id, name, email, role, password_hash, reputation_score, created_at
                 FROM users WHERE id = ?1",
                params![&id],
                row_to_user,
            )
            .optional()
            .map_err(|e| AppError::internal(format!("User fetch error: {e}")))
        })
        .await
    }

    pub async fn insert_session(
        &self,
        token_hash: String,
        user_id: String,
        expires_at: String,
        created_at: String,
    ) -> AppResult<()> {
        self.with_conn(move |conn| {
            conn.execute(
                "INSERT INTO sessions (token_hash, user_id, expires_at, created_at)
                 VALUES (?1, ?2, ?3, ?4)",
                params![token_hash, user_id, expires_at, created_at],
            )
            .map_err(|e| AppError::internal(format!("Session insert error: {e}")))?;
            Ok(())
        })
        .await
    }

    pub async fn get_active_session_user(
        &self,
        token_hash: &str,
        now_iso: &str,
    ) -> AppResult<Option<(StoredUser, String)>> {
        let token_hash = token_hash.to_string();
        let now_iso = now_iso.to_string();
        self.with_conn(move |conn| {
            conn.query_row(
                "SELECT u.id, u.name, u.email, u.role, u.password_hash, u.reputation_score, u.created_at, s.expires_at
                 FROM sessions s
                 JOIN users u ON u.id = s.user_id
                 WHERE s.token_hash = ?1 AND s.expires_at > ?2",
                params![&token_hash, &now_iso],
                |row| {
                    let user = row_to_user(row)?;
                    let expires_at: String = row.get(7)?;
                    Ok((user, expires_at))
                },
            )
            .optional()
            .map_err(|e| AppError::internal(format!("Session lookup error: {e}")))
        })
        .await
    }

    pub async fn delete_session(&self, token_hash: &str) -> AppResult<()> {
        let token_hash = token_hash.to_string();
        self.with_conn(move |conn| {
            conn.execute(
                "DELETE FROM sessions WHERE token_hash = ?1",
                params![&token_hash],
            )
            .map_err(|e| AppError::internal(format!("Session delete error: {e}")))?;
            Ok(())
        })
        .await
    }

    pub async fn update_password_and_revoke_other_sessions(
        &self,
        user_id: &str,
        new_password_hash: &str,
        keep_token_hash: &str,
    ) -> AppResult<()> {
        let user_id = user_id.to_string();
        let new_password_hash = new_password_hash.to_string();
        let keep_token_hash = keep_token_hash.to_string();
        self.with_conn(move |conn| {
            let tx = conn
                .transaction()
                .map_err(|e| AppError::internal(format!("Password tx error: {e}")))?;
            tx.execute(
                "UPDATE users SET password_hash = ?1 WHERE id = ?2",
                params![&new_password_hash, &user_id],
            )
            .map_err(|e| AppError::internal(format!("Password update error: {e}")))?;
            tx.execute(
                "DELETE FROM sessions WHERE user_id = ?1 AND token_hash != ?2",
                params![&user_id, &keep_token_hash],
            )
            .map_err(|e| AppError::internal(format!("Session revoke error: {e}")))?;
            tx.commit()
                .map_err(|e| AppError::internal(format!("Password tx commit error: {e}")))?;
            Ok(())
        })
        .await
    }

    pub async fn cleanup_expired_sessions(&self, now_iso: &str) -> AppResult<usize> {
        let now_iso = now_iso.to_string();
        self.with_conn(move |conn| {
            let deleted = conn
                .execute(
                    "DELETE FROM sessions WHERE expires_at <= ?1",
                    params![&now_iso],
                )
                .map_err(|e| AppError::internal(format!("Session cleanup error: {e}")))?;
            Ok(deleted)
        })
        .await
    }

    /// Return `(active_sessions_count, reports_submitted, votes_cast)` for a signed-in user.
    pub async fn get_user_profile_stats(
        &self,
        user_id: &str,
        now_iso: &str,
    ) -> AppResult<(usize, usize, usize)> {
        let user_id = user_id.to_string();
        let now_iso = now_iso.to_string();
        let voter_key = format!("user:{user_id}");
        self.with_conn(move |conn| {
            let active_sessions: i64 = conn
                .query_row(
                    "SELECT COUNT(*) FROM sessions WHERE user_id = ?1 AND expires_at > ?2",
                    params![&user_id, &now_iso],
                    |row| row.get(0),
                )
                .map_err(|e| AppError::internal(format!("Profile sessions count error: {e}")))?;
            let reports_submitted: i64 = conn
                .query_row(
                    "SELECT COUNT(*) FROM posts WHERE author_user_id = ?1",
                    params![&user_id],
                    |row| row.get(0),
                )
                .map_err(|e| AppError::internal(format!("Profile posts count error: {e}")))?;
            let votes_cast: i64 = conn
                .query_row(
                    "SELECT COUNT(*) FROM post_votes WHERE voter_key = ?1",
                    params![&voter_key],
                    |row| row.get(0),
                )
                .map_err(|e| AppError::internal(format!("Profile votes count error: {e}")))?;

            Ok((
                active_sessions.max(0) as usize,
                reports_submitted.max(0) as usize,
                votes_cast.max(0) as usize,
            ))
        })
        .await
    }

    /// Revoke every session belonging to `user_id` except `keep_token_hash`.
    pub async fn revoke_other_sessions(
        &self,
        user_id: &str,
        keep_token_hash: &str,
    ) -> AppResult<usize> {
        let user_id = user_id.to_string();
        let keep_token_hash = keep_token_hash.to_string();
        self.with_conn(move |conn| {
            let deleted = conn
                .execute(
                    "DELETE FROM sessions WHERE user_id = ?1 AND token_hash != ?2",
                    params![&user_id, &keep_token_hash],
                )
                .map_err(|e| AppError::internal(format!("Revoke sessions error: {e}")))?;
            Ok(deleted)
        })
        .await
    }

    /// Return all users with live post & active-session counts (never exposes password hashes).
    pub async fn list_users_with_stats(
        &self,
        now_iso: &str,
    ) -> AppResult<Vec<crate::models::AdminUserSummary>> {
        let now_iso = now_iso.to_string();
        self.with_conn(move |conn| {
            let mut stmt = conn
                .prepare(
                    "SELECT u.id, u.name, u.email, u.role, u.reputation_score, u.created_at,
                            (SELECT COUNT(*) FROM posts p WHERE p.author_user_id = u.id),
                            (SELECT COUNT(*) FROM sessions s WHERE s.user_id = u.id AND s.expires_at > ?1)
                     FROM users u
                     ORDER BY CASE WHEN u.role = 'admin' THEN 0 ELSE 1 END, u.created_at ASC",
                )
                .map_err(|e| AppError::internal(format!("List users prepare error: {e}")))?;

            let rows = stmt
                .query_map(params![&now_iso], |row| {
                    Ok(crate::models::AdminUserSummary {
                        id: row.get(0)?,
                        name: row.get(1)?,
                        email: row.get(2)?,
                        role: row.get(3)?,
                        reputation_score: row.get(4)?,
                        created_at: row.get(5)?,
                        posts_count: row.get::<_, i64>(6)?.max(0) as usize,
                        active_sessions_count: row.get::<_, i64>(7)?.max(0) as usize,
                    })
                })
                .map_err(|e| AppError::internal(format!("List users query error: {e}")))?;

            let mut out = Vec::new();
            for row in rows {
                out.push(row.map_err(|e| AppError::internal(format!("User summary decode error: {e}")))?);
            }
            Ok(out)
        })
        .await
    }

    /// Update a user's role inside a transaction, refusing to demote the last remaining Administrator.
    pub async fn update_user_role(
        &self,
        target_user_id: &str,
        new_role: UserRole,
        now_iso: &str,
    ) -> AppResult<Option<crate::models::AdminUserSummary>> {
        let target_user_id = target_user_id.to_string();
        let now_iso = now_iso.to_string();
        self.with_conn(move |conn| {
            let tx = conn
                .transaction()
                .map_err(|e| AppError::internal(format!("Update role tx error: {e}")))?;

            let Some(current_role_str): Option<String> = tx
                .query_row(
                    "SELECT role FROM users WHERE id = ?1",
                    params![&target_user_id],
                    |row| row.get(0),
                )
                .optional()
                .map_err(|e| AppError::internal(format!("Role lookup error: {e}")))?
            else {
                return Ok(None);
            };

            if current_role_str.eq_ignore_ascii_case("admin") && new_role != UserRole::Admin {
                let admins_count: i64 = tx
                    .query_row(
                        "SELECT COUNT(*) FROM users WHERE role = 'admin'",
                        [],
                        |row| row.get(0),
                    )
                    .map_err(|e| AppError::internal(format!("Admin count check error: {e}")))?;
                if admins_count <= 1 {
                    return Err(AppError::conflict(
                        "Cannot demote the last remaining administrator",
                    ));
                }
            }

            tx.execute(
                "UPDATE users SET role = ?1 WHERE id = ?2",
                params![new_role.as_str(), &target_user_id],
            )
            .map_err(|e| AppError::internal(format!("Role update error: {e}")))?;
            tx.commit()
                .map_err(|e| AppError::internal(format!("Role update commit error: {e}")))?;

            conn.query_row(
                "SELECT u.id, u.name, u.email, u.role, u.reputation_score, u.created_at,
                        (SELECT COUNT(*) FROM posts p WHERE p.author_user_id = u.id),
                        (SELECT COUNT(*) FROM sessions s WHERE s.user_id = u.id AND s.expires_at > ?1)
                 FROM users u WHERE u.id = ?2",
                params![&now_iso, &target_user_id],
                |row| {
                    Ok(crate::models::AdminUserSummary {
                        id: row.get(0)?,
                        name: row.get(1)?,
                        email: row.get(2)?,
                        role: row.get(3)?,
                        reputation_score: row.get(4)?,
                        created_at: row.get(5)?,
                        posts_count: row.get::<_, i64>(6)?.max(0) as usize,
                        active_sessions_count: row.get::<_, i64>(7)?.max(0) as usize,
                    })
                },
            )
            .optional()
            .map_err(|e| AppError::internal(format!("Role refetch error: {e}")))
        })
        .await
    }

    /// Return live SQLite table & verification breakdown counts for the Admin DB Overview panel.
    pub async fn get_admin_database_overview(
        &self,
        now_iso: &str,
    ) -> AppResult<crate::models::DbOverviewCounts> {
        let now_iso = now_iso.to_string();
        self.with_conn(move |conn| {
            let schema_version: i64 = conn
                .query_row(
                    "SELECT COALESCE(MAX(version), 0) FROM schema_migrations",
                    [],
                    |row| row.get(0),
                )
                .map_err(|e| AppError::internal(format!("Schema version query error: {e}")))?;

            let total_users: i64 = conn
                .query_row("SELECT COUNT(*) FROM users", [], |row| row.get(0))
                .map_err(|e| AppError::internal(format!("Users count query error: {e}")))?;
            let admins_count: i64 = conn
                .query_row(
                    "SELECT COUNT(*) FROM users WHERE role = 'admin'",
                    [],
                    |row| row.get(0),
                )
                .map_err(|e| AppError::internal(format!("Admins count query error: {e}")))?;
            let active_sessions_count: i64 = conn
                .query_row(
                    "SELECT COUNT(*) FROM sessions WHERE expires_at > ?1",
                    params![&now_iso],
                    |row| row.get(0),
                )
                .map_err(|e| AppError::internal(format!("Sessions count query error: {e}")))?;
            let total_comments: i64 = conn
                .query_row("SELECT COUNT(*) FROM comments", [], |row| row.get(0))
                .map_err(|e| AppError::internal(format!("Comments count query error: {e}")))?;
            let total_votes: i64 = conn
                .query_row("SELECT COUNT(*) FROM post_votes", [], |row| row.get(0))
                .map_err(|e| AppError::internal(format!("Votes count query error: {e}")))?;
            let total_audit_logs: i64 = conn
                .query_row("SELECT COUNT(*) FROM audit_logs", [], |row| row.get(0))
                .map_err(|e| AppError::internal(format!("Audit logs count query error: {e}")))?;

            let mut total_posts = 0usize;
            let mut verified_posts = 0usize;
            let mut pending_admin_posts = 0usize;
            let mut quarantined_posts = 0usize;
            let mut disputed_posts = 0usize;
            let mut resolved_posts = 0usize;

            let mut stmt = conn
                .prepare("SELECT verification_status, is_resolved FROM posts")
                .map_err(|e| AppError::internal(format!("Overview posts prepare error: {e}")))?;
            let rows = stmt
                .query_map([], |row| {
                    Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)? != 0))
                })
                .map_err(|e| AppError::internal(format!("Overview posts query error: {e}")))?;

            for row in rows {
                let (status_str, is_resolved) =
                    row.map_err(|e| AppError::internal(format!("Overview row decode error: {e}")))?;
                total_posts += 1;
                if is_resolved {
                    resolved_posts += 1;
                }
                if let Ok(st) = status_str.parse::<VerificationStatus>() {
                    if st.is_verified() {
                        verified_posts += 1;
                    }
                    match st {
                        VerificationStatus::PendingAdminApproval => pending_admin_posts += 1,
                        VerificationStatus::Quarantined => quarantined_posts += 1,
                        VerificationStatus::Disputed => disputed_posts += 1,
                        _ => {}
                    }
                }
            }

            Ok(crate::models::DbOverviewCounts {
                schema_version,
                total_users: total_users.max(0) as usize,
                admins_count: admins_count.max(0) as usize,
                active_sessions_count: active_sessions_count.max(0) as usize,
                total_posts,
                verified_posts,
                pending_admin_posts,
                quarantined_posts,
                disputed_posts,
                resolved_posts,
                total_comments: total_comments.max(0) as usize,
                total_votes: total_votes.max(0) as usize,
                total_audit_logs: total_audit_logs.max(0) as usize,
            })
        })
        .await
    }

    /// Permanently delete a post and its FTS index entry (cascading comments, votes, and audit logs).
    pub async fn delete_post(&self, id: &str) -> AppResult<Option<Post>> {
        let id = id.to_string();
        self.with_conn(move |conn| {
            let Some(existing) = fetch_post_by_id(conn, &id)? else {
                return Ok(None);
            };
            let tx = conn
                .transaction()
                .map_err(|e| AppError::internal(format!("Delete post tx error: {e}")))?;
            let _ = tx.execute("DELETE FROM posts_fts WHERE post_id = ?1", params![&id]);
            tx.execute("DELETE FROM posts WHERE id = ?1", params![&id])
                .map_err(|e| AppError::internal(format!("Delete post error: {e}")))?;
            tx.commit()
                .map_err(|e| AppError::internal(format!("Delete post commit error: {e}")))?;
            Ok(Some(existing))
        })
        .await
    }

    // =========================================================================
    // Posts, FTS5 Search, Pagination, Crowd Quorum & AI Retry Queue
    // =========================================================================

    pub async fn seed_if_empty(&self, seed_posts: Vec<Post>) -> AppResult<usize> {
        self.with_conn(move |conn| {
            let existing: i64 = conn
                .query_row("SELECT COUNT(*) FROM posts", [], |row| row.get(0))
                .map_err(|e| AppError::internal(format!("Failed to count posts: {e}")))?;
            if existing > 0 {
                return Ok(0);
            }

            let tx = conn
                .transaction()
                .map_err(|e| AppError::internal(format!("Failed to start seed transaction: {e}")))?;
            for post in &seed_posts {
                insert_post_row(&tx, post, None, None, false, None)?;
                insert_audit_row(
                    &tx,
                    &post.id,
                    "seeded",
                    &format!(
                        "Initialized seed report (status='{}', score={})",
                        post.verification_status, post.ai_authenticity_score
                    ),
                    &post.created_at,
                )?;
            }
            let count = seed_posts.len();
            tx.commit()
                .map_err(|e| AppError::internal(format!("Failed to commit seed transaction: {e}")))?;
            Ok(count)
        })
        .await
    }

    pub async fn count_posts(&self) -> AppResult<usize> {
        self.with_conn(|conn| {
            let count: i64 = conn
                .query_row("SELECT COUNT(*) FROM posts", [], |row| row.get(0))
                .map_err(|e| AppError::internal(format!("Failed to count posts: {e}")))?;
            Ok(count.max(0) as usize)
        })
        .await
    }

    /// Return all posts alongside their SHA-256 and perceptual dHash media fingerprints.
    pub async fn list_posts_with_fingerprints(&self) -> AppResult<Vec<PostWithFingerprints>> {
        self.with_conn(|conn| fetch_all_posts_with_fingerprints(conn))
            .await
    }

    pub async fn list_posts_paged(&self, query: &ListPostsQuery) -> AppResult<PagedPosts> {
        let category_filter = match query.category.as_deref().map(str::trim) {
            Some(c) if !c.is_empty() && !c.eq_ignore_ascii_case("all") => {
                Some(c.parse::<Category>().map_err(AppError::bad_request)?)
            }
            _ => None,
        };
        let verified_only = query.verified_only.unwrap_or(false);
        let exclude_quarantined = query.exclude_quarantined.unwrap_or(false);
        let search_raw = query
            .search
            .as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(ToOwned::to_owned);

        let geo_origin = match (query.lat, query.lng) {
            (Some(lat), Some(lng)) => {
                validate_coordinates(lat, lng, "query")?;
                Some((lat, lng))
            }
            (Some(_), None) | (None, Some(_)) => {
                return Err(AppError::bad_request(
                    "Both 'lat' and 'lng' must be provided together",
                ));
            }
            (None, None) => None,
        };

        let radius_km = match query.radius_km {
            Some(r) if !r.is_finite() || r <= 0.0 => {
                return Err(AppError::bad_request("radius_km must be a positive number"));
            }
            Some(r) => {
                if geo_origin.is_none() {
                    return Err(AppError::bad_request(
                        "radius_km requires both 'lat' and 'lng' query parameters",
                    ));
                }
                Some(r)
            }
            None => None,
        };

        let sort_mode = query
            .sort
            .as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(str::to_ascii_lowercase)
            .unwrap_or_else(|| "newest".to_string());

        if !matches!(
            sort_mode.as_str(),
            "newest" | "priority" | "nearest" | "severity"
        ) {
            return Err(AppError::bad_request(format!(
                "Invalid sort '{sort_mode}'. Expected one of: newest, priority, nearest, severity"
            )));
        }
        if sort_mode == "nearest" && geo_origin.is_none() {
            return Err(AppError::bad_request(
                "sort=nearest requires 'lat' and 'lng' query parameters",
            ));
        }

        let limit = query.limit.map(|l| l.clamp(1, 500)).unwrap_or(100);
        let offset = query.offset.unwrap_or(0);

        self.with_conn(move |conn| {
            // Try SQLite FTS5 first for ASCII token queries; merge with UTF-8 substring fallback
            let fts_matches = search_raw
                .as_deref()
                .and_then(|q| fts5_search_ids(conn, q));

            let mut posts = fetch_all_posts(conn)?;
            let search_needle = search_raw.as_deref().map(str::to_lowercase);

            posts.retain(|post| {
                if post.verification_status.is_hidden_from_public() {
                    return false;
                }
                if let Some(cat) = category_filter {
                    if post.category != cat {
                        return false;
                    }
                }
                if verified_only && !post.verification_status.is_verified() {
                    return false;
                }
                if exclude_quarantined && post.verification_status.is_quarantined() {
                    return false;
                }
                if let (Some((olat, olng)), Some(max_r)) = (geo_origin, radius_km) {
                    if haversine_distance_km(olat, olng, post.lat, post.lng) > max_r {
                        return false;
                    }
                }
                if let Some(ref needle) = search_needle {
                    let fts_hit = fts_matches
                        .as_ref()
                        .map(|set| set.contains(&post.id))
                        .unwrap_or(false);
                    if !fts_hit {
                        let hay = format!(
                            "{}\n{}\n{}\n{}\n{}",
                            post.title,
                            post.description,
                            post.translated_description,
                            post.location_name,
                            post.category.as_str()
                        )
                        .to_lowercase();
                        if !hay.contains(needle) {
                            return false;
                        }
                    }
                }
                true
            });

            match sort_mode.as_str() {
                "priority" => {
                    let now = Utc::now();
                    posts.sort_by(|a, b| {
                        compute_priority_score(b, now)
                            .total_cmp(&compute_priority_score(a, now))
                            .then_with(|| b.created_at.cmp(&a.created_at))
                    });
                }
                "nearest" => {
                    if let Some((olat, olng)) = geo_origin {
                        posts.sort_by(|a, b| {
                            haversine_distance_km(olat, olng, a.lat, a.lng)
                                .total_cmp(&haversine_distance_km(olat, olng, b.lat, b.lng))
                        });
                    }
                }
                "severity" => {
                    posts.sort_by(|a, b| {
                        b.severity
                            .cmp(&a.severity)
                            .then_with(|| b.created_at.cmp(&a.created_at))
                    });
                }
                _ => {}
            }

            let total_count = posts.len();
            let paged = posts.into_iter().skip(offset).take(limit).collect();

            Ok(PagedPosts {
                posts: paged,
                total_count,
                limit,
                offset,
            })
        })
        .await
    }

    pub async fn list_posts(&self, query: &ListPostsQuery) -> AppResult<Vec<Post>> {
        Ok(self.list_posts_paged(query).await?.posts)
    }

    pub async fn list_active_non_quarantined(&self) -> AppResult<Vec<Post>> {
        self.list_posts(&ListPostsQuery {
            exclude_quarantined: Some(true),
            limit: Some(500),
            ..Default::default()
        })
        .await
    }

    /// Return all posts awaiting Admin review: `Pending Admin Approval`, `Quarantined`, and `Disputed`.
    pub async fn list_pending_admin_posts(&self) -> AppResult<Vec<Post>> {
        self.with_conn(|conn| {
            let mut posts = fetch_all_posts(conn)?;
            posts.retain(|post| post.verification_status.is_pending_admin_review());
            Ok(posts)
        })
        .await
    }

    pub async fn get_post(&self, id: &str) -> AppResult<Option<Post>> {
        let id = id.to_string();
        self.with_conn(move |conn| fetch_post_by_id(conn, &id)).await
    }

    pub async fn insert_post(
        &self,
        post: Post,
        media_hash: Option<String>,
        media_dhash: Option<String>,
        needs_ai_retry: bool,
        author_user_id: Option<String>,
        audit_details: String,
    ) -> AppResult<Post> {
        self.with_conn(move |conn| {
            let tx = conn
                .transaction()
                .map_err(|e| AppError::internal(format!("Failed to begin insert tx: {e}")))?;
            insert_post_row(
                &tx,
                &post,
                media_hash.as_deref(),
                media_dhash.as_deref(),
                needs_ai_retry,
                author_user_id.as_deref(),
            )?;
            insert_audit_row(&tx, &post.id, "post_created", &audit_details, &post.created_at)?;
            tx.commit()
                .map_err(|e| AppError::internal(format!("Failed to commit insert tx: {e}")))?;
            Ok(post)
        })
        .await
    }

    /// Return `{ post_id -> vote_type }` for all votes recorded by `voter_key`.
    pub async fn get_viewer_votes(&self, voter_key: &str) -> AppResult<HashMap<String, String>> {
        let voter_key = voter_key.to_string();
        self.with_conn(move |conn| {
            let mut stmt = conn
                .prepare("SELECT post_id, vote_type FROM post_votes WHERE voter_key = ?1")
                .map_err(|e| AppError::internal(format!("DB viewer votes prepare error: {e}")))?;
            let rows = stmt
                .query_map(params![&voter_key], |row| {
                    Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
                })
                .map_err(|e| AppError::internal(format!("DB viewer votes query error: {e}")))?;

            let mut out = HashMap::new();
            for row in rows {
                let (pid, vtype) =
                    row.map_err(|e| AppError::internal(format!("DB viewer vote decode error: {e}")))?;
                out.insert(pid, vtype);
            }
            Ok(out)
        })
        .await
    }

    /// Return `"verify"` or `"flag"` if `voter_key` has already voted on `post_id`.
    pub async fn get_viewer_vote_for_post(
        &self,
        post_id: &str,
        voter_key: &str,
    ) -> AppResult<Option<String>> {
        let post_id = post_id.to_string();
        let voter_key = voter_key.to_string();
        self.with_conn(move |conn| {
            conn.query_row(
                "SELECT vote_type FROM post_votes WHERE post_id = ?1 AND voter_key = ?2",
                params![&post_id, &voter_key],
                |row| row.get(0),
            )
            .optional()
            .map_err(|e| AppError::internal(format!("DB viewer vote lookup error: {e}")))
        })
        .await
    }

    pub async fn increment_verify(
        &self,
        id: &str,
        voter_key: String,
        voter_user_id: Option<String>,
        strict_unique_voters: bool,
        weight: u32,
    ) -> AppResult<Option<Post>> {
        let id = id.to_string();
        let weight = weight.max(1);
        let now_str = Utc::now().to_rfc3339_opts(SecondsFormat::Secs, true);
        self.with_conn(move |conn| {
            let tx = conn
                .transaction()
                .map_err(|e| AppError::internal(format!("Failed to begin verify tx: {e}")))?;

            let Some((confirmations, status_str, is_resolved_int, author_user_id)): Option<(
                u32,
                String,
                i64,
                Option<String>,
            )> = tx
                .query_row(
                    "SELECT confirmations, verification_status, is_resolved, author_user_id FROM posts WHERE id = ?1",
                    params![&id],
                    |row| {
                        Ok((
                            row.get::<_, u32>(0)?,
                            row.get::<_, String>(1)?,
                            row.get::<_, i64>(2)?,
                            row.get::<_, Option<String>>(3)?,
                        ))
                    },
                )
                .optional()
                .map_err(|e| AppError::internal(format!("DB read error in verify: {e}")))?
            else {
                return Ok(None);
            };

            let current_status = status_str
                .parse::<VerificationStatus>()
                .unwrap_or(VerificationStatus::Unverified);

            if matches!(
                current_status,
                VerificationStatus::PendingAdminApproval
                    | VerificationStatus::Rejected
                    | VerificationStatus::Quarantined
            ) {
                return Err(AppError::conflict(format!(
                    "Cannot confirm a report with status '{current_status}'"
                )));
            }
            if is_resolved_int != 0 {
                return Err(AppError::conflict("Cannot confirm a resolved report"));
            }
            if author_user_id.is_some() && author_user_id == voter_user_id {
                return Err(AppError::forbidden("You cannot confirm your own report"));
            }

            if strict_unique_voters {
                record_unique_vote(&tx, &id, &voter_key, "verify", &now_str)?;
            }

            let next_confirmations = confirmations.saturating_add(weight);
            let next_status = status_after_verify(current_status, next_confirmations);

            tx.execute(
                "UPDATE posts SET confirmations = ?1, verification_status = ?2 WHERE id = ?3",
                params![next_confirmations, next_status.as_str(), &id],
            )
            .map_err(|e| AppError::internal(format!("DB update error in verify: {e}")))?;

            if current_status != VerificationStatus::CommunityVerified
                && next_status == VerificationStatus::CommunityVerified
            {
                if let Some(ref uid) = author_user_id {
                    adjust_user_reputation(&tx, uid, 5)?;
                }
            }

            insert_audit_row(
                &tx,
                &id,
                "post_verified",
                &format!(
                    "weight={weight}, confirmations={next_confirmations}, status='{}' (was '{}')",
                    next_status, current_status
                ),
                &now_str,
            )?;

            tx.commit()
                .map_err(|e| AppError::internal(format!("DB commit error in verify: {e}")))?;

            let mut post = fetch_post_by_id(conn, &id)?;
            if let Some(ref mut p) = post {
                if strict_unique_voters {
                    p.viewer_vote = Some("verify".to_string());
                }
            }
            Ok(post)
        })
        .await
    }

    pub async fn increment_flag(
        &self,
        id: &str,
        voter_key: String,
        voter_user_id: Option<String>,
        strict_unique_voters: bool,
    ) -> AppResult<Option<Post>> {
        let id = id.to_string();
        let now_str = Utc::now().to_rfc3339_opts(SecondsFormat::Secs, true);
        self.with_conn(move |conn| {
            let tx = conn
                .transaction()
                .map_err(|e| AppError::internal(format!("Failed to begin flag tx: {e}")))?;

            let Some((false_flags, status_str, is_live_int, ai_score, author_user_id)): Option<(
                u32,
                String,
                i64,
                u8,
                Option<String>,
            )> = tx
                .query_row(
                    "SELECT false_flags, verification_status, is_live_captured, ai_authenticity_score, author_user_id
                     FROM posts WHERE id = ?1",
                    params![&id],
                    |row| {
                        Ok((
                            row.get::<_, u32>(0)?,
                            row.get::<_, String>(1)?,
                            row.get::<_, i64>(2)?,
                            row.get::<_, u8>(3)?,
                            row.get::<_, Option<String>>(4)?,
                        ))
                    },
                )
                .optional()
                .map_err(|e| AppError::internal(format!("DB read error in flag: {e}")))?
            else {
                return Ok(None);
            };

            let current_status = status_str
                .parse::<VerificationStatus>()
                .unwrap_or(VerificationStatus::Unverified);

            if matches!(
                current_status,
                VerificationStatus::PendingAdminApproval
                    | VerificationStatus::Rejected
                    | VerificationStatus::Quarantined
            ) {
                return Err(AppError::conflict(format!(
                    "Cannot flag a report with status '{current_status}'"
                )));
            }
            if author_user_id.is_some() && author_user_id == voter_user_id {
                return Err(AppError::forbidden("You cannot flag your own report"));
            }

            if strict_unique_voters {
                record_unique_vote(&tx, &id, &voter_key, "flag", &now_str)?;
            }

            let next_flags = false_flags.saturating_add(1);
            let is_live_captured = is_live_int != 0;
            let next_status =
                status_after_flag(current_status, next_flags, is_live_captured, ai_score);

            tx.execute(
                "UPDATE posts SET false_flags = ?1, verification_status = ?2 WHERE id = ?3",
                params![next_flags, next_status.as_str(), &id],
            )
            .map_err(|e| AppError::internal(format!("DB update error in flag: {e}")))?;

            if current_status != VerificationStatus::Quarantined
                && next_status == VerificationStatus::Quarantined
            {
                if let Some(ref uid) = author_user_id {
                    adjust_user_reputation(&tx, uid, -5)?;
                }
            }

            insert_audit_row(
                &tx,
                &id,
                "post_flagged",
                &format!(
                    "false_flags={next_flags}, status='{}' (was '{}')",
                    next_status, current_status
                ),
                &now_str,
            )?;

            tx.commit()
                .map_err(|e| AppError::internal(format!("DB commit error in flag: {e}")))?;

            let mut post = fetch_post_by_id(conn, &id)?;
            if let Some(ref mut p) = post {
                if strict_unique_voters {
                    p.viewer_vote = Some("flag".to_string());
                }
            }
            Ok(post)
        })
        .await
    }

    pub async fn set_admin_moderation_status(
        &self,
        id: &str,
        new_status: VerificationStatus,
        admin_email: &str,
        action: &str,
    ) -> AppResult<Option<Post>> {
        let id = id.to_string();
        let admin_email = admin_email.to_string();
        let action = action.to_string();
        let now_str = Utc::now().to_rfc3339_opts(SecondsFormat::Secs, true);

        self.with_conn(move |conn| {
            let tx = conn
                .transaction()
                .map_err(|e| AppError::internal(format!("Failed to begin moderation tx: {e}")))?;

            let Some((prev_status_str, author_user_id)): Option<(String, Option<String>)> = tx
                .query_row(
                    "SELECT verification_status, author_user_id FROM posts WHERE id = ?1",
                    params![&id],
                    |row| Ok((row.get(0)?, row.get(1)?)),
                )
                .optional()
                .map_err(|e| AppError::internal(format!("DB read error in moderation: {e}")))?
            else {
                return Ok(None);
            };

            let prev_status = prev_status_str
                .parse::<VerificationStatus>()
                .unwrap_or(VerificationStatus::Unverified);
            if prev_status == new_status {
                tx.commit()
                    .map_err(|e| AppError::internal(format!("DB commit error in moderation: {e}")))?;
                return fetch_post_by_id(conn, &id);
            }

            tx.execute(
                "UPDATE posts SET verification_status = ?1, needs_ai_retry = 0 WHERE id = ?2",
                params![new_status.as_str(), &id],
            )
            .map_err(|e| AppError::internal(format!("DB update error in moderation: {e}")))?;

            if let Some(ref uid) = author_user_id {
                let rep_delta = match new_status {
                    VerificationStatus::AdminApproved => 5,
                    VerificationStatus::Rejected => -5,
                    _ => 0,
                };
                if rep_delta != 0 {
                    adjust_user_reputation(&tx, uid, rep_delta)?;
                }
            }

            insert_audit_row(
                &tx,
                &id,
                &action,
                &format!(
                    "admin='{}', status='{}' (was '{}')",
                    admin_email,
                    new_status.as_str(),
                    prev_status_str
                ),
                &now_str,
            )?;

            tx.commit()
                .map_err(|e| AppError::internal(format!("DB commit error in moderation: {e}")))?;

            fetch_post_by_id(conn, &id)
        })
        .await
    }

    pub async fn toggle_resolve(
        &self,
        id: &str,
        actor_user_id: &str,
        actor_role: UserRole,
        actor_label: &str,
    ) -> AppResult<Option<Post>> {
        let id = id.to_string();
        let actor_user_id = actor_user_id.to_string();
        let actor_label = actor_label.to_string();
        let now_str = Utc::now().to_rfc3339_opts(SecondsFormat::Secs, true);
        self.with_conn(move |conn| {
            let tx = conn
                .transaction()
                .map_err(|e| AppError::internal(format!("Failed to begin resolve tx: {e}")))?;

            let Some((current_int, status_str, author_user_id)): Option<(
                i64,
                String,
                Option<String>,
            )> = tx
                .query_row(
                    "SELECT is_resolved, verification_status, author_user_id FROM posts WHERE id = ?1",
                    params![&id],
                    |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
                )
                .optional()
                .map_err(|e| AppError::internal(format!("DB read error in resolve: {e}")))?
            else {
                return Ok(None);
            };

            let status = status_str
                .parse::<VerificationStatus>()
                .unwrap_or(VerificationStatus::Unverified);
            if status.is_hidden_from_public() {
                return Err(AppError::conflict(
                    "Cannot resolve an unpublished or rejected report",
                ));
            }
            if actor_role != UserRole::Admin && author_user_id.as_deref() != Some(actor_user_id.as_str()) {
                return Err(AppError::forbidden(
                    "Only the report author or an administrator can resolve or reopen this incident",
                ));
            }

            let next_int: i64 = if current_int == 0 { 1 } else { 0 };
            tx.execute(
                "UPDATE posts SET is_resolved = ?1 WHERE id = ?2",
                params![next_int, &id],
            )
            .map_err(|e| AppError::internal(format!("DB update error in resolve: {e}")))?;

            insert_audit_row(
                &tx,
                &id,
                "post_resolved_toggled",
                &format!("actor={actor_label}, is_resolved={}", next_int != 0),
                &now_str,
            )?;

            tx.commit()
                .map_err(|e| AppError::internal(format!("DB commit error in resolve: {e}")))?;

            fetch_post_by_id(conn, &id)
        })
        .await
    }

    pub async fn add_comment(&self, post_id: &str, comment: Comment) -> AppResult<Option<Post>> {
        let post_id = post_id.to_string();
        self.with_conn(move |conn| {
            let tx = conn
                .transaction()
                .map_err(|e| AppError::internal(format!("Failed to begin comment tx: {e}")))?;

            let Some(status_str): Option<String> = tx
                .query_row(
                    "SELECT verification_status FROM posts WHERE id = ?1",
                    params![&post_id],
                    |row| row.get(0),
                )
                .optional()
                .map_err(|e| AppError::internal(format!("DB read error in comment: {e}")))?
            else {
                return Ok(None);
            };

            let status = status_str
                .parse::<VerificationStatus>()
                .unwrap_or(VerificationStatus::Unverified);
            if matches!(
                status,
                VerificationStatus::PendingAdminApproval
                    | VerificationStatus::Rejected
                    | VerificationStatus::Quarantined
            ) {
                return Err(AppError::conflict(
                    "Cannot comment on a report that is pending approval, quarantined, or rejected",
                ));
            }

            tx.execute(
                "INSERT INTO comments (post_id, author, text, created_at) VALUES (?1, ?2, ?3, ?4)",
                params![
                    &post_id,
                    &comment.author,
                    &comment.text,
                    &comment.created_at
                ],
            )
            .map_err(|e| AppError::internal(format!("DB insert error in comment: {e}")))?;

            insert_audit_row(
                &tx,
                &post_id,
                "comment_added",
                &format!("Comment by '{}'", comment.author),
                &comment.created_at,
            )?;

            tx.commit()
                .map_err(|e| AppError::internal(format!("DB commit error in comment: {e}")))?;

            fetch_post_by_id(conn, &post_id)
        })
        .await
    }

    pub async fn list_audit_logs(&self, post_id: &str) -> AppResult<Option<Vec<AuditLogEntry>>> {
        let post_id = post_id.to_string();
        self.with_conn(move |conn| {
            let exists: Option<String> = conn
                .query_row(
                    "SELECT id FROM posts WHERE id = ?1",
                    params![&post_id],
                    |row| row.get(0),
                )
                .optional()
                .map_err(|e| AppError::internal(format!("DB read error in audit logs: {e}")))?;
            if exists.is_none() {
                return Ok(None);
            }

            let mut stmt = conn
                .prepare(
                    "SELECT id, post_id, action, details, created_at
                     FROM audit_logs WHERE post_id = ?1 ORDER BY id ASC",
                )
                .map_err(|e| AppError::internal(format!("Failed to prepare audit query: {e}")))?;

            let rows = stmt
                .query_map(params![&post_id], |row| {
                    Ok(AuditLogEntry {
                        id: row.get(0)?,
                        post_id: row.get(1)?,
                        action: row.get(2)?,
                        details: row.get(3)?,
                        created_at: row.get(4)?,
                    })
                })
                .map_err(|e| AppError::internal(format!("Failed to query audit logs: {e}")))?;

            let mut logs = Vec::new();
            for row in rows {
                logs.push(
                    row.map_err(|e| AppError::internal(format!("Audit row decode error: {e}")))?,
                );
            }
            Ok(Some(logs))
        })
        .await
    }

    // =========================================================================
    // Background AI Retry & Metrics
    // =========================================================================

    pub async fn list_posts_needing_ai_retry(&self, limit: usize) -> AppResult<Vec<Post>> {
        self.with_conn(move |conn| {
            let mut stmt = conn
                .prepare(
                    "SELECT
                        id, title, description, translated_description, category, lat, lng,
                        location_name, media_url, is_live_captured, is_on_site,
                        ai_authenticity_score, ai_reasoning, travel_advisory, severity,
                        verification_status, confirmations, false_flags, is_resolved,
                        integrity_hash, created_at, author_user_id
                     FROM posts
                     WHERE needs_ai_retry = 1
                     ORDER BY created_at ASC
                     LIMIT ?1",
                )
                .map_err(|e| AppError::internal(format!("AI retry query prepare error: {e}")))?;

            let rows = stmt
                .query_map(params![limit as i64], row_to_post)
                .map_err(|e| AppError::internal(format!("AI retry query error: {e}")))?;

            let mut out = Vec::new();
            for r in rows {
                out.push(r.map_err(|e| AppError::internal(format!("AI retry decode error: {e}")))?);
            }
            Ok(out)
        })
        .await
    }

    pub async fn apply_ai_retry_result(
        &self,
        post_id: &str,
        update: AiRetryUpdate,
    ) -> AppResult<Option<Post>> {
        let post_id = post_id.to_string();
        let now_str = Utc::now().to_rfc3339_opts(SecondsFormat::Secs, true);
        self.with_conn(move |conn| {
            let tx = conn
                .transaction()
                .map_err(|e| AppError::internal(format!("AI retry tx error: {e}")))?;

            let Some(current_status_str): Option<String> = tx
                .query_row(
                    "SELECT verification_status FROM posts WHERE id = ?1",
                    params![&post_id],
                    |row| row.get(0),
                )
                .optional()
                .map_err(|e| AppError::internal(format!("AI retry read error: {e}")))?
            else {
                return Ok(None);
            };

            let current_status = current_status_str
                .parse::<VerificationStatus>()
                .unwrap_or(VerificationStatus::Unverified);

            // Preserve Admin/Guest moderation holds (`Pending Admin Approval`, `Admin Approved`, `Rejected`, `Community Verified`)
            let effective_status = if matches!(
                current_status,
                VerificationStatus::PendingAdminApproval
                    | VerificationStatus::AdminApproved
                    | VerificationStatus::Rejected
                    | VerificationStatus::CommunityVerified
            ) {
                current_status
            } else {
                update.new_status
            };

            tx.execute(
                "UPDATE posts
                 SET ai_authenticity_score = ?1,
                     ai_reasoning = ?2,
                     translated_description = ?3,
                     travel_advisory = ?4,
                     severity = ?5,
                     verification_status = ?6,
                     needs_ai_retry = 0
                 WHERE id = ?7",
                params![
                    update.ai_score,
                    &update.ai_reasoning,
                    &update.translated_description,
                    update.travel_advisory.as_str(),
                    update.severity,
                    effective_status.as_str(),
                    &post_id
                ],
            )
            .map_err(|e| AppError::internal(format!("AI retry update error: {e}")))?;

            let _ = tx.execute(
                "UPDATE posts_fts SET translated_description = ?1 WHERE post_id = ?2",
                params![&update.translated_description, &post_id],
            );

            insert_audit_row(
                &tx,
                &post_id,
                "ai_retry_completed",
                &format!(
                    "score={}, status='{}' (was '{}')",
                    update.ai_score, effective_status, current_status
                ),
                &now_str,
            )?;

            tx.commit()
                .map_err(|e| AppError::internal(format!("AI retry commit error: {e}")))?;

            fetch_post_by_id(conn, &post_id)
        })
        .await
    }

    pub async fn get_status_counts(&self) -> AppResult<StatusCounts> {
        let now_iso = Utc::now().to_rfc3339_opts(SecondsFormat::Secs, true);
        self.with_conn(move |conn| {
            let mut counts = StatusCounts::default();

            let mut stmt = conn
                .prepare("SELECT verification_status, is_resolved, needs_ai_retry FROM posts")
                .map_err(|e| AppError::internal(format!("Metrics query error: {e}")))?;
            let rows = stmt
                .query_map([], |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, i64>(1)? != 0,
                        row.get::<_, i64>(2)? != 0,
                    ))
                })
                .map_err(|e| AppError::internal(format!("Metrics rows error: {e}")))?;

            for r in rows {
                let (status_str, is_resolved, needs_retry) =
                    r.map_err(|e| AppError::internal(format!("Metrics row decode error: {e}")))?;
                counts.total += 1;
                if is_resolved {
                    counts.resolved += 1;
                }
                if needs_retry {
                    counts.needs_ai_retry += 1;
                }
                if let Ok(st) = status_str.parse::<VerificationStatus>() {
                    if st.is_verified() {
                        counts.verified += 1;
                    }
                    match st {
                        VerificationStatus::PendingAdminApproval => counts.pending_admin += 1,
                        VerificationStatus::Quarantined => counts.quarantined += 1,
                        VerificationStatus::Disputed => counts.disputed += 1,
                        _ => {}
                    }
                }
            }

            counts.users_count = conn
                .query_row("SELECT COUNT(*) FROM users", [], |row| row.get::<_, i64>(0))
                .unwrap_or(0)
                .max(0) as usize;
            counts.active_sessions_count = conn
                .query_row(
                    "SELECT COUNT(*) FROM sessions WHERE expires_at > ?1",
                    params![&now_iso],
                    |row| row.get::<_, i64>(0),
                )
                .unwrap_or(0)
                .max(0) as usize;

            Ok(counts)
        })
        .await
    }
}

fn ensure_post_column(conn: &Connection, name: &str, definition: &str) -> AppResult<()> {
    let mut stmt = conn
        .prepare("PRAGMA table_info(posts)")
        .map_err(|e| AppError::internal(format!("PRAGMA table_info error: {e}")))?;
    let cols = stmt
        .query_map([], |row| row.get::<_, String>(1))
        .map_err(|e| AppError::internal(format!("PRAGMA table_info map error: {e}")))?;

    for col in cols {
        if col.map_err(|e| AppError::internal(format!("Column name error: {e}")))? == name {
            return Ok(());
        }
    }

    conn.execute(
        &format!("ALTER TABLE posts ADD COLUMN {name} {definition}"),
        [],
    )
    .map_err(|e| AppError::internal(format!("ALTER TABLE posts add {name} error: {e}")))?;
    Ok(())
}

fn adjust_user_reputation(conn: &Connection, user_id: &str, delta: i64) -> AppResult<()> {
    conn.execute(
        "UPDATE users
         SET reputation_score = MAX(0, MIN(1000, reputation_score + ?1))
         WHERE id = ?2",
        params![delta, user_id],
    )
    .map_err(|e| AppError::internal(format!("Failed to update user reputation: {e}")))?;
    Ok(())
}

fn record_unique_vote(
    conn: &Connection,
    post_id: &str,
    voter_key: &str,
    vote_type: &str,
    now_str: &str,
) -> AppResult<()> {
    let existing: Option<String> = conn
        .query_row(
            "SELECT vote_type FROM post_votes WHERE post_id = ?1 AND voter_key = ?2",
            params![post_id, voter_key],
            |row| row.get(0),
        )
        .optional()
        .map_err(|e| AppError::internal(format!("DB vote lookup error: {e}")))?;

    if let Some(prev) = existing {
        let msg = match (prev.as_str(), vote_type) {
            ("verify", "verify") => "You have already confirmed this report",
            ("flag", "verify") => "You have already flagged this report and cannot confirm it",
            ("flag", "flag") => "You have already flagged this report",
            ("verify", "flag") => "You have already confirmed this report and cannot flag it",
            _ => "You have already voted on this report",
        };
        return Err(AppError::conflict(msg));
    }

    let inserted = conn
        .execute(
            "INSERT OR IGNORE INTO post_votes (post_id, voter_key, vote_type, created_at)
             VALUES (?1, ?2, ?3, ?4)",
            params![post_id, voter_key, vote_type, now_str],
        )
        .map_err(|e| AppError::internal(format!("DB vote insert error: {e}")))?;

    if inserted == 0 {
        return Err(AppError::conflict("You have already voted on this report"));
    }
    Ok(())
}

fn fts5_search_ids(conn: &Connection, raw_query: &str) -> Option<HashSet<String>> {
    let tokens: Vec<String> = raw_query
        .split_whitespace()
        .map(|w| w.trim_matches(|c: char| !c.is_alphanumeric()))
        .filter(|w| w.len() >= 2 && w.is_ascii() && w.chars().all(|c| c.is_ascii_alphanumeric()))
        .map(|w| format!("\"{w}\"*"))
        .collect();

    if tokens.is_empty() {
        return None;
    }

    let match_expr = tokens.join(" AND ");
    let mut stmt = conn
        .prepare("SELECT post_id FROM posts_fts WHERE posts_fts MATCH ?1")
        .ok()?;
    let rows = stmt
        .query_map(params![match_expr], |row| row.get::<_, String>(0))
        .ok()?;

    let mut set = HashSet::new();
    for id in rows.flatten() {
        set.insert(id);
    }
    Some(set)
}

fn insert_post_row(
    conn: &Connection,
    post: &Post,
    media_hash: Option<&str>,
    media_dhash: Option<&str>,
    needs_ai_retry: bool,
    author_user_id: Option<&str>,
) -> AppResult<()> {
    conn.execute(
        "INSERT INTO posts (
            id, title, description, translated_description, category, lat, lng,
            location_name, media_url, media_hash, media_dhash, is_live_captured, is_on_site,
            ai_authenticity_score, ai_reasoning, travel_advisory, severity,
            verification_status, confirmations, false_flags, is_resolved,
            integrity_hash, needs_ai_retry, author_user_id, created_at
        ) VALUES (
            ?1, ?2, ?3, ?4, ?5, ?6, ?7,
            ?8, ?9, ?10, ?11, ?12, ?13,
            ?14, ?15, ?16, ?17,
            ?18, ?19, ?20, ?21,
            ?22, ?23, ?24, ?25
        )",
        params![
            post.id,
            post.title,
            post.description,
            post.translated_description,
            post.category.as_str(),
            post.lat,
            post.lng,
            post.location_name,
            post.media_url,
            media_hash,
            media_dhash,
            i64::from(post.is_live_captured),
            i64::from(post.is_on_site),
            post.ai_authenticity_score,
            post.ai_reasoning,
            post.travel_advisory.as_str(),
            post.severity,
            post.verification_status.as_str(),
            post.confirmations,
            post.false_flags,
            i64::from(post.is_resolved),
            post.integrity_hash,
            i64::from(needs_ai_retry),
            author_user_id,
            post.created_at,
        ],
    )
    .map_err(|e| AppError::internal(format!("Failed to insert post: {e}")))?;

    let _ = conn.execute(
        "INSERT INTO posts_fts (post_id, title, description, translated_description, location_name, category)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        params![
            post.id,
            post.title,
            post.description,
            post.translated_description,
            post.location_name,
            post.category.as_str(),
        ],
    );

    for comment in &post.comments {
        conn.execute(
            "INSERT INTO comments (post_id, author, text, created_at) VALUES (?1, ?2, ?3, ?4)",
            params![post.id, comment.author, comment.text, comment.created_at],
        )
        .map_err(|e| AppError::internal(format!("Failed to insert seed comment: {e}")))?;
    }
    Ok(())
}

fn insert_audit_row(
    conn: &Connection,
    post_id: &str,
    action: &str,
    details: &str,
    created_at: &str,
) -> AppResult<()> {
    conn.execute(
        "INSERT INTO audit_logs (post_id, action, details, created_at) VALUES (?1, ?2, ?3, ?4)",
        params![post_id, action, details, created_at],
    )
    .map_err(|e| AppError::internal(format!("Failed to insert audit log: {e}")))?;
    Ok(())
}

fn fetch_all_posts(conn: &Connection) -> AppResult<Vec<Post>> {
    Ok(fetch_all_posts_with_fingerprints(conn)?
        .into_iter()
        .map(|(post, _, _)| post)
        .collect())
}

fn fetch_all_posts_with_fingerprints(conn: &Connection) -> AppResult<Vec<PostWithFingerprints>> {
    let mut comments_by_post: HashMap<String, Vec<Comment>> = HashMap::new();
    {
        let mut c_stmt = conn
            .prepare("SELECT post_id, author, text, created_at FROM comments ORDER BY id ASC")
            .map_err(|e| AppError::internal(format!("Failed to prepare comments query: {e}")))?;
        let c_rows = c_stmt
            .query_map([], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    Comment {
                        author: row.get(1)?,
                        text: row.get(2)?,
                        created_at: row.get(3)?,
                    },
                ))
            })
            .map_err(|e| AppError::internal(format!("Failed to query comments: {e}")))?;

        for row in c_rows {
            let (post_id, comment) =
                row.map_err(|e| AppError::internal(format!("Comment row read error: {e}")))?;
            comments_by_post.entry(post_id).or_default().push(comment);
        }
    }

    let mut stmt = conn
        .prepare(
            "SELECT
                id, title, description, translated_description, category, lat, lng,
                location_name, media_url, is_live_captured, is_on_site,
                ai_authenticity_score, ai_reasoning, travel_advisory, severity,
                verification_status, confirmations, false_flags, is_resolved,
                integrity_hash, created_at, author_user_id, media_hash, media_dhash
             FROM posts
             ORDER BY created_at DESC, rowid DESC",
        )
        .map_err(|e| AppError::internal(format!("Failed to prepare posts query: {e}")))?;

    let rows = stmt
        .query_map([], |row| {
            let post = row_to_post(row)?;
            let media_hash: Option<String> = row.get(22)?;
            let media_dhash: Option<String> = row.get(23)?;
            Ok((post, media_hash, media_dhash))
        })
        .map_err(|e| AppError::internal(format!("Failed to query posts: {e}")))?;

    let mut posts = Vec::new();
    for row in rows {
        let (mut post, media_hash, media_dhash) =
            row.map_err(|e| AppError::internal(format!("Post row read error: {e}")))?;
        if let Some(comments) = comments_by_post.remove(&post.id) {
            post.comments = comments;
        }
        posts.push((post, media_hash, media_dhash));
    }

    Ok(posts)
}

fn fetch_post_by_id(conn: &Connection, id: &str) -> AppResult<Option<Post>> {
    let mut post = conn
        .query_row(
            "SELECT
                id, title, description, translated_description, category, lat, lng,
                location_name, media_url, is_live_captured, is_on_site,
                ai_authenticity_score, ai_reasoning, travel_advisory, severity,
                verification_status, confirmations, false_flags, is_resolved,
                integrity_hash, created_at, author_user_id
             FROM posts WHERE id = ?1",
            params![id],
            row_to_post,
        )
        .optional()
        .map_err(|e| AppError::internal(format!("Failed to read post '{id}': {e}")))?;

    if let Some(ref mut p) = post {
        let mut stmt = conn
            .prepare(
                "SELECT author, text, created_at FROM comments WHERE post_id = ?1 ORDER BY id ASC",
            )
            .map_err(|e| AppError::internal(format!("Failed to prepare comments query: {e}")))?;
        let rows = stmt
            .query_map(params![&p.id], |row| {
                Ok(Comment {
                    author: row.get(0)?,
                    text: row.get(1)?,
                    created_at: row.get(2)?,
                })
            })
            .map_err(|e| AppError::internal(format!("Failed to query post comments: {e}")))?;

        for row in rows {
            p.comments
                .push(row.map_err(|e| AppError::internal(format!("Comment decode error: {e}")))?);
        }
    }

    Ok(post)
}

fn row_to_user(row: &rusqlite::Row<'_>) -> rusqlite::Result<StoredUser> {
    let role_str: String = row.get(3)?;
    let role = role_str.parse::<UserRole>().map_err(|e| {
        rusqlite::Error::FromSqlConversionFailure(
            3,
            rusqlite::types::Type::Text,
            Box::new(std::io::Error::new(std::io::ErrorKind::InvalidData, e)),
        )
    })?;

    Ok(StoredUser {
        id: row.get(0)?,
        name: row.get(1)?,
        email: row.get(2)?,
        role,
        password_hash: row.get(4)?,
        reputation_score: row.get(5)?,
        created_at: row.get(6)?,
    })
}

fn row_to_post(row: &rusqlite::Row<'_>) -> rusqlite::Result<Post> {
    let category_str: String = row.get(4)?;
    let advisory_str: String = row.get(13)?;
    let status_str: String = row.get(15)?;

    let category = category_str.parse::<Category>().map_err(|e| {
        rusqlite::Error::FromSqlConversionFailure(
            4,
            rusqlite::types::Type::Text,
            Box::new(std::io::Error::new(std::io::ErrorKind::InvalidData, e)),
        )
    })?;
    let travel_advisory = advisory_str.parse::<TravelAdvisory>().map_err(|e| {
        rusqlite::Error::FromSqlConversionFailure(
            13,
            rusqlite::types::Type::Text,
            Box::new(std::io::Error::new(std::io::ErrorKind::InvalidData, e)),
        )
    })?;
    let verification_status = status_str.parse::<VerificationStatus>().map_err(|e| {
        rusqlite::Error::FromSqlConversionFailure(
            15,
            rusqlite::types::Type::Text,
            Box::new(std::io::Error::new(std::io::ErrorKind::InvalidData, e)),
        )
    })?;

    Ok(Post {
        id: row.get(0)?,
        title: row.get(1)?,
        description: row.get(2)?,
        translated_description: row.get(3)?,
        category,
        lat: row.get(5)?,
        lng: row.get(6)?,
        location_name: row.get(7)?,
        media_url: row.get(8)?,
        is_live_captured: row.get::<_, i64>(9)? != 0,
        is_on_site: row.get::<_, i64>(10)? != 0,
        ai_authenticity_score: row.get(11)?,
        ai_reasoning: row.get(12)?,
        travel_advisory,
        severity: row.get(14)?,
        verification_status,
        confirmations: row.get(16)?,
        false_flags: row.get(17)?,
        is_resolved: row.get::<_, i64>(18)? != 0,
        integrity_hash: row.get(19)?,
        author_id: row.get(21)?,
        viewer_vote: None,
        comments: Vec::new(),
        created_at: row.get(20)?,
    })
}
