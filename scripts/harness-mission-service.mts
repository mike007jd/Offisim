/**
 * MissionService state-machine oracle (PRD §18, slice MS-002).
 *
 * Drives {@link MissionService} against the MS-001 in-memory mission repos and
 * asserts: the full happy path, every §18 invariant the service enforces, and
 * that illegal transitions / terminal states are structurally rejected. Every
 * transition must also append exactly one `mission_event` audit row.
 *
 * Pure Node via tsx against `packages/core` source — no DOM, no renderer, no Pi.
 * Deterministic: `now()` / `newId()` are injected, so ids/timestamps are stable.
 * Style mirrors the other `scripts/harness-*.mts` oracles.
 */

import assert from 'node:assert/strict';
import { createMissionMemoryRepos } from '../packages/core/src/runtime/repos/mission/memory.ts';
import {
  createMissionService,
  MissionStateError,
  type CreateMissionInput,
  type MissionServiceDeps,
  type MissionServiceRepos,
} from '../packages/core/src/runtime/mission/mission-service.ts';

let passed = 0;
const TOTAL = 8;
let failed = 0;

async function check(name: string, run: () => void | Promise<void>): Promise<void> {
  try {
    await run();
    passed += 1;
    console.log(`  ✓ ${name}`);
  } catch (error) {
    failed += 1;
    const message = error instanceof Error ? error.stack ?? error.message : String(error);
    console.error(`  ✗ ${name}\n    ${message}`);
  }
}

/** Deterministic id/clock factories so every run is byte-stable. */
function makeDeps(): MissionServiceDeps {
  let idSeq = 0;
  let clockSeq = 0;
  return {
    newId: () => `id-${(idSeq += 1).toString().padStart(4, '0')}`,
    // Monotonic ISO timestamps; one ms per call keeps created_at ordering stable.
    now: () => new Date(Date.UTC(2026, 0, 1, 0, 0, 0, (clockSeq += 1))).toISOString(),
  };
}

function freshRepos(): MissionServiceRepos {
  const m = createMissionMemoryRepos();
  return {
    missions: m.missions,
    missionCriteria: m.missionCriteria,
    missionAttempts: m.missionAttempts,
    missionEvaluations: m.missionEvaluations,
    missionEvents: m.missionEvents,
  };
}

function baseInput(overrides?: Partial<CreateMissionInput>): CreateMissionInput {
  return {
    companyId: 'co-1',
    threadId: 'thr-1',
    title: 'Ship the thing',
    goal: 'Make it verifiably done',
    runtimeId: 'pi',
    runtimePolicyJson: '{}',
    budgetJson: '{}',
    criteria: [
      { description: 'tests pass', evaluatorId: 'command_exit_zero', required: true },
      { description: 'file exists', evaluatorId: 'file_exists', required: true },
      { description: 'nice-to-have', evaluatorId: 'text_contains', required: false },
    ],
    ...overrides,
  };
}

