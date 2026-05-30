import type { HumanMessage } from '@langchain/core/messages';
import { chatThreadUpdated } from '../events/event-factories.js';
import type { OffisimGraphState } from '../graph/state.js';
import { recordedLlmCall } from '../llm/recorded-call.js';
import type { RuntimeContext } from '../runtime/runtime-context.js';

const TITLE_PROMPT =
  'Summarize the following conversation in one short title (max 60 characters, no trailing punctuation, no quotes). Reply with the title only.';

const TITLE_MAX_LEN = 60;
const FALLBACK_TITLE = 'New thread';
const PER_MESSAGE_CHAR_CAP = 400;
const PROMPT_TOTAL_CAP = 2400;
const LOCKED_THREAD_CAP = 1024;

// Threads whose title was set by the user; we never auto-rewrite these. Bounded
// (FIFO-evicted) so a long-lived runtime cannot grow this set without limit — an
// evicted id simply re-reads title_set_by_user from the DB and re-locks.
const lockedThreadIds = new Set<string>();
// Threads with an auto-title pass currently running, to coalesce concurrent
// invocations of the same chatThreadId (claimed at entry, cleared in finally).
const inFlightThreadIds = new Set<string>();

function lockThread(chatThreadId: string): void {
  lockedThreadIds.add(chatThreadId);
  while (lockedThreadIds.size > LOCKED_THREAD_CAP) {
    const oldest = lockedThreadIds.values().next().value;
    if (oldest === undefined) break;
    lockedThreadIds.delete(oldest);
  }
}

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

function buildSummarizerPrompt(state: OffisimGraphState, fallback: string): string {
  const joined = state.messages
    .slice(-6)
    .map((m) => {
      const role = m._getType() === 'human' ? 'user' : 'assistant';
      const text = typeof m.content === 'string' ? m.content : '';
      if (!text) return '';
      return `${role}: ${text.slice(0, PER_MESSAGE_CHAR_CAP)}`;
    })
    .filter(Boolean)
    .join('\n');
  return (joined || fallback).slice(0, PROMPT_TOTAL_CAP);
}

export function autoTitleThread(ctx: RuntimeContext, state: OffisimGraphState): void {
  const chatThreadId = state.chatThreadId;
  if (!chatThreadId) return;
  if (lockedThreadIds.has(chatThreadId)) return;
  if (inFlightThreadIds.has(chatThreadId)) return;
  if (!ctx.repos.chatThreads) return;
  const chatThreads = ctx.repos.chatThreads;

  const userPrompt = firstUserPrompt(state);
  const fallback = clampTitle(userPrompt) || FALLBACK_TITLE;

  inFlightThreadIds.add(chatThreadId);
  void (async () => {
    try {
      const existing = await chatThreads.findById(chatThreadId);
      if (!existing) return;
      if (existing.title_set_by_user === 1) {
        lockThread(chatThreadId);
        return;
      }

      const resolved = ctx.modelResolver.resolve(null, 'boss');
      const summarizerInput = buildSummarizerPrompt(state, userPrompt);

      let summary = fallback;
      try {
        const response = await recordedLlmCall(
          ctx,
          {
            messages: [
              { role: 'system', content: TITLE_PROMPT },
              { role: 'user', content: summarizerInput },
            ],
            model: resolved.model,
            temperature: 0.2,
            maxTokens: 32,
          },
          {
            nodeName: 'thread_auto_title',
            provider: resolved.provider,
            model: resolved.model,
            projectId: existing.project_id,
          },
        );
        const candidate = clampTitle(response.content ?? '');
        if (candidate) summary = candidate;
      } catch (err) {
        console.warn('[auto-title-thread] LLM summarizer failed; using fallback', err);
      }

      await chatThreads.updateTitle(chatThreadId, summary, { byUser: false });
      const projectId = existing.project_id;
      ctx.eventBus.emit(
        chatThreadUpdated(ctx.companyId, { chatThreadId, projectId, reason: 'title' }),
      );
    } catch (err) {
      console.warn('[auto-title-thread] best-effort title rewrite failed', err);
    } finally {
      inFlightThreadIds.delete(chatThreadId);
    }
  })();
}
