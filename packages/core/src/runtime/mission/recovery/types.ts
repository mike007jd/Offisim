/**
 * Recovery domain types (PRD §22.3, §24.5, slice M4).
 *
 * The shapes the startup reconciliation produces (DR-003) and the resume planner
 * consumes (DR-006). A {@link RecoveryCard} is the structured, presented-not-acted
 * result of reconciling ONE interrupted mission: the §24.5 fields the UI shows so
 * a human can choose Resume / Inspect / Cancel. Reconciliation never auto-resumes
 * (PRD §22.3.6) — it returns cards.
 *
 * Additive at M4 — pure data; the UI / live host consume these at the M-pass.
 */

import type { RetrySafety } from './retry-safety.js';

/**
 * §22.3.5 classification of an interrupted mission's runtime session link:
 *
 * - `resumable` — compatible runtime + a workspace lease + a safe boundary to
 *   resume from. The default Resume target.
 * - `needs_user_confirm` — resumable in principle but missing a workspace lease
 *   (or another soft precondition), so it needs explicit human confirmation.
 * - `incompatible` — the compatibility hash mismatches (or is unknown): a resume
 *   is BLOCKED (§29 Compatibility) and must be explained, not attempted.
 */
export type RecoveryClassification = 'resumable' | 'needs_user_confirm' | 'incompatible';

/** A single unfinished operation surfaced on a recovery card (§24.5). */
export interface UnfinishedOperation {
  /** The operation id (a tool name or evaluator id). */
  id: string;
  kind: 'tool_call' | 'evaluation';
  /** §22.4 retry-safety — drives whether a resume may re-run it. */
  retrySafety: RetrySafety;
  /** Whether this op may be auto-retried (canAutoRetry(retrySafety)). */
  autoRetryable: boolean;
  /** Human-readable label. */
  description: string;
}

/** A pending interaction that survived the restart and is still unanswered (DR-004). */
export interface SurfacedPendingInteraction {
  interactionId: string;
  threadId: string;
  kind: string;
  /** The raw persisted request payload (so the UI can re-present it verbatim). */
  requestJson: string;
  createdAt: string;
}

/**
 * §24.5 recovery card: everything the recovery UX must show for one interrupted
 * mission. Built by DR-003 reconciliation; never auto-acted upon.
 */
export interface RecoveryCard {
  missionId: string;
  companyId: string;
  title: string;
  /** The mission's status AFTER reconciliation (interrupted → ready_to_resume, or interrupted). */
  missionStatus: string;
  /** The interrupted attempt that was marked `interrupted`, if there was an active one. */
  interruptedAttemptId: string | null;
  /** The runtime session link this mission was running on (if linked). */
  runtimeSessionLinkId: string | null;
  /** §24.5: the last safe checkpoint to resume from, or null if none was recorded. */
  lastSafeBoundary: string | null;
  /** §22.3.5 classification of the runtime session link. */
  classification: RecoveryClassification;
  /** Whether the stored compatibility hash matched the current runtime (§29). */
  compatible: boolean;
  /** §24.5: unfinished operations (the criteria that had not reached a terminal verdict). */
  unfinishedOperations: UnfinishedOperation[];
  /** §24.5: whether side effects may already have happened (any non-auto-retryable unfinished op). */
  possibleSideEffects: boolean;
  /** DR-004: pending interactions that survived the restart, still unanswered. */
  pendingInteractions: SurfacedPendingInteraction[];
  /** §24.5: a plain-language description of what a resume will do. */
  whatResumeWillDo: string;
  /** Structured reasons behind the classification (e.g. hash mismatch, no lease). */
  classificationReasons: string[];
}

/** The structured result of a startup reconciliation pass (DR-003). */
export interface ReconciliationResult {
  cards: RecoveryCard[];
  /**
   * INVARIANT (PRD §22.3.6): reconciliation NEVER auto-resumes. This is always
   * false — it is part of the contract that the result is presented, not acted on.
   */
  autoResumed: false;
}
