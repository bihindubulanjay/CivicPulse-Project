use std::{
    io::Cursor,
    sync::{Arc, Mutex},
};

use axum::{
    body::Body,
    extract::State,
    http::{header, HeaderMap, Method, Request, StatusCode},
    routing::post,
    Json, Router,
};
use base64::{engine::general_purpose::STANDARD as BASE64_STANDARD, Engine as _};
use http_body_util::BodyExt;
use image::{imageops::FilterType, ImageFormat, Rgba, RgbaImage};
use serde_json::{json, Value};
use tokio::net::TcpListener;
use tower::ServiceExt;

use civicpulse_backend::{
    build_app,
    config::{Config, MediaStorageMode},
    db::PostRepository,
    models::{AiChatResponse, GeoJsonFeatureCollection, Post, VerificationStatus},
    services::{webhook::hmac_sha256_hex, workers::run_ai_retry_pass},
};

#[derive(Clone)]
struct MockGeminiBehavior {
    status: StatusCode,
    response_body: Value,
    captured_requests: Arc<Mutex<Vec<Value>>>,
}

async fn spawn_gemini_test_server(behavior: MockGeminiBehavior) -> String {
    let app = Router::new()
        .route(
            "/generate",
            post(
                |State(state): State<MockGeminiBehavior>, Json(body): Json<Value>| async move {
                    state.captured_requests.lock().unwrap().push(body);
                    (state.status, Json(state.response_body))
                },
            ),
        )
        .with_state(behavior);

    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    tokio::spawn(async move {
        axum::serve(listener, app).await.unwrap();
    });
    format!("http://{addr}/generate")
}

async fn read_json(response: axum::response::Response) -> Value {
    let bytes = response.into_body().collect().await.unwrap().to_bytes();
    serde_json::from_slice(&bytes).unwrap()
}

fn gemini_text_envelope(text: &str) -> Value {
    json!({
        "candidates": [{
            "content": {
                "parts": [{ "text": text }]
            }
        }]
    })
}

