import type { ResolvedConversationBudgetOptions } from './options-resolver.js';

export function resolveEffectiveTailNonSystemMessages(
  options: ResolvedConversationBudgetOptions,
  summaryCount: number,
): number {
  return summaryCount > 3
    ? Math.max(options.tailNonSystemMessages - 10, 20)
    : options.tailNonSystemMessages;
}
