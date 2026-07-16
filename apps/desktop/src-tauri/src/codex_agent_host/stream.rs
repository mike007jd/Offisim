use std::collections::{HashMap, VecDeque};
use std::sync::{Arc, Mutex};

use tauri::ipc::Channel;
use tokio::sync::Notify;

use super::types::{
    CodexAgentHostEvent, CodexAgentHostResponse, CodexExecutionProvenance, CodexModelSummary,
    CodexNativeThreadRef, CodexRunStreamSnapshot, CodexRunStreamTerminal,
};

const STREAM_BUFFER_LIMIT: usize = 4096;

#[derive(Clone)]
pub(super) enum RunOutcome {
    Completed(Box<CodexAgentHostResponse>),
    Interrupted(String),
    Failed(String),
}

impl RunOutcome {
    pub(super) fn status(&self) -> &'static str {
        match self {
            Self::Completed(_) => "completed",
            Self::Interrupted(_) => "interrupted",
            Self::Failed(_) => "failed",
        }
    }

    fn message(&self) -> Option<String> {
        match self {
            Self::Completed(_) => None,
            Self::Interrupted(message) | Self::Failed(message) => Some(message.clone()),
        }
    }
}

#[derive(Clone)]
pub(super) enum PendingInteractionKind {
    Command,
    FileChange,
    Permissions {
        requested_permissions: serde_json::Value,
    },
    UserInput {
        questions: Vec<PendingUserInputQuestion>,
    },
}

#[derive(Clone)]
pub(super) struct PendingUserInputQuestion {
    pub id: String,
}

#[derive(Clone)]
pub(super) struct PendingInteraction {
    pub native_request_id: serde_json::Value,
    pub kind: PendingInteractionKind,
    pub thread_id: String,
    pub turn_id: String,
}

#[derive(Clone)]
pub(super) struct RunMetadata {
    pub model: CodexModelSummary,
    pub provenance: CodexExecutionProvenance,
    pub native_thread_ref: CodexNativeThreadRef,
    pub expose_session: bool,
}

#[derive(Clone)]
struct BufferedEvent {
    cursor: u64,
    event: CodexAgentHostEvent,
}

struct StreamInner {
    next_cursor: u64,
    events: VecDeque<BufferedEvent>,
    subscribers: HashMap<u64, Channel<CodexAgentHostEvent>>,
    next_subscriber_id: u64,
    terminal: Option<RunOutcome>,
    workspace_declaration: Option<CodexAgentHostEvent>,
    metadata: Option<RunMetadata>,
    final_text: String,
    plan_text: String,
    reasoning: String,
    latest_usage: Option<serde_json::Value>,
    item_phases: HashMap<String, String>,
    pending_interactions: HashMap<String, PendingInteraction>,
    native_request_to_interaction: HashMap<String, String>,
    active_thread_id: Option<String>,
    active_turn_id: Option<String>,
}

pub(super) struct RunStream {
    request_id: String,
    inner: Mutex<StreamInner>,
    delivery_gate: Mutex<()>,
    terminal_notify: Notify,
}

impl RunStream {
    pub(super) fn new(
        request_id: String,
        initial_channel: Channel<CodexAgentHostEvent>,
    ) -> Arc<Self> {
        let mut subscribers = HashMap::new();
        subscribers.insert(1, initial_channel);
        Arc::new(Self {
            request_id,
            inner: Mutex::new(StreamInner {
                next_cursor: 1,
                events: VecDeque::new(),
                subscribers,
                next_subscriber_id: 2,
                terminal: None,
                workspace_declaration: None,
                metadata: None,
                final_text: String::new(),
                plan_text: String::new(),
                reasoning: String::new(),
                latest_usage: None,
                item_phases: HashMap::new(),
                pending_interactions: HashMap::new(),
                native_request_to_interaction: HashMap::new(),
                active_thread_id: None,
                active_turn_id: None,
            }),
            delivery_gate: Mutex::new(()),
            terminal_notify: Notify::new(),
        })
    }

