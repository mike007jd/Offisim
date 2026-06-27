/**
 * DR-003 — Startup interrupted-mission reconciliation (PRD §22.3, slice M4).
 *
 * On app startup the host calls {@link reconcileInterruptedMissions}: it finds
 * missions left in `running` / `verifying` / `repairing` by a crash, marks each
 * one's active attempt `interrupted`, transitions the mission through the §18
 * recovery path (running/verifying → interrupted → ready_to_resume), classifies
 * the runtime session link (resumable / needs-user-confirm / incompatible), and
 * returns a {@link RecoveryCard} per mission. It also surfaces any pending
 * interactions that survived the restart (DR-004).
 *
 * CONTRACT (PRD §22.3.6): it NEVER auto-resumes. The result is presented to the
 * user; nothing is re-run here. ALL mission status writes go through
 * {@link MissionService} (the §18 single writer) — reconciliation never writes
 * `mission.status` directly.
 *
 * Determinism: `now` is injected (no `Date.now()`); the function reads + mints
 * nothing of its own beyond what the service mints.
 *
 * Additive at M4 — the live startup hook calls this at the M-pass.
 */

import type {
  ActiveInteractionRepository,
  MissionAttemptRepository,
  MissionCriterionRepository,
  MissionRepository,
  MissionRow,
  RuntimeSessionLinkRepository,
  RuntimeSessionLinkRow,
} from '../../repositories.js';
import type { MissionService } from '../mission-service.js';
import { isCompatible } from './compatibility-hash.js';
import { canAutoRetry, evaluatorRetrySafety } from './retry-safety.js';
import type {
  ReconciliationResult,
  RecoveryCard,
  RecoveryClassification,
  SurfacedPendingInteraction,
  UnfinishedOperation,
} from './types.js';

/** Mission statuses a crash can leave mid-flight (PRD §22.3.1). */
const RECOVERABLE_STATUSES = ['running', 'verifying', 'repairing'] as const;

/** The repo subset reconciliation reads (beyond the MissionService it writes through). */
export interface ReconciliationRepos {
  missions: MissionRepository;
  missionCriteria: MissionCriterionRepository;
  missionAttempts: MissionAttemptRepository;
  runtimeSessionLinks: RuntimeSessionLinkRepository;
  /** DR-004: the live pending-interaction store (interaction_active). Optional. */
  activeInteractions?: ActiveInteractionRepository;
}

export interface ReconcileInterruptedMissionsInput {
  missionService: MissionService;
  repos: ReconciliationRepos;
  /** The compatibility hash of the runtime that WOULD resume now (§34-Q5). */
  currentCompatibilityHash: string;
  /** Injected clock for the attempt's `finished_at` stamp (determinism). */
  now: () => string;
  /** Limit on companies scanned is the caller's concern; this scans the companies given. */
  companyIds: string[];
}

/**
 * Reconcile every interrupted mission across the given companies. Returns a card
 * per mission. Never auto-resumes (§22.3.6).
 */
export async function reconcileInterruptedMissions(
  input: ReconcileInterruptedMissionsInput,
): Promise<ReconciliationResult> {
  const { missionService, repos, currentCompatibilityHash, now, companyIds } = input;

  const cards: RecoveryCard[] = [];

  for (const companyId of companyIds) {
    // listByStatus is UNBOUNDED (no 100-row cap): a company with >100 missions
    // must not silently drop a crashed one, or it stays stuck running/verifying/
    // repairing forever (DR-003 data-integrity gap). It also avoids the full
    // company scan by filtering to non-terminal statuses in the query.
    const missions = await repos.missions.listByStatus(companyId, RECOVERABLE_STATUSES);
    for (const mission of missions) {
      cards.push(
        await reconcileOne(mission, {
          missionService,
          repos,
          currentCompatibilityHash,
          now,
        }),
      );
    }
  }

  return { cards, autoResumed: false };
}

interface ReconcileOneDeps {
  missionService: MissionService;
  repos: ReconciliationRepos;
  currentCompatibilityHash: string;
  now: () => string;
}

