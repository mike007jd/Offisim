/**
 * Conversion between pi messages and Offisim's flat `LlmMessage` shape.
 *
 * pi models a message as content blocks (text / thinking / toolCall / image);
 * Offisim's `LlmMessage` is flat (string content + `reasoningContent` + a
 * `toolCalls` array). The bridge converts pi → LlmMessage to reuse the existing
 * `ConversationBudgetService` (token counting, micro/full compaction, synopsis)
 * unchanged, then converts the pruned result back to pi by tail-alignment —
 * compaction preserves recent messages verbatim, so the surviving tail is mapped
 * back to the original pi messages (preserving thinking signatures), and any new
 * leading summary message is materialized as a pi user message.
 */

import type {
  AssistantMessage,
  ImageContent,
  Message as PiMessage,
  TextContent,
  ToolResultMessage,
} from '@offisim/pi-ai';
import type { LlmMessage, ToolCallResult } from '../llm/gateway.js';

type PiContentBlock = AssistantMessage['content'][number];

function blocksToText(content: string | (TextContent | ImageContent)[]): string {
  if (typeof content === 'string') return content;
  return content
    .map((block) => (block.type === 'text' ? block.text : '[image]'))
    .join('\n');
}

/** Convert a single pi message to the flat `LlmMessage` shape. */
export function piToLlmMessage(msg: PiMessage): LlmMessage {
  if (msg.role === 'user') {
    return { role: 'user', content: blocksToText(msg.content) };
  }
  if (msg.role === 'assistant') {
    const text = msg.content
      .filter((c): c is TextContent => c.type === 'text')
      .map((c) => c.text)
      .join('');
    const thinking = msg.content
      .filter((c): c is Extract<PiContentBlock, { type: 'thinking' }> => c.type === 'thinking')
      .map((c) => c.thinking)
      .join('');
    const toolCalls: ToolCallResult[] = msg.content
      .filter((c): c is Extract<PiContentBlock, { type: 'toolCall' }> => c.type === 'toolCall')
      .map((c) => ({ id: c.id, name: c.name, arguments: c.arguments }));
    return {
      role: 'assistant',
      content: text,
      ...(thinking ? { reasoningContent: thinking } : {}),
      ...(toolCalls.length ? { toolCalls } : {}),
    };
  }
  // toolResult
  return { role: 'tool', content: blocksToText(msg.content), toolCallId: msg.toolCallId };
}

export function piToLlmMessages(messages: readonly PiMessage[]): LlmMessage[] {
  return messages.map(piToLlmMessage);
}

/** Stable correlation key so a pruned `LlmMessage` can be matched to its pi origin. */
function correlationKey(msg: LlmMessage): string {
  if (msg.role === 'tool') return `tool:${msg.toolCallId ?? ''}`;
  if (msg.role === 'assistant' && msg.toolCalls?.length) {
    return `asst:${msg.toolCalls.map((t) => t.id).join(',')}`;
  }
  return `${msg.role}:${msg.content.slice(0, 64)}`;
}

function llmMessageToPi(msg: LlmMessage, now: number): PiMessage {
  if (msg.role === 'tool') {
    const result: ToolResultMessage = {
      role: 'toolResult',
      toolCallId: msg.toolCallId ?? '',
      toolName: '',
      content: [{ type: 'text', text: msg.content }],
      isError: false,
      timestamp: now,
    };
    return result;
  }
  if (msg.role === 'assistant') {
    const content: AssistantMessage['content'] = [];
    if (msg.reasoningContent) content.push({ type: 'thinking', thinking: msg.reasoningContent });
    if (msg.content) content.push({ type: 'text', text: msg.content });
    for (const call of msg.toolCalls ?? []) {
      content.push({ type: 'toolCall', id: call.id, name: call.name, arguments: call.arguments });
    }
    const assistant: AssistantMessage = {
      role: 'assistant',
      content,
      api: 'anthropic-messages',
      provider: 'anthropic',
      model: 'compaction-synthesized',
      usage: {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 0,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      },
      stopReason: 'stop',
      timestamp: now,
    };
    return assistant;
  }
  // system + user both become a pi user message (pi keeps the system prompt out
  // of the transcript; a compaction summary injected as system folds into user).
  return { role: 'user', content: [{ type: 'text', text: msg.content }], timestamp: now };
}

/**
 * Reconstruct pi messages from a pruned `LlmMessage[]`, preserving the original
 * pi messages (and their thinking signatures) for the surviving tail and
 * materializing any newly-injected leading summary message.
 */
export function llmToPiMessages(
  pruned: readonly LlmMessage[],
  original: readonly PiMessage[],
  now: number,
): PiMessage[] {
  const originalLlm = original.map(piToLlmMessage);
  // Tail-align: walk both lists from the end while keys match.
  let pi = original.length;
  let pr = pruned.length;
  const tail: PiMessage[] = [];
  while (pi > 0 && pr > 0) {
    const oMsg = originalLlm[pi - 1];
    const pMsg = pruned[pr - 1];
    if (oMsg && pMsg && correlationKey(oMsg) === correlationKey(pMsg)) {
      const orig = original[pi - 1];
      if (orig) tail.unshift(orig);
      pi -= 1;
      pr -= 1;
    } else {
      break;
    }
  }
  // Remaining leading pruned messages are synthesized (compaction summary, etc.).
  const head: PiMessage[] = [];
  for (let i = 0; i < pr; i += 1) {
    const m = pruned[i];
    if (m) head.push(llmMessageToPi(m, now));
  }
  return [...head, ...tail];
}
