use axum::{
    extract::{Path, State},
    http::{header, HeaderValue},
    response::IntoResponse,
};

use crate::{error::AppResult, services::media::read_stored_media, state::AppState};

/// `GET /uploads/{filename}` — safely serve stored media uploads with immutable cache headers.
pub async fn serve_upload(
    State(state): State<AppState>,
    Path(filename): Path<String>,
) -> AppResult<impl IntoResponse> {
    let upload_dir = state.config.upload_dir.clone();
    let (bytes, mime) = tokio::task::spawn_blocking(move || read_stored_media(&upload_dir, &filename))
        .await
        .map_err(|e| crate::error::AppError::internal(format!("Upload read join error: {e}")))??;

    Ok((
        [
            (header::CONTENT_TYPE, HeaderValue::from_static(mime)),
            (
                header::CACHE_CONTROL,
                HeaderValue::from_static("public, max-age=31536000, immutable"),
            ),
        ],
        bytes,
    ))
}
