/**
 * Durable Mission Recovery oracle (PRD §22, slice M4 — DR-001..006).
 *
 * Drives the deterministic recovery logic over a REAL {@link MissionService}
 * (MS-002) on the MS-001 in-memory mission repos. No model, no real workspace, no
 * Pi: every checkpoint predicate, hash, reconciliation transition, retry-safety
 * gate, and resume plan is a pure function of injected facts + repos, so each run
 * is byte-stable. Style mirrors the other `scripts/harness-mission-*.mts` oracles.
 *
 * Covers each DR:
 *   (a) DR-001 isSafeBoundary — true only when ALL §22.2 conditions hold; toggling
 *       any single one false → false. recordSafeBoundary refuses a non-safe point
 *       and writes last_safe_boundary + status='active' at a safe point.
 *   (b) DR-002 computeCompatibilityHash — deterministic, stable under reordering of
 *       extensions/tool ids/skill ids; isCompatible match/mismatch.
 *   (c) DR-003 reconcileInterruptedMissions — a running mission's attempt becomes
 *       'interrupted', the mission reaches ready_to_resume, a recovery card is
 *       returned; a compatibility-hash mismatch classifies the card incompatible.
 *   (d) DR-005/DR-006 retry-safety — canAutoRetry only for safe/idempotent_with_key;
 *       an 'unsafe'/'unknown' op is excluded from a resume plan's auto-replay set.
 *   (e) DR-003 default — reconciliation NEVER auto-resumes (autoResumed === false).
 *
 * Inject-proof (run manually, then revert): break the compatibility check by
 * making `isCompatible` ignore mismatches → the incompatible-classification check
 * (c) fails. That proves the check exercises the real rule, not a tautology.
 */

import assert from 'node:assert/strict';
import {
  computeCompatibilityHash,
  isCompatible,
} from '../packages/core/src/runtime/mission/recovery/compatibility-hash.ts';
import {
  reconcileInterruptedMissions,
} from '../packages/core/src/runtime/mission/recovery/reconciliation.ts';
import {
  isSafeBoundary,
  recordSafeBoundary,
  unmetSafeBoundaryReasons,
  type SafeBoundaryInput,
} from '../packages/core/src/runtime/mission/recovery/safe-boundary.ts';
import {
  canAutoRetry,
  evaluatorRetrySafety,
} from '../packages/core/src/runtime/mission/recovery/retry-safety.ts';
import { planResume, unsafeOperationsInAutoReplay } from '../packages/core/src/runtime/mission/recovery/resume-plan.ts';
import type {
  CompatibilityResources,
  RecoveryCard,
} from '../packages/core/src/runtime/mission/recovery/types.ts';
import {
  createMissionService,
  type CreateMissionInput,
  type MissionService,
  type MissionServiceDeps,
} from '../packages/core/src/runtime/mission/mission-service.ts';
import {
  createMissionMemoryRepos,
  type MissionMemoryRepos,
} from '../packages/core/src/runtime/repos/mission/memory.ts';

let passed = 0;
let failed = 0;
const TOTAL = 16;

async function check(name: string, run: () => void | Promise<void>): Promise<void> {
  try {
    await run();
    passed += 1;
    console.log(`  ✓ ${name}`);
  } catch (error) {
    failed += 1;
    const message = error instanceof Error ? (error.stack ?? error.message) : String(error);
    console.error(`  ✗ ${name}\n    ${message}`);
  }
}

// ---------------------------------------------------------------------------
// Deterministic id/clock + repos + service, mirroring the mission harnesses.
// ---------------------------------------------------------------------------

function makeDeps(): MissionServiceDeps {
  let idSeq = 0;
  let clockSeq = 0;
  return {
    newId: () => `id-${(idSeq += 1).toString().padStart(4, '0')}`,
    now: () => new Date(Date.UTC(2026, 0, 1, 0, 0, 0, (clockSeq += 1))).toISOString(),
  };
}

function freshService(): { svc: MissionService; deps: MissionServiceDeps; m: MissionMemoryRepos } {
  const m = createMissionMemoryRepos();
  const deps = makeDeps();
  const svc = createMissionService(
    {
      missions: m.missions,
      missionCriteria: m.missionCriteria,
      missionAttempts: m.missionAttempts,
      missionEvaluations: m.missionEvaluations,
      missionEvents: m.missionEvents,
    },
    deps,
  );
  return { svc, deps, m };
}

