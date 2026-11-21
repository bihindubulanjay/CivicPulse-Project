# CivicPulse-Backend API Contract (`feat/civicpulse-backend`)

Base URL (local development): `http://localhost:8080`

This contract defines the exact JSON schemas, status codes, enums, and GeoJSON payloads exposed by `./CivicPulse-Backend` for **Member 2 (`./CivicPulse-Frontend`)** and **Member 3 (`./CivicPulse-CLI`)**.

---

## Global Behavior & Headers

- **CORS:** Configurable via `ALLOWED_ORIGINS` (permissive when empty/`*`, strict allowlist when comma-separated origins are provided).
- **Security Headers:** Every response sets `X-Request-Id` (UUID v4 or validated client ID), `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`, `Permissions-Policy`, and `Cache-Control: no-store`.
- **Input & Media Hardening:** All text fields strip ANSI terminal escape sequences, NUL bytes, and Unicode Bidi override characters (protecting both `./CivicPulse-Frontend` Web UI and `./CivicPulse-CLI`). Uploaded base64 media is validated against MIME whitelist + binary magic bytes (`JPEG`, `PNG`, `WebP`, `GIF`, `HEIC/MP4/MOV`, `WebM`) and fingerprinted with **both SHA-256 and 64-bit Perceptual `dHash`** (detecting resized, recompressed, or screenshot-spoofed imagery).
- **Disk Media Storage:** By default (`MEDIA_STORAGE_MODE=file`), uploaded images/videos are written atomically to `UPLOAD_DIR` and served at `GET /uploads/{filename}` with immutable cache headers instead of bloating database rows.
- **Max Request Body Size:** Configurable via `MAX_BODY_SIZE_BYTES` (default `15 MB`).
- **Rate Limiting & Proxy Safety:**
  - Global `POST` rate limit: configurable via `RATE_LIMIT_POST_PER_MIN` (default `10` req/min/IP).
  - Brute-force Auth rate limit: `AUTH_RATE_LIMIT_PER_15MIN` (default `15` req/15min/IP) on `/api/auth/login` & `/api/auth/register`.
  - Proxy headers (`X-Forwarded-For`, `X-Real-IP`) are trusted ONLY when `TRUST_PROXY_HEADERS=true`.
- **Anti-Sybil Quorum Guard:** `STRICT_UNIQUE_VOTERS=true` enforces one verify/flag vote per user/client/IP per report (`409 Conflict` on duplicates).
- **Persistent SQLite WAL + FTS5 + Background Workers:** Users, Argon2id password hashes, expiring Bearer sessions (`SESSION_TTL_HOURS`), system settings, posts, and audit logs persist across restarts. A background worker automatically retries Gemini `429`/timeout fallback posts and dispatches **HMAC-SHA256 signed webhooks** (`WEBHOOK_URL` / `WEBHOOK_SECRET`) for verified high-severity `Danger` alerts.
- **Error Envelope (`400` / `404` / `409` / `429` / `500`):**
  ```json
  {
    "error": "Human-readable error description",
    "code": "BAD_REQUEST | NOT_FOUND | CONFLICT | RATE_LIMIT_EXCEEDED | INTERNAL_ERROR",
    "status": 400
  }
  ```

---

## Exact Enums

| Enum | Valid Serialized String Values |
| :--- | :--- |
| `category` | `"Disaster"`, `"Nature"`, `"Tourism"`, `"Road"` (case-insensitive accepted on input) |
| `travel_advisory` | `"Safe"`, `"Caution"`, `"Danger"` |
| `verification_status` | `"Unverified"`, `"Pending Community Verification"`, `"Pending Admin Approval"`, `"AI Verified"`, `"Community Verified"`, `"Admin Approved"`, `"Disputed"`, `"Quarantined"`, `"Rejected"` |

---

## `Post` Schema

```json
{
  "id": "11111111-1111-4111-8111-000000000001",
  "title": "Ella Rock Trail Ridge Mist & Slippery Ascent",
  "description": "Original reporter text (Sinhala, Tamil, English, etc.)",
  "translated_description": "English translation or summary",
  "category": "Tourism",
  "lat": 6.8667,
  "lng": 81.0466,
  "location_name": "Ella Rock Trail, Badulla District, Sri Lanka",
  "media_url": "data:image/jpeg;base64,...",
  "is_live_captured": true,
  "is_on_site": true,
  "ai_authenticity_score": 94,
  "ai_reasoning": "Live GPS telemetry matches coordinates...",
  "travel_advisory": "Caution",
  "severity": 5,
  "verification_status": "Community Verified",
  "confirmations": 5,
  "false_flags": 0,
  "is_resolved": false,
  "integrity_hash": "64-char lowercase SHA-256 hex digest",
  "comments": [
    {
      "author": "Kasun Perera",
      "text": "Confirmed at the rail track fork.",
      "created_at": "2026-11-21T05:42:00Z"
    }
  ],
  "created_at": "2026-11-21T05:30:00Z"
}
```