await check('happy path: draft→ready→running→verifying→completed + one event per transition', async () => {
  const repos = freshRepos();
  const svc = createMissionService(repos, makeDeps());

  const created = await svc.createMission(baseInput());
  assert.equal(created.status, 'draft', 'createMission starts in draft');

  const criteria = await repos.missionCriteria.listByMission(created.mission_id);
  assert.equal(criteria.length, 3, 'all criteria inserted');
  assert.ok(
    criteria.every((c) => c.status === 'pending'),
    'criteria start pending',
  );

  const afterReady = await svc.markReady(created.mission_id);
  assert.equal(afterReady.status, 'ready');

  const afterRunning = await svc.startAttempt(created.mission_id, 'initial');
  assert.equal(afterRunning.status, 'running');
  assert.ok(afterRunning.current_attempt_id, '§18.2: running bound to an attempt');
  const attempts = await repos.missionAttempts.listByMission(created.mission_id);
  assert.equal(attempts.length, 1, 'one attempt created');
  assert.equal(attempts[0]?.status, 'running', '§18.2: attempt is running');
  assert.equal(attempts[0]?.attempt_id, afterRunning.current_attempt_id, 'mission bound to that attempt');

  const afterVerifying = await svc.beginVerifying(created.mission_id);
  assert.equal(afterVerifying.status, 'verifying');

  // Record PASS for the two required criteria (the optional one stays pending).
  await svc.recordEvaluation({
    missionId: created.mission_id,
    criterionId: criteria[0]!.criterion_id,
    attemptId: afterRunning.current_attempt_id!,
    evaluatorId: 'command_exit_zero',
    verdict: 'PASS',
    summary: 'pnpm test green',
  });
  await svc.recordEvaluation({
    missionId: created.mission_id,
    criterionId: criteria[1]!.criterion_id,
    attemptId: afterRunning.current_attempt_id!,
    evaluatorId: 'file_exists',
    verdict: 'PASS',
    summary: 'artifact present',
  });

  // recordEvaluation must NOT have transitioned the mission off verifying.
  const stillVerifying = await repos.missions.findById(created.mission_id);
  assert.equal(stillVerifying?.status, 'verifying', 'recordEvaluation does not transition the mission');
  const c0 = await repos.missionCriteria.findById(criteria[0]!.criterion_id);
  assert.equal(c0?.status, 'pass', 'recordEvaluation updates criterion status');
  assert.ok(c0?.last_evaluation_id, 'recordEvaluation stamps last_evaluation_id');

  const completed = await svc.completeMission(created.mission_id);
  assert.equal(completed.status, 'completed');
  assert.ok(completed.completed_at, 'completed_at stamped');

  // One mission_event per transition: created, ready, attempt_started, verifying, completed = 5.
  const events = await repos.missionEvents.listByMission(created.mission_id);
  const types = events.map((e) => e.type);
  assert.deepEqual(
    types,
    [
      'mission.created',
      'mission.ready',
      'mission.attempt_started',
      'mission.verifying',
      'mission.completed',
    ],
    `expected one event per transition, got ${JSON.stringify(types)}`,
  );
});

await check('invariant 1: completing with a required criterion not PASS throws; all-PASS succeeds', async () => {
  const repos = freshRepos();
  const svc = createMissionService(repos, makeDeps());
  const created = await svc.createMission(baseInput());
  const criteria = await repos.missionCriteria.listByMission(created.mission_id);

  await svc.markReady(created.mission_id);
  const running = await svc.startAttempt(created.mission_id, 'initial');
  await svc.beginVerifying(created.mission_id);

  // Only the first required criterion passes; second required stays pending.
  await svc.recordEvaluation({
    missionId: created.mission_id,
    criterionId: criteria[0]!.criterion_id,
    attemptId: running.current_attempt_id!,
    evaluatorId: 'command_exit_zero',
    verdict: 'PASS',
    summary: 'ok',
  });

  await assert.rejects(
    () => svc.completeMission(created.mission_id),
    (err: unknown) =>
      err instanceof MissionStateError && err.code === 'invariant_violation',
    'completing with an unmet required criterion must throw invariant_violation',
  );
  const stillVerifying = await repos.missions.findById(created.mission_id);
  assert.equal(stillVerifying?.status, 'verifying', 'rejected completion does not mutate status');

  // Now pass the second required criterion (FAIL on the optional one is fine).
  await svc.recordEvaluation({
    missionId: created.mission_id,
    criterionId: criteria[1]!.criterion_id,
    attemptId: running.current_attempt_id!,
    evaluatorId: 'file_exists',
    verdict: 'PASS',
    summary: 'ok',
  });
  await svc.recordEvaluation({
    missionId: created.mission_id,
    criterionId: criteria[2]!.criterion_id,
    attemptId: running.current_attempt_id!,
    evaluatorId: 'text_contains',
    verdict: 'FAIL',
    summary: 'optional missed — should not block completion',
  });
  const completed = await svc.completeMission(created.mission_id);
  assert.equal(completed.status, 'completed', 'all required PASS → completion succeeds');
});

