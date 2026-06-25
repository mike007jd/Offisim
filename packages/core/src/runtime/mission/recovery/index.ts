/**
 * Durable Mission Recovery barrel (PRD §22, slice M4 — DR-001..006).
 *
 * Additive over the M2 Mission core. Re-exported from `@offisim/core/browser` so
 * the live startup hook + the harness consume the deterministic recovery logic
 * through the public entry. Every piece is pure logic over injected repos /
 * clock — no node fs / shell / Pi here. The live resume + the crash `.app` test
 * are the M-pass; this slice is the logic + its harness.
 */

// DR-001 — Safe boundary / checkpoint model.
export {
  isSafeBoundary,
  unmetSafeBoundaryReasons,
  recordSafeBoundary,
} from './safe-boundary.js';
export type { SafeBoundaryInput, RecordSafeBoundaryResult } from './safe-boundary.js';

// DR-002 — Runtime compatibility hash.
export { computeCompatibilityHash, isCompatible } from './compatibility-hash.js';
export type { CompatibilityResources, RuntimeExtensionRef } from './compatibility-hash.js';

// DR-003 — Startup interrupted-mission reconciliation.
export { reconcileInterruptedMissions } from './reconciliation.js';
export type {
  ReconciliationRepos,
  ReconcileInterruptedMissionsInput,
} from './reconciliation.js';

// DR-004/DR-003 — recovery card + reconciliation result shapes.
export type {
  RecoveryCard,
  RecoveryClassification,
  ReconciliationResult,
  SurfacedPendingInteraction,
  UnfinishedOperation,
} from './types.js';

// DR-005 — Retry-safety metadata.
export {
  canAutoRetry,
  evaluatorRetrySafety,
  EVALUATOR_RETRY_SAFETY,
} from './retry-safety.js';
export type { RetrySafety, RetrySafetyMeta } from './retry-safety.js';

// DR-006 — Pi session resume integration (plan only).
export { planResume, unsafeOperationsInAutoReplay } from './resume-plan.js';
export type { ResumePlan, InterruptionFact } from './resume-plan.js';
