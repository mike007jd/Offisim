import type { HumanMessage } from '@langchain/core/messages';
import { recordedLlmCall } from '../llm/recorded-call.js';
import type { RuntimeContext } from '../runtime/runtime-context.js';
import type { OffisimGraphState } from '../graph/state.js';

const TITLE_PROMPT =
  'Summarize the following conversation in one short title (max 60 characters, no trailing punctuation, no quotes). Reply with the title only.';

const TITLE_MAX_LEN = 60;
const FALLBACK_TITLE = 'New thread';

function isHumanMessage(m: unknown): m is HumanMessage {
  return (
    typeof m === 'object' &&
    m !== null &&
    typeof (m as { _getType?: () => string })._getType === 'function' &&
    (m as { _getType: () => string })._getType() === 'human'
  );
}

function firstUserPrompt(state: OffisimGraphState): string {
  const human = state.messages.find(isHumanMessage);
  const content = human?.content;
  if (typeof content !== 'string') return '';
  return content.trim();
}

function clampTitle(value: string): string {
  const trimmed = value.replace(/^["'`]+|["'`]+$/g, '').trim();
  return trimmed.slice(0, TITLE_MAX_LEN);
}

export function autoTitleThread(ctx: RuntimeContext, state: OffisimGraphState): void {
  const chatThreadId = state.chatThreadId;
  if (!chatThreadId) return;
  if (!ctx.repos.chatThreads) return;

  const userPrompt = firstUserPrompt(state);
  const fallback = clampTitle(userPrompt) || FALLBACK_TITLE;

  void (async () => {
    try {
      const existing = await ctx.repos.chatThreads.findById(chatThreadId);
      if (!existing || existing.title_set_by_user === 1) return;

      const resolved = ctx.modelResolver.resolve(null, 'boss');
      const messages = state.messages
        .slice(-6)
        .map((m) => {
          const role = m._getType() === 'human' ? 'user' : 'assistant';
          const text = typeof m.content === 'string' ? m.content : '';
          return text ? `${role}: ${text}` : '';
        })
        .filter(Boolean)
        .join('\n');

      let summary = fallback;
      try {
        const response = await recordedLlmCall(
          ctx,
          {
            messages: [
              { role: 'system', content: TITLE_PROMPT },
              { role: 'user', content: messages || userPrompt },
            ],
            model: resolved.model,
            temperature: 0.2,
            maxTokens: 32,
          },
          { nodeName: 'thread_auto_title', provider: resolved.provider, model: resolved.model },
        );
        const candidate = clampTitle(response.content ?? '');
        if (candidate) summary = candidate;
      } catch {
        // Fall back to truncated first prompt — never block the chat reply.
      }

      await ctx.repos.chatThreads.updateTitle(chatThreadId, summary, { byUser: false });
    } catch {
      // Best-effort — auto-title must never raise into the chat path.
    }
  })();
}