async function createMission(
  svc: MissionService,
  input?: Partial<CreateMissionInput>,
): Promise<string> {
  const created = await svc.createMission({
    companyId: 'co-1',
    threadId: 'thr-1',
    title: 'Ship the thing',
    goal: 'Verifiably done',
    runtimeId: 'pi',
    runtimePolicyJson: '{}',
    budgetJson: '{}',
    criteria: [
      { description: 'tests pass', evaluatorId: 'command_exit_zero', required: true },
      { description: 'file exists', evaluatorId: 'file_exists', required: true },
    ],
    ...input,
  });
  return created.mission_id;
}

/** A fully-met SafeBoundaryInput; tests toggle one field false to disqualify. */
function safeInput(overrides?: Partial<SafeBoundaryInput>): SafeBoundaryInput {
  return {
    agentTurnSettled: true,
    allToolCallsTerminal: true,
    pendingInteractionsPersisted: true,
    artifactMetadataCommitted: true,
    evaluationsCommitted: true,
    resumableSessionRef: 'session:abc#turn-3',
    ...overrides,
  };
}

const baseResources: CompatibilityResources = {
  sdkId: 'pi',
  sdkVersion: '0.79.8',
  extensions: [
    { id: 'offisim-bridge', version: '1.0.0' },
    { id: 'mission-bridge', version: '2.1.0' },
  ],
  toolIds: ['read', 'write', 'bash', 'grep'],
  skillIds: ['skill-b', 'skill-a'],
  systemPromptVersion: 'sp-v3',
};

// ===========================================================================
// (a) DR-001 — isSafeBoundary + recordSafeBoundary.
// ===========================================================================

await check('DR-001: isSafeBoundary true only when ALL conditions hold', () => {
  assert.equal(isSafeBoundary(safeInput()), true, 'all conditions met → safe boundary');
});

await check('DR-001: toggling ANY single condition false → not a safe boundary', () => {
  const keys: Array<keyof SafeBoundaryInput> = [
    'agentTurnSettled',
    'allToolCallsTerminal',
    'pendingInteractionsPersisted',
    'artifactMetadataCommitted',
    'evaluationsCommitted',
  ];
  for (const key of keys) {
    const input = safeInput({ [key]: false } as Partial<SafeBoundaryInput>);
    assert.equal(isSafeBoundary(input), false, `${key} false → not safe`);
    assert.ok(unmetSafeBoundaryReasons(input).length >= 1, `${key} false yields a reason`);
  }
  // The resumable session ref is the sixth condition (a null / empty ref disqualifies).
  assert.equal(isSafeBoundary(safeInput({ resumableSessionRef: null })), false, 'null ref → not safe');
  assert.equal(isSafeBoundary(safeInput({ resumableSessionRef: '' })), false, 'empty ref → not safe');
});

await check('DR-001: recordSafeBoundary refuses a non-safe point; writes at a safe point', async () => {
  const { m } = freshService();
  const linkId = 'rsl-1';
  await m.runtimeSessionLinks.insert({
    runtime_session_link_id: linkId,
    mission_id: 'mis-1',
    runtime_id: 'pi',
    runtime_version: '0.79.8',
    opaque_session_ref_json: '{}',
    compatibility_hash: null,
    workspace_lease_id: null,
    last_safe_boundary: null,
    status: 'active',
  });

  // Non-safe point: a tool call is not terminal → refuse, nothing written.
  const refused = await recordSafeBoundary(
    'mis-1',
    linkId,
    'boundary:1',
    safeInput({ allToolCallsTerminal: false }),
    m.runtimeSessionLinks,
  );
  assert.equal(refused.recorded, false, 'non-safe point → not recorded');
  assert.ok((refused.unmet ?? []).some((r) => /tool call/.test(r)), 'reason names the unmet condition');
  const stillNull = await m.runtimeSessionLinks.findById(linkId);
  assert.equal(stillNull?.last_safe_boundary, null, 'no boundary written at a non-safe point');

  // Safe point → boundary recorded + status set to the live resumable state.
  const ok = await recordSafeBoundary('mis-1', linkId, 'boundary:2', safeInput(), m.runtimeSessionLinks);
  assert.equal(ok.recorded, true, 'safe point → recorded');
  const after = await m.runtimeSessionLinks.findById(linkId);
  assert.equal(after?.last_safe_boundary, 'boundary:2', 'last_safe_boundary persisted');
  assert.equal(after?.status, 'active', 'status set to active at a safe boundary');
});

