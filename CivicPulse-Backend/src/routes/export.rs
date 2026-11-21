use std::borrow::Cow;

use axum::{
    extract::{Query, State},
    http::{header, HeaderValue},
    response::IntoResponse,
    Json,
};

use crate::{
    error::AppResult,
    models::{
        ExportGeoJsonQuery, GeoJsonFeature, GeoJsonFeatureCollection, GeoJsonPoint,
        GeoJsonProperties, ListPostsQuery,
    },
    state::AppState,
};

pub async fn export_geojson(
    State(state): State<AppState>,
    Query(query): Query<ExportGeoJsonQuery>,
) -> AppResult<impl IntoResponse> {
    let posts = state
        .repo
        .list_posts(&ListPostsQuery {
            category: query.category,
            verified_only: query.verified_only,
            search: None,
            exclude_quarantined: Some(true),
            ..Default::default()
        })
        .await?;

    let features = posts
        .into_iter()
        .map(|p| GeoJsonFeature {
            feature_type: Cow::Borrowed("Feature"),
            id: p.id,
            geometry: GeoJsonPoint {
                geometry_type: Cow::Borrowed("Point"),
                // RFC 7946 requires [longitude, latitude]
                coordinates: [p.lng, p.lat],
            },
            properties: GeoJsonProperties {
                title: p.title,
                description: p.description,
                translated_description: p.translated_description,
                category: p.category,
                location_name: p.location_name,
                is_live_captured: p.is_live_captured,
                is_on_site: p.is_on_site,
                ai_authenticity_score: p.ai_authenticity_score,
                ai_reasoning: p.ai_reasoning,
                travel_advisory: p.travel_advisory,
                severity: p.severity,
                verification_status: p.verification_status,
                confirmations: p.confirmations,
                false_flags: p.false_flags,
                is_resolved: p.is_resolved,
                integrity_hash: p.integrity_hash,
                comments_count: p.comments.len(),
                created_at: p.created_at,
            },
        })
        .collect();

    let collection = GeoJsonFeatureCollection {
        collection_type: Cow::Borrowed("FeatureCollection"),
        features,
    };

    Ok((
        [(
            header::CONTENT_TYPE,
            HeaderValue::from_static("application/geo+json; charset=utf-8"),
        )],
        Json(collection),
    ))
}
