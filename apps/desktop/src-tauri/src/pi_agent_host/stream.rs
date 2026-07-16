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
pub(super) const PI_RUN_STREAM_BUFFER_LIMIT: usize = 4096;
const PI_RUN_STREAM_REPLAY_OVERFLOW: &str =
    "Pi Agent stream replay exceeded its bounded pending buffer; retry reattach from the last durable cursor.";
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
    workspace_unavailable_declarations: Vec<PiAgentHostEvent>,
    subscribers: HashMap<u64, PiRunStreamSubscriber>,
    terminal: Option<PiRunStreamTerminal>,
    finished_at: Option<Instant>,
}

struct PiRunStreamSubscriber {
    channel: Channel<PiAgentHostEvent>,
    replaying: bool,
    pending: VecDeque<PiRunStreamBufferedEvent>,
    overflowed: bool,
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
            workspace_unavailable_declarations: Vec::new(),
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

    #[cfg(test)]
    pub(super) fn subscriber_count(&self) -> usize {
        self.subscribers.len()
    }
}

fn same_workspace_unavailable(left: &PiAgentHostEvent, right: &PiAgentHostEvent) -> bool {
    match (left, right) {
        (
            PiAgentHostEvent::WorkspaceUnavailable {
                project_id: left_project_id,
                thread_id: left_thread_id,
                turn_id: left_turn_id,
                request_id: left_request_id,
                source: left_source,
                reason_code: left_reason_code,
            },
            PiAgentHostEvent::WorkspaceUnavailable {
                project_id: right_project_id,
                thread_id: right_thread_id,
                turn_id: right_turn_id,
                request_id: right_request_id,
                source: right_source,
                reason_code: right_reason_code,
            },
        ) => {
            left_project_id == right_project_id
                && left_thread_id == right_thread_id
                && left_turn_id == right_turn_id
                && left_request_id == right_request_id
                && left_source == right_source
                && left_reason_code == right_reason_code
        }
        _ => false,
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

pub(crate) fn begin_run_stream(request_id: &str) {
    let mut streams = pi_run_streams_guard();
    cleanup_terminal_run_streams_locked(&mut streams, Instant::now());
    streams.insert(request_id.to_string(), PiRunStreamState::new());
}

pub(crate) fn finish_run_stream(request_id: &str, status: &str, message: Option<String>) {
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
        state
            .subscribers
            .retain(|_, subscriber| subscriber.replaying);
    }
}

pub(crate) fn publish_host_event(
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
        if matches!(&event, PiAgentHostEvent::WorkspaceUnavailable { .. })
            && state
                .workspace_unavailable_declarations
                .iter()
                .all(|declaration| !same_workspace_unavailable(declaration, &event))
            && state.workspace_unavailable_declarations.len() < 2
        {
            // This declaration is safe to persist in the in-memory stream and
            // must be replayed independently of the renderer's event cursor.
            // Retain one conflicting declaration as well, so reattach poisons
            // an impossible bound/unavailable transition instead of hiding it.
            state.workspace_unavailable_declarations.push(event.clone());
        }
        let cursor = state.next_cursor;
        state.next_cursor = state.next_cursor.saturating_add(1);
        let buffered_event = PiRunStreamBufferedEvent {
            cursor,
            event: event.clone(),
        };
        state.events.push_back(buffered_event.clone());
        while state.events.len() > PI_RUN_STREAM_BUFFER_LIMIT {
            state.events.pop_front();
        }
        stream_cursor = Some(cursor);
        for (id, subscriber) in &mut state.subscribers {
            if subscriber.replaying {
                if !subscriber.overflowed {
                    if subscriber.pending.len() >= PI_RUN_STREAM_BUFFER_LIMIT {
                        subscriber.pending.clear();
                        subscriber.overflowed = true;
                    } else {
                        subscriber.pending.push_back(buffered_event.clone());
                    }
                }
            } else {
                stream_subscribers.push((*id, subscriber.channel.clone()));
            }
        }
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

pub(crate) fn stream_snapshot(request_id: String) -> Result<Option<PiRunStreamSnapshot>, String> {
    cleanup_terminal_run_streams(Instant::now());
    Ok(pi_run_streams_guard()
        .get(&request_id)
        .map(|state| state.snapshot(&request_id)))
}

pub(crate) fn release_stream(request_id: String) -> Result<(), String> {
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

fn remove_stream_subscriber(request_id: &str, subscriber_id: u64) {
    if let Some(state) = pi_run_streams_guard().get_mut(request_id) {
        state.subscribers.remove(&subscriber_id);
    }
}

fn send_buffered_stream_event(
    on_event: &Channel<PiAgentHostEvent>,
    entry: PiRunStreamBufferedEvent,
) -> Result<(), String> {
    let cursor = entry.cursor;
    on_event
        .send(entry.event)
        .map_err(|err| format!("Replay Pi Agent stream event: {err}"))?;
    on_event
        .send(PiAgentHostEvent::StreamCursor { cursor })
        .map_err(|err| format!("Replay Pi Agent stream cursor: {err}"))
}

fn finish_stream_subscriber_replay(
    request_id: &str,
    subscriber_id: u64,
    on_event: &Channel<PiAgentHostEvent>,
) -> Result<(), String> {
    loop {
        let pending = {
            let mut streams = pi_run_streams_guard();
            let Some(state) = streams.get_mut(request_id) else {
                return Ok(());
            };
            let terminal = state.terminal.is_some();
            let Some(subscriber) = state.subscribers.get(&subscriber_id) else {
                return Ok(());
            };
            if subscriber.overflowed {
                state.subscribers.remove(&subscriber_id);
                return Err(PI_RUN_STREAM_REPLAY_OVERFLOW.into());
            }
            if subscriber.pending.is_empty() {
                if terminal {
                    state.subscribers.remove(&subscriber_id);
                } else if let Some(subscriber) = state.subscribers.get_mut(&subscriber_id) {
                    subscriber.replaying = false;
                }
                return Ok(());
            }
            state
                .subscribers
                .get_mut(&subscriber_id)
                .expect("subscriber checked above")
                .pending
                .pop_front()
        };
        if let Some(entry) = pending {
            if let Err(error) = send_buffered_stream_event(on_event, entry) {
                remove_stream_subscriber(request_id, subscriber_id);
                return Err(error);
            }
        }
    }
}

fn next_replay_event(
    request_id: &str,
    cursor: u64,
    replay_through: u64,
) -> Result<Option<PiRunStreamBufferedEvent>, String> {
    if cursor >= replay_through {
        return Ok(None);
    }
    let streams = pi_run_streams_guard();
    let state = streams
        .get(request_id)
        .ok_or_else(|| format!("No live Pi Agent stream for request {request_id}"))?;
    let expected_cursor = cursor.saturating_add(1);
    let entry = state
        .events
        .iter()
        .find(|entry| entry.cursor == expected_cursor)
        .cloned()
        .ok_or_else(|| {
            format!(
                "Pi Agent stream replay gap at cursor {expected_cursor}; retry from the last durable cursor."
            )
        })?;
    Ok(Some(entry))
}

pub(crate) fn reattach_stream(
    request_id: String,
    after_cursor: Option<u64>,
    on_event: Channel<PiAgentHostEvent>,
) -> Result<PiRunStreamSnapshot, String> {
    let replay_after = after_cursor.unwrap_or(0);
    let (subscriber_id, workspace_unavailable_declarations, replay_through, snapshot) = {
        let mut streams = pi_run_streams_guard();
        cleanup_terminal_run_streams_locked(&mut streams, Instant::now());
        let state = streams
            .get_mut(&request_id)
            .ok_or_else(|| format!("No live Pi Agent stream for request {request_id}"))?;
        let replay_through = state.next_cursor.saturating_sub(1);
        if replay_after > replay_through {
            return Err(format!(
                "Pi Agent stream cursor {replay_after} is ahead of live cursor {replay_through}."
            ));
        }
        if replay_after < replay_through
            && state
                .events
                .front()
                .is_none_or(|entry| entry.cursor > replay_after.saturating_add(1))
        {
            return Err(format!(
                "Pi Agent stream replay gap after cursor {replay_after}; retry from a retained durable cursor."
            ));
        }
        let subscriber_id = if state.terminal.is_none() {
            let subscriber_id = PI_STREAM_SUBSCRIBER_ID.fetch_add(1, Ordering::Relaxed);
            state.subscribers.insert(
                subscriber_id,
                PiRunStreamSubscriber {
                    channel: on_event.clone(),
                    replaying: true,
                    pending: VecDeque::new(),
                    overflowed: false,
                },
            );
            Some(subscriber_id)
        } else {
            None
        };
        (
            subscriber_id,
            state.workspace_unavailable_declarations.clone(),
            replay_through,
            state.snapshot(&request_id),
        )
    };
    for declaration in workspace_unavailable_declarations {
        if let Err(err) = on_event.send(declaration) {
            if let Some(subscriber_id) = subscriber_id {
                remove_stream_subscriber(&request_id, subscriber_id);
            }
            return Err(format!("Replay Pi Agent workspace declaration: {err}"));
        }
    }
    let mut replay_cursor = replay_after;
    while let Some(entry) = next_replay_event(&request_id, replay_cursor, replay_through)
        .inspect_err(|_error| {
            if let Some(subscriber_id) = subscriber_id {
                remove_stream_subscriber(&request_id, subscriber_id);
            }
        })?
    {
        let cursor = entry.cursor;
        // WorkspaceBound contains an ephemeral capability. Buffered copies are
        // never authoritative after reattach; the gateway separately asks the
        // live backend registry to replay a freshly root-identity-checked claim.
        // Still advance the old event's cursor so retries cannot loop on it.
        if !matches!(
            &entry.event,
            PiAgentHostEvent::WorkspaceBound { .. } | PiAgentHostEvent::WorkspaceUnavailable { .. }
        ) {
            if let Err(err) = on_event.send(entry.event) {
                if let Some(subscriber_id) = subscriber_id {
                    remove_stream_subscriber(&request_id, subscriber_id);
                }
                return Err(format!("Replay Pi Agent stream event: {err}"));
            }
        }
        if let Err(err) = on_event.send(PiAgentHostEvent::StreamCursor { cursor }) {
            if let Some(subscriber_id) = subscriber_id {
                remove_stream_subscriber(&request_id, subscriber_id);
            }
            return Err(format!("Replay Pi Agent stream cursor: {err}"));
        }
        replay_cursor = cursor;
    }
    if let Some(subscriber_id) = subscriber_id {
        finish_stream_subscriber_replay(&request_id, subscriber_id, &on_event)?;
    }
    Ok(snapshot)
}
