use std::collections::{HashMap, VecDeque};
use std::sync::{
    atomic::{AtomicU64, Ordering},
    Mutex,
};
use std::time::{Duration, Instant};

use once_cell::sync::Lazy;
use serde::Serialize;
use tauri::ipc::Channel;

use crate::agent_host_runtime::HostError;

use super::types::PiAgentHostEvent;

pub(super) static PI_RUN_STREAMS: Lazy<Mutex<HashMap<String, PiRunStreamState>>> =
    Lazy::new(|| Mutex::new(HashMap::new()));
static PI_STREAM_SUBSCRIBER_ID: AtomicU64 = AtomicU64::new(1);
const PI_RUN_STREAM_BUFFER_LIMIT: usize = 4096;
pub(super) const PI_RUN_STREAM_TERMINAL_TTL: Duration =
    Duration::from_secs(super::PI_RUN_STREAM_TERMINAL_TTL_SECS);
pub(super) fn pi_run_streams_guard(
) -> std::sync::MutexGuard<'static, HashMap<String, PiRunStreamState>> {
    PI_RUN_STREAMS
        .lock()
        .unwrap_or_else(|_| panic!("pi_agent_host PI_RUN_STREAMS poisoned"))
}

pub(super) struct PiRunStreamState {
    next_cursor: u64,
    pub(super) events: VecDeque<PiRunStreamBufferedEvent>,
    subscribers: HashMap<u64, Channel<PiAgentHostEvent>>,
    terminal: Option<PiRunStreamTerminal>,
    finished_at: Option<Instant>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct PiRunStreamBufferedEvent {
    pub(super) cursor: u64,
    event: PiAgentHostEvent,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct PiRunStreamTerminal {
    pub(super) status: String,
    #[serde(default)]
    message: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PiRunStreamSnapshot {
    request_id: String,
    pub(super) running: bool,
    pub(super) cursor: u64,
    pub(super) buffered: usize,
    #[serde(default)]
    pub(super) terminal: Option<PiRunStreamTerminal>,
}

impl PiRunStreamState {
    fn new() -> Self {
        Self {
            next_cursor: 1,
            events: VecDeque::new(),
            subscribers: HashMap::new(),
            terminal: None,
            finished_at: None,
        }
    }

    pub(super) fn snapshot(&self, request_id: &str) -> PiRunStreamSnapshot {
        PiRunStreamSnapshot {
            request_id: request_id.to_string(),
            running: self.terminal.is_none(),
            cursor: self.next_cursor.saturating_sub(1),
            buffered: self.events.len(),
            terminal: self.terminal.clone(),
        }
    }
}

fn cleanup_terminal_run_streams_locked(
    streams: &mut HashMap<String, PiRunStreamState>,
    now: Instant,
) {
    streams.retain(|_, state| {
        if state.terminal.is_none() {
            return true;
        }
        match state.finished_at {
            Some(finished_at) => {
                now.saturating_duration_since(finished_at) <= PI_RUN_STREAM_TERMINAL_TTL
            }
            None => true,
        }
    });
}

pub(super) fn cleanup_terminal_run_streams(now: Instant) {
    let mut streams = pi_run_streams_guard();
    cleanup_terminal_run_streams_locked(&mut streams, now);
}

pub(super) fn begin_run_stream(request_id: &str) {
    let mut streams = pi_run_streams_guard();
    cleanup_terminal_run_streams_locked(&mut streams, Instant::now());
    streams.insert(request_id.to_string(), PiRunStreamState::new());
}

pub(super) fn finish_run_stream(request_id: &str, status: &str, message: Option<String>) {
    finish_run_stream_at(request_id, status, message, Instant::now());
}

pub(super) fn finish_run_stream_at(
    request_id: &str,
    status: &str,
    message: Option<String>,
    finished_at: Instant,
) {
    if let Some(state) = pi_run_streams_guard().get_mut(request_id) {
        state.terminal = Some(PiRunStreamTerminal {
            status: status.to_string(),
            message,
        });
        state.finished_at = Some(finished_at);
        state.subscribers.clear();
    }
}

pub(super) fn publish_host_event(
    request_id: Option<&str>,
    on_event: Option<&Channel<PiAgentHostEvent>>,
    event: PiAgentHostEvent,
    send_label: &str,
) -> Result<(), HostError> {
    let mut stream_cursor = None;
    let mut stream_subscribers = Vec::new();
    if let Some(request_id) = request_id {
        let mut streams = pi_run_streams_guard();
        let state = streams
            .entry(request_id.to_string())
            .or_insert_with(PiRunStreamState::new);
        let cursor = state.next_cursor;
        state.next_cursor = state.next_cursor.saturating_add(1);
        state.events.push_back(PiRunStreamBufferedEvent {
            cursor,
            event: event.clone(),
        });
        while state.events.len() > PI_RUN_STREAM_BUFFER_LIMIT {
            state.events.pop_front();
        }
        stream_cursor = Some(cursor);
        stream_subscribers = state
            .subscribers
            .iter()
            .map(|(id, subscriber)| (*id, subscriber.clone()))
            .collect::<Vec<_>>();
    }

    if let Some(cursor) = stream_cursor {
        let mut dead_subscribers = Vec::new();
        for (id, subscriber) in stream_subscribers {
            if subscriber.send(event.clone()).is_err()
                || subscriber
                    .send(PiAgentHostEvent::StreamCursor { cursor })
                    .is_err()
            {
                dead_subscribers.push(id);
            }
        }
        if !dead_subscribers.is_empty() {
            if let Some(request_id) = request_id {
                if let Some(state) = pi_run_streams_guard().get_mut(request_id) {
                    for id in dead_subscribers {
                        state.subscribers.remove(&id);
                    }
                }
            }
        }
    }

    if let Some(on_event) = on_event {
        if let Err(err) = on_event.send(event) {
            if request_id.is_none() {
                return Err(HostError::Request(format!("{send_label}: {err}")));
            }
            eprintln!("[pi-agent-host] dropped stale renderer channel for {send_label}: {err}");
        } else if let Some(cursor) = stream_cursor {
            if let Err(err) = on_event.send(PiAgentHostEvent::StreamCursor { cursor }) {
                eprintln!(
                    "[pi-agent-host] dropped stale renderer channel for {send_label} cursor: {err}"
                );
            }
        }
    }
    Ok(())
}

pub(super) fn stream_snapshot(request_id: String) -> Result<Option<PiRunStreamSnapshot>, String> {
    cleanup_terminal_run_streams(Instant::now());
    Ok(pi_run_streams_guard()
        .get(&request_id)
        .map(|state| state.snapshot(&request_id)))
}

pub(super) fn release_stream(request_id: String) -> Result<(), String> {
    let mut streams = pi_run_streams_guard();
    if streams
        .get(&request_id)
        .map(|state| state.terminal.is_some())
        .unwrap_or(false)
    {
        streams.remove(&request_id);
    }
    Ok(())
}

pub(super) fn reattach_stream(
    request_id: String,
    after_cursor: Option<u64>,
    on_event: Channel<PiAgentHostEvent>,
) -> Result<PiRunStreamSnapshot, String> {
    let replay_after = after_cursor.unwrap_or(0);
    let (replay, snapshot) = {
        let mut streams = pi_run_streams_guard();
        cleanup_terminal_run_streams_locked(&mut streams, Instant::now());
        let state = streams
            .get_mut(&request_id)
            .ok_or_else(|| format!("No live Pi Agent stream for request {request_id}"))?;
        let replay = state
            .events
            .iter()
            .filter(|entry| entry.cursor > replay_after)
            .cloned()
            .collect::<Vec<_>>();
        if state.terminal.is_none() {
            let subscriber_id = PI_STREAM_SUBSCRIBER_ID.fetch_add(1, Ordering::Relaxed);
            state.subscribers.insert(subscriber_id, on_event.clone());
        }
        (replay, state.snapshot(&request_id))
    };
    for entry in replay {
        let cursor = entry.cursor;
        // WorkspaceBound contains an ephemeral capability. Buffered copies are
        // never authoritative after reattach; the gateway separately asks the
        // live backend registry to replay a freshly root-identity-checked claim.
        // Still advance the old event's cursor so retries cannot loop on it.
        if !matches!(&entry.event, PiAgentHostEvent::WorkspaceBound { .. }) {
            on_event
                .send(entry.event)
                .map_err(|err| format!("Replay Pi Agent stream event: {err}"))?;
        }
        on_event
            .send(PiAgentHostEvent::StreamCursor { cursor })
            .map_err(|err| format!("Replay Pi Agent stream cursor: {err}"))?;
    }
    Ok(snapshot)
}