await check('DR-001: recordSafeBoundary rejects a link belonging to another mission', async () => {
  const { m } = freshService();
  await m.runtimeSessionLinks.insert({
    runtime_session_link_id: 'rsl-x',
    mission_id: 'mis-OWNER',
    runtime_id: 'pi',
    runtime_version: '0.79.8',
    opaque_session_ref_json: '{}',
    compatibility_hash: null,
    workspace_lease_id: null,
    last_safe_boundary: null,
    status: 'active',
  });
  const res = await recordSafeBoundary('mis-OTHER', 'rsl-x', 'b', safeInput(), m.runtimeSessionLinks);
  assert.equal(res.recorded, false, 'cross-mission link write is refused');
});

// ===========================================================================
// (b) DR-002 — compatibility hash determinism + stability + isCompatible.
// ===========================================================================

await check('DR-002: computeCompatibilityHash is deterministic (same input → same hash)', async () => {
  const h1 = await computeCompatibilityHash(baseResources);
  const h2 = await computeCompatibilityHash({ ...baseResources });
  assert.equal(h1, h2, 'identical resources hash identically');
});

await check('DR-002: hash is stable under reordering of extensions / tool ids / skill ids', async () => {
  const base = await computeCompatibilityHash(baseResources);
  const reordered: CompatibilityResources = {
    ...baseResources,
    extensions: [...baseResources.extensions].reverse(),
    toolIds: ['grep', 'bash', 'write', 'read'],
    skillIds: ['skill-a', 'skill-b'],
  };
  const h = await computeCompatibilityHash(reordered);
  assert.equal(h, base, 'reordering order-insensitive fields does not change the hash');
});

await check('DR-002: a real resource difference changes the hash; isCompatible match/mismatch', async () => {
  const base = await computeCompatibilityHash(baseResources);
  const bumped = await computeCompatibilityHash({ ...baseResources, sdkVersion: '0.80.2' });
  assert.notEqual(bumped, base, 'a different SDK version yields a different hash');

  assert.equal(isCompatible(base, base), true, 'identical hashes are compatible');
  assert.equal(isCompatible(base, bumped), false, 'different hashes are incompatible');
  assert.equal(isCompatible(null, base), false, 'a null stored hash is never compatible');
  assert.equal(isCompatible(undefined, base), false, 'an undefined stored hash is never compatible');
});

// ===========================================================================
// (c) DR-003 — reconcileInterruptedMissions.
// ===========================================================================

/** Bring a fresh mission to `running` with a runtime session link bound. */
async function runningMissionWithLink(
  svc: MissionService,
  m: MissionMemoryRepos,
  opts: { compatibilityHash: string | null; workspaceLeaseId: string | null; lastSafeBoundary: string | null },
): Promise<{ missionId: string; attemptId: string; linkId: string }> {
  const missionId = await createMission(svc);
  await svc.markReady(missionId);
  const running = await svc.startAttempt(missionId, 'initial');
  const attemptId = running.current_attempt_id!;
  const linkId = `rsl-${missionId}`;
  await m.runtimeSessionLinks.insert({
    runtime_session_link_id: linkId,
    mission_id: missionId,
    runtime_id: 'pi',
    runtime_version: '0.79.8',
    opaque_session_ref_json: '{}',
    compatibility_hash: opts.compatibilityHash,
    workspace_lease_id: opts.workspaceLeaseId,
    last_safe_boundary: opts.lastSafeBoundary,
    status: 'active',
  });
  return { missionId, attemptId, linkId };
}

