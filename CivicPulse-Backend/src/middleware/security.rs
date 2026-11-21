use axum::{
    extract::Request,
    http::{header, HeaderValue},
    middleware::Next,
    response::Response,
};
use uuid::Uuid;

/// Strip NUL bytes, ANSI escape sequences, C0/C1 control characters (except `\n` and `\t`),
/// and Unicode bidirectional override characters that can spoof terminal (`civic-cli`) or UI text.
pub fn sanitize_text(input: &str) -> String {
    let mut out = String::with_capacity(input.len());
    let mut chars = input.chars().peekable();

    while let Some(ch) = chars.next() {
        // Strip ANSI CSI escape sequences (e.g., `\x1b[31m`) to protect terminal CLI consumers.
        if ch == '\x1b' {
            if matches!(chars.peek(), Some('[')) {
                chars.next();
                for c in chars.by_ref() {
                    if ('@'..='~').contains(&c) {
                        break;
                    }
                }
            }
            continue;
        }

        // Reject NUL, C0/C1 controls (except newline and tab), and Unicode Bidi override chars.
        let is_bidi_override = matches!(
            ch,
            '\u{202A}'..='\u{202E}' | '\u{2066}'..='\u{2069}' | '\u{200E}' | '\u{200F}' | '\u{061C}'
        );
        let is_bad_control = (ch.is_control() && ch != '\n' && ch != '\t') || ch == '\u{FEFF}';

        if !is_bidi_override && !is_bad_control {
            out.push(ch);
        }
    }

    out.trim().to_string()
}

/// Attach `X-Request-Id` and OWASP API security headers to every HTTP response.
pub async fn security_headers_middleware(req: Request, next: Next) -> Response {
    let request_id = req
        .headers()
        .get("x-request-id")
        .and_then(|v| v.to_str().ok())
        .map(str::trim)
        .filter(|s| {
            !s.is_empty()
                && s.len() <= 64
                && s.bytes()
                    .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
        })
        .map(ToOwned::to_owned)
        .unwrap_or_else(|| Uuid::new_v4().to_string());

    let mut res = next.run(req).await;
    let headers = res.headers_mut();

    headers.insert(
        "x-content-type-options",
        HeaderValue::from_static("nosniff"),
    );
    headers.insert("x-frame-options", HeaderValue::from_static("DENY"));
    headers.insert("referrer-policy", HeaderValue::from_static("no-referrer"));
    headers.insert(
        "permissions-policy",
        HeaderValue::from_static("geolocation=(), camera=(), microphone=()"),
    );
    headers.insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));

    if let Ok(val) = HeaderValue::from_str(&request_id) {
        headers.insert("x-request-id", val);
    }

    res
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn strips_ansi_escapes_and_bidi_spoofing_while_preserving_sinhala() {
        let dirty = "\x1b[31mනුවරඑළිය\x1b[0m \u{202E}alert\0\nline2";
        let clean = sanitize_text(dirty);
        assert_eq!(clean, "නුවරඑළිය alert\nline2");
    }
}
