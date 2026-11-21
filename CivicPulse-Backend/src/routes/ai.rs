use axum::{extract::State, Json};

use crate::{
    error::{AppError, AppResult},
    models::{AiChatRequest, AiChatResponse},
    services::{geofence::validate_coordinates, trust_engine::normalize_required_text},
    state::AppState,
};

const MAX_CHAT_MESSAGE_LEN: usize = 2000;

pub async fn ai_chat(
    State(state): State<AppState>,
    Json(payload): Json<AiChatRequest>,
) -> AppResult<Json<AiChatResponse>> {
    let message = normalize_required_text(&payload.message, "message", MAX_CHAT_MESSAGE_LEN)?;

    if let Some(ulat) = payload.user_lat {
        if !ulat.is_finite() || !(-90.0..=90.0).contains(&ulat) {
            return Err(AppError::bad_request("Invalid user_lat coordinate"));
        }
    }
    if let Some(ulng) = payload.user_lng {
        if !ulng.is_finite() || !(-180.0..=180.0).contains(&ulng) {
            return Err(AppError::bad_request("Invalid user_lng coordinate"));
        }
    }

    let user_coords = match (payload.user_lat, payload.user_lng) {
        (Some(ulat), Some(ulng)) => {
            validate_coordinates(ulat, ulng, "user")?;
            Some((ulat, ulng))
        }
        _ => None,
    };

    // Only active non-quarantined posts are injected into Gemini context.
    let active_posts = state.repo.list_active_non_quarantined().await?;
    let response = state
        .gemini
        .answer_safety_chat(&message, &payload.history, &active_posts, user_coords)
        .await;

    Ok(Json(response))
}
