# syntax=docker/dockerfile:1

FROM rust:1-slim-bookworm AS builder
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        gcc \
        libc6-dev \
        pkg-config \
        libssl-dev \
        ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /usr/src/civicpulse

# Pre-compile third-party dependencies for layer caching
COPY Cargo.toml Cargo.lock ./
RUN mkdir -p src \
    && touch src/lib.rs \
    && echo "fn main() {}" > src/main.rs \
    && cargo build --release --locked \
    && rm -rf src \
        target/release/.fingerprint/civicpulse* \
        target/release/deps/civicpulse* \
        target/release/deps/libcivicpulse* \
        target/release/civicpulse-backend*

# Build the real civicpulse-backend binary
COPY src ./src
RUN touch src/lib.rs src/main.rs \
    && cargo build --release --locked --bin civicpulse-backend

FROM debian:bookworm-slim AS runtime
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates libssl3 curl \
    && rm -rf /var/lib/apt/lists/* \
    && useradd --system --create-home --home-dir /app --shell /usr/sbin/nologin civicpulse

WORKDIR /app
RUN mkdir -p /app/data/uploads && chown -R civicpulse:civicpulse /app

COPY --from=builder /usr/src/civicpulse/target/release/civicpulse-backend /usr/local/bin/civicpulse-backend

USER civicpulse
ENV HOST=0.0.0.0 \
    PORT=8080 \
    DATABASE_PATH=/app/data/civicpulse.db \
    UPLOAD_DIR=/app/data/uploads \
    MEDIA_STORAGE_MODE=file \
    DB_POOL_SIZE=8 \
    GEOFENCE_RADIUS_KM=15.0 \
    RATE_LIMIT_POST_PER_MIN=10 \
    AUTH_RATE_LIMIT_PER_15MIN=15 \
    STRICT_UNIQUE_VOTERS=true \
    TRUST_PROXY_HEADERS=true \
    SEED_INITIAL_POSTS=false \
    SESSION_TTL_HOURS=24 \
    AI_RETRY_INTERVAL_SECS=60 \
    STALE_ALERT_HOURS=72 \
    RUST_LOG=civicpulse_backend=info,tower_http=info

VOLUME ["/app/data"]
EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD curl -fsS http://127.0.0.1:8080/health || exit 1

CMD ["civicpulse-backend"]
