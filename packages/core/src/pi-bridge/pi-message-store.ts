/**
 * Per-message persistence for the pi kernel + the dangling-toolCall resume patch.
 *
 * pi-agent-core has no serialize API: `AgentContext.messages` is plain data, so
 * the transcript is persisted message-by-message (append granularity, finer than
 * the old super-step checkpoint) and the tools are re-attached on load.
 *
 * Critical patch (upstream #2119 / #3073): `runAgentLoopContinue` throws if the
 * transcript ends with an assistant message that has an unanswered toolCall. On
 * load we synthesize a toolResult for every dangling toolCall so the ResumeBar
 * never crashes on restart. The synthetic result is positioned immediately after
 * its assistant message, preserving the provider's tool_use → tool_result order.
 */

import type { AssistantMessage, Message as PiMessage, ToolResultMessage } from '@offisim/pi-ai';
import type { AgentMessage } from '@offisim/pi-agent';
import type { PiMessageRepository, PiMessageRow } from '../runtime/repositories.js';
import { generateId } from '../utils/generate-id.js';

export class PiMessageStore {
  constructor(private readonly repo: PiMessageRepository) {}

  /**
   * Load a thread's transcript as pi messages, repaired so it can be safely fed
   * back into the agent loop (no dangling toolCalls).
   */
  async loadTranscript(threadId: string): Promise<AgentMessage[]> {
    const rows = await this.repo.listByThread(threadId);
    const messages: PiMessage[] = [];
    for (const row of rows) {
      try {
        messages.push(JSON.parse(row.message_json) as PiMessage);
      } catch {
        // Skip a corrupt row rather than failing the whole load.
      }
    }
    return patchDanglingToolCalls(messages);
  }

  /** Append the given messages after the thread's current tail. */
  async append(
    threadId: string,
    companyId: string,
    messages: readonly PiMessage[],
    createdAt: string,
    employeeId: string | null = null,
  ): Promise<void> {
    if (messages.length === 0) return;
    const start = (await this.repo.maxSeq(threadId)) + 1;
    const rows: PiMessageRow[] = messages.map((message, i) => ({
      message_id: generateId('pim'),
      thread_id: threadId,
      company_id: companyId,
      employee_id: employeeId,
      seq: start + i,
      role: message.role,
      message_json: JSON.stringify(message),
      created_at: createdAt,
    }));
    await this.repo.append(rows);
  }

  /** The worker that owns this thread (null = boss / not found) — for resume. */
  async threadOwnerEmployeeId(threadId: string): Promise<string | null> {
    const rows = await this.repo.listByThread(threadId);
    const last = rows[rows.length - 1];
    return last?.employee_id ?? null;
  }

  async clear(threadId: string): Promise<void> {
    await this.repo.deleteByThread(threadId);
  }
}

/**
 * Insert a synthetic toolResult immediately after any assistant message whose
 * toolCalls were never answered, so `runAgentLoopContinue` accepts the transcript.
 */
export function patchDanglingToolCalls(messages: readonly PiMessage[]): PiMessage[] {
  const answered = new Set<string>();
  for (const message of messages) {
    if (message.role === 'toolResult') answered.add(message.toolCallId);
  }

  const out: PiMessage[] = [];
  for (const message of messages) {
    out.push(message);
    if (message.role !== 'assistant') continue;
    // Guard against a corrupt/legacy row whose assistant content is not an array
    // (pi allows string content on user messages; a hand-edited row could too) —
    // a bare .filter would throw and crash the whole transcript load.
    const blocks = (message as AssistantMessage).content;
    if (!Array.isArray(blocks)) continue;
    const toolCalls = blocks.filter(
      (c): c is Extract<AssistantMessage['content'][number], { type: 'toolCall' }> =>
        c.type === 'toolCall',
    );
    for (const call of toolCalls) {
      if (answered.has(call.id)) continue;
      answered.add(call.id);
      const synthetic: ToolResultMessage = {
        role: 'toolResult',
        toolCallId: call.id,
        toolName: call.name,
        content: [
          {
            type: 'text',
            text: 'Tool call was interrupted before it completed; re-run if the result is still needed.',
          },
        ],
        isError: true,
        timestamp: message.timestamp,
      };
      out.push(synthetic);
    }
  }
  return out;
}