await check('illegal transition: draft→completed and a transition out of cancelled both throw', async () => {
  const repos = freshRepos();
  const svc = createMissionService(repos, makeDeps());
  const created = await svc.createMission(baseInput());

  // draft → completed is not in the allowed-from map.
  await assert.rejects(
    () => svc.completeMission(created.mission_id),
    (err: unknown) =>
      err instanceof MissionStateError && err.code === 'invariant_violation',
    'draft→completed: completeMission rejects (no required PASS yet → invariant first)',
  );

  // Now prove a pure illegal-transition rejection: ready → completed.
  await svc.markReady(created.mission_id);
  await assert.rejects(
    () => svc.completeMission(created.mission_id),
    (err: unknown) =>
      err instanceof MissionStateError &&
      (err.code === 'illegal_transition' || err.code === 'invariant_violation'),
    'ready→completed must be rejected',
  );

  // cancelled is terminal: any transition out of it is illegal.
  const other = await svc.createMission(baseInput());
  await svc.cancel(other.mission_id);
  await assert.rejects(
    () => svc.markReady(other.mission_id),
    (err: unknown) =>
      err instanceof MissionStateError && err.code === 'illegal_transition',
    'cancelled→ready must throw illegal_transition',
  );
});

await check('invariant 3: startAttempt while verifying (active attempt) throws', async () => {
  const repos = freshRepos();
  const svc = createMissionService(repos, makeDeps());
  const created = await svc.createMission(baseInput());
  await svc.markReady(created.mission_id);
  await svc.startAttempt(created.mission_id, 'initial');
  await svc.beginVerifying(created.mission_id);

  await assert.rejects(
    () => svc.startAttempt(created.mission_id, 'initial'),
    (err: unknown) =>
      err instanceof MissionStateError && err.code === 'invariant_violation',
    '§18.3: no second root attempt while verifying with an active attempt',
  );
  const attempts = await repos.missionAttempts.listByMission(created.mission_id);
  assert.equal(attempts.length, 1, 'rejected startAttempt did not create a second attempt');
});

await check('repair path: verifying→repairing(prevAttempt)→running; event carries prev attempt ref', async () => {
  const repos = freshRepos();
  const svc = createMissionService(repos, makeDeps());
  const created = await svc.createMission(baseInput());
  await svc.markReady(created.mission_id);
  const firstRun = await svc.startAttempt(created.mission_id, 'initial');
  const prevAttemptId = firstRun.current_attempt_id!;
  await svc.beginVerifying(created.mission_id);

  const sig = 'sig:tests-fail@abc123';
  const repairing = await svc.toRepairing(created.mission_id, prevAttemptId, sig);
  assert.equal(repairing.status, 'repairing');

  // §18.4: the repairing event references the previous failed attempt.
  const events = await repos.missionEvents.listByMission(created.mission_id);
  const repairEvent = events.find((e) => e.type === 'mission.repairing');
  assert.ok(repairEvent, 'mission.repairing event written');
  const data = JSON.parse(repairEvent!.data_json) as { prevAttemptId?: string; failureSignature?: string };
  assert.equal(data.prevAttemptId, prevAttemptId, '§18.4: repairing references previous attempt');
  assert.equal(data.failureSignature, sig, '§18.4: repairing carries failure signature');

  // repairing → running: a fresh repair attempt starts.
  const repairRun = await svc.startAttempt(created.mission_id, 'repair', {
    prevAttemptId,
    failureSignature: sig,
  });
  assert.equal(repairRun.status, 'running');
  assert.notEqual(repairRun.current_attempt_id, prevAttemptId, 'new attempt id for the repair run');
  const attempts = await repos.missionAttempts.listByMission(created.mission_id);
  assert.equal(attempts.length, 2, 'a second (repair) attempt exists');
  assert.equal(attempts[1]?.trigger, 'repair', 'second attempt trigger is repair');
});

