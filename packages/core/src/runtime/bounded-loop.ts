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
