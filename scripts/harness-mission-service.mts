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
const TOTAL = 16;
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

await check('transition MAP rejects an illegal edge with required criteria all PASS', async () => {
  const repos = freshRepos();
  const svc = createMissionService(repos, makeDeps());
  // A required criterion is mandatory now (A1), so a zero-required mission can no
  // longer be used to isolate the map. We instead drive the mission to a state
  // where the invariant (all-required-PASS) is SATISFIED, then attempt an illegal
  // edge so the ONLY possible rejection is the transition MAP itself.
  const created = await svc.createMission(
    baseInput({
      criteria: [{ description: 'required gate', evaluatorId: 'command_exit_zero', required: true }],
    }),
  );
  await svc.markReady(created.mission_id);
  const running = await svc.startAttempt(created.mission_id, 'initial');
  await svc.beginVerifying(created.mission_id);
  const criteria = await repos.missionCriteria.listByMission(created.mission_id);
  await svc.recordEvaluation({
    missionId: created.mission_id,
    criterionId: criteria[0]!.criterion_id,
    attemptId: running.current_attempt_id!,
    evaluatorId: 'command_exit_zero',
    verdict: 'PASS',
    summary: 'ok',
  });
  // Complete it (legal verifying→completed). Now the mission is terminal.
  const completed = await svc.completeMission(created.mission_id);
  assert.equal(completed.status, 'completed');

  // completed is terminal — there is no `completed → *` edge: a fresh
  // completeMission (or any transition) must be rejected by the MAP exactly.
  await assert.rejects(
    () => svc.completeMission(created.mission_id),
    (err: unknown) => err instanceof MissionStateError && err.code === 'illegal_transition',
    "map: 'completed' is terminal — re-completing must throw illegal_transition (invariant already satisfied)",
  );
});

// ---------------------------------------------------------------------------
// A1: a mission must gate on at least one REQUIRED criterion.
// ---------------------------------------------------------------------------

await check('A1: createMission with zero required criteria is rejected (fail-fast §18.1)', async () => {
  const repos = freshRepos();
  const svc = createMissionService(repos, makeDeps());

  await assert.rejects(
    () =>
      svc.createMission(
        baseInput({
          criteria: [
            { description: 'optional only', evaluatorId: 'text_contains', required: false },
          ],
        }),
      ),
    (err: unknown) => err instanceof MissionStateError && err.code === 'invariant_violation',
    'a zero-required mission must not be creatable (else completion verifies nothing)',
  );

  // And no mission row leaked: the insert never happened.
  const all = await repos.missions.listByCompany('co-1');
  assert.equal(all.length, 0, 'rejected createMission inserted no mission row');

  // The empty-criteria case is likewise rejected.
  await assert.rejects(
    () => svc.createMission(baseInput({ criteria: [] })),
    (err: unknown) => err instanceof MissionStateError && err.code === 'invariant_violation',
    'an empty-criteria mission is also rejected',
  );
});

await check('A1: completeMission guards zero required even if a row exists (defense-in-depth)', async () => {
  // createMission blocks the zero-required path, so to exercise the completeMission
  // guard directly we insert a verifying mission with ONLY optional criteria
  // straight through the repos (bypassing the service's createMission guard),
  // then prove completeMission still refuses it.
  const repos = freshRepos();
  const svc = createMissionService(repos, makeDeps());
  const ts = new Date(Date.UTC(2026, 0, 1)).toISOString();
  await repos.missions.insert({
    mission_id: 'm-zero',
    company_id: 'co-1',
    project_id: null,
    thread_id: 'thr-1',
    title: 'zero-required',
    goal: 'g',
    status: 'verifying',
    runtime_id: 'pi',
    runtime_policy_json: '{}',
    budget_json: '{}',
    expected_artifacts_json: null,
    current_attempt_id: null,
    created_at: ts,
    updated_at: ts,
    completed_at: null,
  });
  await repos.missionCriteria.insert({
    criterion_id: 'c-opt',
    mission_id: 'm-zero',
    description: 'optional only',
    evaluator_id: 'text_contains',
    evaluator_config_json: '{}',
    required: 0,
    order_index: 0,
    status: 'pass',
    last_evaluation_id: null,
  });

  await assert.rejects(
    () => svc.completeMission('m-zero'),
    (err: unknown) => err instanceof MissionStateError && err.code === 'invariant_violation',
    'completeMission must refuse a mission with zero required criteria (no vacuous completion)',
  );
  const still = await repos.missions.findById('m-zero');
  assert.equal(still?.status, 'verifying', 'rejected completion did not mutate status');
});

