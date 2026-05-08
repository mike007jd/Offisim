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

export function resolveOptions(
  ctx: RuntimeContext,
  defaults: ConversationBudgetServiceOptions,
): ResolvedConversationBudgetOptions {
  const summarization = ctx.runtimePolicy?.summarization;
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
    fullCompactTriggerTokens:
      defaults.fullCompactTriggerTokens ?? DEFAULT_FULL_COMPACT_TRIGGER_TOKENS,
    fullCompactTriggerMessages:
      defaults.fullCompactTriggerMessages ?? DEFAULT_FULL_COMPACT_TRIGGER_MESSAGES,
    fullCompactFailureThreshold:
      defaults.fullCompactFailureThreshold ?? DEFAULT_FULL_COMPACT_FAILURE_THRESHOLD,
    fullCompactRefreshMinMessages:
      defaults.fullCompactRefreshMinMessages ?? DEFAULT_FULL_COMPACT_REFRESH_MIN_MESSAGES,
  };
}
