import type { ChatMessage } from '@/data/types.js';

export function messageAt(message: ChatMessage): number {
  return typeof message.at === 'number' && Number.isFinite(message.at) ? message.at : Date.now();
}

/**
 * Merge the durable seed projection with the controller's live Turn messages.
 *
 * While a run is active the live projection wins per id (it carries streaming
 * state). Once the run reaches a terminal phase the persisted seed wins per id:
 * a stale live copy must never overwrite durable metadata (queue state, final
 * status, terminal body). Live-only ids are still appended so an in-flight Turn
 * that never persisted cannot silently disappear from view.
 */
export function mergeMessages(
  seedMessages: readonly ChatMessage[],
  liveMessages: readonly ChatMessage[],
  preferLiveMessages: boolean,
): ChatMessage[] {
  const byId = new Map<string, ChatMessage>();
  for (const message of seedMessages) byId.set(message.id, message);
  for (const message of liveMessages) {
    if (!preferLiveMessages && byId.has(message.id)) continue;
    byId.set(message.id, message);
  }
  return Array.from(byId.values()).sort((a, b) => messageAt(a) - messageAt(b));
}
