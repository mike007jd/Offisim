/**
 * DR-006 — Pi session resume integration: the resume PLAN (PRD §22.3.7-8, slice M4).
 *
 * Given a resumable {@link RecoveryCard}, {@link planResume} returns the
 * deterministic plan a live resume would execute (PRD §22.3.7):
 *
 *   - which safe boundary to resume FROM (`fromSafeBoundary`);
 *   - the interruption framed as a STRUCTURED FACT to tell the agent (§22.3.8) —
 *     not a free-form prompt, a typed record the host can serialize verbatim;
 *   - the operations that MAY be auto-replayed — and the guarantee that NO
 *     `unsafe` / `unknown` operation is among them (§22.4, filtered by
 *     {@link canAutoRetry}); the held operations are listed separately so the
 *     host can ask the user about them.
 *
 * This is LOGIC ONLY. It does NOT start a Pi session, does NOT re-run anything —
 * it returns the plan. The live resume + the crash `.app` test are the M-pass.
 * A non-resumable card yields a refusal plan (`canResume: false`) — the planner
 * never produces an auto-replay set for an incompatible mission (§29).
 *
 * Additive at M4.
 */

import { canAutoRetry } from './retry-safety.js';
import type { RecoveryCard, UnfinishedOperation } from './types.js';

/**
 * The §22.3.8 structured interruption fact handed to the agent on resume. A typed
 * record, not prose — the host serializes it into the runtime session as the
 * resume context so the agent knows it was interrupted and what is known.
 */
export interface InterruptionFact {
  type: 'mission_interrupted';
  missionId: string;
  interruptedAttemptId: string | null;
  /** The safe checkpoint the resume starts from, or null when none was recorded. */
  resumedFromSafeBoundary: string | null;
  /** Whether side effects may already have occurred before the interruption. */
  possibleSideEffects: boolean;
  /** Operation ids that will NOT be auto-replayed (held for user confirmation). */
  operationsHeldForConfirmation: string[];
}

/** The plan a resume would execute. Logic only — nothing is run here. */
export interface ResumePlan {
  canResume: boolean;
  missionId: string;
  /** The safe boundary to resume from (null = from the attempt start). */
  fromSafeBoundary: string | null;
  /** The §22.3.8 interruption fact to tell the agent. */
  interruptionFact: InterruptionFact;
  /**
   * Operations safe to auto-replay (§22.4) — ONLY `safe` / `idempotent_with_key`.
   * Guaranteed to contain NO `unsafe` / `unknown` operation.
   */
  autoReplayOperations: UnfinishedOperation[];
  /** Operations NOT auto-replayed — held for explicit user confirmation. */
  heldOperations: UnfinishedOperation[];
  /** When `canResume === false`, why (e.g. incompatible runtime). */
  refusalReason?: string;
}

/**
 * Build the resume plan for a recovery card. A resumable card yields a plan whose
 * `autoReplayOperations` are strictly the auto-retryable ones; an incompatible /
 * needs-confirm card yields a refusal plan with no auto-replay set.
 *
 * The §22.4 filter is applied here as a HARD partition: `canAutoRetry` decides
 * membership, so an `unsafe` / `unknown` op can never reach `autoReplayOperations`.
 */
export function planResume(card: RecoveryCard): ResumePlan {
  const autoReplayOperations = card.unfinishedOperations.filter((op) => canAutoRetry(op));
  const heldOperations = card.unfinishedOperations.filter((op) => !canAutoRetry(op));

  const interruptionFact: InterruptionFact = {
    type: 'mission_interrupted',
    missionId: card.missionId,
    interruptedAttemptId: card.interruptedAttemptId,
    resumedFromSafeBoundary: card.lastSafeBoundary,
    possibleSideEffects: card.possibleSideEffects,
    operationsHeldForConfirmation: heldOperations.map((op) => op.id),
  };

  if (card.classification !== 'resumable') {
    return {
      canResume: false,
      missionId: card.missionId,
      fromSafeBoundary: card.lastSafeBoundary,
      interruptionFact,
      // A non-resumable plan exposes NO auto-replay set — the §22.4 guarantee
      // holds vacuously, and §29 blocks an incompatible resume entirely.
      autoReplayOperations: [],
      heldOperations: card.unfinishedOperations,
      refusalReason:
        card.classification === 'incompatible'
          ? 'runtime incompatible with the interrupted session (resume blocked, §29)'
          : 'workspace state needs user confirmation before resume',
    };
  }

  return {
    canResume: true,
    missionId: card.missionId,
    fromSafeBoundary: card.lastSafeBoundary,
    interruptionFact,
    autoReplayOperations,
    heldOperations,
  };
}

/**
 * Defensive assertion (§22.4): NO `unsafe` / `unknown` operation is in a plan's
 * auto-replay set. Returns the offending ops (empty = the guarantee holds). The
 * partition in {@link planResume} already enforces this; this is the check the
 * harness inject-proofs against.
 */
export function unsafeOperationsInAutoReplay(plan: ResumePlan): UnfinishedOperation[] {
  return plan.autoReplayOperations.filter((op) => !canAutoRetry(op));
}