async function reconcileOne(mission: MissionRow, deps: ReconcileOneDeps): Promise<RecoveryCard> {
  const { missionService, repos, currentCompatibilityHash, now } = deps;
  const missionId = mission.mission_id;

  // --- 1. mark the active attempt `interrupted` (§22.3.2) -------------------
  // The active attempt is the one the mission is bound to (current_attempt_id),
  // or the latest non-terminal attempt as a fallback.
  const interruptedAttemptId = await markActiveAttemptInterrupted(mission, repos, now);

  // --- 2. transition the mission through the §18 recovery path --------------
  // §18 only allows running/verifying → interrupted. A `repairing` mission goes
  // repairing → running first (the only legal edge out of repairing besides
  // cancel/pause), then running → interrupted, so the single writer's transition
  // map is never violated.
  if (mission.status === 'repairing') {
    await missionService.resume(missionId, 'running');
  }
  await missionService.toInterrupted(missionId);
  // After interrupted, advance to ready_to_resume so the UI Resume action is legal
  // (interrupted → ready_to_resume per §18). We do this unconditionally — a
  // resumable OR incompatible mission still parks in ready_to_resume; the card's
  // classification, not the mission status, decides whether Resume is offered.
  await missionService.toReadyToResume(missionId);
  const after = await missionService.getMission(missionId);

  // --- 3. classify the runtime session link (§22.3.3-5) --------------------
  const link = await latestSessionLink(missionId, repos.runtimeSessionLinks);
  const { classification, compatible, reasons } = classifyLink(link, currentCompatibilityHash);

  // Reflect the classification onto the link status (incompatible links are
  // marked so; resumable/needs-confirm links go to `interrupted` = recoverable).
  if (link) {
    await repos.runtimeSessionLinks.update(link.runtime_session_link_id, {
      status: classification === 'incompatible' ? 'incompatible' : 'interrupted',
    });
  }

  // --- 4. unfinished operations (§24.5) ------------------------------------
  const unfinishedOperations = await collectUnfinishedOperations(missionId, repos);
  const possibleSideEffects = unfinishedOperations.some((op) => !op.autoRetryable);

  // --- 5. surface surviving pending interactions (DR-004) ------------------
  const pendingInteractions = await surfacePendingInteractions(mission.thread_id, repos);

  return {
    missionId,
    companyId: mission.company_id,
    title: mission.title,
    missionStatus: after.status,
    interruptedAttemptId,
    runtimeSessionLinkId: link?.runtime_session_link_id ?? null,
    lastSafeBoundary: link?.last_safe_boundary ?? null,
    classification,
    compatible,
    unfinishedOperations,
    possibleSideEffects,
    pendingInteractions,
    whatResumeWillDo: describeResume(classification, link, unfinishedOperations),
    classificationReasons: reasons,
  };
}

// ---------------------------------------------------------------------------
// Helpers.
// ---------------------------------------------------------------------------

/** Mark the mission's active attempt `interrupted` (§22.3.2). Returns its id. */
async function markActiveAttemptInterrupted(
  mission: MissionRow,
  repos: ReconciliationRepos,
  now: () => string,
): Promise<string | null> {
  const attempts = await repos.missionAttempts.listByMission(mission.mission_id);
  const active =
    (mission.current_attempt_id
      ? attempts.find((a) => a.attempt_id === mission.current_attempt_id)
      : undefined) ??
    // Fallback: the latest non-terminal attempt.
    [...attempts]
      .reverse()
      .find((a) => a.status === 'running' || a.status === 'verifying');
  if (!active) return null;
  await repos.missionAttempts.updateStatus(active.attempt_id, 'interrupted', {
    finishedAt: now(),
  });
  return active.attempt_id;
}

/** The latest runtime session link for a mission (the one a resume would target). */
async function latestSessionLink(
  missionId: string,
  repo: RuntimeSessionLinkRepository,
): Promise<RuntimeSessionLinkRow | null> {
  const links = await repo.listByMission(missionId);
  if (links.length === 0) return null;
  // No created_at column on the link; the last inserted is the live one. The
  // memory + drizzle repos preserve insertion order for listByMission.
  return links[links.length - 1] ?? null;
}