await check('DR-003: a running mission → attempt interrupted, mission ready_to_resume, card returned (resumable)', async () => {
  const { svc, deps, m } = freshService();
  const currentHash = 'sha256:CURRENT';
  const { missionId, attemptId } = await runningMissionWithLink(svc, m, {
    compatibilityHash: currentHash,
    workspaceLeaseId: 'lease-1',
    lastSafeBoundary: 'boundary:42',
  });

  const result = await reconcileInterruptedMissions({
    missionService: svc,
    repos: {
      missions: m.missions,
      missionCriteria: m.missionCriteria,
      missionAttempts: m.missionAttempts,
      runtimeSessionLinks: m.runtimeSessionLinks,
    },
    currentCompatibilityHash: currentHash,
    now: deps.now,
    companyIds: ['co-1'],
  });

  assert.equal(result.cards.length, 1, 'one interrupted mission → one card');
  const card = result.cards[0]!;
  assert.equal(card.missionId, missionId, 'card is for the interrupted mission');

  // The active attempt is now 'interrupted'.
  const attempt = await m.missionAttempts.findById(attemptId);
  assert.equal(attempt?.status, 'interrupted', '§22.3.2: active attempt marked interrupted');
  assert.equal(card.interruptedAttemptId, attemptId, 'card names the interrupted attempt');

  // The mission reached ready_to_resume via the §18 path.
  const mission = await svc.getMission(missionId);
  assert.equal(mission.status, 'ready_to_resume', 'mission parked in ready_to_resume');
  assert.equal(card.missionStatus, 'ready_to_resume', 'card reflects ready_to_resume');

  // Compatible + leased → resumable; last safe checkpoint surfaced.
  assert.equal(card.classification, 'resumable', 'compatible + leased → resumable');
  assert.equal(card.compatible, true, 'compatibility hash matched');
  assert.equal(card.lastSafeBoundary, 'boundary:42', '§24.5: last safe checkpoint shown');

  // Both required criteria were still pending → both are unfinished operations.
  assert.equal(card.unfinishedOperations.length, 2, 'both pending criteria are unfinished ops');

  // The §18 event trail proves the transitions went through the single writer.
  const events = await m.missionEvents.listByMission(missionId);
  const types = events.map((e) => e.type);
  assert.ok(types.includes('mission.interrupted'), 'mission.interrupted event written');
  assert.ok(types.includes('mission.ready_to_resume'), 'mission.ready_to_resume event written');
});

await check('DR-003: compatibility-hash mismatch → card classified incompatible', async () => {
  const { svc, deps, m } = freshService();
  const { missionId } = await runningMissionWithLink(svc, m, {
    compatibilityHash: 'sha256:OLD',
    workspaceLeaseId: 'lease-1',
    lastSafeBoundary: 'boundary:1',
  });

  const result = await reconcileInterruptedMissions({
    missionService: svc,
    repos: {
      missions: m.missions,
      missionCriteria: m.missionCriteria,
      missionAttempts: m.missionAttempts,
      runtimeSessionLinks: m.runtimeSessionLinks,
    },
    currentCompatibilityHash: 'sha256:NEW', // differs from the stored hash
    now: deps.now,
    companyIds: ['co-1'],
  });

  const card = result.cards[0]!;
  assert.equal(card.classification, 'incompatible', '§29: hash mismatch → incompatible (resume blocked)');
  assert.equal(card.compatible, false, 'card reports not compatible');
  // The mission still parks in ready_to_resume; the CARD (not the status) gates Resume.
  const mission = await svc.getMission(missionId);
  assert.equal(mission.status, 'ready_to_resume', 'mission still reaches ready_to_resume');
  // The link is marked incompatible.
  const link = await m.runtimeSessionLinks.findById(`rsl-${missionId}`);
  assert.equal(link?.status, 'incompatible', 'runtime session link marked incompatible');
});

await check('DR-003: missing workspace lease (compatible) → needs_user_confirm', async () => {
  const { svc, deps, m } = freshService();
  const currentHash = 'sha256:SAME';
  await runningMissionWithLink(svc, m, {
    compatibilityHash: currentHash,
    workspaceLeaseId: null, // no lease
    lastSafeBoundary: null,
  });
  const result = await reconcileInterruptedMissions({
    missionService: svc,
    repos: {
      missions: m.missions,
      missionCriteria: m.missionCriteria,
      missionAttempts: m.missionAttempts,
      runtimeSessionLinks: m.runtimeSessionLinks,
    },
    currentCompatibilityHash: currentHash,
    now: deps.now,
    companyIds: ['co-1'],
  });
  const card = result.cards[0]!;
  assert.equal(card.classification, 'needs_user_confirm', 'compatible but no lease → needs confirm');
  assert.equal(card.compatible, true, 'still compatible');
});

