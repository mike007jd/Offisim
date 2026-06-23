import { reposOrNull } from './adapters.js';

/** Append a chat-style message as an agent event under the given event type.
 *  No-op without a company (nothing to scope it to) or repos (preview build). */
export async function appendThreadMessageEvent(opts: {
  eventType: string;
  threadId: string;
  companyId: string | null;
  projectId: string | null;
  agentName: string;
  payload: unknown;
  createdAt: Date;
}): Promise<void> {
  if (!opts.companyId) return;
  const repos = await reposOrNull();
  if (!repos?.agentEvents) return;
  await repos.agentEvents.append({
    event_id: `evt-${crypto.randomUUID()}`,
    project_id: opts.projectId,
    thread_id: opts.threadId,
    company_id: opts.companyId,
    agent_name: opts.agentName,
    event_type: opts.eventType,
    payload_json: JSON.stringify(opts.payload),
    parent_event_id: null,
    created_at: opts.createdAt.toISOString(),
  });
}

/** Default per-thread row window for a single message-event type. */
const DEFAULT_MESSAGE_EVENT_LIMIT = 500;
/**
 * When `paginateAll` is set, fetch the whole thread's message rows for this
 * event type instead of the newest 500. A long single reply writes one row per
 * streaming checkpoint, so the newest-500 window can be entirely consumed by one
 * reply — evicting the older real messages from the result before the caller can
 * even dedup them. The caller (`loadPersistedChatMessages`) dedups by message.id
 * while decoding, so the in-memory cost stays bounded by *distinct* messages,
 * not the (much larger) checkpoint-row count.
 */
const PAGINATE_ALL_LIMIT = 1_000_000;

/** Load and decode the persisted message events for a thread. Malformed rows
 *  and decode rejects (returning null) are skipped; callers apply their sort. */
export async function loadThreadMessageEvents<T>(
  threadId: string,
  eventType: string,
  decode: (payload: unknown, row: { payload_json: string; created_at: string }) => T | null,
  opts?: { paginateAll?: boolean },
): Promise<T[]> {
  const repos = await reposOrNull();
  const limit = opts?.paginateAll ? PAGINATE_ALL_LIMIT : DEFAULT_MESSAGE_EVENT_LIMIT;
  const rows = (await repos?.agentEvents?.findByThread(threadId, { eventType, limit })) ?? [];
  const out: T[] = [];
  for (const row of rows) {
    try {
      const decoded = decode(JSON.parse(row.payload_json), row);
      if (decoded !== null) out.push(decoded);
    } catch {
      // skip malformed payloads
    }
  }
  return out;
}