    fn guard(&self) -> std::sync::MutexGuard<'_, StreamInner> {
        self.inner
            .lock()
            .unwrap_or_else(|_| panic!("codex_agent_host run stream poisoned"))
    }

    fn delivery_guard(&self) -> std::sync::MutexGuard<'_, ()> {
        self.delivery_gate
            .lock()
            .unwrap_or_else(|_| panic!("codex_agent_host delivery gate poisoned"))
    }

    pub(super) fn set_workspace_declaration(&self, event: CodexAgentHostEvent) {
        self.guard().workspace_declaration = Some(event.clone());
        self.publish(event);
    }

    pub(super) fn set_metadata(&self, metadata: RunMetadata) {
        let mut inner = self.guard();
        inner.active_thread_id = Some(metadata.native_thread_ref.thread_id.clone());
        inner.metadata = Some(metadata);
    }

    pub(super) fn prime_native_thread(&self, thread_id: &str) -> Result<(), String> {
        if thread_id.is_empty() {
            return Err("Codex returned an invalid thread reference.".into());
        }
        let mut inner = self.guard();
        if let Some(active) = inner.active_thread_id.as_deref() {
            if active != thread_id {
                return Err("Codex changed the active thread unexpectedly.".into());
            }
        }
        inner.active_thread_id = Some(thread_id.to_string());
        Ok(())
    }

    pub(super) fn prime_native_turn(&self, turn_id: &str) -> Result<(), String> {
        if turn_id.is_empty() {
            return Err("Codex returned an invalid turn reference.".into());
        }
        let mut inner = self.guard();
        if inner.active_thread_id.is_none() {
            return Err("Codex started a turn without an active thread.".into());
        }
        if let Some(active) = inner.active_turn_id.as_deref() {
            if active != turn_id {
                return Err("Codex changed the active turn unexpectedly.".into());
            }
        }
        inner.active_turn_id = Some(turn_id.to_string());
        Ok(())
    }

    pub(super) fn active_native_thread(&self) -> Option<String> {
        self.guard().active_thread_id.clone()
    }

    pub(super) fn active_native_scope(&self) -> Option<(String, String)> {
        let inner = self.guard();
        Some((
            inner.active_thread_id.clone()?,
            inner.active_turn_id.clone()?,
        ))
    }

    pub(super) fn publish(&self, event: CodexAgentHostEvent) -> u64 {
        let _delivery = self.delivery_guard();
        let (cursor, subscribers) = {
            let mut inner = self.guard();
            if inner.terminal.is_some() {
                return inner.next_cursor.saturating_sub(1);
            }
            let cursor = inner.next_cursor;
            inner.next_cursor = inner.next_cursor.saturating_add(1);
            inner.events.push_back(BufferedEvent {
                cursor,
                event: event.clone(),
            });
            while inner.events.len() > STREAM_BUFFER_LIMIT {
                inner.events.pop_front();
            }
            let subscribers = inner
                .subscribers
                .iter()
                .map(|(id, channel)| (*id, channel.clone()))
                .collect::<Vec<_>>();
            (cursor, subscribers)
        };

        let mut dead = Vec::new();
        for (id, channel) in subscribers {
            if channel.send(event.clone()).is_err()
                || channel
                    .send(CodexAgentHostEvent::StreamCursor { cursor })
                    .is_err()
            {
                dead.push(id);
            }
        }
        if !dead.is_empty() {
            let mut inner = self.guard();
            for id in dead {
                inner.subscribers.remove(&id);
            }
        }
        cursor
    }

    pub(super) fn snapshot(&self) -> CodexRunStreamSnapshot {
        let inner = self.guard();
        CodexRunStreamSnapshot {
            request_id: self.request_id.clone(),
            running: inner.terminal.is_none(),
            cursor: inner.next_cursor.saturating_sub(1),
            buffered: inner.events.len(),
            terminal: inner
                .terminal
                .as_ref()
                .map(|outcome| CodexRunStreamTerminal {
                    status: outcome.status().to_string(),
                    message: outcome.message(),
                }),
        }
    }

    pub(super) fn reattach(
        &self,
        after_cursor: Option<u64>,
        channel: Channel<CodexAgentHostEvent>,
    ) -> Result<CodexRunStreamSnapshot, String> {
        let _delivery = self.delivery_guard();
        let mut inner = self.guard();
        let after_cursor = after_cursor.unwrap_or(0);
        if let Some(first) = inner.events.front() {
            if after_cursor > 0 && after_cursor.saturating_add(1) < first.cursor {
                return Err(
                    "Codex stream replay exceeded its bounded buffer; resume from durable state."
                        .into(),
                );
            }
        }
        let replay_workspace_separately = inner.workspace_declaration.is_some();
        if let Some(workspace) = inner.workspace_declaration.clone() {
            channel
                .send(workspace)
                .map_err(|_| "Codex stream reattach channel is closed.".to_string())?;
        }
        for entry in inner
            .events
            .iter()
            .filter(|entry| entry.cursor > after_cursor)
        {
            if replay_workspace_separately
                && matches!(
                    entry.event,
                    CodexAgentHostEvent::WorkspaceBound { .. }
                        | CodexAgentHostEvent::WorkspaceUnavailable { .. }
                )
            {
                continue;
            }
            send_buffered_entry(&channel, entry)
                .map_err(|_| "Codex stream reattach channel is closed.".to_string())?;
        }
        if inner.terminal.is_none() {
            let subscriber_id = inner.next_subscriber_id;
            inner.next_subscriber_id = inner.next_subscriber_id.saturating_add(1);
            inner.subscribers.insert(subscriber_id, channel);
        }
        Ok(CodexRunStreamSnapshot {
            request_id: self.request_id.clone(),
            running: inner.terminal.is_none(),
            cursor: inner.next_cursor.saturating_sub(1),
            buffered: inner.events.len(),
            terminal: inner
                .terminal
                .as_ref()
                .map(|outcome| CodexRunStreamTerminal {
                    status: outcome.status().to_string(),
                    message: outcome.message(),
                }),
        })
    }

    pub(super) fn record_item_phase(&self, item_id: &str, phase: Option<&str>) {
        if let Some(phase) = phase {
            self.guard()
                .item_phases
                .insert(item_id.to_string(), phase.to_string());
        }
    }

    pub(super) fn append_message_delta(&self, item_id: &str, delta: &str) -> String {
        let mut inner = self.guard();
        let phase = inner
            .item_phases
            .get(item_id)
            .cloned()
            .unwrap_or_else(|| "final_answer".into());
        if phase == "final_answer" {
            inner.final_text.push_str(delta);
        }
        phase
    }

    pub(super) fn set_completed_message(&self, item_id: &str, text: &str) {
        let mut inner = self.guard();
        if inner
            .item_phases
            .get(item_id)
            .map(String::as_str)
            .unwrap_or("final_answer")
            == "final_answer"
        {
            inner.final_text.clear();
            inner.final_text.push_str(text);
        }
    }

    pub(super) fn append_plan_delta(&self, delta: &str) {
        self.guard().plan_text.push_str(delta);
    }

    pub(super) fn set_completed_plan(&self, text: &str) {
        let mut inner = self.guard();
        inner.plan_text.clear();
        inner.plan_text.push_str(text);
    }

    pub(super) fn append_reasoning(&self, delta: &str) {
        self.guard().reasoning.push_str(delta);
    }

    pub(super) fn set_usage(&self, usage: serde_json::Value) {
        self.guard().latest_usage = Some(usage);
    }

    pub(super) fn insert_pending_interaction(
        &self,
        interaction_id: String,
        native_request_key: String,
        interaction: PendingInteraction,
    ) -> Result<(), String> {
        let mut inner = self.guard();
        if inner.terminal.is_some() {
            return Err("Codex turn is no longer awaiting user interaction.".into());
        }
        if inner.pending_interactions.contains_key(&interaction_id)
            || inner
                .native_request_to_interaction
                .contains_key(&native_request_key)
        {
            return Err("Codex user interaction was duplicated.".into());
        }
        inner
            .native_request_to_interaction
            .insert(native_request_key, interaction_id.clone());
        inner
            .pending_interactions
            .insert(interaction_id, interaction);
        Ok(())
    }

    pub(super) fn pending_interaction(&self, interaction_id: &str) -> Option<PendingInteraction> {
        self.guard()
            .pending_interactions
            .get(interaction_id)
            .cloned()
    }

    pub(super) fn take_pending_interaction(
        &self,
        interaction_id: &str,
    ) -> Option<PendingInteraction> {
        let mut inner = self.guard();
        let interaction = inner.pending_interactions.remove(interaction_id);
        if let Some(interaction) = interaction.as_ref() {
            inner
                .native_request_to_interaction
                .remove(&native_request_key(&interaction.native_request_id));
        }
        interaction
    }

    pub(super) fn resolve_native_request(
        &self,
        native_request_id: &serde_json::Value,
    ) -> Option<(String, PendingInteraction)> {
        let mut inner = self.guard();
        let key = native_request_key(native_request_id);
        if let Some(interaction_id) = inner.native_request_to_interaction.remove(&key) {
            return inner
                .pending_interactions
                .remove(&interaction_id)
                .map(|interaction| (interaction_id, interaction));
        }
        None
    }

    pub(super) fn terminal_outcome(&self) -> Option<RunOutcome> {
        self.guard().terminal.clone()
    }

    pub(super) async fn wait_outcome(&self) -> RunOutcome {
        loop {
            if let Some(outcome) = self.terminal_outcome() {
                return outcome;
            }
            let notified = self.terminal_notify.notified();
            if let Some(outcome) = self.terminal_outcome() {
                return outcome;
            }
            notified.await;
        }
    }

    pub(super) fn finish_completed(&self) -> Option<CodexAgentHostResponse> {
        let _delivery = self.delivery_guard();
        let (response, terminal_events, subscribers) = {
            let mut inner = self.guard();
            if inner.terminal.is_some() {
                return None;
            }
            let metadata = inner.metadata.clone()?;
            let session_id = if metadata.expose_session {
                Some(opaque_session_id(&metadata.native_thread_ref).ok()?)
            } else {
                None
            };
            // The completed native Plan item is authoritative and deliberately
            // excludes Codex's internal <proposed_plan> transport wrapper. In
            // Plan mode it is the user-facing answer; ordinary turns continue
            // to use the completed final assistant message.
            let text = if inner.plan_text.trim().is_empty() {
                inner.final_text.clone()
            } else {
                inner.plan_text.clone()
            };
            let response = CodexAgentHostResponse {
                text,
                reasoning: (!inner.reasoning.is_empty()).then(|| inner.reasoning.clone()),
                session_id,
                session_file: None,
                model: Some(metadata.model),
                provenance: Some(metadata.provenance),
                usage: inner.latest_usage.clone(),
                budget_usage: None,
            };
            let events = vec![
                CodexAgentHostEvent::MessageEnd {
                    text: response.text.clone(),
                    stop_reason: Some("completed".into()),
                    error_message: None,
                },
                CodexAgentHostEvent::Result {
                    response: Box::new(response.clone()),
                },
            ];
            let (events, subscribers) = terminalize_locked(
                &mut inner,
                RunOutcome::Completed(Box::new(response.clone())),
                events,
            );
            (response, events, subscribers)
        };
        deliver_terminal_events(terminal_events, subscribers);
        self.terminal_notify.notify_waiters();
        Some(response)
    }

    pub(super) fn finish_interrupted(&self, message: impl Into<String>) -> bool {
        let _delivery = self.delivery_guard();
        let message = message.into();
        let (terminal_events, subscribers) = {
            let mut inner = self.guard();
            if inner.terminal.is_some() {
                return false;
            }
            let events = vec![CodexAgentHostEvent::MessageEnd {
                text: inner.final_text.clone(),
                stop_reason: Some("interrupted".into()),
                error_message: None,
            }];
            terminalize_locked(&mut inner, RunOutcome::Interrupted(message), events)
        };
        deliver_terminal_events(terminal_events, subscribers);
        self.terminal_notify.notify_waiters();
        true
    }

    pub(super) fn finish_failed(&self, code: &str, message: impl Into<String>) -> bool {
        let _delivery = self.delivery_guard();
        let message = message.into();
        let (terminal_events, subscribers) = {
            let mut inner = self.guard();
            if inner.terminal.is_some() {
                return false;
            }
            let events = vec![CodexAgentHostEvent::Error {
                code: code.to_string(),
                message: message.clone(),
            }];
            terminalize_locked(&mut inner, RunOutcome::Failed(message), events)
        };
        deliver_terminal_events(terminal_events, subscribers);
        self.terminal_notify.notify_waiters();
        true
    }
}