// ---------------------------------------------------------------------------
// DR-003 two-hop path: a mission interrupted mid-REPAIR. §18 has no direct
// repairing → interrupted edge; reconciliation must route repairing → running →
// interrupted → ready_to_resume through MissionService. This path was previously
// unproven — if it ever breaks, a mid-repair crash is irrecoverable with no card.
// ---------------------------------------------------------------------------

await check('DR-003: a REPAIRING mission reconciles via the two-hop §18 path → ready_to_resume (resumable)', async () => {
  const { svc, deps, m } = freshService();
  const currentHash = 'sha256:REPAIR';

  // Drive a mission all the way into `repairing`: ready → running → verifying →
  // toRepairing (the loop's repair decision). The mission is now 'repairing' with
  // a bound (running-then-interrupted-candidate) attempt.
  const missionId = await createMission(svc);
  await svc.markReady(missionId);
  const running = await svc.startAttempt(missionId, 'initial');
  const attemptId = running.current_attempt_id!;
  await svc.beginVerifying(missionId);
  await svc.toRepairing(missionId, attemptId, 'sig:first-fail');
  const beforeRepairing = await svc.getMission(missionId);
  assert.equal(beforeRepairing.status, 'repairing', 'mission is in repairing before the crash');

  // Seed a compatible, leased runtime session link.
  await m.runtimeSessionLinks.insert({
    runtime_session_link_id: `rsl-${missionId}`,
    mission_id: missionId,
    runtime_id: 'pi',
    runtime_version: '0.79.8',
    opaque_session_ref_json: '{}',
    compatibility_hash: currentHash,
    workspace_lease_id: 'lease-r',
    last_safe_boundary: 'boundary:r',
    status: 'active',
  });

  const result = await reconcileInterruptedMissions({
    missionService: svc,
    repos: {
      missions: m.missions,
      missionCriteria: m.missionCriteria,
      missionAttempts: m.missionAttempts,
      runtimeSessionLinks: m.runtimeSessionLinks,
    },
    currentCompatibilityHash: currentHash,
    now: deps.now,
    companyIds: ['co-1'],
  });

  // Exactly one card, classified resumable.
  assert.equal(result.cards.length, 1, 'a repairing mission yields exactly one recovery card');
  const card = result.cards[0]!;
  assert.equal(card.missionId, missionId, 'card is for the repairing mission');
  assert.equal(card.classification, 'resumable', 'compatible + leased → resumable');

  // The mission reached ready_to_resume via repairing → running → interrupted →
  // ready_to_resume (all legal §18 edges through the single writer).
  const mission = await svc.getMission(missionId);
  assert.equal(mission.status, 'ready_to_resume', 'two-hop path lands in ready_to_resume');
  assert.equal(card.missionStatus, 'ready_to_resume', 'card reflects ready_to_resume');

  // The active attempt is now interrupted.
  const attempt = await m.missionAttempts.findById(attemptId);
  assert.equal(attempt?.status, 'interrupted', '§22.3.2: the active attempt is interrupted');
  assert.equal(card.interruptedAttemptId, attemptId, 'card names the interrupted attempt');

  // The event trail proves the two-hop sequence: a `mission.resumed` (repairing →
  // running) precedes `mission.interrupted` then `mission.ready_to_resume`.
  const types = (await m.missionEvents.listByMission(missionId)).map((e) => e.type);
  const iResumed = types.indexOf('mission.resumed');
  const iInterrupted = types.indexOf('mission.interrupted');
  const iReady = types.lastIndexOf('mission.ready_to_resume');
  assert.ok(iResumed >= 0, 'repairing → running fired a mission.resumed event');
  assert.ok(iInterrupted > iResumed, 'mission.interrupted followed the repairing → running hop');
  assert.ok(iReady > iInterrupted, 'mission.ready_to_resume followed interrupted');
});

// ---------------------------------------------------------------------------
// DR-003 unbounded scan: a company with >100 non-terminal missions must NOT drop
// any crashed mission. listByStatus is unbounded (no 100-row default), so EVERY
// running mission gets a card. This guards the data-integrity gap where missions
// beyond slot 100 of listByCompany would stay stuck forever.
// ---------------------------------------------------------------------------

