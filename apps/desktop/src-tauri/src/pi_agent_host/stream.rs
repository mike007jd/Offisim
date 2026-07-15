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
const PI_RUN_STREAM_BUFFER_BYTE_LIMIT: usize = 8 * 1024 * 1024;
pub(super) const PI_RUN_STREAM_TERMINAL_TTL: Duration = Duration::from_secs(30 * 60);
pub(super) fn pi_run_streams_guard(
) -> std::sync::MutexGuard<'static, HashMap<String, PiRunStreamState>> {
    PI_RUN_STREAMS
        .lock()
        .unwrap_or_else(|_| panic!("pi_agent_host PI_RUN_STREAMS poisoned"))
}

pub(super) struct PiRunStreamState {
    next_cursor: u64,
    pub(super) events: VecDeque<PiRunStreamBufferedEvent>,
    buffered_bytes: usize,
    subscribers: HashMap<u64, PiRunStreamSubscriber>,
    terminal: Option<PiRunStreamTerminal>,
    finished_at: Option<Instant>,
    active_reattaches: usize,
    release_pending: bool,
}

struct PiRunStreamSubscriber {
    channel: Channel<PiAgentHostEvent>,
    replaying: bool,
    pending: VecDeque<PiRunStreamBufferedEvent>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct PiRunStreamBufferedEvent {
    pub(super) cursor: u64,
    event: PiAgentHostEvent,
    #[serde(skip)]
    byte_len: usize,
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
            buffered_bytes: 0,
            subscribers: HashMap::new(),
            terminal: None,
            finished_at: None,
            active_reattaches: 0,
            release_pending: false,
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
        // A renderer Channel callback can synchronously invoke another Tauri
        // command. Keep a terminal stream alive while reattach is replaying so
        // cleanup cannot invalidate the final snapshot lookup.
        if state.active_reattaches > 0 {
            return true;
        }
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
        // A subscriber still replaying history owns a small ordered catch-up
        // queue. Retain it until that queue drains; ready live subscribers need
        // no more events once the terminal was published.
        state
            .subscribers
            .retain(|_, subscriber| subscriber.replaying);
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
        let byte_len = serde_json::to_vec(&event)
            .map_err(|err| {
                HostError::Protocol(format!("Serialize Pi Agent stream replay event: {err}"))
            })?
            .len();
        let mut streams = pi_run_streams_guard();
        let state = streams
            .entry(request_id.to_string())
            .or_insert_with(PiRunStreamState::new);
        let cursor = state.next_cursor;
        state.next_cursor = state.next_cursor.saturating_add(1);
        let buffered_event = PiRunStreamBufferedEvent {
            cursor,
            event: event.clone(),
            byte_len,
        };
        state.buffered_bytes += byte_len;
        state.events.push_back(buffered_event.clone());
        while state.events.len() > 1
            && (state.events.len() > PI_RUN_STREAM_BUFFER_LIMIT
                || state.buffered_bytes > PI_RUN_STREAM_BUFFER_BYTE_LIMIT)
        {
            if let Some(evicted) = state.events.pop_front() {
                state.buffered_bytes -= evicted.byte_len;
            }
        }
        stream_cursor = Some(cursor);
        for (id, subscriber) in &mut state.subscribers {
            if subscriber.replaying {
                subscriber.pending.push_back(buffered_event.clone());
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

pub(super) fn stream_snapshot(request_id: String) -> Result<Option<PiRunStreamSnapshot>, String> {
    cleanup_terminal_run_streams(Instant::now());
    Ok(pi_run_streams_guard()
        .get(&request_id)
        .map(|state| state.snapshot(&request_id)))
}

pub(super) fn release_stream(request_id: String) -> Result<(), String> {
    let mut streams = pi_run_streams_guard();
    let Some(state) = streams.get_mut(&request_id) else {
        return Ok(());
    };
    if state.terminal.is_none() {
        return Ok(());
    }
    if state.active_reattaches > 0 {
        state.release_pending = true;
    } else {
        streams.remove(&request_id);
    }
    Ok(())
}

struct PiRunStreamReattachPin {
    request_id: String,
    active: bool,
}

impl PiRunStreamReattachPin {
    fn new(request_id: &str) -> Self {
        Self {
            request_id: request_id.to_string(),
            active: true,
        }
    }

    fn snapshot_and_release(mut self) -> Result<PiRunStreamSnapshot, String> {
        let snapshot = release_reattach_pin(&self.request_id, true)?
            .ok_or_else(|| format!("No live Pi Agent stream for request {}", self.request_id))?;
        self.active = false;
        Ok(snapshot)
    }
}

impl Drop for PiRunStreamReattachPin {
    fn drop(&mut self) {
        if self.active {
            let _ = release_reattach_pin(&self.request_id, false);
        }
    }
}

fn release_reattach_pin(
    request_id: &str,
    capture_snapshot: bool,
) -> Result<Option<PiRunStreamSnapshot>, String> {
    let mut streams = pi_run_streams_guard();
    let (snapshot, should_remove) = {
        let state = streams
            .get_mut(request_id)
            .ok_or_else(|| format!("No live Pi Agent stream for request {request_id}"))?;
        if state.active_reattaches == 0 {
            return Err(format!(
                "Pi Agent stream reattach pin underflow for request {request_id}"
            ));
        }
        let snapshot = capture_snapshot.then(|| state.snapshot(request_id));
        state.active_reattaches -= 1;
        let should_remove =
            state.active_reattaches == 0 && state.release_pending && state.terminal.is_some();
        (snapshot, should_remove)
    };
    if should_remove {
        streams.remove(request_id);
    }
    Ok(snapshot)
}

pub(super) fn reattach_stream(
    request_id: String,
    after_cursor: Option<u64>,
    on_event: Channel<PiAgentHostEvent>,
) -> Result<PiRunStreamSnapshot, String> {
    let replay_after = after_cursor.unwrap_or(0);
    let (replay, subscriber_id) = {
        let mut streams = pi_run_streams_guard();
        cleanup_terminal_run_streams_locked(&mut streams, Instant::now());
        let state = streams
            .get_mut(&request_id)
            .ok_or_else(|| format!("No live Pi Agent stream for request {request_id}"))?;
        if let Some(first_retained_cursor) = state.events.front().map(|entry| entry.cursor) {
            if first_retained_cursor > replay_after.saturating_add(1) {
                return Err(format!(
                    "Pi Agent stream replay gap for request {request_id}: renderer cursor \
                     {replay_after}, first retained cursor {first_retained_cursor}"
                ));
            }
        }
        let replay = state
            .events
            .iter()
            .filter(|entry| entry.cursor > replay_after)
            .cloned()
            .collect::<Vec<_>>();
        let subscriber_id = if state.terminal.is_none() {
            let subscriber_id = PI_STREAM_SUBSCRIBER_ID.fetch_add(1, Ordering::Relaxed);
            state.subscribers.insert(
                subscriber_id,
                PiRunStreamSubscriber {
                    channel: on_event.clone(),
                    replaying: true,
                    pending: VecDeque::new(),
                },
            );
            Some(subscriber_id)
        } else {
            None
        };
        state.active_reattaches += 1;
        (replay, subscriber_id)
    };
    let reattach_pin = PiRunStreamReattachPin::new(&request_id);

    let send_entries = |entries: Vec<PiRunStreamBufferedEvent>| -> Result<(), String> {
        for entry in entries {
            let cursor = entry.cursor;
            on_event
                .send(entry.event)
                .map_err(|err| format!("Replay Pi Agent stream event: {err}"))?;
            on_event
                .send(PiAgentHostEvent::StreamCursor { cursor })
                .map_err(|err| format!("Replay Pi Agent stream cursor: {err}"))?;
        }
        Ok(())
    };

    if let Err(err) = send_entries(replay) {
        if let Some(subscriber_id) = subscriber_id {
            if let Some(state) = pi_run_streams_guard().get_mut(&request_id) {
                state.subscribers.remove(&subscriber_id);
            }
        }
        return Err(err);
    }

    if let Some(subscriber_id) = subscriber_id {
        loop {
            let pending = {
                let mut streams = pi_run_streams_guard();
                let state = streams
                    .get_mut(&request_id)
                    .ok_or_else(|| format!("No live Pi Agent stream for request {request_id}"))?;
                let Some(subscriber) = state.subscribers.get_mut(&subscriber_id) else {
                    break;
                };
                if subscriber.pending.is_empty() {
                    if state.terminal.is_some() {
                        state.subscribers.remove(&subscriber_id);
                    } else {
                        subscriber.replaying = false;
                    }
                    break;
                }
                subscriber.pending.drain(..).collect::<Vec<_>>()
            };
            if let Err(err) = send_entries(pending) {
                if let Some(state) = pi_run_streams_guard().get_mut(&request_id) {
                    state.subscribers.remove(&subscriber_id);
                }
                return Err(err);
            }
        }
    }
    // Terminal state can change while replay callbacks are running (notably a
    // concurrent Stop/abort). Return a snapshot taken only after the replay and
    // pending-live drain, otherwise the renderer can receive `running: true`
    // even though this same stream has already become terminal.
    reattach_pin.snapshot_and_release()
}