fn terminalize_locked(
    inner: &mut StreamInner,
    outcome: RunOutcome,
    events: Vec<CodexAgentHostEvent>,
) -> (Vec<BufferedEvent>, Vec<Channel<CodexAgentHostEvent>>) {
    let mut terminal_events = Vec::with_capacity(events.len());
    for event in events {
        let buffered = BufferedEvent {
            cursor: inner.next_cursor,
            event,
        };
        inner.next_cursor = inner.next_cursor.saturating_add(1);
        inner.events.push_back(buffered.clone());
        terminal_events.push(buffered);
    }
    while inner.events.len() > STREAM_BUFFER_LIMIT {
        inner.events.pop_front();
    }
    // This transition is deliberately inside the same critical section as the
    // terminal events. A racing native delta either lands before this sequence
    // or is rejected by `publish`; it can never appear after terminal output.
    inner.terminal = Some(outcome);
    inner.pending_interactions.clear();
    inner.native_request_to_interaction.clear();
    let subscribers = std::mem::take(&mut inner.subscribers)
        .into_values()
        .collect();
    (terminal_events, subscribers)
}

fn deliver_terminal_events(
    events: Vec<BufferedEvent>,
    subscribers: Vec<Channel<CodexAgentHostEvent>>,
) {
    for channel in subscribers {
        for entry in &events {
            if send_buffered_entry(&channel, entry).is_err() {
                break;
            }
        }
    }
}