await check('cancelled is terminal: no transition out of cancelled', async () => {
  const repos = freshRepos();
  const svc = createMissionService(repos, makeDeps());
  const created = await svc.createMission(baseInput());
  await svc.markReady(created.mission_id);
  await svc.startAttempt(created.mission_id, 'initial');
  await svc.cancel(created.mission_id, 'user aborted');

  const cancelled = await repos.missions.findById(created.mission_id);
  assert.equal(cancelled?.status, 'cancelled');

  // Every outgoing method must be rejected as an illegal transition.
  for (const op of [
    () => svc.markReady(created.mission_id),
    () => svc.beginVerifying(created.mission_id),
    () => svc.startAttempt(created.mission_id, 'resume'),
    () => svc.pause(created.mission_id),
    () => svc.resume(created.mission_id),
    () => svc.toBlocked(created.mission_id, 'x'),
    () => svc.toFailed(created.mission_id, 'x'),
  ]) {
    await assert.rejects(
      op,
      (err: unknown) => err instanceof MissionStateError && err.code === 'illegal_transition',
      '§18.6: cancelled is terminal — no auto-resume / no outgoing transition',
    );
  }
});

await check('recordEvaluation while NOT verifying (running) throws invariant_violation (§19)', async () => {
  const repos = freshRepos();
  const svc = createMissionService(repos, makeDeps());
  const created = await svc.createMission(baseInput());
  const criteria = await repos.missionCriteria.listByMission(created.mission_id);
  await svc.markReady(created.mission_id);
  const running = await svc.startAttempt(created.mission_id, 'initial');
  assert.equal(running.status, 'running', 'mission is running, not verifying');

  await assert.rejects(
    () =>
      svc.recordEvaluation({
        missionId: created.mission_id,
        criterionId: criteria[0]!.criterion_id,
        attemptId: running.current_attempt_id!,
        evaluatorId: 'command_exit_zero',
        verdict: 'PASS',
        summary: 'should be rejected — recorded before verifying',
      }),
    (err: unknown) => err instanceof MissionStateError && err.code === 'invariant_violation',
    '§19: evaluations may only be recorded while the mission is verifying',
  );

  // The criterion status must NOT have been pre-seeded to pass.
  const c0 = await repos.missionCriteria.findById(criteria[0]!.criterion_id);
  assert.equal(c0?.status, 'pending', 'rejected recordEvaluation did not mutate criterion status');
  const evals = await repos.missionEvaluations.listByMission(created.mission_id);
  assert.equal(evals.length, 0, 'rejected recordEvaluation did not insert an evaluation row');
});

await check('transition MAP rejects ready→completed independent of INV1 (zero required criteria)', async () => {
  const repos = freshRepos();
  const svc = createMissionService(repos, makeDeps());
  // Zero required criteria → INV1 (all-required-PASS) passes vacuously, so the
  // rejection MUST come from the transition map, not INV1.
  const created = await svc.createMission(
    baseInput({
      criteria: [{ description: 'optional only', evaluatorId: 'text_contains', required: false }],
    }),
  );
  const afterReady = await svc.markReady(created.mission_id);
  assert.equal(afterReady.status, 'ready');

  await assert.rejects(
    () => svc.completeMission(created.mission_id),
    (err: unknown) => err instanceof MissionStateError && err.code === 'illegal_transition',
    "map: 'ready' is not an allowed-from for 'completed' — must throw illegal_transition exactly",
  );
  const stillReady = await repos.missions.findById(created.mission_id);
  assert.equal(stillReady?.status, 'ready', 'rejected completion did not mutate status');
});

if (failed > 0) {
  console.error(`\nmission-service: ${passed}/${TOTAL} checks passed (${failed} failed)`);
  process.exit(1);
}
console.log(`\nmission-service: ${passed}/${TOTAL} checks passed`);
