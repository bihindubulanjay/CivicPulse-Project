use axum::{
    http::{header, HeaderValue, StatusCode},
    response::{IntoResponse, Response},
    Json,
};
use serde::Serialize;

/// Unified API error type returning consistent JSON responses without leaking internal details.
#[derive(Debug, Clone)]
pub enum AppError {
    BadRequest(String),
    Unauthorized(String),
    Forbidden(String),
    NotFound(String),
    Conflict(String),
    RateLimited {
        retry_after_secs: u64,
        message: String,
    },
    ServiceUnavailable(String),
    Internal(String),
}

#[derive(Debug, Serialize)]
struct ErrorBody<'a> {
    error: &'a str,
    code: &'static str,
    status: u16,
}

impl AppError {
    pub fn bad_request(msg: impl Into<String>) -> Self {
        Self::BadRequest(msg.into())
    }

    pub fn unauthorized(msg: impl Into<String>) -> Self {
        Self::Unauthorized(msg.into())
    }

    pub fn forbidden(msg: impl Into<String>) -> Self {
        Self::Forbidden(msg.into())
    }

    pub fn not_found(msg: impl Into<String>) -> Self {
        Self::NotFound(msg.into())
    }

    pub fn conflict(msg: impl Into<String>) -> Self {
        Self::Conflict(msg.into())
    }

    pub fn service_unavailable(msg: impl Into<String>) -> Self {
        Self::ServiceUnavailable(msg.into())
    }

    pub fn internal(msg: impl Into<String>) -> Self {
        Self::Internal(msg.into())
    }
}

impl std::fmt::Display for AppError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::BadRequest(msg)
            | Self::Unauthorized(msg)
            | Self::Forbidden(msg)
            | Self::NotFound(msg)
            | Self::Conflict(msg)
            | Self::ServiceUnavailable(msg)
            | Self::Internal(msg) => {
                write!(f, "{msg}")
            }
            Self::RateLimited { message, .. } => write!(f, "{message}"),
        }
    }
}

impl std::error::Error for AppError {}

impl IntoResponse for AppError {
    fn into_response(self) -> Response {
        match self {
            Self::BadRequest(msg) => (
                StatusCode::BAD_REQUEST,
                Json(ErrorBody {
                    error: &msg,
                    code: "BAD_REQUEST",
                    status: StatusCode::BAD_REQUEST.as_u16(),
                }),
            )
                .into_response(),
            Self::Unauthorized(msg) => (
                StatusCode::UNAUTHORIZED,
                Json(ErrorBody {
                    error: &msg,
                    code: "UNAUTHORIZED",
                    status: StatusCode::UNAUTHORIZED.as_u16(),
                }),
            )
                .into_response(),
            Self::Forbidden(msg) => (
                StatusCode::FORBIDDEN,
                Json(ErrorBody {
                    error: &msg,
                    code: "FORBIDDEN",
                    status: StatusCode::FORBIDDEN.as_u16(),
                }),
            )
                .into_response(),
            Self::NotFound(msg) => (
                StatusCode::NOT_FOUND,
                Json(ErrorBody {
                    error: &msg,
                    code: "NOT_FOUND",
                    status: StatusCode::NOT_FOUND.as_u16(),
                }),
            )
                .into_response(),
            Self::Conflict(msg) => (
                StatusCode::CONFLICT,
                Json(ErrorBody {
                    error: &msg,
                    code: "CONFLICT",
                    status: StatusCode::CONFLICT.as_u16(),
                }),
            )
                .into_response(),
            Self::RateLimited {
                retry_after_secs,
                message,
            } => {
                let mut res = (
                    StatusCode::TOO_MANY_REQUESTS,
                    Json(ErrorBody {
                        error: &message,
                        code: "RATE_LIMIT_EXCEEDED",
                        status: StatusCode::TOO_MANY_REQUESTS.as_u16(),
                    }),
                )
                    .into_response();
                if let Ok(val) = HeaderValue::from_str(&retry_after_secs.to_string()) {
                    res.headers_mut().insert(header::RETRY_AFTER, val);
                }
                res
            }
            Self::ServiceUnavailable(msg) => (
                StatusCode::SERVICE_UNAVAILABLE,
                Json(ErrorBody {
                    error: &msg,
                    code: "SERVICE_UNAVAILABLE",
                    status: StatusCode::SERVICE_UNAVAILABLE.as_u16(),
                }),
            )
                .into_response(),
            Self::Internal(msg) => {
                tracing::error!(error = %msg, "Internal server error");
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    Json(ErrorBody {
                        error: "An internal server error occurred",
                        code: "INTERNAL_ERROR",
                        status: StatusCode::INTERNAL_SERVER_ERROR.as_u16(),
                    }),
                )
                    .into_response()
            }
        }
    }
}

pub type AppResult<T> = Result<T, AppError>;