// ---------------------------------------------------------------------------
// A3: terminal/repair transitions finalize the in-flight attempt.
// ---------------------------------------------------------------------------

await check('A3: completeMission closes the current attempt (status completed + finished_at)', async () => {
  const repos = freshRepos();
  const svc = createMissionService(repos, makeDeps());
  const created = await svc.createMission(baseInput());
  const criteria = await repos.missionCriteria.listByMission(created.mission_id);
  await svc.markReady(created.mission_id);
  const running = await svc.startAttempt(created.mission_id, 'initial');
  const attemptId = running.current_attempt_id!;
  await svc.beginVerifying(created.mission_id);

  // While running, the attempt is open (no finished_at).
  const mid = await repos.missionAttempts.findById(attemptId);
  assert.equal(mid?.status, 'running', 'attempt is running before completion');
  assert.equal(mid?.finished_at, null, 'attempt has no finished_at while open');

  await svc.recordEvaluation({
    missionId: created.mission_id,
    criterionId: criteria[0]!.criterion_id,
    attemptId,
    evaluatorId: 'command_exit_zero',
    verdict: 'PASS',
    summary: 'ok',
  });
  await svc.recordEvaluation({
    missionId: created.mission_id,
    criterionId: criteria[1]!.criterion_id,
    attemptId,
    evaluatorId: 'file_exists',
    verdict: 'PASS',
    summary: 'ok',
  });
  await svc.completeMission(created.mission_id);

  const done = await repos.missionAttempts.findById(attemptId);
  assert.equal(done?.status, 'completed', 'A3: completed mission closes its attempt to completed');
  assert.ok(done?.finished_at, 'A3: closed attempt has a finished_at timestamp');
  // root_run_id / runtime_session_link_id stay null (live runner territory).
  assert.equal(done?.root_run_id, null, 'root_run_id stays null (not in this scope)');
  assert.equal(done?.runtime_session_link_id, null, 'runtime_session_link_id stays null');
});

await check('A3: toFailed / toBlocked / cancel each close the current attempt with the matching terminal status', async () => {
  // toFailed → 'failed'
  {
    const repos = freshRepos();
    const svc = createMissionService(repos, makeDeps());
    const created = await svc.createMission(baseInput());
    await svc.markReady(created.mission_id);
    const running = await svc.startAttempt(created.mission_id, 'initial');
    await svc.beginVerifying(created.mission_id);
    await svc.toFailed(created.mission_id, 'limits exhausted');
    const a = await repos.missionAttempts.findById(running.current_attempt_id!);
    assert.equal(a?.status, 'failed', "toFailed closes the attempt to 'failed'");
    assert.ok(a?.finished_at, 'failed attempt has finished_at');
  }
  // toBlocked → 'blocked'
  {
    const repos = freshRepos();
    const svc = createMissionService(repos, makeDeps());
    const created = await svc.createMission(baseInput());
    await svc.markReady(created.mission_id);
    const running = await svc.startAttempt(created.mission_id, 'initial');
    await svc.toBlocked(created.mission_id, 'external blocker');
    const a = await repos.missionAttempts.findById(running.current_attempt_id!);
    assert.equal(a?.status, 'blocked', "toBlocked closes the attempt to 'blocked'");
    assert.ok(a?.finished_at, 'blocked attempt has finished_at');
  }
  // cancel mid-attempt → 'cancelled'
  {
    const repos = freshRepos();
    const svc = createMissionService(repos, makeDeps());
    const created = await svc.createMission(baseInput());
    await svc.markReady(created.mission_id);
    const running = await svc.startAttempt(created.mission_id, 'initial');
    await svc.cancel(created.mission_id, 'user stop');
    const a = await repos.missionAttempts.findById(running.current_attempt_id!);
    assert.equal(a?.status, 'cancelled', "cancel closes the in-flight attempt to 'cancelled'");
    assert.ok(a?.finished_at, 'cancelled attempt has finished_at');
  }
  // cancel from ready (no attempt) → no attempt write, no throw
  {
    const repos = freshRepos();
    const svc = createMissionService(repos, makeDeps());
    const created = await svc.createMission(baseInput());
    await svc.markReady(created.mission_id);
    await svc.cancel(created.mission_id, 'user stop before any attempt');
    const attempts = await repos.missionAttempts.listByMission(created.mission_id);
    assert.equal(attempts.length, 0, 'cancel from ready creates/touches no attempt');
  }
});

