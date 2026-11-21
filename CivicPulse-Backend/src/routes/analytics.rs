use axum::{
    extract::{Query, State},
    Json,
};
use chrono::Utc;
use serde::Deserialize;

use crate::{
    error::{AppError, AppResult},
    models::ListPostsQuery,
    services::algorithms::{
        analyze_route_safety, compute_network_hotspots, NetworkHotspotsResponse,
        RouteSafetyRequest, RouteSafetyResponse,
    },
    state::AppState,
};

#[derive(Debug, Deserialize)]
pub struct HotspotsQuery {
    pub cluster_radius_km: Option<f64>,
}

/// Dynamic geospatial DBSCAN-style hazard hotspot clustering & live network statistics.
pub async fn get_hotspots(
    State(state): State<AppState>,
    Query(query): Query<HotspotsQuery>,
) -> AppResult<Json<NetworkHotspotsResponse>> {
    let radius = query.cluster_radius_km.unwrap_or(25.0);
    if !radius.is_finite() || !(1.0..=500.0).contains(&radius) {
        return Err(AppError::bad_request(
            "cluster_radius_km must be between 1.0 and 500.0",
        ));
    }

    let all_posts = state.repo.list_posts(&ListPostsQuery::default()).await?;
    let report = compute_network_hotspots(&all_posts, radius, Utc::now());
    Ok(Json(report))
}

/// Evaluate safety along a multi-waypoint travel corridor against all live unresolved hazards.
pub async fn post_route_safety(
    State(state): State<AppState>,
    Json(payload): Json<RouteSafetyRequest>,
) -> AppResult<Json<RouteSafetyResponse>> {
    let active_posts = state.repo.list_active_non_quarantined().await?;
    let result = analyze_route_safety(&payload, &active_posts)?;
    Ok(Json(result))
}
