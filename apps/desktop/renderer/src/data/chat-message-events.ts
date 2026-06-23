import { appendThreadMessageEvent, loadThreadMessageEvents } from './thread-message-events.js';
import type { ChatMessage } from './types.js';

const DIRECT_CHAT_MESSAGE_EVENT = 'direct_chat.message';

interface PersistedChatMessageEntry {
  message: ChatMessage;
  createdAtMs: number;
  /** Monotonic per-thread write order; 0 for legacy rows that predate stamping. */
  seq: number;
}

/**
 * A long single reply writes one streaming checkpoint row every few seconds plus
 * a final row — all sharing the same `message.id`. On reload these rows are
 * deduped by id, but `created_at` (ISO string) and `message.at` (the assistant's
 * fixed reply timestamp) are non-monotonic tiebreakers: two checkpoints inside
 * the same millisecond, or a clock skew, could let an earlier checkpoint outrank
 * the final complete row. A strictly increasing per-thread sequence stamped at
 * persist time makes the latest write deterministically win, independent of
 * wall-clock. Stored in the event payload wrapper, not on `ChatMessage`.
 */
const writeSeqByThread = new Map<string, number>();

function nextWriteSeq(threadId: string): number {
  const next = (writeSeqByThread.get(threadId) ?? 0) + 1;
  writeSeqByThread.set(threadId, next);
  return next;
}

function persistedMessage(message: ChatMessage): ChatMessage {
  const { toolCalls: _toolCalls, ...rest } = message;
  return rest;
}

function finiteTimestamp(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function restoredMessage(message: ChatMessage, fallbackAt: number): ChatMessage {
  return {
    ...message,
    body: typeof message.body === 'string' ? message.body : '',
    at: finiteTimestamp(message.at, fallbackAt),
    status: message.status === 'streaming' ? 'interrupted' : message.status,
  };
}

export async function persistChatMessage({
  message,
  companyId,
  projectId,
}: {
  message: ChatMessage;
  companyId: string | null;
  projectId: string | null;
}): Promise<void> {
  const messageForStorage = persistedMessage(message);
  await appendThreadMessageEvent({
    eventType: DIRECT_CHAT_MESSAGE_EVENT,
    threadId: messageForStorage.threadId,
    companyId,
    projectId,
    agentName: messageForStorage.author === 'boss' ? 'boss' : 'desktop-provider',
    payload: { message: messageForStorage, seq: nextWriteSeq(messageForStorage.threadId) },
    createdAt: new Date(finiteTimestamp(messageForStorage.at, Date.now())),
  });
}

/** True when `candidate` is a later write than `incumbent` for the same id.
 *  The monotonic per-thread `seq` is authoritative within a renderer session
 *  (it is stamped from an in-memory counter that resets on reload); `createdAtMs`
 *  breaks ties across sessions and for legacy rows (seq 0) that predate stamping. */
function isLaterWrite(
  candidate: PersistedChatMessageEntry,
  incumbent: PersistedChatMessageEntry,
): boolean {
  if (candidate.seq !== incumbent.seq) return candidate.seq > incumbent.seq;
  return candidate.createdAtMs >= incumbent.createdAtMs;
}

export async function loadPersistedChatMessages(threadId: string): Promise<ChatMessage[]> {
  // Dedup by message.id *while* loading so a long reply's many streaming
  // checkpoints (all sharing one id) collapse to a single message before any
  // row cap is reached. Without this, 500+ checkpoints of one reply fill the
  // newest-first window and evict the older real messages (the boss prompt,
  // earlier turns) that the user must still see on reload.
  const latestById = new Map<string, PersistedChatMessageEntry>();
  await loadThreadMessageEvents<null>(
    threadId,
    DIRECT_CHAT_MESSAGE_EVENT,
    (payload, row) => {
      const wrapper = payload as { message?: ChatMessage; seq?: unknown };
      const message = wrapper.message;
      if (message?.threadId !== threadId || typeof message.id !== 'string') return null;
      const createdAtMs = Date.parse(row.created_at) || finiteTimestamp(message.at, 0);
      const seq = typeof wrapper.seq === 'number' ? wrapper.seq : 0;
      const entry: PersistedChatMessageEntry = {
        message: restoredMessage(message, createdAtMs || Date.now()),
        createdAtMs,
        seq,
      };
      const previous = latestById.get(message.id);
      if (!previous || isLaterWrite(entry, previous)) latestById.set(message.id, entry);
      return null;
    },
    { paginateAll: true },
  );
  return Array.from(latestById.values())
    .map((entry) => entry.message)
    .sort((a, b) => finiteTimestamp(a.at, 0) - finiteTimestamp(b.at, 0));
}