await check('A3: toRepairing supersedes the failed attempt (status superseded + finished_at)', async () => {
  const repos = freshRepos();
  const svc = createMissionService(repos, makeDeps());
  const created = await svc.createMission(baseInput());
  await svc.markReady(created.mission_id);
  const firstRun = await svc.startAttempt(created.mission_id, 'initial');
  const prevAttemptId = firstRun.current_attempt_id!;
  await svc.beginVerifying(created.mission_id);
  await svc.toRepairing(created.mission_id, prevAttemptId, 'sig:fail');

  const superseded = await repos.missionAttempts.findById(prevAttemptId);
  assert.equal(superseded?.status, 'superseded', "toRepairing closes the old attempt to 'superseded'");
  assert.ok(superseded?.finished_at, 'superseded attempt has finished_at');

  // The next attempt opens fresh and running (the live one).
  const repairRun = await svc.startAttempt(created.mission_id, 'repair', {
    prevAttemptId,
    failureSignature: 'sig:fail',
  });
  const fresh = await repos.missionAttempts.findById(repairRun.current_attempt_id!);
  assert.equal(fresh?.status, 'running', 'the repair attempt is open/running');
  assert.equal(fresh?.finished_at, null, 'the repair attempt is not finished');
});

// ---------------------------------------------------------------------------
// A4: compare-and-swap status guard closes the lost-update race.
// ---------------------------------------------------------------------------

await check('A4: updateStatus with a stale expectedStatus is a no-op returning false', async () => {
  const repos = freshRepos();
  const svc = createMissionService(repos, makeDeps());
  const created = await svc.createMission(baseInput());
  await svc.markReady(created.mission_id); // now 'ready'

  // Stale CAS: the row is 'ready', but we claim we expect 'running'. Must miss.
  const missed = await repos.missions.updateStatus(created.mission_id, {
    status: 'verifying',
    updatedAt: new Date(Date.UTC(2026, 0, 2)).toISOString(),
    expectedStatus: 'running',
  });
  assert.equal(missed, false, 'stale expectedStatus → no-op, returns false');
  const unchanged = await repos.missions.findById(created.mission_id);
  assert.equal(unchanged?.status, 'ready', 'the row was NOT overwritten by the stale write');

  // Matching CAS: expectedStatus equals the current status → applies, returns true.
  const hit = await repos.missions.updateStatus(created.mission_id, {
    status: 'running',
    updatedAt: new Date(Date.UTC(2026, 0, 3)).toISOString(),
    expectedStatus: 'ready',
  });
  assert.equal(hit, true, 'matching expectedStatus → applies, returns true');
  const moved = await repos.missions.findById(created.mission_id);
  assert.equal(moved?.status, 'running', 'the matching CAS applied');

  // No-guard update on an existing row → true; on a missing row → false.
  const ungated = await repos.missions.updateStatus(created.mission_id, {
    status: 'paused',
    updatedAt: new Date(Date.UTC(2026, 0, 4)).toISOString(),
  });
  assert.equal(ungated, true, 'unguarded update on an existing row returns true');
  const ghost = await repos.missions.updateStatus('nope', {
    status: 'paused',
    updatedAt: new Date(Date.UTC(2026, 0, 4)).toISOString(),
  });
  assert.equal(ghost, false, 'unguarded update on a missing row returns false');
});

