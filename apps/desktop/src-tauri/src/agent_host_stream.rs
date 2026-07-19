use std::collections::{HashMap, VecDeque};

use serde::Serialize;
use tauri::ipc::Channel;

pub(crate) const RUN_STREAM_BUFFER_LIMIT: usize = 4096;

pub(crate) trait RunStreamEvent: Clone + Serialize {
    fn stream_cursor(cursor: u64) -> Self;
    fn is_terminal(&self) -> bool;
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum ReplayConcurrencyPolicy {
    BoundedPendingFailClosed,
    SerializedDelivery,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum CursorValidationPolicy {
    Strict,
    CodexExisting,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum TerminalDeliveryPolicy {
    EventFirst,
    CursorBeforeTerminal,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum PostTerminalPublishPolicy {
    Allow,
    Reject,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum TerminalSubscriberPolicy {
    RetainReplaying,
    DrainAll,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) struct RunStreamPolicy {
    replay_concurrency: ReplayConcurrencyPolicy,
    cursor_validation: CursorValidationPolicy,
    terminal_delivery: TerminalDeliveryPolicy,
    post_terminal_publish: PostTerminalPublishPolicy,
    terminal_subscribers: TerminalSubscriberPolicy,
}

impl RunStreamPolicy {
    pub(crate) const PI: Self = Self {
        replay_concurrency: ReplayConcurrencyPolicy::BoundedPendingFailClosed,
        cursor_validation: CursorValidationPolicy::Strict,
        terminal_delivery: TerminalDeliveryPolicy::EventFirst,
        post_terminal_publish: PostTerminalPublishPolicy::Allow,
        terminal_subscribers: TerminalSubscriberPolicy::RetainReplaying,
    };

    pub(crate) const CODEX: Self = Self {
        replay_concurrency: ReplayConcurrencyPolicy::SerializedDelivery,
        cursor_validation: CursorValidationPolicy::CodexExisting,
        terminal_delivery: TerminalDeliveryPolicy::CursorBeforeTerminal,
        post_terminal_publish: PostTerminalPublishPolicy::Reject,
        terminal_subscribers: TerminalSubscriberPolicy::DrainAll,
    };
}

#[derive(Clone)]
pub(crate) struct RunStreamBufferedEvent<E> {
    pub(crate) cursor: u64,
    pub(crate) event: E,
}

struct RunStreamSubscriber<E> {
    channel: Channel<E>,
    replaying: bool,
    pending: VecDeque<RunStreamBufferedEvent<E>>,
    overflowed: bool,
}

pub(crate) struct RunStreamPublish<E> {
    pub(crate) cursor: u64,
    pub(crate) entry: Option<RunStreamBufferedEvent<E>>,
    pub(crate) subscribers: Vec<(u64, Channel<E>)>,
}

pub(crate) enum RunStreamReplayStep<E> {
    Event(RunStreamBufferedEvent<E>),
    Overflowed,
    Complete,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum RunStreamCursorError {
    Ahead { cursor: u64, live_cursor: u64 },
    Gap { expected_cursor: u64 },
}

pub(crate) enum RunStreamSendError {
    Event(String),
    Cursor(String),
}

pub(crate) struct RunStreamCore<E: RunStreamEvent> {
    next_cursor: u64,
    events: VecDeque<RunStreamBufferedEvent<E>>,
    subscribers: HashMap<u64, RunStreamSubscriber<E>>,
    terminal: bool,
    policy: RunStreamPolicy,
}

impl<E: RunStreamEvent> RunStreamCore<E> {
    pub(crate) fn new(policy: RunStreamPolicy) -> Self {
        Self {
            next_cursor: 1,
            events: VecDeque::new(),
            subscribers: HashMap::new(),
            terminal: false,
            policy,
        }
    }

    pub(crate) fn cursor(&self) -> u64 {
        self.next_cursor.saturating_sub(1)
    }

    pub(crate) fn buffered(&self) -> usize {
        self.events.len()
    }

    pub(crate) fn publish(&mut self, event: E) -> RunStreamPublish<E> {
        if self.terminal && self.policy.post_terminal_publish == PostTerminalPublishPolicy::Reject {
            return RunStreamPublish {
                cursor: self.cursor(),
                entry: None,
                subscribers: Vec::new(),
            };
        }

        let entry = self.buffer_event(event);
        let mut subscribers = Vec::new();
        for (id, subscriber) in &mut self.subscribers {
            if subscriber.replaying {
                if !subscriber.overflowed {
                    if subscriber.pending.len() >= RUN_STREAM_BUFFER_LIMIT {
                        subscriber.pending.clear();
                        subscriber.overflowed = true;
                    } else {
                        subscriber.pending.push_back(entry.clone());
                    }
                }
            } else {
                subscribers.push((*id, subscriber.channel.clone()));
            }
        }
        RunStreamPublish {
            cursor: entry.cursor,
            entry: Some(entry),
            subscribers,
        }
    }

    pub(crate) fn buffer_events(
        &mut self,
        events: impl IntoIterator<Item = E>,
    ) -> Vec<RunStreamBufferedEvent<E>> {
        events
            .into_iter()
            .map(|event| self.buffer_event(event))
            .collect()
    }

    pub(crate) fn mark_terminal(&mut self) -> Vec<Channel<E>> {
        self.terminal = true;
        match self.policy.terminal_subscribers {
            TerminalSubscriberPolicy::RetainReplaying => {
                self.subscribers
                    .retain(|_, subscriber| subscriber.replaying);
                Vec::new()
            }
            TerminalSubscriberPolicy::DrainAll => std::mem::take(&mut self.subscribers)
                .into_values()
                .map(|subscriber| subscriber.channel)
                .collect(),
        }
    }

    pub(crate) fn insert_subscriber(
        &mut self,
        subscriber_id: u64,
        channel: Channel<E>,
        replaying: bool,
    ) {
        debug_assert!(
            !replaying
                || self.policy.replay_concurrency
                    == ReplayConcurrencyPolicy::BoundedPendingFailClosed,
            "serialized stream subscribers must be registered after replay"
        );
        self.subscribers.insert(
            subscriber_id,
            RunStreamSubscriber {
                channel,
                replaying,
                pending: VecDeque::new(),
                overflowed: false,
            },
        );
    }

    pub(crate) fn remove_subscriber(&mut self, subscriber_id: u64) {
        self.subscribers.remove(&subscriber_id);
    }

    pub(crate) fn next_pending(&mut self, subscriber_id: u64) -> RunStreamReplayStep<E> {
        let Some(subscriber) = self.subscribers.get(&subscriber_id) else {
            return RunStreamReplayStep::Complete;
        };
        if subscriber.overflowed {
            self.subscribers.remove(&subscriber_id);
            return RunStreamReplayStep::Overflowed;
        }
        if let Some(entry) = self
            .subscribers
            .get_mut(&subscriber_id)
            .and_then(|subscriber| subscriber.pending.pop_front())
        {
            return RunStreamReplayStep::Event(entry);
        }
        if self.terminal {
            self.subscribers.remove(&subscriber_id);
        } else if let Some(subscriber) = self.subscribers.get_mut(&subscriber_id) {
            subscriber.replaying = false;
        }
        RunStreamReplayStep::Complete
    }

    pub(crate) fn validate_replay_cursor(
        &self,
        after_cursor: u64,
    ) -> Result<(), RunStreamCursorError> {
        let live_cursor = self.cursor();
        match self.policy.cursor_validation {
            CursorValidationPolicy::Strict => {
                if after_cursor > live_cursor {
                    return Err(RunStreamCursorError::Ahead {
                        cursor: after_cursor,
                        live_cursor,
                    });
                }
                if after_cursor < live_cursor
                    && self
                        .events
                        .front()
                        .is_none_or(|entry| entry.cursor > after_cursor.saturating_add(1))
                {
                    return Err(RunStreamCursorError::Gap {
                        expected_cursor: after_cursor.saturating_add(1),
                    });
                }
            }
            CursorValidationPolicy::CodexExisting => {
                if let Some(first) = self.events.front() {
                    if after_cursor > 0 && after_cursor.saturating_add(1) < first.cursor {
                        return Err(RunStreamCursorError::Gap {
                            expected_cursor: after_cursor.saturating_add(1),
                        });
                    }
                }
            }
        }
        Ok(())
    }

    pub(crate) fn replay_entries_after(
        &self,
        after_cursor: u64,
    ) -> impl Iterator<Item = &RunStreamBufferedEvent<E>> {
        self.events
            .iter()
            .filter(move |entry| entry.cursor > after_cursor)
    }

    pub(crate) fn next_replay_event_exact(
        &self,
        cursor: u64,
        replay_through: u64,
    ) -> Result<Option<RunStreamBufferedEvent<E>>, RunStreamCursorError> {
        if cursor >= replay_through {
            return Ok(None);
        }
        let expected_cursor = cursor.saturating_add(1);
        self.events
            .iter()
            .find(|entry| entry.cursor == expected_cursor)
            .cloned()
            .map(Some)
            .ok_or(RunStreamCursorError::Gap { expected_cursor })
    }

    #[cfg(test)]
    pub(crate) fn events(&self) -> &VecDeque<RunStreamBufferedEvent<E>> {
        &self.events
    }

    #[cfg(test)]
    pub(crate) fn subscriber_count(&self) -> usize {
        self.subscribers.len()
    }

    fn buffer_event(&mut self, event: E) -> RunStreamBufferedEvent<E> {
        let entry = RunStreamBufferedEvent {
            cursor: self.next_cursor,
            event,
        };
        self.next_cursor = self.next_cursor.saturating_add(1);
        self.events.push_back(entry.clone());
        while self.events.len() > RUN_STREAM_BUFFER_LIMIT {
            self.events.pop_front();
        }
        entry
    }
}

pub(crate) fn send_stream_entry<E: RunStreamEvent>(
    channel: &Channel<E>,
    entry: &RunStreamBufferedEvent<E>,
    policy: RunStreamPolicy,
) -> Result<(), RunStreamSendError> {
    let cursor = E::stream_cursor(entry.cursor);
    if policy.terminal_delivery == TerminalDeliveryPolicy::CursorBeforeTerminal
        && entry.event.is_terminal()
    {
        channel
            .send(cursor)
            .map_err(|error| RunStreamSendError::Cursor(error.to_string()))?;
        channel
            .send(entry.event.clone())
            .map_err(|error| RunStreamSendError::Event(error.to_string()))
    } else {
        send_event_then_cursor(channel, entry, cursor)
    }
}

pub(crate) fn send_published_stream_entry<E: RunStreamEvent>(
    channel: &Channel<E>,
    entry: &RunStreamBufferedEvent<E>,
) -> Result<(), RunStreamSendError> {
    send_event_then_cursor(channel, entry, E::stream_cursor(entry.cursor))
}

fn send_event_then_cursor<E: RunStreamEvent>(
    channel: &Channel<E>,
    entry: &RunStreamBufferedEvent<E>,
    cursor: E,
) -> Result<(), RunStreamSendError> {
    channel
        .send(entry.event.clone())
        .map_err(|error| RunStreamSendError::Event(error.to_string()))?;
    channel
        .send(cursor)
        .map_err(|error| RunStreamSendError::Cursor(error.to_string()))
}