---

## Endpoints

### 1. Health Check
- `GET /health`
- Returns `200 OK`:
  ```json
  {
    "status": "ok",
    "service": "civicpulse-backend",
    "version": "0.1.0",
    "posts_count": 6,
    "gemini_configured": true,
    "geofence_radius_km": 15.0,
    "rate_limit_post_per_min": 10
  }
  ```

### 2. List Posts (FTS5 Search, Geo-Radius, Dynamic Sort & Pagination)
- `GET /api/posts`
- Optional query params:
  - `category`: `Disaster` | `Nature` | `Tourism` | `Road` (case-insensitive)
  - `verified_only`: `true` | `false` (`true` returns only `"AI Verified"`, `"Community Verified"`, `"Admin Approved"`)
  - `search`: SQLite FTS5 + UTF-8 substring search across `title`, `description`, `translated_description`, `location_name`, `category`
  - `exclude_quarantined`: `true` | `false`
  - `lat`, `lng`, `radius_km`: Haversine geospatial radius filter around user coordinates
  - `sort`: `newest` (default) | `priority` (exponential time-decay + severity + trust score) | `nearest` (requires `lat` & `lng`) | `severity`
  - `limit`: `1..=500` (default `100`)
  - `offset`: `0+` (default `0`)
- Response headers: `X-Total-Count`, `X-Limit`, `X-Offset`.
- Returns `200 OK` -> `Post[]`.

### 3. Get Single Post, Integrity Check & Audit Trail
- `GET /api/posts/:id` -> `200 OK` (`Post`) or `404 Not Found`.
- `GET /api/posts/:id/verify-integrity` -> `200 OK`:
  ```json
  {
    "id": "...",
    "valid": true,
    "integrity_hash": "...",
    "recomputed_hash": "..."
  }
  ```
- `GET /api/posts/:id/audit` -> `200 OK` (`AuditLogEntry[]`) returning the immutable lifecycle log (`post_created`, `post_verified`, `post_flagged`, `post_resolved_toggled`, `comment_added`).

### 4. Create Report (4-Layer Zero-Fake Trust Engine)
- `POST /api/posts`
- Request JSON:
  ```json
  {
    "user_lat": 6.8660,
    "user_lng": 81.0460,
    "lat": 6.8667,
    "lng": 81.0466,
    "title": "Trail Blocked by Fallen Tree",
    "description": "ගසක් කඩා වැටී මාර්ගය අවහිර වී ඇත.",
    "category": "Tourism",
    "location_name": "Ella Rock",
    "media_base64": "data:image/jpeg;base64,...",
    "is_live_captured": true
  }
  ```
  - `user_lat` / `user_lng`, `media_base64` (alias `media_url`), and `is_live_captured` are optional.
- Returns `201 Created` with full `Post` JSON.
- Trust Engine outcomes:
  - `ai_authenticity_score < 40` -> `"Quarantined"`
  - `40..=65` -> `"Pending Community Verification"`
  - `> 65` -> `"AI Verified"`
  - Gemini failure / HTTP `429` -> safe fallback `ai_authenticity_score: 55`, `"Pending Community Verification"`.

### 5. Community Crowd Quorum & Resolution
- `POST /api/posts/:id/verify` -> `+1 confirmations`; at `>= 3`, updates `verification_status` to `"Community Verified"`. Returns `200 OK` (`Post`).
- `POST /api/posts/:id/flag` -> `+1 false_flags`; at `>= 3`, sets `"Disputed"` if `is_live_captured && ai_authenticity_score > 80`, otherwise `"Quarantined"`. Returns `200 OK` (`Post`).
- `POST /api/posts/:id/resolve` -> toggles `is_resolved`. Returns `200 OK` (`Post`).

### 6. Add Comment
- `POST /api/posts/:id/comment`
- Request JSON: `{ "author": "Nimal", "text": "Road cleared by local team." }` (`author` optional, defaults to `"Community Member"`).
- Returns `201 Created` with updated `Post`.

### 7. Live Gemini Safety & Travel Chat
- `POST /api/ai/chat`
- Request JSON:
  ```json
  {
    "message": "දැන් ඇල්ල පැත්තේ පාරවල් ආරක්ෂිතද?",
    "user_lat": 6.8667,
    "user_lng": 81.0466
  }
  ```
  - `message` also accepts aliases `prompt` or `query`; `user_lat`/`user_lng` are optional.
