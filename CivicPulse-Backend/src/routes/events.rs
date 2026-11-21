use std::{convert::Infallible, time::Duration};

use axum::{
    extract::State,
    response::sse::{Event, KeepAlive, Sse},
};
use tokio_stream::{wrappers::BroadcastStream, Stream, StreamExt};

use crate::state::AppState;

/// Real-time Server-Sent Events stream (`GET /api/events`) emitting live post & quorum updates.
pub async fn sse_events(
    State(state): State<AppState>,
) -> Sse<impl Stream<Item = Result<Event, Infallible>>> {
    let rx = state.events_tx.subscribe();
    let stream = BroadcastStream::new(rx).filter_map(|msg| match msg {
        Ok(payload) => {
            let event_name = payload.event_type.clone();
            match serde_json::to_string(&payload) {
                Ok(data) => Some(Ok(Event::default().event(event_name).data(data))),
                Err(_) => None,
            }
        }
        Err(_) => None, // lagged subscriber continues cleanly
    });

    Sse::new(stream).keep_alive(
        KeepAlive::new()
            .interval(Duration::from_secs(15))
            .text("heartbeat"),
    )
}
