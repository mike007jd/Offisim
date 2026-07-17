/** Shared deterministic stop rules for Mission and delegated-write repair loops. */

export interface LoopFailureFact {
  id: string;
  verdict: string;
  summary: string;
}

export type BoundedLoopStopReason = 'stuck' | 'attempt_cap' | 'token_budget';

export interface BoundedLoopDecisionInput {
  attemptNumber: number;
  maxAttempts: number;
  failureSignature: string;
  previousFailureSignature?: string;
  tokenRemaining?: number;
}

export type BoundedLoopDecision =
  | { action: 'continue' }
  | { action: 'stop'; reason: BoundedLoopStopReason };

export const BUDGET_NUDGE_THRESHOLD_RATIO = 0.88;

export interface BudgetNudge {
  readonly tokenBudget: number;
  readonly tokenRemaining: number;
  readonly usedPercent: number;
  readonly instruction: string;
}

/** One run-scoped soft signal before the existing token-budget hard stop. */
export class OneShotBudgetNudge {
  private issued = false;

  next(input: { tokenBudget: number; tokenRemaining: number }): BudgetNudge | null {
    if (this.issued || input.tokenBudget <= 0 || input.tokenRemaining <= 0) return null;
    const usedRatio = Math.max(
      0,
      Math.min(1, (input.tokenBudget - input.tokenRemaining) / input.tokenBudget),
    );
    if (usedRatio < BUDGET_NUDGE_THRESHOLD_RATIO) return null;

    this.issued = true;
    const usedPercent = Math.floor(usedRatio * 100);
    return {
      tokenBudget: input.tokenBudget,
      tokenRemaining: input.tokenRemaining,
      usedPercent,
      instruction: `The run has used ${usedPercent}% of its token budget; ${input.tokenRemaining} tokens remain out of ${input.tokenBudget}. Finish and deliver the best complete result now. Do not start new work, broaden scope, or delegate additional tasks. Prioritize closing the current work, running the most important verification, and reporting any unfinished item explicitly.`,
    };
  }
}

/** Stable across producer order; dynamic timestamps belong in evidence, not signatures. */
export function stableFailureSignature(failures: readonly LoopFailureFact[]): string {
  return JSON.stringify(
    failures
      .map((failure) => ({
        id: failure.id,
        v: failure.verdict,
        s: failure.summary,
      }))
      .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)),
  );
}

/**
 * Mission §19.2 ordering is authoritative: repeated signature, attempt cap,
 * then token budget. Consumers call this only after a failed verification.
 */
export function decideBoundedLoop(input: BoundedLoopDecisionInput): BoundedLoopDecision {
  if (
    input.previousFailureSignature !== undefined &&
    input.failureSignature === input.previousFailureSignature
  ) {
    return { action: 'stop', reason: 'stuck' };
  }
  if (input.attemptNumber >= input.maxAttempts) {
    return { action: 'stop', reason: 'attempt_cap' };
  }
  if (input.tokenRemaining !== undefined && input.tokenRemaining <= 0) {
    return { action: 'stop', reason: 'token_budget' };
  }
  return { action: 'continue' };
}