await check('A4: a concurrent cancel is NOT overwritten by a stale verifying transition', async () => {
  const repos = freshRepos();
  const svc = createMissionService(repos, makeDeps());
  const created = await svc.createMission(baseInput());
  await svc.markReady(created.mission_id);
  const running = await svc.startAttempt(created.mission_id, 'initial');
  assert.equal(running.status, 'running');

  // Simulate the race: capture the 'running' mission view the loop holds, then a
  // concurrent cancel lands (mission → cancelled). The loop then tries to push
  // 'running' → 'verifying' using its STALE view. The CAS (expectedStatus =
  // 'running') must miss → transition throws illegal_transition, and the cancel
  // SURVIVES (no clobber).
  await svc.cancel(created.mission_id, 'user cancel won the race');
  const cancelled = await repos.missions.findById(created.mission_id);
  assert.equal(cancelled?.status, 'cancelled', 'cancel landed first');

  // beginVerifying reloads, so to truly simulate a stale write we hit the repo
  // CAS path that `transition` uses: claim from 'running'. It must be a no-op.
  const stale = await repos.missions.updateStatus(created.mission_id, {
    status: 'verifying',
    updatedAt: new Date(Date.UTC(2026, 0, 5)).toISOString(),
    expectedStatus: 'running',
  });
  assert.equal(stale, false, 'stale verifying write missed the CAS');
  const final = await repos.missions.findById(created.mission_id);
  assert.equal(final?.status, 'cancelled', 'the cancel was NOT overwritten by the stale verifying write');
});

await check('A4: transition CAS throws even for a map-LEGAL edge when the row moved underfoot', async () => {
  // This isolates the CAS throw from the transition MAP. We pick a `from → to`
  // that IS legal in the map (verifying → completed), but the row has been moved
  // to ANOTHER legal state (verifying → repairing) by a concurrent transition.
  // The CAS (expectedStatus = the stale 'verifying') must miss and the transition
  // must throw — otherwise the stale completed would clobber the live repairing.
  const repos = freshRepos();
  const svc = createMissionService(repos, makeDeps());
  const created = await svc.createMission(baseInput());
  const criteria = await repos.missionCriteria.listByMission(created.mission_id);
  await svc.markReady(created.mission_id);
  const running = await svc.startAttempt(created.mission_id, 'initial');
  const attemptId = running.current_attempt_id!;
  await svc.beginVerifying(created.mission_id);
  // Make the required criteria all PASS so the invariant guard cannot be what
  // rejects — only the CAS can.
  await svc.recordEvaluation({
    missionId: created.mission_id,
    criterionId: criteria[0]!.criterion_id,
    attemptId,
    evaluatorId: 'command_exit_zero',
    verdict: 'PASS',
    summary: 'ok',
  });
  await svc.recordEvaluation({
    missionId: created.mission_id,
    criterionId: criteria[1]!.criterion_id,
    attemptId,
    evaluatorId: 'file_exists',
    verdict: 'PASS',
    summary: 'ok',
  });

  // Capture the stale 'verifying' mission view, then a concurrent transition
  // moves the row to 'repairing' (a legal verifying→repairing edge).
  const staleView = await svc.getMission(created.mission_id);
  assert.equal(staleView.status, 'verifying', 'captured a verifying view');
  await svc.toRepairing(created.mission_id, attemptId, 'sig:concurrent');
  const moved = await repos.missions.findById(created.mission_id);
  assert.equal(moved?.status, 'repairing', 'a concurrent transition moved the row to repairing');

  // Now the stale completed write (verifying→completed is map-LEGAL) must be
  // rejected by the CAS — directly exercise the repo path the transition uses.
  const clobbered = await repos.missions.updateStatus(created.mission_id, {
    status: 'completed',
    updatedAt: new Date(Date.UTC(2026, 0, 9)).toISOString(),
    expectedStatus: 'verifying',
    completedAt: new Date(Date.UTC(2026, 0, 9)).toISOString(),
  });
  assert.equal(clobbered, false, 'map-legal but stale completed write missed the CAS');
  const final = await repos.missions.findById(created.mission_id);
  assert.equal(final?.status, 'repairing', 'the live repairing state was NOT clobbered by a stale completed');
});

if (failed > 0) {
  console.error(`\nmission-service: ${passed}/${TOTAL} checks passed (${failed} failed)`);
  process.exit(1);
}
console.log(`\nmission-service: ${passed}/${TOTAL} checks passed`);