- Injects all active **non-quarantined** posts into Gemini 2.5 Flash (with deterministic fallback if Gemini is unavailable).
- Returns `200 OK`:
  ```json
  {
    "reply": "...",
    "referenced_posts_count": 6,
    "sources": [
      {
        "id": "...",
        "title": "...",
        "location_name": "...",
        "category": "Tourism",
        "travel_advisory": "Caution",
        "severity": 5,
        "verification_status": "Community Verified",
        "is_resolved": false
      }
    ],
    "fallback_used": false
  }
  ```

### 8. GeoJSON Export (`./CivicPulse-CLI` & GIS Interoperability)
- `GET /api/export/geojson`
- Optional query params: `verified_only=true`, `category=Disaster|Nature|Tourism|Road`.
- Always excludes `"Quarantined"` posts.
- Returns `200 OK` (`Content-Type: application/geo+json`) valid RFC 7946 `FeatureCollection` with strict `[lng, lat]` coordinates.

### 9. Real-Time Event Stream (Server-Sent Events)
- `GET /api/events`
- Streams `text/event-stream` push events (`post_created`, `post_verified`, `post_flagged`, `post_resolved`, `comment_added`) with 15-second keep-alive heartbeats so frontends and CLIs stay live without polling.

### 10. Dynamic Geospatial Analytics & Route Safety Algorithms
- `GET /api/analytics/hotspots?cluster_radius_km=25.0`
  - Runs DBSCAN-style spatial proximity clustering over active unresolved non-quarantined hazards, returning severity-weighted cluster centroids, `risk_index` (`0–100`), `risk_level`, and live network counts.
- `POST /api/analytics/route-safety`
  - Request JSON:
    ```json
    {
      "waypoints": [
        { "lat": 6.8916, "lng": 80.5955 },
        { "lat": 6.9497, "lng": 80.7891 },
        { "lat": 6.8667, "lng": 81.0466 }
      ],
      "corridor_km": 12.0,
      "verified_only": true
    }
    ```
  - Computes shortest point-to-segment distance from every active unresolved hazard to each route leg and returns `overall_advisory`, `risk_score`, `total_route_km`, and `hazards_on_route`.

### 11. Persistent Role-Based Auth (`admin` / `user`, Argon2id + Expiring Sessions)
- Initial seeded accounts (configurable via `.env` `ADMIN_SEED_*` / `USER_SEED_*`):
  - Admin: `admin@civicpulse.org` / `admin123` (`role: "admin"`)
  - User: `user@civicpulse.org` / `user123` (`role: "user"`)
- `POST /api/auth/register` -> `{ name, email, password }` -> `201 Created`: `{ token, role: "user", name, email, reputation_score, expires_at }`.
- `POST /api/auth/login` -> `{ email, password }` -> `200 OK`: `{ token, role, name, email, reputation_score, expires_at }`.
- `POST /api/auth/logout` (requires Bearer token) -> revokes session in SQLite -> `200 OK`: `{ "logged_out": true }`.
- `GET /api/auth/me` (requires Bearer token) -> `200 OK`: `{ role, name, email, reputation_score }`.
- `POST /api/auth/change-password` (requires Bearer token) -> `{ current_password, new_password }` -> updates Argon2id hash and revokes other sessions -> `200 OK`: `{ "password_updated": true }`.
- **Guest vs Authenticated `POST /api/posts`:**
  - With valid `Authorization: Bearer <token>` (`user` or `admin`): publishes directly through the 4-Layer Trust Engine.
  - Without `Authorization` header (Guest):
    - If `allow_guest_uploads == false` -> `403 Forbidden`.
    - If `allow_guest_uploads == true` -> runs Gemini Trust Engine and forces `verification_status = "Pending Admin Approval"` (hidden from `GET /api/posts` until approved by an Admin).

### 12. Admin Moderation & Settings (Admin Bearer Token Required)
- `GET /api/admin/settings` -> `200 OK`: `{ "allow_guest_uploads": true }`
- `POST /api/admin/settings` -> `{ "allow_guest_uploads": false }` (persisted in SQLite) -> `200 OK`: `{ "allow_guest_uploads": false }`
- `GET /api/admin/pending` -> `200 OK`: `Post[]` containing `"Pending Admin Approval"`, `"Quarantined"`, and `"Disputed"` posts.
- `POST /api/admin/posts/:id/approve` -> sets status to `"Admin Approved"` and makes the post public (`200 OK` `Post`).
- `POST /api/admin/posts/:id/reject` -> marks status as `"Rejected"` and hides the post from public & pending queues (`200 OK` `Post`).

### 13. Uploaded Media, Observability & OpenAPI Docs
- `GET /uploads/:filename` -> serves stored image/video files with immutable cache headers (`200 OK`).
- `GET /metrics` -> Prometheus `0.0.4` metrics exposition (`text/plain`).
- `GET /openapi.json` -> OpenAPI 3.1 JSON specification.
- `GET /docs` -> Interactive Swagger UI API Explorer.
