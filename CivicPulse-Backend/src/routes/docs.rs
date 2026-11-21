use axum::{
    http::{header, HeaderValue},
    response::{Html, IntoResponse},
    Json,
};
use serde_json::{json, Value};

/// `GET /openapi.json` — OpenAPI 3.1 specification for CivicPulse REST API.
pub async fn openapi_spec() -> Json<Value> {
    Json(json!({
        "openapi": "3.1.0",
        "info": {
            "title": "CivicPulse Zero-Fake Safety & Eco-Tourism API",
            "version": env!("CARGO_PKG_VERSION"),
            "description": "Production Rust/Axum backend with 4-Layer Zero-Fake Trust Engine, perceptual dHash forensics, Gemini 2.5 Flash multimodal verification, SQLite WAL + FTS5, Role-Based Auth, SSE streaming, geospatial analytics, and GeoJSON export."
        },
        "components": {
            "securitySchemes": {
                "BearerAuth": {
                    "type": "http",
                    "scheme": "bearer"
                }
            }
        },
        "paths": {
            "/health": { "get": { "summary": "Service health and runtime policy status" } },
            "/metrics": { "get": { "summary": "Prometheus 0.0.4 metrics exposition" } },
            "/api/events": { "get": { "summary": "Server-Sent Events live stream" } },
            "/api/auth/register": { "post": { "summary": "Register user account" } },
            "/api/auth/login": { "post": { "summary": "Login user or admin account" } },
            "/api/auth/logout": { "post": { "summary": "Revoke active bearer session", "security": [{ "BearerAuth": [] }] } },
            "/api/auth/me": { "get": { "summary": "Inspect current authenticated user", "security": [{ "BearerAuth": [] }] } },
            "/api/auth/change-password": { "post": { "summary": "Change password & revoke other sessions", "security": [{ "BearerAuth": [] }] } },
            "/api/admin/settings": {
                "get": { "summary": "Get guest upload policy (Admin)", "security": [{ "BearerAuth": [] }] },
                "post": { "summary": "Toggle guest upload policy (Admin)", "security": [{ "BearerAuth": [] }] }
            },
            "/api/admin/pending": { "get": { "summary": "List Pending Admin Approval, Quarantined & Disputed posts (Admin)", "security": [{ "BearerAuth": [] }] } },
            "/api/admin/posts/{id}/approve": { "post": { "summary": "Approve report into public feed (Admin)", "security": [{ "BearerAuth": [] }] } },
            "/api/admin/posts/{id}/reject": { "post": { "summary": "Reject and hide report (Admin)", "security": [{ "BearerAuth": [] }] } },
            "/api/posts": {
                "get": { "summary": "List public reports with filtering, FTS5 search, geospatial radius, priority sort, and pagination (X-Total-Count)" },
                "post": { "summary": "Submit new hazard/eco-tourism report through 4-Layer Zero-Fake Trust Engine" }
            },
            "/api/posts/{id}": { "get": { "summary": "Get single report by ID" } },
            "/api/posts/{id}/verify-integrity": { "get": { "summary": "Verify SHA-256 report integrity hash" } },
            "/api/posts/{id}/audit": { "get": { "summary": "Read immutable audit trail for report" } },
            "/api/posts/{id}/verify": { "post": { "summary": "Community confirmation vote (weighted crowd quorum)" } },
            "/api/posts/{id}/flag": { "post": { "summary": "Flag potential misinformation (crowd quorum)" } },
            "/api/posts/{id}/resolve": { "post": { "summary": "Toggle Active <-> Resolved status" } },
            "/api/posts/{id}/comment": { "post": { "summary": "Append community comment" } },
            "/api/ai/chat": { "post": { "summary": "Real-time Gemini safety & eco-tourism advisor grounded in active non-quarantined reports" } },
            "/api/export/geojson": { "get": { "summary": "RFC 7946 GeoJSON FeatureCollection export" } },
            "/api/analytics/hotspots": { "get": { "summary": "DBSCAN geospatial hazard clustering" } },
            "/api/analytics/route-safety": { "post": { "summary": "Multi-waypoint corridor hazard intersection analysis" } },
            "/uploads/{filename}": { "get": { "summary": "Serve uploaded media file" } }
        }
    }))
}

/// `GET /docs` — Interactive API Documentation page powered by `/openapi.json`.
pub async fn swagger_docs() -> impl IntoResponse {
    (
        [(
            header::CONTENT_TYPE,
            HeaderValue::from_static("text/html; charset=utf-8"),
        )],
        Html(
            r##"<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>CivicPulse API Docs</title>
  <link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@5/swagger-ui.css" />
</head>
<body>
  <div id="swagger-ui"></div>
  <script src="https://unpkg.com/swagger-ui-dist@5/swagger-ui-bundle.js"></script>
  <script>
    window.onload = () => {
      if (window.SwaggerUIBundle) {
        SwaggerUIBundle({ url: "/openapi.json", dom_id: "#swagger-ui" });
      }
    };
  </script>
</body>
</html>"##,
        ),
    )
}
