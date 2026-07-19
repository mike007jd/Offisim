use std::collections::HashMap;
use std::sync::{
    atomic::{AtomicU64, Ordering},
    Mutex,
};
use std::time::{Duration, Instant};

use once_cell::sync::Lazy;
use serde::Serialize;
use tauri::ipc::Channel;

use crate::agent_host_runtime::HostError;
#[cfg(test)]
use crate::agent_host_stream::RUN_STREAM_BUFFER_LIMIT;
use crate::agent_host_stream::{
    send_published_stream_entry, send_stream_entry, RunStreamBufferedEvent, RunStreamCore,
    RunStreamCursorError, RunStreamEvent, RunStreamPolicy, RunStreamReplayStep, RunStreamSendError,
};

use super::types::PiAgentHostEvent;

pub(super) static PI_RUN_STREAMS: Lazy<Mutex<HashMap<String, PiRunStreamState>>> =
    Lazy::new(|| Mutex::new(HashMap::new()));
static PI_STREAM_SUBSCRIBER_ID: AtomicU64 = AtomicU64::new(1);
#[cfg(test)]
pub(super) const PI_RUN_STREAM_BUFFER_LIMIT: usize = RUN_STREAM_BUFFER_LIMIT;
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
    core: RunStreamCore<PiAgentHostEvent>,
    workspace_unavailable_declarations: Vec<PiAgentHostEvent>,
    terminal: Option<PiRunStreamTerminal>,
    finished_at: Option<Instant>,
}

impl RunStreamEvent for PiAgentHostEvent {
    fn stream_cursor(cursor: u64) -> Self {
        Self::StreamCursor { cursor }
    }

    fn is_terminal(&self) -> bool {
        matches!(
            self,
            Self::MessageEnd { .. } | Self::Result { .. } | Self::Error { .. }
        )
    }
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
            core: RunStreamCore::new(RunStreamPolicy::PI),
            workspace_unavailable_declarations: Vec::new(),
            terminal: None,
            finished_at: None,
        }
    }

    pub(super) fn snapshot(&self, request_id: &str) -> PiRunStreamSnapshot {
        PiRunStreamSnapshot {
            request_id: request_id.to_string(),
            running: self.terminal.is_none(),
            cursor: self.core.cursor(),
            buffered: self.core.buffered(),
            terminal: self.terminal.clone(),
        }
    }

    #[cfg(test)]
    pub(super) fn subscriber_count(&self) -> usize {
        self.core.subscriber_count()
    }

    #[cfg(test)]
    pub(super) fn events(
        &self,
    ) -> &std::collections::VecDeque<RunStreamBufferedEvent<PiAgentHostEvent>> {
        self.core.events()
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
        state.core.mark_terminal();
    }
}

pub(crate) fn publish_host_event(
    request_id: Option<&str>,
    on_event: Option<&Channel<PiAgentHostEvent>>,
    event: PiAgentHostEvent,
    send_label: &str,
) -> Result<(), HostError> {
    let mut stream_entry = None;
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
        let published = state.core.publish(event.clone());
        stream_entry = published.entry;
        stream_subscribers = published.subscribers;
    }

    if let Some(entry) = stream_entry.as_ref() {
        let mut dead_subscribers = Vec::new();
        for (id, subscriber) in stream_subscribers {
            if send_published_stream_entry(&subscriber, entry).is_err() {
                dead_subscribers.push(id);
            }
        }
        if !dead_subscribers.is_empty() {
            if let Some(request_id) = request_id {
                if let Some(state) = pi_run_streams_guard().get_mut(request_id) {
                    for id in dead_subscribers {
                        state.core.remove_subscriber(id);
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
        } else if let Some(cursor) = stream_entry.as_ref().map(|entry| entry.cursor) {
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
        state.core.remove_subscriber(subscriber_id);
    }
}

fn send_buffered_stream_event(
    on_event: &Channel<PiAgentHostEvent>,
    entry: RunStreamBufferedEvent<PiAgentHostEvent>,
) -> Result<(), String> {
    send_stream_entry(on_event, &entry, RunStreamPolicy::PI).map_err(|error| match error {
        RunStreamSendError::Event(error) => format!("Replay Pi Agent stream event: {error}"),
        RunStreamSendError::Cursor(error) => format!("Replay Pi Agent stream cursor: {error}"),
    })
}

fn finish_stream_subscriber_replay(
    request_id: &str,
    subscriber_id: u64,
    on_event: &Channel<PiAgentHostEvent>,
) -> Result<(), String> {
    loop {
        let step = {
            let mut streams = pi_run_streams_guard();
            let Some(state) = streams.get_mut(request_id) else {
                return Ok(());
            };
            state.core.next_pending(subscriber_id)
        };
        match step {
            RunStreamReplayStep::Event(entry) => {
                if let Err(error) = send_buffered_stream_event(on_event, entry) {
                    remove_stream_subscriber(request_id, subscriber_id);
                    return Err(error);
                }
            }
            RunStreamReplayStep::Overflowed => {
                return Err(PI_RUN_STREAM_REPLAY_OVERFLOW.into());
            }
            RunStreamReplayStep::Complete => return Ok(()),
        }
    }
}

fn next_replay_event(
    request_id: &str,
    cursor: u64,
    replay_through: u64,
) -> Result<Option<RunStreamBufferedEvent<PiAgentHostEvent>>, String> {
    if cursor >= replay_through {
        return Ok(None);
    }
    let streams = pi_run_streams_guard();
    let state = streams
        .get(request_id)
        .ok_or_else(|| format!("No live Pi Agent stream for request {request_id}"))?;
    state
        .core
        .next_replay_event_exact(cursor, replay_through)
        .map_err(|error| match error {
            RunStreamCursorError::Gap { expected_cursor } => format!(
                "Pi Agent stream replay gap at cursor {expected_cursor}; retry from the last durable cursor."
            ),
            RunStreamCursorError::Ahead { .. } => {
                unreachable!("next replay cursor cannot be ahead after the replay bound check")
            }
        })
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
        let replay_through = state.core.cursor();
        state
            .core
            .validate_replay_cursor(replay_after)
            .map_err(|error| match error {
                RunStreamCursorError::Ahead {
                    cursor,
                    live_cursor,
                } => format!(
                    "Pi Agent stream cursor {cursor} is ahead of live cursor {live_cursor}."
                ),
                RunStreamCursorError::Gap { .. } => format!(
                    "Pi Agent stream replay gap after cursor {replay_after}; retry from a retained durable cursor."
                ),
            })?;
        let subscriber_id = if state.terminal.is_none() {
            let subscriber_id = PI_STREAM_SUBSCRIBER_ID.fetch_add(1, Ordering::Relaxed);
            state
                .core
                .insert_subscriber(subscriber_id, on_event.clone(), true);
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
