import { reposOrNull } from './adapters.js';

/** Append a chat-style message as an agent event under the given event type.
 *  No-op without a company (nothing to scope it to) or repos (preview build). */
export async function appendThreadMessageEvent(opts: {
  eventId?: string;
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
  if (!repos) return;
  await repos.agentEvents.append({
    event_id: opts.eventId ?? `evt-${crypto.randomUUID()}`,
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

/** Load and decode the persisted message events for a thread. Malformed rows
 *  and decode rejects (returning null) are skipped; callers apply their sort. */
export async function loadThreadMessageEvents<T>(
  threadId: string,
  eventType: string,
  decode: (payload: unknown, row: { payload_json: string; created_at: string }) => T | null,
): Promise<T[]> {
  const repos = await reposOrNull();
  // Chat messages are stored as one stable-id projection row per message. Loading
  // without a checkpoint-row cap therefore scales with visible messages, not with
  // the number of streaming writes that produced them.
  const rows = repos ? await repos.agentEvents.findByThread(threadId, { eventType }) : [];
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
