/**
 * Budget compaction as a pi `transformContext` hook.
 *
 * pi's `transformContext` runs on the AgentMessage transcript before each LLM
 * call — exactly where context-window management belongs. This converts the pi
 * transcript to Offisim `LlmMessage[]`, runs the unchanged
 * `ConversationBudgetService` (micro-compact, full-compact, synopsis, all of
 * which read/write `graph_threads` + emit budget events), and converts the
 * pruned result back to pi by tail-alignment.
 *
 * The system prompt is prepended for the budget split (the service partitions on
 * role === 'system' and never drops it) and stripped from the result, since pi
 * keeps the system prompt out of the transcript.
 */

import type { AgentMessage } from '@offisim/pi-agent';
import { toErrorMessage } from '../errors.js';
import type { LlmMessage, LlmRequest } from '../llm/gateway.js';
import type { RuntimeContext } from '../runtime/runtime-context.js';
import type { ConversationBudgetService } from '../services/conversation-budget-service.js';
import { parseCompactBaseline } from '../services/conversation-budget/compact-baseline.js';
import { Logger } from '../services/logger.js';
import { llmToPiMessages, piToLlmMessages } from './pi-message-convert.js';

const logger = new Logger('pi-budget');

export interface PiBudgetDeps {
  readonly budgetService: ConversationBudgetService;
  readonly runtimeCtx: RuntimeContext;
  /** Concrete model id (used for context-window lookup in the budget service). */
  readonly model: string;
  /** The fixed system prompt, prepended for the budget split then stripped. */
  readonly systemPrompt: string;
  readonly maxTokens?: number;
}

/**
 * Build a `transformContext` function. Per the pi contract it must not throw —
 * on any failure it returns the original transcript unchanged.
 */
export function createBudgetTransform(
  deps: PiBudgetDeps,
): (messages: AgentMessage[], signal?: AbortSignal) => Promise<AgentMessage[]> {
  return async (messages, signal) => {
    try {
      const transcript = piToLlmMessages(messages);
      const withSystem: LlmMessage[] = [
        { role: 'system', content: deps.systemPrompt },
        ...transcript,
      ];
      const request: LlmRequest = {
        messages: withSystem,
        model: deps.model,
        ...(deps.maxTokens ? { maxTokens: deps.maxTokens } : {}),
        ...(signal ? { signal } : {}),
      };
      const pruned = await deps.budgetService.prepareRequest(deps.runtimeCtx, request);
      // Drop the injected system prompt; keep an injected synopsis (also system,
      // but with different content) — it folds into a leading pi user message.
      const prunedTranscript = pruned.messages.filter(
        (m) => !(m.role === 'system' && m.content === deps.systemPrompt),
      );
      await rebasePersistedCompactionPrefix(deps, messages);
      // The synthesized-message timestamp only orders compaction artifacts and
      // is not persisted as canonical history; use the injected clock seam.
      return llmToPiMessages(prunedTranscript, messages, deps.runtimeCtx.determinism.nowMs());
    } catch (error) {
      logger.warn('budget transform failed; passing transcript through', {
        error: toErrorMessage(error),
      });
      return messages;
    }
  };
}

async function rebasePersistedCompactionPrefix(
  deps: PiBudgetDeps,
  messages: AgentMessage[],
): Promise<void> {
  const threadId = deps.runtimeCtx.threadId;
  const piMessages = deps.runtimeCtx.repos.piMessages;
  if (!piMessages) return;
  const thread = await deps.runtimeCtx.repos.threads.findById(threadId);
  const baseline = parseCompactBaseline(thread?.compact_baseline_json ?? null);
  const compactedPrefix = baseline?.compactedNonSystemMessageCount ?? 0;
  if (!baseline || compactedPrefix <= 0 || messages.length === 0) return;

  // Keep at least one live message in memory if the persisted baseline ever
  // claims the whole transcript; the remaining compacted count continues to
  // protect the next transform from replaying that message beside the summary.
  const dropCount = Math.min(compactedPrefix, Math.max(0, messages.length - 1));
  if (dropCount <= 0) return;

  const rebasedBaseline = {
    ...baseline,
    compactedNonSystemMessageCount: compactedPrefix - dropCount,
  };
  try {
    const rebasedBaselineJson = JSON.stringify(rebasedBaseline);
    if (deps.runtimeCtx.repos.asyncTransact) {
      await deps.runtimeCtx.repos.asyncTransact(async (txRepos) => {
        const repos = txRepos ?? deps.runtimeCtx.repos;
        const txPiMessages = repos.piMessages;
        if (!txPiMessages) return;
        await repos.threads.updateCompactBaseline(threadId, rebasedBaselineJson);
        await txPiMessages.deleteFirstByThread(threadId, dropCount);
      });
    } else {
      await deps.runtimeCtx.repos.threads.updateCompactBaseline(threadId, rebasedBaselineJson);
      await piMessages.deleteFirstByThread(threadId, dropCount);
    }
    messages.splice(0, dropCount);
  } catch (error) {
    logger.warn('failed to rebase compacted pi transcript prefix', {
      threadId,
      dropCount,
      error: toErrorMessage(error),
    });
  }
}