fn send_buffered_entry(
    channel: &Channel<CodexAgentHostEvent>,
    entry: &BufferedEvent,
) -> Result<(), ()> {
    let cursor = CodexAgentHostEvent::StreamCursor {
        cursor: entry.cursor,
    };
    if is_terminal_event(&entry.event) {
        channel.send(cursor).map_err(|_| ())?;
        channel.send(entry.event.clone()).map_err(|_| ())
    } else {
        channel.send(entry.event.clone()).map_err(|_| ())?;
        channel.send(cursor).map_err(|_| ())
    }
}

fn is_terminal_event(event: &CodexAgentHostEvent) -> bool {
    matches!(
        event,
        CodexAgentHostEvent::MessageEnd { .. }
            | CodexAgentHostEvent::Result { .. }
            | CodexAgentHostEvent::Error { .. }
    )
}

pub(super) fn opaque_session_id(native: &CodexNativeThreadRef) -> Result<String, String> {
    serde_json::to_string(native)
        .map_err(|_| "Encode Codex continuation reference failed.".to_string())
}

pub(super) fn native_request_key(value: &serde_json::Value) -> String {
    match value {
        serde_json::Value::String(value) => format!("s:{value}"),
        serde_json::Value::Number(value) => format!("n:{value}"),
        _ => "invalid".into(),
    }
}

