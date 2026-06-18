import type { RuntimeContext } from '../../runtime/runtime-context.js';

export interface ConversationBudgetServiceOptions {
  maxNonSystemMessages?: number;
  tailNonSystemMessages?: number;
  synopsisTriggerMessages?: number;
  synopsisRefreshMinMessages?: number;
  toolResultKeepRecent?: number;
  toolResultMaxContentChars?: number;
  microMaxToolResultBytes?: number;
  microSnippetBytes?: number;
  microPreserveLastN?: number;
  synopsisFailureThreshold?: number;
  postCompactKeepNodeSummaries?: number;
  fullCompactTriggerTokens?: number;
  fullCompactTriggerMessages?: number;
  fullCompactFailureThreshold?: number;
  fullCompactRefreshMinMessages?: number;
  resolvedContextWindowTokens?: number;
  reservedOutputTokens?: number;
  fullCompactTriggerRatio?: number;
  /**
   * Resolve the active model's real context window from the owning runtime.
   * The Pi Agent runtime owns model/session state; legacy callers can still
   * inject a resolver for compatibility. Returns `undefined` when the source
   * has no entry, so the caller falls back to the conservative default.
   */
  contextWindowResolver?: (model: string) => number | undefined;
}

export interface ResolvedConversationBudgetOptions {
  enabled: boolean;
  maxNonSystemMessages: number;
  tailNonSystemMessages: number;
  synopsisTriggerMessages: number;
  synopsisRefreshMinMessages: number;
  synopsisTriggerTokens: number;
  toolResultKeepRecent: number;
  toolResultMaxContentChars: number;
  microMaxToolResultBytes: number;
  microSnippetBytes: number;
  microPreserveLastN: number;
  synopsisFailureThreshold: number;
  postCompactKeepNodeSummaries: number;
  fullCompactTriggerTokens: number;
  fullCompactTriggerMessages: number;
  fullCompactFailureThreshold: number;
  fullCompactRefreshMinMessages: number;
}

export const DEFAULT_TAIL_NON_SYSTEM_MESSAGES = 50;
export const DEFAULT_SYNOPSIS_TRIGGER_MESSAGES = 80;
export const DEFAULT_SYNOPSIS_REFRESH_MIN_MESSAGES = 6;
export const DEFAULT_TOOL_RESULT_KEEP_RECENT = 4;
export const DEFAULT_TOOL_RESULT_MAX_CONTENT_CHARS = 400;
export const DEFAULT_MICRO_MAX_TOOL_RESULT_BYTES = 8000;
export const DEFAULT_MICRO_SNIPPET_BYTES = 400;
export const DEFAULT_MICRO_PRESERVE_LAST_N = 1;
export const DEFAULT_SYNOPSIS_FAILURE_THRESHOLD = 3;
export const DEFAULT_POST_COMPACT_KEEP_NODE_SUMMARIES = 12;
export const DEFAULT_FULL_COMPACT_TRIGGER_TOKENS = 90_000;
export const DEFAULT_FULL_COMPACT_TRIGGER_MESSAGES = 120;
export const DEFAULT_FULL_COMPACT_FAILURE_THRESHOLD = 3;
export const DEFAULT_FULL_COMPACT_REFRESH_MIN_MESSAGES = 24;
export const DEFAULT_CONTEXT_WINDOW_TOKENS = 128_000;
export const DEFAULT_RESERVED_OUTPUT_TOKENS = 20_000;
export const DEFAULT_FULL_COMPACT_TRIGGER_RATIO = 0.8;

export function resolveOptions(
  ctx: RuntimeContext,
  defaults: ConversationBudgetServiceOptions,
): ResolvedConversationBudgetOptions {
  const summarization = ctx.runtimePolicy?.summarization;
  const contextWindow = Math.max(
    1,
    defaults.resolvedContextWindowTokens ?? DEFAULT_CONTEXT_WINDOW_TOKENS,
  );
  const reservedOutput = Math.max(
    0,
    defaults.reservedOutputTokens ?? DEFAULT_RESERVED_OUTPUT_TOKENS,
  );
  const triggerRatio = Math.min(
    1,
    Math.max(0.1, defaults.fullCompactTriggerRatio ?? DEFAULT_FULL_COMPACT_TRIGGER_RATIO),
  );
  const windowDerivedFullCompactTrigger = Math.max(
    1,
    Math.floor(Math.max(1, contextWindow - reservedOutput) * triggerRatio),
  );
  const keepRecentMessages = Math.max(
    0,
    summarization?.keepRecentMessages ?? DEFAULT_TAIL_NON_SYSTEM_MESSAGES,
  );
  return {
    enabled: summarization?.enabled ?? true,
    maxNonSystemMessages: defaults.maxNonSystemMessages ?? keepRecentMessages,
    tailNonSystemMessages: defaults.tailNonSystemMessages ?? keepRecentMessages,
    synopsisTriggerMessages:
      defaults.synopsisTriggerMessages ??
      Math.max(DEFAULT_SYNOPSIS_TRIGGER_MESSAGES, keepRecentMessages + 10),
    synopsisRefreshMinMessages:
      defaults.synopsisRefreshMinMessages ?? DEFAULT_SYNOPSIS_REFRESH_MIN_MESSAGES,
    synopsisTriggerTokens: summarization?.triggerTokens ?? 60_000,
    toolResultKeepRecent: defaults.toolResultKeepRecent ?? DEFAULT_TOOL_RESULT_KEEP_RECENT,
    toolResultMaxContentChars:
      defaults.toolResultMaxContentChars ?? DEFAULT_TOOL_RESULT_MAX_CONTENT_CHARS,
    microMaxToolResultBytes:
      defaults.microMaxToolResultBytes ?? DEFAULT_MICRO_MAX_TOOL_RESULT_BYTES,
    microSnippetBytes: defaults.microSnippetBytes ?? DEFAULT_MICRO_SNIPPET_BYTES,
    microPreserveLastN: defaults.microPreserveLastN ?? DEFAULT_MICRO_PRESERVE_LAST_N,
    synopsisFailureThreshold:
      defaults.synopsisFailureThreshold ?? DEFAULT_SYNOPSIS_FAILURE_THRESHOLD,
    postCompactKeepNodeSummaries:
      defaults.postCompactKeepNodeSummaries ?? DEFAULT_POST_COMPACT_KEEP_NODE_SUMMARIES,
    fullCompactTriggerTokens: defaults.fullCompactTriggerTokens ?? windowDerivedFullCompactTrigger,
    fullCompactTriggerMessages:
      defaults.fullCompactTriggerMessages ?? DEFAULT_FULL_COMPACT_TRIGGER_MESSAGES,
    fullCompactFailureThreshold:
      defaults.fullCompactFailureThreshold ?? DEFAULT_FULL_COMPACT_FAILURE_THRESHOLD,
    fullCompactRefreshMinMessages:
      defaults.fullCompactRefreshMinMessages ?? DEFAULT_FULL_COMPACT_REFRESH_MIN_MESSAGES,
  };
}