/**
 * §22.3.3-5 classification. Incompatible hash → `incompatible` (resume blocked,
 * §29). Compatible but missing workspace lease → `needs_user_confirm`. Compatible
 * + leased → `resumable`. A missing link is `needs_user_confirm` (we have no
 * session to prove compatibility for).
 */
function classifyLink(
  link: RuntimeSessionLinkRow | null,
  currentHash: string,
): { classification: RecoveryClassification; compatible: boolean; reasons: string[] } {
  if (!link) {
    return {
      classification: 'needs_user_confirm',
      compatible: false,
      reasons: ['no runtime session link recorded for the mission'],
    };
  }
  const compatible = isCompatible(link.compatibility_hash, currentHash);
  if (!compatible) {
    return {
      classification: 'incompatible',
      compatible: false,
      reasons: [
        link.compatibility_hash == null
          ? 'no stored compatibility hash — cannot prove the runtime is compatible'
          : `compatibility hash mismatch (stored ${link.compatibility_hash} ≠ current ${currentHash})`,
      ],
    };
  }
  if (!link.workspace_lease_id) {
    return {
      classification: 'needs_user_confirm',
      compatible: true,
      reasons: ['no workspace lease — the working tree state must be confirmed before resume'],
    };
  }
  return { classification: 'resumable', compatible: true, reasons: [] };
}

/**
 * §24.5 unfinished operations: required criteria that had not reached a terminal
 * verdict (still `pending`) when the crash hit — those are the checks a resume
 * would re-run. Each carries its §22.4 retry-safety so the card can flag possible
 * side effects.
 */
async function collectUnfinishedOperations(
  missionId: string,
  repos: ReconciliationRepos,
): Promise<UnfinishedOperation[]> {
  const criteria = await repos.missionCriteria.listByMission(missionId);
  const ops: UnfinishedOperation[] = [];
  for (const c of criteria) {
    // A criterion that already reached a terminal verdict (pass/fail/blocked/skip)
    // is finished; only `pending` / `error` criteria are unfinished work to re-run.
    if (
      c.status === 'pass' ||
      c.status === 'fail' ||
      c.status === 'blocked' ||
      c.status === 'skip'
    ) {
      continue;
    }
    const retrySafety = evaluatorRetrySafety(c.evaluator_id);
    ops.push({
      id: c.evaluator_id,
      kind: 'evaluation',
      retrySafety,
      autoRetryable: canAutoRetry({ retrySafety }),
      description: c.description,
    });
  }
  return ops;
}

/** DR-004: pending interactions on the mission's thread that survived the restart. */
async function surfacePendingInteractions(
  threadId: string,
  repos: ReconciliationRepos,
): Promise<SurfacedPendingInteraction[]> {
  if (!repos.activeInteractions) return [];
  const active = await repos.activeInteractions.findByThread(threadId);
  if (!active) return [];
  return [
    {
      interactionId: active.interaction_id,
      threadId: active.thread_id,
      kind: active.kind,
      requestJson: active.request_json,
      createdAt: active.created_at,
    },
  ];
}

/** §24.5: a plain-language "what resume will do" line. */
function describeResume(
  classification: RecoveryClassification,
  link: RuntimeSessionLinkRow | null,
  unfinished: UnfinishedOperation[],
): string {
  if (classification === 'incompatible') {
    return 'Resume is blocked: the runtime is not compatible with the interrupted session. Inspect the differences or cancel.';
  }
  const boundary = link?.last_safe_boundary
    ? `from the last safe checkpoint (${link.last_safe_boundary})`
    : 'from the start of the interrupted attempt (no safe checkpoint was recorded)';
  const autoCount = unfinished.filter((o) => o.autoRetryable).length;
  const heldCount = unfinished.length - autoCount;
  const reEval =
    unfinished.length === 0
      ? 'No unfinished checks remain.'
      : `${autoCount} read-only check(s) will be re-evaluated; ${heldCount} operation(s) with possible side effects will NOT be auto-replayed and need your confirmation.`;
  const confirm =
    classification === 'needs_user_confirm' ? ' Workspace state must be confirmed first.' : '';
  return `Resume the same runtime session ${boundary}. ${reEval}${confirm}`;
}