async fn login_token(app: &Router, email: &str, password: &str, ip: &str) -> String {
    let res = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri("/api/auth/login")
                .header(header::CONTENT_TYPE, "application/json")
                .header("x-forwarded-for", ip)
                .body(Body::from(
                    json!({ "email": email, "password": password }).to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(res.status(), StatusCode::OK);
    let body = read_json(res).await;
    body["token"].as_str().unwrap().to_string()
}

#[tokio::test]
async fn seed_data_and_filters_and_integrity_work() {
    let repo = PostRepository::open_in_memory().unwrap();
    let config = Config::for_test("http://127.0.0.1:9/unused".into(), None);
    let (app, _) = build_app(config, repo).await.unwrap();

    // Health endpoint
    let res = app
        .clone()
        .oneshot(Request::builder().uri("/health").body(Body::empty()).unwrap())
        .await
        .unwrap();
    assert_eq!(res.status(), StatusCode::OK);
    let health = read_json(res).await;
    assert_eq!(health["status"], "ok");
    assert_eq!(health["posts_count"], 6);

    // Default GET /api/posts returns 6 seed posts
    let res = app
        .clone()
        .oneshot(
            Request::builder()
                .uri("/api/posts")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(res.status(), StatusCode::OK);
    let posts: Vec<Post> = serde_json::from_value(read_json(res).await).unwrap();
    assert_eq!(posts.len(), 6);

    // Every seed post passes cryptographic SHA-256 verification
    for post in &posts {
        let res = app
            .clone()
            .oneshot(
                Request::builder()
                    .uri(format!("/api/posts/{}/verify-integrity", post.id))
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(res.status(), StatusCode::OK);
        let integrity = read_json(res).await;
        assert_eq!(integrity["valid"], true, "seed post {} failed integrity", post.id);
    }

    // Filter category=Disaster
    let res = app
        .clone()
        .oneshot(
            Request::builder()
                .uri("/api/posts?category=disaster")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    let disaster_posts: Vec<Post> = serde_json::from_value(read_json(res).await).unwrap();
    assert_eq!(disaster_posts.len(), 1);
    assert!(disaster_posts[0].title.contains("Nuwara Eliya"));

    // Filter verified_only=true excludes Gampaha (Pending Community Verification)
    let res = app
        .clone()
        .oneshot(
            Request::builder()
                .uri("/api/posts?verified_only=true")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    let verified_posts: Vec<Post> = serde_json::from_value(read_json(res).await).unwrap();
    assert_eq!(verified_posts.len(), 5);
    assert!(verified_posts
        .iter()
        .all(|p| p.verification_status.is_verified()));

    // Search across Sinhala / English / location
    let res = app
        .oneshot(
            Request::builder()
                .uri("/api/posts?search=Fuji")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    let fuji_posts: Vec<Post> = serde_json::from_value(read_json(res).await).unwrap();
    assert_eq!(fuji_posts.len(), 1);
    assert_eq!(fuji_posts[0].location_name, "Mount Fuji Yoshida Trail, Yamanashi, Japan");
}

#[tokio::test]
async fn trust_engine_4_layers_thresholds_and_gemini_payload() {
    let captured = Arc::new(Mutex::new(Vec::new()));
    let gemini_json = json!({
        "ai_authenticity_score": 89,
        "ai_reasoning": "Image matches road flooding description; no screen-spoofing cues detected.",
        "translated_description": "Flash flooding reported along Kandy Peradeniya road.",
        "travel_advisory": "Danger",
        "severity": 8
    });

    let endpoint = spawn_gemini_test_server(MockGeminiBehavior {
        status: StatusCode::OK,
        response_body: gemini_text_envelope(&gemini_json.to_string()),
        captured_requests: Arc::clone(&captured),
    })
    .await;

    let repo = PostRepository::open_in_memory().unwrap();
    let config = Config::for_test(endpoint, Some("test-secret-key".into()));
    let (app, _) = build_app(config, repo).await.unwrap();
    let user_token = login_token(&app, "user@civicpulse.org", "user123", "198.51.100.200").await;

    // 1x1 PNG sample
    let png_b64 = BASE64_STANDARD.encode(b"\x89PNG\r\n\x1a\nsample");
    let body = json!({
        "user_lat": 7.2600,
        "user_lng": 80.5950,
        "lat": 7.2630,
        "lng": 80.5980,
        "title": "Peradeniya Bridge Water Rise",
        "description": "පේරාදෙණිය පාලම අසල ජල මට්ටම ඉහළ යමින් පවතී.",
        "category": "Road",
        "location_name": "Peradeniya, Kandy",
        "media_base64": format!("data:image/png;base64,{png_b64}"),
        "is_live_captured": true
    });

    let res = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri("/api/posts")
                .header(header::CONTENT_TYPE, "application/json")
                .header(header::AUTHORIZATION, format!("Bearer {user_token}"))
                .body(Body::from(body.to_string()))
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(res.status(), StatusCode::CREATED);
    let created: Post = serde_json::from_value(read_json(res).await).unwrap();

    assert!(created.is_on_site);
    assert!(created.is_live_captured);
    assert_eq!(created.ai_authenticity_score, 89);
    assert_eq!(created.verification_status, VerificationStatus::AiVerified);
    assert_eq!(
        created.translated_description,
        "Flash flooding reported along Kandy Peradeniya road."
    );
    assert_eq!(created.severity, 8);
    assert_eq!(created.integrity_hash.len(), 64);
    assert_eq!(
        created.media_url.as_deref(),
        Some(format!("data:image/png;base64,{png_b64}").as_str())
    );

    // Verify Gemini received multimodal inlineData part
    {
        let sent = captured.lock().unwrap();
        assert_eq!(sent.len(), 1);
        let parts = sent[0]["contents"][0]["parts"].as_array().unwrap();
        assert_eq!(parts.len(), 2);
        assert_eq!(parts[1]["inlineData"]["mimeType"], "image/png");
        assert_eq!(parts[1]["inlineData"]["data"], png_b64);
    }

    // Verify integrity check endpoint passes on new post
    let res = app
        .oneshot(
            Request::builder()
                .uri(format!("/api/posts/{}/verify-integrity", created.id))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    let integrity = read_json(res).await;
    assert_eq!(integrity["valid"], true);
}

#[tokio::test]
async fn gemini_429_graceful_fallback_never_crashes() {
    let captured = Arc::new(Mutex::new(Vec::new()));
    let endpoint = spawn_gemini_test_server(MockGeminiBehavior {
        status: StatusCode::TOO_MANY_REQUESTS,
        response_body: json!({ "error": { "code": 429, "message": "Quota exceeded" } }),
        captured_requests: Arc::clone(&captured),
    })
    .await;

    let repo = PostRepository::open_in_memory().unwrap();
    let config = Config::for_test(endpoint, Some("test-secret-key".into()));
    let (app, _) = build_app(config, repo).await.unwrap();
    let user_token = login_token(&app, "user@civicpulse.org", "user123", "198.51.100.201").await;

    let body = json!({
        "user_lat": 6.9271,
        "user_lng": 79.8612,
        "lat": 7.5000,
        "lng": 80.5000,
        "title": "Distant Mudflow Report",
        "description": "Mud blocking hillside lane",
        "category": "Disaster",
        "location_name": "Matale Hills",
        "is_live_captured": false
    });

    let res = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri("/api/posts")
                .header(header::CONTENT_TYPE, "application/json")
                .header(header::AUTHORIZATION, format!("Bearer {user_token}"))
                .body(Body::from(body.to_string()))
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(res.status(), StatusCode::CREATED);
    let created: Post = serde_json::from_value(read_json(res).await).unwrap();

    assert!(!created.is_on_site); // > 15km away
    assert_eq!(created.ai_authenticity_score, 55);
    assert_eq!(
        created.verification_status,
        VerificationStatus::PendingCommunityVerification
    );

    // AI chat also falls back cleanly without crashing on 429
    let chat_res = app
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri("/api/ai/chat")
                .header(header::CONTENT_TYPE, "application/json")
                .body(Body::from(json!({ "message": "Is Ella safe right now?" }).to_string()))
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(chat_res.status(), StatusCode::OK);
    let chat_body: AiChatResponse = serde_json::from_value(read_json(chat_res).await).unwrap();
    assert!(chat_body.fallback_used);
    assert!(chat_body.reply.contains("Ella Rock"));
    assert_eq!(chat_body.referenced_posts_count, 7);
}

#[tokio::test]
async fn crowd_quorum_verify_flag_resolve_comment_chat_and_geojson() {
    let captured = Arc::new(Mutex::new(Vec::new()));
    let gemini_low_score = json!({
        "ai_authenticity_score": 25,
        "ai_reasoning": "Screen moire pattern and mismatched photo metadata detected.",
        "translated_description": "Fake tsunami claim",
        "travel_advisory": "Safe",
        "severity": 1
    });

    let endpoint = spawn_gemini_test_server(MockGeminiBehavior {
        status: StatusCode::OK,
        response_body: gemini_text_envelope(&gemini_low_score.to_string()),
        captured_requests: Arc::clone(&captured),
    })
    .await;

    let repo = PostRepository::open_in_memory().unwrap();
    let config = Config::for_test(endpoint, Some("test-key".into()));
    let (app, _) = build_app(config, repo).await.unwrap();
    let user_token = login_token(&app, "user@civicpulse.org", "user123", "203.0.113.9").await;

    // Create a low-score post (< 40) -> auto-Quarantined
    let fake_res = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri("/api/posts")
                .header(header::CONTENT_TYPE, "application/json")
                .header(header::AUTHORIZATION, format!("Bearer {user_token}"))
                .header("x-forwarded-for", "203.0.113.10")
                .body(Body::from(
                    json!({
                        "lat": 6.0,
                        "lng": 80.2,
                        "title": "SECRET_QUARANTINED_TOKEN_999",
                        "description": "Suspicious spoofed post",
                        "category": "Disaster",
                        "location_name": "Nowhere"
                    })
                    .to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    let fake_post: Post = serde_json::from_value(read_json(fake_res).await).unwrap();
    assert_eq!(fake_post.verification_status, VerificationStatus::Quarantined);

    // Gampaha seed post (0005) has confirmations=2, Pending Community Verification -> 1 verify promotes it!
    let gampaha_id = "11111111-1111-4111-8111-000000000005";
    let verify_res = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri(format!("/api/posts/{gampaha_id}/verify"))
                .header("x-forwarded-for", "203.0.113.11")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(verify_res.status(), StatusCode::OK);
    let verified_gampaha: Post = serde_json::from_value(read_json(verify_res).await).unwrap();
    assert_eq!(verified_gampaha.confirmations, 3);
    assert_eq!(
        verified_gampaha.verification_status,
        VerificationStatus::CommunityVerified
    );

    // Flag Galle post (0003: is_live_captured=true, ai_authenticity_score=88 > 80) 3 times -> Disputed!
    let galle_id = "11111111-1111-4111-8111-000000000003";
    for _ in 0..3 {
        let res = app
            .clone()
            .oneshot(
                Request::builder()
                    .method(Method::POST)
                    .uri(format!("/api/posts/{galle_id}/flag"))
                    .header("x-forwarded-for", "203.0.113.12")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(res.status(), StatusCode::OK);
    }
    let galle_res = app
        .clone()
        .oneshot(
            Request::builder()
                .uri(format!("/api/posts/{galle_id}"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    let galle_post: Post = serde_json::from_value(read_json(galle_res).await).unwrap();
    assert_eq!(galle_post.false_flags, 3);
    assert_eq!(galle_post.verification_status, VerificationStatus::Disputed);

    // Flag Sinharaja post (0004: is_live_captured=false, score=84) 3 times -> Quarantined!
    let sinharaja_id = "11111111-1111-4111-8111-000000000004";
    for _ in 0..3 {
        let res = app
            .clone()
            .oneshot(
                Request::builder()
                    .method(Method::POST)
                    .uri(format!("/api/posts/{sinharaja_id}/flag"))
                    .header("x-forwarded-for", "203.0.113.13")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(res.status(), StatusCode::OK);
    }
    let sinharaja_res = app
        .clone()
        .oneshot(
            Request::builder()
                .uri(format!("/api/posts/{sinharaja_id}"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    let sinharaja_post: Post = serde_json::from_value(read_json(sinharaja_res).await).unwrap();
    assert_eq!(
        sinharaja_post.verification_status,
        VerificationStatus::Quarantined
    );

    // Toggle resolve on Ella (0001)
    let ella_id = "11111111-1111-4111-8111-000000000001";
    let res1 = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri(format!("/api/posts/{ella_id}/resolve"))
                .header("x-forwarded-for", "203.0.113.14")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    let resolved_ella: Post = serde_json::from_value(read_json(res1).await).unwrap();
    assert!(resolved_ella.is_resolved);

    // Comment on Ella (0001)
    let comment_res = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri(format!("/api/posts/{ella_id}/comment"))
                .header(header::CONTENT_TYPE, "application/json")
                .header("x-forwarded-for", "203.0.113.15")
                .body(Body::from(
                    json!({ "author": "Ashan", "text": "Mist cleared around 11 AM." }).to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(comment_res.status(), StatusCode::CREATED);
    let commented_ella: Post = serde_json::from_value(read_json(comment_res).await).unwrap();
    assert_eq!(commented_ella.comments.len(), 3);
    assert_eq!(commented_ella.comments[2].author, "Ashan");

    // GeoJSON export excludes both Quarantined posts (fake_post + sinharaja_post -> 5 left)
    let geo_res = app
        .clone()
        .oneshot(
            Request::builder()
                .uri("/api/export/geojson")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(geo_res.status(), StatusCode::OK);
    let geo_ctype = geo_res
        .headers()
        .get(header::CONTENT_TYPE)
        .unwrap()
        .to_str()
        .unwrap()
        .to_string();
    assert!(geo_ctype.contains("application/geo+json"));
    let fc: GeoJsonFeatureCollection = serde_json::from_value(read_json(geo_res).await).unwrap();
    assert_eq!(fc.collection_type, "FeatureCollection");
    assert_eq!(fc.features.len(), 5);
    assert!(fc
        .features
        .iter()
        .all(|f| f.properties.title != "SECRET_QUARANTINED_TOKEN_999"));

    // Verify RFC 7946 [lng, lat] order on Ella Rock (6.8667, 81.0466 -> [81.0466, 6.8667])
    let ella_feature = fc.features.iter().find(|f| f.id == ella_id).unwrap();
    assert_eq!(ella_feature.geometry.coordinates, [81.0466, 6.8667]);

    // AI Chat injects active non-quarantined posts and NEVER injects quarantined posts
    captured.lock().unwrap().clear();
    let chat_res = app
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri("/api/ai/chat")
                .header(header::CONTENT_TYPE, "application/json")
                .header("x-forwarded-for", "203.0.113.16")
                .body(Body::from(json!({ "message": "Give safety update" }).to_string()))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(chat_res.status(), StatusCode::OK);
    let chat_body: AiChatResponse = serde_json::from_value(read_json(chat_res).await).unwrap();
    assert_eq!(chat_body.referenced_posts_count, 5);

    let chat_sent = captured.lock().unwrap();
    let prompt_text = chat_sent[0]["contents"][0]["parts"][0]["text"]
        .as_str()
        .unwrap();
    assert!(prompt_text.contains("Ella Rock"));
    assert!(!prompt_text.contains("SECRET_QUARANTINED_TOKEN_999"));
}

#[tokio::test]
async fn ip_rate_limiter_enforces_10_posts_per_minute_over_http() {
    let repo = PostRepository::open_in_memory().unwrap();
    let config = Config::for_test("http://127.0.0.1:9/unused".into(), None);
    let (app, _) = build_app(config, repo).await.unwrap();

    let target_id = "11111111-1111-4111-8111-000000000001";
    for i in 0..10 {
        let res = app
            .clone()
            .oneshot(
                Request::builder()
                    .method(Method::POST)
                    .uri(format!("/api/posts/{target_id}/verify"))
                    .header("x-forwarded-for", "198.51.100.42")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(res.status(), StatusCode::OK, "POST #{i} should succeed");
        assert_eq!(
            res.headers()
                .get("x-ratelimit-remaining")
                .unwrap()
                .to_str()
                .unwrap(),
            &(9 - i).to_string()
        );
    }

    // 11th POST from same IP gets HTTP 429 + Retry-After + CORS headers
    let blocked = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri(format!("/api/posts/{target_id}/verify"))
                .header("x-forwarded-for", "198.51.100.42")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(blocked.status(), StatusCode::TOO_MANY_REQUESTS);
    assert!(blocked.headers().contains_key(header::RETRY_AFTER));
    assert!(blocked
        .headers()
        .contains_key(header::ACCESS_CONTROL_ALLOW_ORIGIN));

    // GET requests remain unblocked for the rate-limited IP
    let get_ok = app
        .clone()
        .oneshot(
            Request::builder()
                .uri("/api/posts")
                .header("x-forwarded-for", "198.51.100.42")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(get_ok.status(), StatusCode::OK);

    // Different IP still succeeds
    let other_ip_ok = app
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri(format!("/api/posts/{target_id}/verify"))
                .header("x-forwarded-for", "198.51.100.99")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(other_ip_ok.status(), StatusCode::OK);
}

#[tokio::test]
async fn sqlite_wal_persists_posts_across_restarts() {
    let temp_dir = std::env::temp_dir().join(format!(
        "civicpulse_test_{}",
        uuid::Uuid::new_v4()
    ));
    let db_path = temp_dir.join("civicpulse.db");
    let db_path_str = db_path.to_str().unwrap().to_string();

    let created_id = {
        let repo = PostRepository::open_file(&db_path_str, 4).unwrap();
        let config = Config::for_test("http://127.0.0.1:9/unused".into(), None);
        let (app, _) = build_app(config, repo).await.unwrap();
        let user_token = login_token(&app, "user@civicpulse.org", "user123", "198.51.100.205").await;

        let res = app
            .oneshot(
                Request::builder()
                    .method(Method::POST)
                    .uri("/api/posts")
                    .header(header::CONTENT_TYPE, "application/json")
                    .header(header::AUTHORIZATION, format!("Bearer {user_token}"))
                    .body(Body::from(
                        json!({
                            "lat": 6.9271,
                            "lng": 79.8612,
                            "title": "Persisted Colombo Alert",
                            "description": "Heavy drainage overflow near Town Hall",
                            "category": "Road",
                            "location_name": "Colombo 07"
                        })
                        .to_string(),
                    ))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(res.status(), StatusCode::CREATED);
        let post: Post = serde_json::from_value(read_json(res).await).unwrap();
        post.id
    };

    // Reopen fresh repository from same SQLite file
    let repo2 = PostRepository::open_file(&db_path_str, 4).unwrap();
    let config2 = Config::for_test("http://127.0.0.1:9/unused".into(), None);
    let (app2, _) = build_app(config2, repo2).await.unwrap();

    let res = app2
        .oneshot(
            Request::builder()
                .uri("/api/posts")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    let posts: Vec<Post> = serde_json::from_value(read_json(res).await).unwrap();
    assert_eq!(posts.len(), 7);
    assert!(posts.iter().any(|p| p.id == created_id));

    let _ = std::fs::remove_dir_all(&temp_dir);
}

#[tokio::test]
async fn security_headers_magic_bytes_recycled_media_and_audit_trail() {
    let captured = Arc::new(Mutex::new(Vec::new()));
    let gemini_json = json!({
        "ai_authenticity_score": 82,
        "ai_reasoning": "Verified image and location.",
        "translated_description": "Flooding on road.",
        "travel_advisory": "Caution",
        "severity": 6
    });
    let endpoint = spawn_gemini_test_server(MockGeminiBehavior {
        status: StatusCode::OK,
        response_body: gemini_text_envelope(&gemini_json.to_string()),
        captured_requests: Arc::clone(&captured),
    })
    .await;

    let repo = PostRepository::open_in_memory().unwrap();
    let config = Config::for_test(endpoint, Some("test-key".into()));
    let (app, state) = build_app(config, repo).await.unwrap();
    let mut sse_rx = state.events_tx.subscribe();

    // 1. Reject spoofed MIME (script bytes disguised as JPEG)
    let fake_b64 = BASE64_STANDARD.encode(b"<script>alert('xss')</script>");
    let bad_media_res = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri("/api/posts")
                .header(header::CONTENT_TYPE, "application/json")
                .header("x-forwarded-for", "198.51.100.1")
                .body(Body::from(
                    json!({
                        "lat": 6.9,
                        "lng": 79.9,
                        "title": "Spoofed Upload",
                        "description": "Trying fake jpeg",
                        "category": "Road",
                        "location_name": "Colombo",
                        "media_base64": format!("data:image/jpeg;base64,{fake_b64}")
                    })
                    .to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(bad_media_res.status(), StatusCode::BAD_REQUEST);
    assert!(bad_media_res.headers().contains_key("x-request-id"));
    assert_eq!(
        bad_media_res.headers().get("x-frame-options").unwrap(),
        "DENY"
    );

    // 2. Upload valid PNG with ANSI escape sequences in title -> sanitized + SSE broadcast
    let valid_png_b64 = BASE64_STANDARD.encode(b"\x89PNG\r\n\x1a\nauthentic-frame-bytes");
    let first_res = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri("/api/posts")
                .header(header::CONTENT_TYPE, "application/json")
                .header("x-forwarded-for", "198.51.100.2")
                .body(Body::from(
                    json!({
                        "lat": 6.9271,
                        "lng": 79.8612,
                        "title": "\x1b[31mColombo Flood\x1b[0m",
                        "description": "Water rising near Fort",
                        "category": "Road",
                        "location_name": "Colombo",
                        "media_base64": format!("data:image/png;base64,{valid_png_b64}")
                    })
                    .to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(first_res.status(), StatusCode::CREATED);
    let first_post: Post = serde_json::from_value(read_json(first_res).await).unwrap();
    assert_eq!(first_post.title, "Colombo Flood");

    // SSE broadcast received live
    let live_event = sse_rx.try_recv().unwrap();
    assert_eq!(live_event.event_type, "post_created");
    assert_eq!(live_event.post_id, first_post.id);

    // 3. Re-upload exact same PNG bytes 100+ km away -> Gemini prompt receives recycled-media ALERT & audit log records it
    let second_res = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri("/api/posts")
                .header(header::CONTENT_TYPE, "application/json")
                .header("x-forwarded-for", "198.51.100.3")
                .body(Body::from(
                    json!({
                        "lat": 8.3114,
                        "lng": 80.4037,
                        "title": "Anuradhapura Flood",
                        "description": "Claiming flood far away",
                        "category": "Disaster",
                        "location_name": "Anuradhapura",
                        "media_base64": format!("data:image/png;base64,{valid_png_b64}")
                    })
                    .to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(second_res.status(), StatusCode::CREATED);
    let second_post: Post = serde_json::from_value(read_json(second_res).await).unwrap();

    {
        let sent = captured.lock().unwrap();
        let second_prompt = sent[1]["contents"][0]["parts"][0]["text"].as_str().unwrap();
        assert!(
            second_prompt.contains("ALERT: Identical SHA-256 media bytes"),
            "expected recycled media alert in Gemini prompt"
        );
    }

    // 4. Audit log endpoint records creation + duplicate signal
    let audit_res = app
        .oneshot(
            Request::builder()
                .uri(format!("/api/posts/{}/audit", second_post.id))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(audit_res.status(), StatusCode::OK);
    let audit_logs = read_json(audit_res).await;
    let entries = audit_logs.as_array().unwrap();
    assert_eq!(entries.len(), 1);
    assert_eq!(entries[0]["action"], "post_created");
    assert!(entries[0]["details"]
        .as_str()
        .unwrap()
        .contains("exact_media=true"));
}

#[tokio::test]
async fn dynamic_geospatial_sort_hotspots_route_safety_and_strict_unique_voters() {
    let repo = PostRepository::open_in_memory().unwrap();
    let mut config = Config::for_test("http://127.0.0.1:9/unused".into(), None);
    config.strict_unique_voters = true;
    let (app, _) = build_app(config, repo).await.unwrap();

    // Geospatial radius filter around Ella (6.8667, 81.0466) within 40 km -> Ella + Nuwara Eliya
    let near_res = app
        .clone()
        .oneshot(
            Request::builder()
                .uri("/api/posts?lat=6.8667&lng=81.0466&radius_km=40&sort=nearest")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(near_res.status(), StatusCode::OK);
    let near_posts: Vec<Post> = serde_json::from_value(read_json(near_res).await).unwrap();
    assert_eq!(near_posts.len(), 2);
    assert!(near_posts[0].title.contains("Ella Rock"));

    // Dynamic priority sort puts highest severity Danger alert first
    let prio_res = app
        .clone()
        .oneshot(
            Request::builder()
                .uri("/api/posts?sort=priority")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    let prio_posts: Vec<Post> = serde_json::from_value(read_json(prio_res).await).unwrap();
    assert!(prio_posts[0].title.contains("Nuwara Eliya"));

    // Hotspots DBSCAN clustering endpoint
    let hotspots_res = app
        .clone()
        .oneshot(
            Request::builder()
                .uri("/api/analytics/hotspots?cluster_radius_km=35")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(hotspots_res.status(), StatusCode::OK);
    let hotspots = read_json(hotspots_res).await;
    assert_eq!(hotspots["total_posts"], 6);
    assert!(hotspots["hotspots"].as_array().unwrap().len() <= 5);

    // Route corridor safety analysis (Hatton -> Nuwara Eliya -> Ella)
    let route_res = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri("/api/analytics/route-safety")
                .header(header::CONTENT_TYPE, "application/json")
                .header("x-forwarded-for", "198.51.100.55")
                .body(Body::from(
                    json!({
                        "waypoints": [
                            { "lat": 6.8916, "lng": 80.5955 },
                            { "lat": 6.9497, "lng": 80.7891 },
                            { "lat": 6.8667, "lng": 81.0466 }
                        ],
                        "corridor_km": 12.0,
                        "verified_only": true
                    })
                    .to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(route_res.status(), StatusCode::OK);
    let route_body = read_json(route_res).await;
    assert_eq!(route_body["overall_advisory"], "Danger");
    assert!(route_body["hazards_on_route"].as_array().unwrap().len() >= 2);

    // Anti-Sybil unique voter guard: same voter blocked with 409, distinct voter succeeds
    let target = "11111111-1111-4111-8111-000000000005";
    let first_vote = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri(format!("/api/posts/{target}/verify"))
                .header("x-client-id", "device-alpha")
                .header("x-forwarded-for", "198.51.100.60")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(first_vote.status(), StatusCode::OK);

    let dup_vote = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri(format!("/api/posts/{target}/verify"))
                .header("x-client-id", "device-alpha")
                .header("x-forwarded-for", "198.51.100.61")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(dup_vote.status(), StatusCode::CONFLICT);

    let second_voter = app
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri(format!("/api/posts/{target}/verify"))
                .header("x-client-id", "device-beta")
                .header("x-forwarded-for", "198.51.100.62")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(second_voter.status(), StatusCode::OK);
}

#[tokio::test]
async fn role_based_auth_guest_policy_and_admin_moderation_workflow() {
    let captured = Arc::new(Mutex::new(Vec::new()));
    let gemini_high = json!({
        "ai_authenticity_score": 91,
        "ai_reasoning": "Authentic field report.",
        "translated_description": "Tree fallen across road.",
        "travel_advisory": "Caution",
        "severity": 6
    });
    let endpoint = spawn_gemini_test_server(MockGeminiBehavior {
        status: StatusCode::OK,
        response_body: gemini_text_envelope(&gemini_high.to_string()),
        captured_requests: Arc::clone(&captured),
    })
    .await;

    let repo = PostRepository::open_in_memory().unwrap();
    let config = Config::for_test(endpoint, Some("test-key".into()));
    let (app, _) = build_app(config, repo).await.unwrap();

    // 1. Pre-seeded Admin & User login + Register new user
    let admin_token = login_token(&app, "admin@civicpulse.org", "admin123", "198.51.100.70").await;
    let user_token = login_token(&app, "user@civicpulse.org", "user123", "198.51.100.71").await;

    let reg_res = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri("/api/auth/register")
                .header(header::CONTENT_TYPE, "application/json")
                .header("x-forwarded-for", "198.51.100.72")
                .body(Body::from(
                    json!({
                        "name": "Saman Kumara",
                        "email": "saman@example.com",
                        "password": "securepassword"
                    })
                    .to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(reg_res.status(), StatusCode::CREATED);
    let reg_body = read_json(reg_res).await;
    assert_eq!(reg_body["role"], "user");
    assert_eq!(reg_body["email"], "saman@example.com");
    assert!(reg_body["token"].as_str().unwrap().starts_with("cp_"));

    // 2. Role protection: Guest -> 401, Regular User -> 403 on admin routes
    let guest_admin = app
        .clone()
        .oneshot(
            Request::builder()
                .uri("/api/admin/settings")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(guest_admin.status(), StatusCode::UNAUTHORIZED);

    let user_admin = app
        .clone()
        .oneshot(
            Request::builder()
                .uri("/api/admin/pending")
                .header(header::AUTHORIZATION, format!("Bearer {user_token}"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(user_admin.status(), StatusCode::FORBIDDEN);

    // 3. Guest posting when allow_guest_uploads == true -> runs Gemini (score 91) but forces 'Pending Admin Approval' and hides from public GET /api/posts
    let guest_post_res = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri("/api/posts")
                .header(header::CONTENT_TYPE, "application/json")
                .header("x-forwarded-for", "198.51.100.73")
                .body(Body::from(
                    json!({
                        "lat": 7.2906,
                        "lng": 80.6337,
                        "title": "Guest Kandy Tree Fall",
                        "description": "Large branch blocking lane near Kandy Lake",
                        "category": "Road",
                        "location_name": "Kandy Lake Round"
                    })
                    .to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(guest_post_res.status(), StatusCode::CREATED);
    let guest_post: Post = serde_json::from_value(read_json(guest_post_res).await).unwrap();
    assert_eq!(guest_post.ai_authenticity_score, 91);
    assert_eq!(
        guest_post.verification_status,
        VerificationStatus::PendingAdminApproval
    );

    // Hidden from public GET /api/posts (still 6 seed posts)
    let public_res = app
        .clone()
        .oneshot(
            Request::builder()
                .uri("/api/posts")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    let public_posts: Vec<Post> = serde_json::from_value(read_json(public_res).await).unwrap();
    assert_eq!(public_posts.len(), 6);
    assert!(!public_posts.iter().any(|p| p.id == guest_post.id));

    // Appears in GET /api/admin/pending for Admin
    let pending_res = app
        .clone()
        .oneshot(
            Request::builder()
                .uri("/api/admin/pending")
                .header(header::AUTHORIZATION, format!("Bearer {admin_token}"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(pending_res.status(), StatusCode::OK);
    let pending_posts: Vec<Post> = serde_json::from_value(read_json(pending_res).await).unwrap();
    assert!(pending_posts.iter().any(|p| p.id == guest_post.id));

    // 4. Admin approves guest post -> status 'Admin Approved' and becomes public!
    let approve_res = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri(format!("/api/admin/posts/{}/approve", guest_post.id))
                .header(header::AUTHORIZATION, format!("Bearer {admin_token}"))
                .header("x-forwarded-for", "198.51.100.74")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(approve_res.status(), StatusCode::OK);
    let approved_post: Post = serde_json::from_value(read_json(approve_res).await).unwrap();
    assert_eq!(
        approved_post.verification_status,
        VerificationStatus::AdminApproved
    );

    let public_after = app
        .clone()
        .oneshot(
            Request::builder()
                .uri("/api/posts?verified_only=true")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    let verified_after: Vec<Post> = serde_json::from_value(read_json(public_after).await).unwrap();
    assert!(verified_after.iter().any(|p| p.id == guest_post.id));

    // 5. Guest submits a second post -> Admin rejects it -> status 'Rejected', hidden from public & pending
    let guest_post2_res = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri("/api/posts")
                .header(header::CONTENT_TYPE, "application/json")
                .header("x-forwarded-for", "198.51.100.75")
                .body(Body::from(
                    json!({
                        "lat": 6.9,
                        "lng": 79.9,
                        "title": "Spam Guest Post",
                        "description": "Unverified rumor",
                        "category": "Nature",
                        "location_name": "Colombo"
                    })
                    .to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    let guest_post2: Post = serde_json::from_value(read_json(guest_post2_res).await).unwrap();

    let reject_res = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri(format!("/api/admin/posts/{}/reject", guest_post2.id))
                .header(header::AUTHORIZATION, format!("Bearer {admin_token}"))
                .header("x-forwarded-for", "198.51.100.76")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(reject_res.status(), StatusCode::OK);
    let rejected_post: Post = serde_json::from_value(read_json(reject_res).await).unwrap();
    assert_eq!(rejected_post.verification_status, VerificationStatus::Rejected);

    let pending_after = app
        .clone()
        .oneshot(
            Request::builder()
                .uri("/api/admin/pending")
                .header(header::AUTHORIZATION, format!("Bearer {admin_token}"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    let pending_after_posts: Vec<Post> =
        serde_json::from_value(read_json(pending_after).await).unwrap();
    assert!(!pending_after_posts.iter().any(|p| p.id == guest_post2.id));

    // 6. Admin toggles allow_guest_uploads = false -> Guest POST returns 403 Forbidden, Auth User succeeds!
    let toggle_res = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri("/api/admin/settings")
                .header(header::CONTENT_TYPE, "application/json")
                .header(header::AUTHORIZATION, format!("Bearer {admin_token}"))
                .header("x-forwarded-for", "198.51.100.77")
                .body(Body::from(json!({ "allow_guest_uploads": false }).to_string()))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(toggle_res.status(), StatusCode::OK);
    let settings = read_json(toggle_res).await;
    assert_eq!(settings["allow_guest_uploads"], false);

    let blocked_guest = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri("/api/posts")
                .header(header::CONTENT_TYPE, "application/json")
                .header("x-forwarded-for", "198.51.100.78")
                .body(Body::from(
                    json!({
                        "lat": 6.9,
                        "lng": 79.9,
                        "title": "Blocked Guest Post",
                        "description": "Should be forbidden",
                        "category": "Road",
                        "location_name": "Colombo"
                    })
                    .to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(blocked_guest.status(), StatusCode::FORBIDDEN);

    let auth_user_post = app
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri("/api/posts")
                .header(header::CONTENT_TYPE, "application/json")
                .header(header::AUTHORIZATION, format!("Bearer {user_token}"))
                .header("x-forwarded-for", "198.51.100.79")
                .body(Body::from(
                    json!({
                        "lat": 6.9,
                        "lng": 79.9,
                        "title": "Authenticated User Post",
                        "description": "Published directly through 4-layer trust engine",
                        "category": "Road",
                        "location_name": "Colombo"
                    })
                    .to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(auth_user_post.status(), StatusCode::CREATED);
    let auth_post: Post = serde_json::from_value(read_json(auth_user_post).await).unwrap();
    assert_eq!(auth_post.verification_status, VerificationStatus::AiVerified);
}

#[tokio::test]
async fn persistent_auth_sessions_logout_password_change_and_settings_survive_restart() {
    let temp_dir = std::env::temp_dir().join(format!(
        "civicpulse_persist_auth_{}",
        uuid::Uuid::new_v4()
    ));
    let db_path = temp_dir.join("civicpulse.db");
    let db_path_str = db_path.to_str().unwrap().to_string();

    let (admin_token, reg_token) = {
        let repo = PostRepository::open_file(&db_path_str, 4).unwrap();
        let config = Config::for_test("http://127.0.0.1:9/unused".into(), None);
        let (app, _) = build_app(config, repo).await.unwrap();

        let admin_token =
            login_token(&app, "admin@civicpulse.org", "admin123", "198.51.100.80").await;

        let reg_res = app
            .clone()
            .oneshot(
                Request::builder()
                    .method(Method::POST)
                    .uri("/api/auth/register")
                    .header(header::CONTENT_TYPE, "application/json")
                    .header("x-forwarded-for", "198.51.100.81")
                    .body(Body::from(
                        json!({
                            "name": "Kasun Silva",
                            "email": "kasun@example.com",
                            "password": "initialpassword"
                        })
                        .to_string(),
                    ))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(reg_res.status(), StatusCode::CREATED);
        let reg_body = read_json(reg_res).await;
        let reg_token = reg_body["token"].as_str().unwrap().to_string();

        // Admin disables guest uploads -> persisted in SQLite system_settings
        let toggle = app
            .oneshot(
                Request::builder()
                    .method(Method::POST)
                    .uri("/api/admin/settings")
                    .header(header::CONTENT_TYPE, "application/json")
                    .header(header::AUTHORIZATION, format!("Bearer {admin_token}"))
                    .header("x-forwarded-for", "198.51.100.82")
                    .body(Body::from(json!({ "allow_guest_uploads": false }).to_string()))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(toggle.status(), StatusCode::OK);
        (admin_token, reg_token)
    };

    // Simulate full process restart against the same SQLite DB
    let repo2 = PostRepository::open_file(&db_path_str, 4).unwrap();
    let config2 = Config::for_test("http://127.0.0.1:9/unused".into(), None);
    let (app2, _) = build_app(config2, repo2).await.unwrap();

    // Persisted setting survived restart: guest POST blocked with 403
    let guest_blocked = app2
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri("/api/posts")
                .header(header::CONTENT_TYPE, "application/json")
                .header("x-forwarded-for", "198.51.100.83")
                .body(Body::from(
                    json!({
                        "lat": 6.9,
                        "lng": 79.9,
                        "title": "Blocked After Restart",
                        "description": "Should still be forbidden",
                        "category": "Road",
                        "location_name": "Colombo"
                    })
                    .to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(guest_blocked.status(), StatusCode::FORBIDDEN);

    // Persisted session token still authenticates after restart
    let me_res = app2
        .clone()
        .oneshot(
            Request::builder()
                .uri("/api/auth/me")
                .header(header::AUTHORIZATION, format!("Bearer {reg_token}"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(me_res.status(), StatusCode::OK);
    let me_json = read_json(me_res).await;
    assert_eq!(me_json["email"], "kasun@example.com");

    // Change password + verify new login works & logout revokes token
    let chg_res = app2
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri("/api/auth/change-password")
                .header(header::CONTENT_TYPE, "application/json")
                .header(header::AUTHORIZATION, format!("Bearer {reg_token}"))
                .header("x-forwarded-for", "198.51.100.84")
                .body(Body::from(
                    json!({
                        "current_password": "initialpassword",
                        "new_password": "updatedpassword123"
                    })
                    .to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(chg_res.status(), StatusCode::OK);

    let new_token = login_token(
        &app2,
        "kasun@example.com",
        "updatedpassword123",
        "198.51.100.85",
    )
    .await;

    let logout_res = app2
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri("/api/auth/logout")
                .header(header::AUTHORIZATION, format!("Bearer {admin_token}"))
                .header("x-forwarded-for", "198.51.100.86")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(logout_res.status(), StatusCode::OK);

    let after_logout = app2
        .clone()
        .oneshot(
            Request::builder()
                .uri("/api/admin/settings")
                .header(header::AUTHORIZATION, format!("Bearer {admin_token}"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(after_logout.status(), StatusCode::UNAUTHORIZED);
    assert!(!new_token.is_empty());

    let _ = std::fs::remove_dir_all(&temp_dir);
}

#[tokio::test]
async fn disk_media_upload_perceptual_dhash_pagination_and_metrics_work() {
    let captured = Arc::new(Mutex::new(Vec::new()));
    let gemini_json = json!({
        "ai_authenticity_score": 87,
        "ai_reasoning": "Image inspected.",
        "translated_description": "Flooded road image.",
        "travel_advisory": "Caution",
        "severity": 6
    });
    let endpoint = spawn_gemini_test_server(MockGeminiBehavior {
        status: StatusCode::OK,
        response_body: gemini_text_envelope(&gemini_json.to_string()),
        captured_requests: Arc::clone(&captured),
    })
    .await;

    let temp_uploads =
        std::env::temp_dir().join(format!("civicpulse_uploads_{}", uuid::Uuid::new_v4()));
    let repo = PostRepository::open_in_memory().unwrap();
    let mut config = Config::for_test(endpoint, Some("test-key".into()));
    config.media_storage_mode = MediaStorageMode::File;
    config.upload_dir = temp_uploads.to_string_lossy().into_owned();

    let (app, _) = build_app(config, repo).await.unwrap();
    let user_token = login_token(&app, "user@civicpulse.org", "user123", "198.51.100.90").await;

    // Generate a real 64x64 asymmetric PNG and a resized JPEG derivative
    let mut img = RgbaImage::new(64, 64);
    for y in 0..64 {
        for x in 0..64 {
            img.put_pixel(
                x,
                y,
                Rgba([
                    ((x * 4) % 256) as u8,
                    ((y * 4) % 256) as u8,
                    if x > 32 && y < 32 { 220 } else { 30 },
                    255,
                ]),
            );
        }
    }
    let mut png_bytes = Vec::new();
    img.write_to(&mut Cursor::new(&mut png_bytes), ImageFormat::Png)
        .unwrap();
    let png_b64 = BASE64_STANDARD.encode(&png_bytes);

    let resized = image::DynamicImage::ImageRgba8(img).resize_exact(40, 40, FilterType::Lanczos3);
    let mut jpg_bytes = Vec::new();
    resized
        .to_rgb8()
        .write_to(&mut Cursor::new(&mut jpg_bytes), ImageFormat::Jpeg)
        .unwrap();
    let jpg_b64 = BASE64_STANDARD.encode(&jpg_bytes);

    // Upload PNG -> persisted to disk under /uploads/
    let up1 = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri("/api/posts")
                .header(header::CONTENT_TYPE, "application/json")
                .header(header::AUTHORIZATION, format!("Bearer {user_token}"))
                .header("x-forwarded-for", "198.51.100.91")
                .body(Body::from(
                    json!({
                        "lat": 6.9271,
                        "lng": 79.8612,
                        "title": "Colombo Road Flood",
                        "description": "Original road flood photo",
                        "category": "Road",
                        "location_name": "Colombo",
                        "media_base64": format!("data:image/png;base64,{png_b64}")
                    })
                    .to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(up1.status(), StatusCode::CREATED);
    let post1: Post = serde_json::from_value(read_json(up1).await).unwrap();
    let media_url = post1.media_url.as_deref().unwrap();
    assert!(media_url.starts_with("/uploads/"));

    // Serve uploaded file safely
    let fetch_media = app
        .clone()
        .oneshot(
            Request::builder()
                .uri(media_url)
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(fetch_media.status(), StatusCode::OK);
    assert_eq!(
        fetch_media.headers().get(header::CONTENT_TYPE).unwrap(),
        "image/png"
    );
    let downloaded_bytes = fetch_media.into_body().collect().await.unwrap().to_bytes();
    assert_eq!(downloaded_bytes.as_ref(), png_bytes.as_slice());

    // Path traversal blocked
    let trav = app
        .clone()
        .oneshot(
            Request::builder()
                .uri("/uploads/..%2F..%2Fetc%2Fpasswd")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(trav.status(), StatusCode::BAD_REQUEST);

    // Upload resized JPEG derivative far away -> perceptual dHash triggers Gemini alert!
    let up2 = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri("/api/posts")
                .header(header::CONTENT_TYPE, "application/json")
                .header(header::AUTHORIZATION, format!("Bearer {user_token}"))
                .header("x-forwarded-for", "198.51.100.92")
                .body(Body::from(
                    json!({
                        "lat": 8.5874,
                        "lng": 81.2152,
                        "title": "Trincomalee Claim",
                        "description": "Re-encoded resized image from Colombo",
                        "category": "Disaster",
                        "location_name": "Trincomalee",
                        "media_base64": format!("data:image/jpeg;base64,{jpg_b64}")
                    })
                    .to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(up2.status(), StatusCode::CREATED);

    {
        let sent = captured.lock().unwrap();
        let prompt2 = sent[1]["contents"][0]["parts"][0]["text"].as_str().unwrap();
        assert!(
            prompt2.contains("Perceptual image hash (dHash"),
            "expected perceptual dHash alert in Gemini prompt: {prompt2}"
        );
    }

    // Pagination headers + page slicing
    let paged_res = app
        .clone()
        .oneshot(
            Request::builder()
                .uri("/api/posts?limit=3&offset=2")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(paged_res.status(), StatusCode::OK);
    assert_eq!(paged_res.headers().get("x-total-count").unwrap(), "8");
    assert_eq!(paged_res.headers().get("x-limit").unwrap(), "3");
    assert_eq!(paged_res.headers().get("x-offset").unwrap(), "2");
    let page_posts: Vec<Post> = serde_json::from_value(read_json(paged_res).await).unwrap();
    assert_eq!(page_posts.len(), 3);

    // Prometheus metrics & OpenAPI + Docs endpoints
    let metrics_res = app
        .clone()
        .oneshot(
            Request::builder()
                .uri("/metrics")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(metrics_res.status(), StatusCode::OK);
    let metrics_body = String::from_utf8(
        metrics_res
            .into_body()
            .collect()
            .await
            .unwrap()
            .to_bytes()
            .to_vec(),
    )
    .unwrap();
    assert!(metrics_body.contains("civicpulse_http_requests_total"));
    assert!(metrics_body.contains("civicpulse_gemini_calls_total 2"));

    let openapi_res = app
        .clone()
        .oneshot(
            Request::builder()
                .uri("/openapi.json")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(openapi_res.status(), StatusCode::OK);
    let spec = read_json(openapi_res).await;
    assert_eq!(spec["openapi"], "3.1.0");

    let docs_res = app
        .oneshot(
            Request::builder()
                .uri("/docs")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(docs_res.status(), StatusCode::OK);

    let _ = std::fs::remove_dir_all(&temp_uploads);
}

#[tokio::test]
async fn background_ai_retry_and_signed_emergency_webhook_and_proxy_trust() {
    let fail_flag = Arc::new(std::sync::atomic::AtomicBool::new(true));
    let gemini_app = Router::new().route(
        "/generate",
        post({
            let fail_flag = Arc::clone(&fail_flag);
            move |Json(_body): Json<Value>| {
                let fail = fail_flag.load(std::sync::atomic::Ordering::Relaxed);
                async move {
                    if fail {
                        (
                            StatusCode::TOO_MANY_REQUESTS,
                            Json(json!({ "error": "rate limited" })),
                        )
                    } else {
                        let ok_payload = json!({
                            "ai_authenticity_score": 93,
                            "ai_reasoning": "Recovered AI verification confirms severe flash flood.",
                            "translated_description": "Severe flash flood blocking highway.",
                            "travel_advisory": "Danger",
                            "severity": 9
                        });
                        (
                            StatusCode::OK,
                            Json(gemini_text_envelope(&ok_payload.to_string())),
                        )
                    }
                }
            }
        }),
    );

    let g_listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let g_addr = g_listener.local_addr().unwrap();
    tokio::spawn(async move {
        axum::serve(g_listener, gemini_app).await.unwrap();
    });

    // Spawn signed webhook receiver
    let webhook_hits: Arc<Mutex<Vec<(String, String)>>> = Arc::new(Mutex::new(Vec::new()));
    let webhook_hits_clone = Arc::clone(&webhook_hits);
    let wh_app = Router::new().route(
        "/hook",
        post(move |headers: HeaderMap, body: axum::body::Bytes| {
            let hits = Arc::clone(&webhook_hits_clone);
            async move {
                let sig = headers
                    .get("x-civicpulse-signature")
                    .and_then(|v| v.to_str().ok())
                    .unwrap_or("")
                    .to_string();
                let payload = String::from_utf8_lossy(&body).to_string();
                hits.lock().unwrap().push((sig, payload));
                StatusCode::OK
            }
        }),
    );
    let wh_listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let wh_addr = wh_listener.local_addr().unwrap();
    tokio::spawn(async move {
        axum::serve(wh_listener, wh_app).await.unwrap();
    });

    let repo = PostRepository::open_in_memory().unwrap();
    let mut config = Config::for_test(format!("http://{g_addr}/generate"), Some("live-key".into()));
    config.webhook_url = Some(format!("http://{wh_addr}/hook"));
    config.webhook_secret = Some("top-secret-webhook-key".into());
    // Disable proxy header trust to verify spoofed X-Forwarded-For is ignored!
    config.trust_proxy_headers = false;
    config.rate_limit_post_per_min = 3;

    let (app, state) = build_app(config, repo).await.unwrap();
    let user_token = login_token(&app, "user@civicpulse.org", "user123", "10.0.0.1").await;

    // 1. Create post while Gemini returns 429 -> fallback score 55 & queued for retry
    let create_res = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri("/api/posts")
                .header(header::CONTENT_TYPE, "application/json")
                .header(header::AUTHORIZATION, format!("Bearer {user_token}"))
                .header("x-forwarded-for", "10.0.0.2")
                .body(Body::from(
                    json!({
                        "lat": 6.95,
                        "lng": 80.78,
                        "title": "Queued Highway Flash Flood",
                        "description": "Severe floodwater across bridge",
                        "category": "Disaster",
                        "location_name": "Hatton A7"
                    })
                    .to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(create_res.status(), StatusCode::CREATED);
    let created: Post = serde_json::from_value(read_json(create_res).await).unwrap();
    assert_eq!(created.ai_authenticity_score, 55);
    assert_eq!(
        created.verification_status,
        VerificationStatus::PendingCommunityVerification
    );

    // 2. Spoofing different X-Forwarded-For values cannot bypass rate limiter when trust_proxy_headers=false
    // (login + create_post already used 2 of 3 POST slots on fallback peer 127.0.0.1)
    let third_ok = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri("/api/posts/11111111-1111-4111-8111-000000000001/verify")
                .header("x-forwarded-for", "203.0.113.1")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(third_ok.status(), StatusCode::OK);

    let fourth_blocked = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::POST)
                .uri("/api/posts/11111111-1111-4111-8111-000000000001/verify")
                .header("x-forwarded-for", "203.0.113.2")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(fourth_blocked.status(), StatusCode::TOO_MANY_REQUESTS);

    // 3. Gemini recovers -> run single background AI retry pass -> upgrades post & dispatches signed webhook!
    fail_flag.store(false, std::sync::atomic::Ordering::Relaxed);
    let upgraded_count = run_ai_retry_pass(&state).await;
    assert_eq!(upgraded_count, 1);

    let upgraded_res = app
        .clone()
        .oneshot(
            Request::builder()
                .uri(format!("/api/posts/{}", created.id))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    let upgraded: Post = serde_json::from_value(read_json(upgraded_res).await).unwrap();
    assert_eq!(upgraded.ai_authenticity_score, 93);
    assert_eq!(upgraded.verification_status, VerificationStatus::AiVerified);
    assert_eq!(upgraded.severity, 9);

    // Wait briefly for spawned webhook delivery
    for _ in 0..20 {
        if !webhook_hits.lock().unwrap().is_empty() {
            break;
        }
        tokio::time::sleep(std::time::Duration::from_millis(25)).await;
    }

    let hits = webhook_hits.lock().unwrap();
    assert_eq!(hits.len(), 1);
    let (sig_header, payload_str) = &hits[0];
    let expected_sig = format!(
        "sha256={}",
        hmac_sha256_hex("top-secret-webhook-key", payload_str.as_bytes())
    );
    assert_eq!(sig_header, &expected_sig);
    assert!(payload_str.contains(&created.id));
}