#[cfg(test)]
mod tests {
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::sync::{Arc, Barrier};
    use std::time::Duration;

    use super::*;

    fn test_stream() -> Arc<RunStream> {
        RunStream::new("request".into(), Channel::new(|_body| Ok(())))
    }

    #[test]
    fn completed_native_plan_is_the_authoritative_user_facing_answer() {
        let stream = test_stream();
        stream.set_metadata(RunMetadata {
            model: CodexModelSummary {
                provider: None,
                id: Some("gpt-5.4".into()),
                name: Some("GPT-5.4".into()),
                api: Some("codex-app-server".into()),
                reasoning: Some(true),
                context_window: None,
                max_tokens: None,
                input: vec!["text".into()],
                catalog_id: Some("gpt-5.4-high".into()),
            },
            provenance: CodexExecutionProvenance {
                engine_id: "codex".into(),
                account_id: "account".into(),
                billing_mode: "subscription".into(),
                model_id: "gpt-5.4".into(),
                model_source: super::super::types::CodexModelSource {
                    kind: "native".into(),
                    source_url: None,
                    checked_at: None,
                },
                run_id: "run".into(),
                adapter: super::super::types::CodexAdapterIdentity {
                    id: "codex-app-server".into(),
                    version: "0.144.4".into(),
                },
                requested_model_id: Some("gpt-5.4".into()),
                actual_model_id: Some("gpt-5.4".into()),
            },
            native_thread_ref: CodexNativeThreadRef {
                protocol: "codex-app-server".into(),
                thread_id: "thread".into(),
                session_id: "session".into(),
            },
            expose_session: true,
        });
        stream.append_plan_delta("draft");
        stream.set_completed_message("message", "wrapper copy");
        stream.set_completed_plan("# Plan\n\n1. Inspect\n2. Report");
        let response = stream.finish_completed().unwrap();
        assert_eq!(response.text, "# Plan\n\n1. Inspect\n2. Report");
        assert!(!response.text.contains("proposed_plan"));
    }

    #[test]
    fn late_native_output_is_rejected_after_user_stop() {
        let stream = test_stream();
        assert!(stream.finish_interrupted("user stop"));
        let terminal_cursor = stream.snapshot().cursor;
        stream.publish(CodexAgentHostEvent::MessageDelta {
            delta: "late".into(),
            channel: Some("final".into()),
        });
        assert_eq!(stream.snapshot().cursor, terminal_cursor);
        assert!(matches!(
            stream.terminal_outcome(),
            Some(RunOutcome::Interrupted(_))
        ));
        assert!(stream.finish_completed().is_none());
        assert!(matches!(
            stream.terminal_outcome(),
            Some(RunOutcome::Interrupted(_))
        ));
    }