await check('DR-003: >100 interrupted missions all get a card (listByStatus is unbounded, no 100 cap)', async () => {
  const { svc, deps, m } = freshService();
  const currentHash = 'sha256:BULK';
  const N = 150; // exceeds the listByCompany default limit of 100

  const expectedIds = new Set<string>();
  for (let i = 0; i < N; i += 1) {
    // Use the helper's default criteria (two required): a mission must gate on at
    // least one required criterion (§18.1 / A1), so an empty-criteria mission is
    // no longer creatable. This test only cares about the mission COUNT, not the
    // criteria, so the default set is fine.
    const missionId = await createMission(svc);
    await svc.markReady(missionId);
    await svc.startAttempt(missionId, 'initial'); // → running
    expectedIds.add(missionId);
  }
  // Sanity: listByCompany (default cap) would only see 100 of them.
  const capped = await m.missions.listByCompany('co-1');
  assert.equal(capped.length, 100, 'listByCompany is capped at the 100 default — proves the risk is real');

  const result = await reconcileInterruptedMissions({
    missionService: svc,
    repos: {
      missions: m.missions,
      missionCriteria: m.missionCriteria,
      missionAttempts: m.missionAttempts,
      runtimeSessionLinks: m.runtimeSessionLinks,
    },
    currentCompatibilityHash: currentHash,
    now: deps.now,
    companyIds: ['co-1'],
  });

  assert.equal(result.cards.length, N, `all ${N} interrupted missions reconciled — none dropped beyond 100`);
  const cardIds = new Set(result.cards.map((c) => c.missionId));
  assert.equal(cardIds.size, N, 'every card is for a distinct mission');
  for (const id of expectedIds) {
    assert.ok(cardIds.has(id), `mission ${id} was reconciled (not dropped)`);
  }
});

// ===========================================================================
// (d) DR-005 + DR-006 — retry-safety gate + resume-plan exclusion of unsafe ops.
// ===========================================================================

await check('DR-005: canAutoRetry only for safe / idempotent_with_key', () => {
  assert.equal(canAutoRetry({ retrySafety: 'safe' }), true, 'safe → auto-retryable');
  assert.equal(canAutoRetry({ retrySafety: 'idempotent_with_key' }), true, 'idempotent_with_key → auto-retryable');
  assert.equal(canAutoRetry({ retrySafety: 'unsafe' }), false, 'unsafe → NOT auto-retryable');
  assert.equal(canAutoRetry({ retrySafety: 'unknown' }), false, 'unknown → NOT auto-retryable');

  // The MS-003 read-only evaluators are 'safe'; command_exit_zero is 'unknown'.
  assert.equal(evaluatorRetrySafety('file_exists'), 'safe', 'file_exists re-evaluates safely');
  assert.equal(evaluatorRetrySafety('artifact_published'), 'safe', 'artifact_published is read-only');
  assert.equal(evaluatorRetrySafety('manual_approval'), 'safe', 'manual_approval re-reads a durable row');
  assert.equal(evaluatorRetrySafety('command_exit_zero'), 'unknown', 'command_exit_zero is never auto-replayed');
  assert.equal(evaluatorRetrySafety('nope'), 'unknown', 'an undeclared id defaults to unknown');
});