    #[test]
    fn racing_delta_can_only_land_before_atomic_terminal_sequence() {
        let stream = test_stream();
        let barrier = Arc::new(Barrier::new(2));
        let publisher = Arc::clone(&stream);
        let publisher_barrier = Arc::clone(&barrier);
        let publish_thread = std::thread::spawn(move || {
            publisher_barrier.wait();
            for index in 0..200 {
                publisher.publish(CodexAgentHostEvent::MessageDelta {
                    delta: index.to_string(),
                    channel: Some("final".into()),
                });
            }
        });
        barrier.wait();
        stream.finish_interrupted("user stop");
        publish_thread.join().unwrap();

        let inner = stream.guard();
        let terminal_index = inner
            .events
            .iter()
            .position(|entry| {
                matches!(
                    entry.event,
                    CodexAgentHostEvent::MessageEnd {
                        stop_reason: Some(ref reason),
                        ..
                    } if reason == "interrupted"
                )
            })
            .expect("terminal message is buffered");
        assert_eq!(terminal_index + 1, inner.events.len());
        assert!(matches!(inner.terminal, Some(RunOutcome::Interrupted(_))));
    }

    #[test]
    fn publish_delivery_cannot_arrive_after_terminal_delivery() {
        let delivered = Arc::new(Mutex::new(Vec::<serde_json::Value>::new()));
        let entered = Arc::new(Barrier::new(2));
        let release = Arc::new(Barrier::new(2));
        let blocked = Arc::new(AtomicBool::new(false));
        let delivered_for_channel = Arc::clone(&delivered);
        let entered_for_channel = Arc::clone(&entered);
        let release_for_channel = Arc::clone(&release);
        let blocked_for_channel = Arc::clone(&blocked);
        let channel = Channel::new(move |body| {
            let event: serde_json::Value = body.deserialize().unwrap();
            if event["kind"] == "messageDelta" && !blocked_for_channel.swap(true, Ordering::AcqRel)
            {
                entered_for_channel.wait();
                release_for_channel.wait();
            }
            delivered_for_channel.lock().unwrap().push(event);
            Ok(())
        });
        let stream = RunStream::new("request".into(), channel);
        let publisher = Arc::clone(&stream);
        let publish_thread = std::thread::spawn(move || {
            publisher.publish(CodexAgentHostEvent::MessageDelta {
                delta: "before-stop".into(),
                channel: Some("final".into()),
            });
        });
        entered.wait();
        let finisher = Arc::clone(&stream);
        let finish_thread = std::thread::spawn(move || {
            finisher.finish_interrupted("user stop");
        });
        std::thread::sleep(Duration::from_millis(20));
        release.wait();
        publish_thread.join().unwrap();
        finish_thread.join().unwrap();

        let events = delivered.lock().unwrap();
        let terminal_index = events
            .iter()
            .position(|event| event["kind"] == "messageEnd" && event["stopReason"] == "interrupted")
            .expect("terminal event delivered");
        assert!(events[terminal_index + 1..].iter().all(|event| {
            !matches!(
                event["kind"].as_str(),
                Some("messageDelta" | "tool" | "streamCursor")
            )
        }));
    }

    #[test]
    fn native_resolution_atomically_clears_the_matching_pending_interaction() {
        let stream = test_stream();
        let native_request_id = serde_json::json!("native-request-1");
        stream
            .insert_pending_interaction(
                "interaction-1".into(),
                native_request_key(&native_request_id),
                PendingInteraction {
                    native_request_id: native_request_id.clone(),
                    kind: PendingInteractionKind::UserInput {
                        questions: vec![PendingUserInputQuestion { id: "scope".into() }],
                    },
                    thread_id: "thread-1".into(),
                    turn_id: "turn-1".into(),
                },
            )
            .unwrap();

        let (interaction_id, interaction) = stream
            .resolve_native_request(&native_request_id)
            .expect("native request resolves once");
        assert_eq!(interaction_id, "interaction-1");
        assert_eq!(interaction.thread_id, "thread-1");
        assert!(stream.pending_interaction("interaction-1").is_none());
        assert!(stream.resolve_native_request(&native_request_id).is_none());
    }
}