await check('DR-006: a resume plan excludes unsafe/unknown ops from auto-replay (no auto-replay of unsafe)', () => {
  const card: RecoveryCard = {
    missionId: 'mis-1',
    companyId: 'co-1',
    title: 'M',
    missionStatus: 'ready_to_resume',
    interruptedAttemptId: 'att-1',
    runtimeSessionLinkId: 'rsl-1',
    lastSafeBoundary: 'boundary:9',
    classification: 'resumable',
    compatible: true,
    unfinishedOperations: [
      { id: 'file_exists', kind: 'evaluation', retrySafety: 'safe', autoRetryable: true, description: 'file exists' },
      { id: 'command_exit_zero', kind: 'evaluation', retrySafety: 'unknown', autoRetryable: false, description: 'run tests' },
      { id: 'deploy_tool', kind: 'tool_call', retrySafety: 'unsafe', autoRetryable: false, description: 'deploy' },
    ],
    possibleSideEffects: true,
    pendingInteractions: [],
    whatResumeWillDo: '',
    classificationReasons: [],
  };

  const plan = planResume(card);
  assert.equal(plan.canResume, true, 'a resumable card yields an executable plan');
  assert.equal(plan.fromSafeBoundary, 'boundary:9', 'plan resumes from the last safe boundary');

  // ONLY the safe op is in the auto-replay set; the unknown + unsafe ops are held.
  assert.deepEqual(
    plan.autoReplayOperations.map((o) => o.id),
    ['file_exists'],
    '§22.4: only safe/idempotent ops auto-replay',
  );
  assert.deepEqual(
    plan.heldOperations.map((o) => o.id).sort(),
    ['command_exit_zero', 'deploy_tool'],
    'unsafe + unknown ops are held for user confirmation',
  );
  // The defensive assertion: NO unsafe/unknown op leaked into auto-replay.
  assert.equal(unsafeOperationsInAutoReplay(plan).length, 0, 'no unsafe op in the auto-replay set');

  // The interruption fact is structured (§22.3.8) and names the held ops.
  assert.equal(plan.interruptionFact.type, 'mission_interrupted', 'structured interruption fact');
  assert.deepEqual(
    plan.interruptionFact.operationsHeldForConfirmation.sort(),
    ['command_exit_zero', 'deploy_tool'],
    'fact lists the operations held for confirmation',
  );
});

await check('DR-006: an incompatible card yields a refusal plan with NO auto-replay set (§29)', () => {
  const card: RecoveryCard = {
    missionId: 'mis-2',
    companyId: 'co-1',
    title: 'M2',
    missionStatus: 'ready_to_resume',
    interruptedAttemptId: 'att-2',
    runtimeSessionLinkId: 'rsl-2',
    lastSafeBoundary: 'boundary:1',
    classification: 'incompatible',
    compatible: false,
    unfinishedOperations: [
      { id: 'file_exists', kind: 'evaluation', retrySafety: 'safe', autoRetryable: true, description: 'file exists' },
    ],
    possibleSideEffects: false,
    pendingInteractions: [],
    whatResumeWillDo: '',
    classificationReasons: ['hash mismatch'],
  };
  const plan = planResume(card);
  assert.equal(plan.canResume, false, 'incompatible → cannot resume');
  assert.equal(plan.autoReplayOperations.length, 0, '§29: an incompatible mission auto-replays nothing');
  assert.ok(plan.refusalReason, 'a refusal reason is given');
});

// ===========================================================================
// (e) DR-003 default — reconciliation NEVER auto-resumes.
// ===========================================================================

await check('DR-003 default: reconciliation never auto-resumes (autoResumed === false, no mission re-runs)', async () => {
  const { svc, deps, m } = freshService();
  const currentHash = 'sha256:SAME';
  const { missionId } = await runningMissionWithLink(svc, m, {
    compatibilityHash: currentHash,
    workspaceLeaseId: 'lease-1',
    lastSafeBoundary: 'boundary:1',
  });
  const result = await reconcileInterruptedMissions({
    missionService: svc,
    repos: {
      missions: m.missions,
      missionCriteria: m.missionCriteria,
      missionAttempts: m.missionAttempts,
      runtimeSessionLinks: m.runtimeSessionLinks,
    },
    currentCompatibilityHash: currentHash,
    now: deps.now,
    companyIds: ['co-1'],
  });
  assert.equal(result.autoResumed, false, '§22.3.6: reconciliation NEVER auto-resumes');
  // The mission rests in ready_to_resume — it was NOT advanced back to running.
  const mission = await svc.getMission(missionId);
  assert.equal(mission.status, 'ready_to_resume', 'no auto-resume — mission stays ready_to_resume');
  // No new attempt was started (still exactly one attempt, the interrupted one).
  const attempts = await m.missionAttempts.listByMission(missionId);
  assert.equal(attempts.length, 1, 'no new attempt minted — nothing was re-run');
});

if (failed > 0) {
  console.error(`\nmission-recovery: ${passed}/${TOTAL} passed (${failed} failed)`);
  process.exit(1);
}
console.log(`\nmission-recovery: ${passed}/${TOTAL} passed`);
