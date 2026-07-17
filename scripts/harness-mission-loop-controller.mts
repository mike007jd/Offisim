/**
 * MissionLoopController oracle (PRD §19, slice MS-004).
 *
 * Drives {@link createMissionLoopController} over a REAL {@link MissionService}
 * (MS-002) on the MS-001 in-memory mission repos, the default EvaluatorRegistry
 * (MS-003), and a SCRIPTED `runAttempt` — the harness controls PASS/FAIL per
 * criterion per attempt by returning a scripted per-criterion EvaluationContext.
 * No model, no real workspace: the controller's flow is a pure function of the
 * scripted verdicts + the §19.2 bounded stop rules, so every run is byte-stable.
 *
 * Covers each §19.2 stop rule + the §5/§20.3 deterministic-FAIL-final rule:
 *   - happy path (all PASS, 1 attempt → completed);
 *   - repair-then-complete (FAIL@1, PASS@2 → completed in 2, with a FailurePacket);
 *   - per-criterion 3-repair cap (always-FAIL → failed after the cap);
 *   - 6-attempt global cap (distinct failures each attempt to avoid STUCK);
 *   - STUCK (identical failed set + signature twice → stuck before the 6-cap);
 *   - runtimeError → blocked (infra), repair counter does NOT move;
 *   - deterministic FAIL + advisory llm_rubric SKIP stays FAIL;
 *   - token budget (usage > tokenBudget reported via AttemptExecution.usage →
 *     failed/token_budget, bounded);
 *   - concurrent cancel mid-attempt → run() returns cancelled cleanly (no throw);
 *   - evaluator BLOCKED (not a runtimeError) with no product FAIL → blocked
 *     (infra), repair counter untouched.
 *
 * Pure Node via tsx against `packages/core` source — style mirrors the other
 * `scripts/harness-*.mts` oracles. Two non-tautology proofs (run manually, then
 * revert): (a) remove the 6-cap guard → the 6-attempt cap check fails; (b) skip
 * the token debit (`tokenRemaining -= execution.usage.tokens`) → the token
 * budget check fails. Both confirm the checks exercise the real rules.
 */

import assert from 'node:assert/strict';
import { createDefaultEvaluatorRegistry } from '../packages/core/src/runtime/mission/evaluators/registry.ts';
import type { EvaluationContext } from '../packages/core/src/runtime/mission/evaluators/types.ts';
import {
  type AttemptExecution,
  type ControllerCriterion,
  type MissionLoopControllerDeps,
  type RunAttemptInput,
  createMissionLoopController,
} from '../packages/core/src/runtime/mission/mission-loop-controller.ts';
import {
  type CreateMissionInput,
  type MissionService,
  type MissionServiceDeps,
  MissionStateError,
  createMissionService,
} from '../packages/core/src/runtime/mission/mission-service.ts';
import { createMissionMemoryRepos } from '../packages/core/src/runtime/repos/mission/memory.ts';

let passed = 0;
let failed = 0;
const TOTAL = 18;

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
// Deterministic id/clock + repos + service, mirroring harness-mission-service.
// ---------------------------------------------------------------------------

function makeDeps(): MissionServiceDeps {
  let idSeq = 0;
  let clockSeq = 0;
  return {
    newId: () => {
      idSeq += 1;
      return `id-${idSeq.toString().padStart(4, '0')}`;
    },
    now: () => {
      clockSeq += 1;
      return new Date(Date.UTC(2026, 0, 1, 0, 0, 0, clockSeq)).toISOString();
    },
  };
}

function freshService(): { svc: MissionService; deps: MissionServiceDeps } {
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
  return { svc, deps };
}

/**
 * A scripted EvaluationContext: a `command_exit_zero` criterion whose
 * `runCommand` returns the exit code we want for this (attempt, criterion). The
 * evaluator does the real work — we only control the environment fact it reads.
 */
function scriptedContext(criterion: ControllerCriterion, exitCode: number): EvaluationContext {
  const command = JSON.parse(criterion.configJson).command as string;
  return {
    criterion: {
      id: criterion.id,
      description: criterion.description,
      configJson: criterion.configJson,
    },
    workspaceReadFile: async () => null,
    workspaceFileExists: async () => false,
    workspaceHashFile: async () => null,
    runCommand: async (cmd) => {
      assert.equal(cmd, command, 'evaluator ran the criterion command');
      return { exitCode, stdout: '', stderr: '' };
    },
    gitChangedPaths: async () => [],
    listArtifacts: async () => [],
    recordedApproval: async () => null,
  };
}

/** A criterion input gating on `command_exit_zero` of a named command. */
function cmdCriterion(description: string, command: string, required = true) {
  return {
    description,
    evaluatorId: 'command_exit_zero',
    evaluatorConfigJson: JSON.stringify({ command }),
    required,
  };
}

/** Build + ready a mission, returning its id and its criteria (controller view). */
async function readyMission(
  svc: MissionService,
  input: Partial<CreateMissionInput>,
): Promise<string> {
  const created = await svc.createMission({
    companyId: 'co-1',
    threadId: 'thr-1',
    title: 'Mission',
    goal: 'Verifiably done',
    runtimeId: 'pi',
    runtimePolicyJson: '{}',
    budgetJson: '{}',
    criteria: [],
    ...input,
  });
  await svc.markReady(created.mission_id);
  return created.mission_id;
}

/** Controller deps with a scripted runAttempt + the default registry. */
function makeController(
  svc: MissionService,
  serviceDeps: MissionServiceDeps,
  runAttempt: (input: RunAttemptInput) => Promise<AttemptExecution>,
  budget?: MissionLoopControllerDeps['budget'],
  nowOverride?: () => string,
) {
  return createMissionLoopController({
    missionService: svc,
    evaluatorRegistry: createDefaultEvaluatorRegistry(),
    runAttempt,
    ...(budget ? { budget } : {}),
    // The controller mints no ids/timestamps of its own beyond the service, but
    // the contract requires them; reuse the service's deterministic factories.
    now: nowOverride ?? serviceDeps.now,
    newId: serviceDeps.newId,
  });
}

await check('zero Mission caps are rejected before runAttempt can spend', async () => {
  const { svc, deps } = freshService();
  let attemptCount = 0;
  const runAttempt = async (): Promise<AttemptExecution> => {
    attemptCount += 1;
    throw new Error('runAttempt must not be reached for an invalid budget');
  };

  for (const budget of [
    { maxRepairsPerCriterion: 0 },
    { maxAttempts: 0 },
    { tokenBudget: 0 },
    { maxConcurrentAgents: 0 },
    { maxTotalAgents: 0 },
    { maxRecursionDepth: 0 },
    { wallClockMinutes: 0 },
  ]) {
    assert.throws(() => makeController(svc, deps, runAttempt, budget), /positive integer/);
  }
  assert.equal(attemptCount, 0, 'invalid caps spend no attempts or tokens');
});

await check('wall-clock cap can expire before attempt 1 with zero runtime spend', async () => {
  const { svc, deps } = freshService();
  const missionId = await readyMission(svc, {
    criteria: [cmdCriterion('tests pass', 'pnpm test')],
  });
  let attemptCount = 0;
  const times = ['2026-01-01T00:00:00.000Z', '2026-01-01T00:01:00.000Z'];
  const controller = makeController(
    svc,
    deps,
    async () => {
      attemptCount += 1;
      throw new Error('runAttempt must not start after the wall-clock deadline');
    },
    { wallClockMinutes: 1 },
    () => times.shift()!,
  );

  await assert.rejects(
    () => controller.run(missionId),
    /exhausted its wall-clock budget before the first attempt/,
  );
  assert.equal(attemptCount, 0, 'no runtime attempt or tokens were spent');
  assert.equal((await svc.getMission(missionId)).status, 'ready', 'mission remains unstarted');
});

await check(
  'attempt returning after wall-clock deadline fails before evaluation or repair',
  async () => {
    const { svc, deps } = freshService();
    const missionId = await readyMission(svc, {
      criteria: [cmdCriterion('tests pass', 'pnpm test')],
    });
    let attemptCount = 0;
    const times = [
      '2026-01-01T00:00:00.000Z',
      '2026-01-01T00:00:00.000Z',
      '2026-01-01T00:01:00.000Z',
    ];
    const controller = makeController(
      svc,
      deps,
      async () => {
        attemptCount += 1;
        return {
          evaluationContextFor: () => {
            throw new Error('evaluation must not start after the wall-clock deadline');
          },
          usage: { tokens: 10 },
        };
      },
      { wallClockMinutes: 1, tokenBudget: 100 },
      () => times.shift()!,
    );

    const result = await controller.run(missionId);
    assert.equal(result.status, 'failed');
    assert.equal(result.stopReason, 'wall_clock_budget');
    assert.equal(result.attempts, 1);
    assert.equal(attemptCount, 1, 'no repair attempt was started');
    assert.equal((await svc.getMission(missionId)).status, 'failed');
  },
);

await check('wall-clock cap stops between attempts before a repair starts', async () => {
  const { svc, deps } = freshService();
  const missionId = await readyMission(svc, {
    criteria: [cmdCriterion('tests pass', 'pnpm test')],
  });
  let attemptCount = 0;
  const times = [
    '2026-01-01T00:00:00.000Z',
    '2026-01-01T00:00:00.000Z',
    '2026-01-01T00:00:00.000Z',
    '2026-01-01T00:00:00.000Z',
    '2026-01-01T00:01:00.000Z',
  ];
  const controller = makeController(
    svc,
    deps,
    async () => {
      attemptCount += 1;
      return { evaluationContextFor: (criterion) => scriptedContext(criterion, 1) };
    },
    { wallClockMinutes: 1 },
    () => times.shift()!,
  );

  const result = await controller.run(missionId);
  assert.equal(result.status, 'failed');
  assert.equal(result.stopReason, 'wall_clock_budget');
  assert.equal(result.attempts, 1);
  assert.equal(attemptCount, 1, 'deadline prevented the repair attempt');
});

// ---------------------------------------------------------------------------
// 1. Happy path: all PASS on attempt 1 → completed, 1 attempt.
// ---------------------------------------------------------------------------

await check('happy path: criteria PASS on attempt 1 → completed in 1 attempt', async () => {
  const { svc, deps } = freshService();
  const missionId = await readyMission(svc, {
    criteria: [cmdCriterion('tests pass', 'pnpm test'), cmdCriterion('build ok', 'pnpm build')],
  });

  const controller = makeController(svc, deps, async () => ({
    // Every command exits 0 → PASS.
    evaluationContextFor: (criterion) => scriptedContext(criterion, 0),
  }));

  const result = await controller.run(missionId);
  assert.equal(result.status, 'completed', 'all PASS → completed');
  assert.equal(result.attempts, 1, 'completed in exactly one attempt');
  assert.equal(result.finalMissionStatus, 'completed', 'mission persisted as completed');
  assert.equal(result.failurePacket, undefined, 'no failure packet on completion');

  const mission = await svc.getMission(missionId);
  assert.equal(mission.status, 'completed', 'MissionService is the authoritative writer');
});

// ---------------------------------------------------------------------------
// 2. Repair-then-complete: FAIL@1, PASS@2 → completed in 2; assert toRepairing
//    happened and a FailurePacket exists for attempt 1.
// ---------------------------------------------------------------------------

await check(
  'repair-then-complete: FAIL@1 → PASS@2 → completed in 2; toRepairing + FailurePacket@1',
  async () => {
    const { svc, deps } = freshService();
    const missionId = await readyMission(svc, {
      criteria: [cmdCriterion('tests pass', 'pnpm test')],
    });

    let observedRepairPacket: RunAttemptInput['failurePacket'] | undefined;
    const controller = makeController(svc, deps, async ({ attemptNumber, failurePacket }) => {
      if (attemptNumber === 2) observedRepairPacket = failurePacket;
      return {
        // Attempt 1 fails (exit 1); attempt 2 passes (exit 0) — the scripted flip.
        evaluationContextFor: (criterion) =>
          scriptedContext(criterion, attemptNumber === 1 ? 1 : 0),
      } satisfies AttemptExecution;
    });

    const result = await controller.run(missionId);
    assert.equal(result.status, 'completed', 'second attempt passes → completed');
    assert.equal(result.attempts, 2, 'completed in exactly two attempts');

    // The repair attempt must have received the FailurePacket from attempt 1.
    assert.ok(observedRepairPacket, 'attempt 2 (repair) received a FailurePacket');
    assert.equal(
      observedRepairPacket!.failedCriteria.length,
      1,
      'packet lists the one failed criterion',
    );
    assert.equal(observedRepairPacket!.failedCriteria[0]!.verdict, 'FAIL', 'product FAIL recorded');
    assert.equal(
      observedRepairPacket!.remainingBudget.repairsRemainingByCriterion[
        observedRepairPacket!.failedCriteria[0]!.criterionId
      ],
      2,
      'after consuming 1 of 3 repairs, 2 remain',
    );

    // The controller evidence shows attempt 1 failed (has a signature) and there
    // were exactly two attempts; the dedicated event-trail check below proves the
    // mission.repairing transition (toRepairing) fired.
    const attempt1Sig = result.evidence.attempts[0]?.failureSignature;
    assert.ok(attempt1Sig, 'attempt 1 recorded a failure signature (it failed)');
    assert.equal(result.evidence.attempts.length, 2, 'two attempts in evidence');
  },
);

await check(
  'repair-then-complete: a mission.repairing event is written for attempt 1',
  async () => {
    // Separate check with direct event-trail access via fresh repos we own.
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
    const missionId = await readyMission(svc, {
      criteria: [cmdCriterion('tests pass', 'pnpm test')],
    });
    const controller = makeController(svc, deps, async ({ attemptNumber }) => ({
      evaluationContextFor: (criterion) => scriptedContext(criterion, attemptNumber === 1 ? 1 : 0),
    }));
    await controller.run(missionId);

    const events = await m.missionEvents.listByMission(missionId);
    const types = events.map((e) => e.type);
    assert.ok(
      types.includes('mission.repairing'),
      `expected a mission.repairing event, got ${JSON.stringify(types)}`,
    );
    assert.ok(types.includes('mission.completed'), 'mission completed after the repair');
    const repairEvent = events.find((e) => e.type === 'mission.repairing')!;
    const data = JSON.parse(repairEvent.data_json) as { failureSignature?: string };
    assert.ok(data.failureSignature, '§18.4: repairing carries a failure signature');
  },
);

// ---------------------------------------------------------------------------
// 3. Per-criterion 3-repair cap: a criterion that FAILs every attempt stops
//    after the cap with status failed.
// ---------------------------------------------------------------------------

await check(
  'per-criterion 3-repair cap: always-FAIL → failed after the cap (repair_cap)',
  async () => {
    const { svc, deps } = freshService();
    const missionId = await readyMission(svc, {
      criteria: [cmdCriterion('tests pass', 'pnpm test')],
    });

    // Each attempt fails differently so STUCK does not fire first — we isolate the
    // repair cap. The summary differs by embedding the attempt number into a
    // distinct command per attempt (different criterion summary → distinct sig).
    let attemptSeen = 0;
    const controller = makeController(svc, deps, async ({ attemptNumber }) => {
      attemptSeen = attemptNumber;
      return {
        // Always FAIL, but vary the exit code per attempt so each summary (and thus
        // each failure signature) differs — isolating the repair cap from STUCK.
        evaluationContextFor: (criterion) => scriptedContext(criterion, attemptNumber + 1),
      } satisfies AttemptExecution;
    });

    const result = await controller.run(missionId);
    assert.equal(result.status, 'failed', 'exhausting the repair cap → failed');
    assert.equal(result.stopReason, 'repair_cap', 'stop reason is the per-criterion repair cap');
    // 1 initial + 3 repairs = the 4th product FAIL trips the cap → 4 attempts.
    assert.equal(result.attempts, 4, 'initial + 3 repairs = 4 attempts before the cap stops');
    assert.equal(attemptSeen, 4, 'runAttempt was invoked for all 4 attempts');
    assert.ok(result.failurePacket, 'a FailurePacket accompanies the failed stop');
    const mission = await svc.getMission(missionId);
    assert.equal(mission.status, 'failed', 'mission persisted as failed');
  },
);

// ---------------------------------------------------------------------------
// 4. 6-attempt global cap: never more than 6 attempts. Use criteria failing
//    DIFFERENTLY each attempt to avoid STUCK, and >1 criterion so the per-
//    criterion repair cap is not what stops it first.
// ---------------------------------------------------------------------------

await check('6-attempt global cap: never exceeds 6 attempts (attempt_cap)', async () => {
  const { svc, deps } = freshService();
  // Two criteria; on each attempt a DIFFERENT one fails, so no single criterion
  // accrues 3 repairs before the 6-attempt cap, and the signature changes each
  // attempt (different failed criterion) so STUCK never fires.
  const missionId = await readyMission(svc, {
    criteria: [cmdCriterion('crit A', 'cmd-a'), cmdCriterion('crit B', 'cmd-b')],
  });

  let attemptSeen = 0;
  const controller = makeController(svc, deps, async ({ attemptNumber }) => {
    attemptSeen = attemptNumber;
    return {
      evaluationContextFor: (criterion) => {
        const command = JSON.parse(criterion.configJson).command as string;
        // Alternate which criterion fails: odd attempts fail A, even fail B.
        const failsThis =
          (attemptNumber % 2 === 1 && command === 'cmd-a') ||
          (attemptNumber % 2 === 0 && command === 'cmd-b');
        return scriptedContext(criterion, failsThis ? 1 : 0);
      },
    } satisfies AttemptExecution;
  });

  const result = await controller.run(missionId);
  assert.equal(result.status, 'failed', 'never completes → failed at the cap');
  assert.equal(result.stopReason, 'attempt_cap', 'stopped on the global attempt cap');
  assert.equal(result.attempts, 6, 'exactly 6 attempts — never more');
  assert.equal(attemptSeen, 6, 'runAttempt invoked exactly 6 times');
  assert.ok(result.attempts <= 6, '§19.2: at most 6 full attempts');
});

// ---------------------------------------------------------------------------
// 5. STUCK: identical failed set + signature two attempts running → 'stuck'
//    BEFORE the 6-cap.
// ---------------------------------------------------------------------------

await check('STUCK: identical failure signature twice → stuck before the 6-cap', async () => {
  const { svc, deps } = freshService();
  const missionId = await readyMission(svc, {
    criteria: [cmdCriterion('tests pass', 'pnpm test')],
  });

  let attemptSeen = 0;
  const controller = makeController(svc, deps, async ({ attemptNumber }) => {
    attemptSeen = attemptNumber;
    return {
      // IDENTICAL FAIL every attempt (same command, same exit 1 → same summary →
      // same signature). Attempt 2 matches attempt 1 → STUCK.
      evaluationContextFor: (criterion) => scriptedContext(criterion, 1),
    } satisfies AttemptExecution;
  });

  const result = await controller.run(missionId);
  assert.equal(result.status, 'stuck', 'two identical signatures → stuck');
  assert.equal(result.stopReason, 'stuck', 'stop reason is stuck');
  assert.equal(result.attempts, 2, 'stuck detected on the 2nd attempt, before the 6-cap');
  assert.equal(attemptSeen, 2, 'only two attempts ran');
  assert.equal(result.finalMissionStatus, 'failed', 'STUCK persists the mission as failed');
  assert.ok(result.failurePacket, 'a FailurePacket accompanies the stuck stop');
  assert.ok(
    result.failurePacket!.previousFailureSignature,
    'the packet carries the previous (identical) signature',
  );
});

// ---------------------------------------------------------------------------
// 6. runtimeError → blocked (infra), does NOT consume a repair.
// ---------------------------------------------------------------------------

await check('runtimeError → blocked (infra); repair counter does NOT move', async () => {
  const { svc, deps } = freshService();
  const missionId = await readyMission(svc, {
    criteria: [cmdCriterion('tests pass', 'pnpm test')],
  });

  const controller = makeController(svc, deps, async () => ({
    // The runtime itself failed — infra, not a product FAIL. The controller must
    // not even evaluate; it goes straight to blocked without a repair.
    evaluationContextFor: () => {
      throw new Error('evaluationContextFor must NOT be called on a runtimeError attempt');
    },
    runtimeError: { code: 'runtime_incompatible', message: 'sidecar crashed' },
  }));

  const result = await controller.run(missionId);
  assert.equal(result.status, 'blocked', 'runtimeError → blocked');
  assert.equal(
    result.stopReason,
    'runtime_incompatible',
    'stop reason is the infra incompatibility',
  );
  assert.equal(result.attempts, 1, 'a single attempt was run');
  assert.equal(result.finalMissionStatus, 'blocked', 'mission persisted as blocked');

  // No repair consumed: the evidence repair map is empty (the criterion never
  // counted a product FAIL).
  assert.deepEqual(
    result.evidence.repairCountsByCriterion,
    {},
    '§19.2/§5: infra (runtimeError) consumes NO repair',
  );
  // And the FailurePacket's remaining repairs were NOT debited.
  assert.ok(result.failurePacket, 'a FailurePacket accompanies the blocked stop');
});

// ---------------------------------------------------------------------------
// 7. Deterministic FAIL final: a deterministic FAIL + an advisory llm_rubric
//    SKIP stays FAIL (the advisory result can never upgrade the FAIL).
// ---------------------------------------------------------------------------

await check(
  'deterministic FAIL final: det FAIL + advisory llm_rubric SKIP stays FAIL',
  async () => {
    const { svc, deps } = freshService();
    // Two required criteria: a deterministic command_exit_zero that FAILs, plus an
    // advisory llm_rubric_review (deterministic:false → always SKIP). The advisory
    // SKIP must never satisfy the gate; the deterministic FAIL must be final, so
    // the mission cannot complete and (FAILing identically twice) ends stuck/failed.
    const missionId = await readyMission(svc, {
      criteria: [
        cmdCriterion('tests pass', 'pnpm test'),
        {
          description: 'tone is on-brand',
          evaluatorId: 'llm_rubric_review',
          evaluatorConfigJson: '{}',
          required: true,
        },
      ],
    });

    const controller = makeController(svc, deps, async () => ({
      evaluationContextFor: (criterion) => {
        if (criterion.evaluatorId === 'command_exit_zero') return scriptedContext(criterion, 1); // FAIL
        // The advisory evaluator ignores its context; supply a benign one.
        return {
          criterion: {
            id: criterion.id,
            description: criterion.description,
            configJson: criterion.configJson,
          },
          workspaceReadFile: async () => null,
          workspaceFileExists: async () => false,
          workspaceHashFile: async () => null,
          runCommand: async () => ({ exitCode: 0, stdout: '', stderr: '' }),
          gitChangedPaths: async () => [],
          listArtifacts: async () => [],
          recordedApproval: async () => null,
        } satisfies EvaluationContext;
      },
    }));

    const result = await controller.run(missionId);
    // The advisory SKIP cannot make the mission complete; the deterministic FAIL
    // governs. The mission must NOT be completed.
    assert.notEqual(
      result.status,
      'completed',
      'advisory SKIP must not complete a FAILing mission',
    );
    assert.equal(
      result.finalMissionStatus !== 'completed',
      true,
      'mission not persisted as completed',
    );

    // The deterministic criterion's recorded verdict on attempt 1 is FAIL, and the
    // advisory criterion's verdict is SKIP (never FAIL/PASS) — it did not gate.
    const attempt1 = result.evidence.attempts[0]!;
    const verdictByCrit = new Map(attempt1.verdicts.map((v) => [v.criterionId, v.verdict]));
    const criteria = await svc.listCriteria(missionId);
    const detCrit = criteria.find((c) => c.evaluator_id === 'command_exit_zero')!;
    const advCrit = criteria.find((c) => c.evaluator_id === 'llm_rubric_review')!;
    assert.equal(
      verdictByCrit.get(detCrit.criterion_id),
      'FAIL',
      'deterministic criterion is FAIL',
    );
    assert.equal(
      verdictByCrit.get(advCrit.criterion_id),
      'SKIP',
      'advisory criterion is SKIP (never gates)',
    );
  },
);

// ---------------------------------------------------------------------------
// 8. Token budget (§19.2): a runAttempt that reports usage exceeding the
//    configured tokenBudget → loop stops failed with stopReason token_budget,
//    bounded attempts. This proves the budget is REAL (debited from
//    AttemptExecution.usage), not a dead guard.
// ---------------------------------------------------------------------------

await check(
  'token budget: usage exceeding tokenBudget → failed (token_budget), bounded',
  async () => {
    const { svc, deps } = freshService();
    const missionId = await readyMission(svc, {
      criteria: [cmdCriterion('tests pass', 'pnpm test')],
    });

    let attemptSeen = 0;
    // tokenBudget = 100; each attempt FAILs (so the loop would otherwise repair)
    // and reports 60 tokens. After attempt 1: 100 - 60 = 40 (> 0, repair). After
    // attempt 2: 40 - 60 = -20 (<= 0) → stop on token_budget BEFORE a 3rd attempt.
    // (Each attempt fails with a DISTINCT signature so STUCK does not pre-empt.)
    const controller = makeController(
      svc,
      deps,
      async ({ attemptNumber }) => {
        attemptSeen = attemptNumber;
        return {
          evaluationContextFor: (criterion) => scriptedContext(criterion, attemptNumber + 1),
          usage: { tokens: 60 },
        } satisfies AttemptExecution;
      },
      { maxRepairsPerCriterion: 3, maxAttempts: 6, tokenBudget: 100 },
    );

    const result = await controller.run(missionId);
    assert.equal(result.status, 'failed', 'exhausting the token budget → failed');
    assert.equal(result.stopReason, 'token_budget', 'stop reason is the token budget');
    assert.equal(
      result.attempts,
      2,
      'stopped after the attempt that pushed the budget non-positive',
    );
    assert.equal(attemptSeen, 2, 'no third attempt was started');
    assert.ok(result.attempts < 6, 'token budget stopped well before the 6-cap');
    assert.ok(
      result.failurePacket!.remainingBudget.tokenBudgetRemaining! <= 0,
      'the packet reports the exhausted (non-positive) token budget',
    );
    const mission = await svc.getMission(missionId);
    assert.equal(mission.status, 'failed', 'mission persisted as failed');
  },
);

await check('token budget nudge: 88%+ injects once before the unchanged hard stop', async () => {
  const { svc, deps } = freshService();
  const missionId = await readyMission(svc, {
    criteria: [cmdCriterion('tests pass', 'pnpm test')],
  });
  const observedNudges: Array<RunAttemptInput['budgetNudge']> = [];
  const controller = makeController(
    svc,
    deps,
    async ({ attemptNumber, budgetNudge }) => {
      observedNudges.push(budgetNudge);
      return {
        evaluationContextFor: (criterion) => scriptedContext(criterion, attemptNumber + 10),
        usage: { tokens: attemptNumber < 3 ? 45 : 10 },
      } satisfies AttemptExecution;
    },
    { maxRepairsPerCriterion: 3, maxAttempts: 6, tokenBudget: 100 },
  );

  const result = await controller.run(missionId);
  assert.equal(result.stopReason, 'token_budget');
  assert.equal(result.attempts, 3, 'the nudge is delivered before the exhausting attempt');
  assert.equal(observedNudges.filter(Boolean).length, 1, 'the Mission receives exactly one nudge');
  assert.equal(observedNudges[0], undefined, '45% usage is below threshold');
  assert.equal(observedNudges[1], undefined, 'the nudge is computed after crossing 88%');
  assert.equal(
    observedNudges[2]?.tokenRemaining,
    10,
    'the next attempt sees exact remaining tokens',
  );
  assert.match(observedNudges[2]?.instruction ?? '', /Do not start new work/);
  assert.ok(
    result.failurePacket!.remainingBudget.tokenBudgetRemaining! <= 0,
    'hard exhaustion remains authoritative after the nudge',
  );
});

// ---------------------------------------------------------------------------
// 9. Concurrent cancel race: a cancel that lands mid-attempt (after
//    startAttempt → running, before beginVerifying) makes the next transition
//    throw illegal_transition; run() must catch it, re-read, and return a clean
//    'cancelled' result — no escaping throw.
// ---------------------------------------------------------------------------

await check(
  'concurrent cancel mid-attempt → run() returns cancelled cleanly (no throw)',
  async () => {
    const { svc, deps } = freshService();
    const missionId = await readyMission(svc, {
      criteria: [cmdCriterion('tests pass', 'pnpm test')],
    });

    // The scripted runAttempt cancels the mission WHILE the attempt is in flight
    // (mission is 'running' here, set by startAttempt). The subsequent
    // beginVerifying('running'→'verifying') is then illegal because the mission is
    // 'cancelled' — the controller must convert that into a clean cancelled stop.
    const controller = makeController(svc, deps, async () => {
      await svc.cancel(missionId, 'user pressed stop mid-attempt');
      return {
        evaluationContextFor: (criterion) => scriptedContext(criterion, 0),
      } satisfies AttemptExecution;
    });

    // Must NOT throw — it returns a clean cancelled result.
    const result = await controller.run(missionId);
    assert.equal(result.status, 'cancelled', 'mid-attempt cancel → cancelled');
    assert.equal(result.stopReason, 'cancelled', 'stop reason is cancelled');
    assert.equal(result.finalMissionStatus, 'cancelled', 'mission persisted as cancelled');
    const mission = await svc.getMission(missionId);
    assert.equal(mission.status, 'cancelled', 'cancel is authoritative');
  },
);

// ---------------------------------------------------------------------------
// 10. Evaluator BLOCKED/ERROR (NOT a runtimeError) with no product FAIL →
//     mission blocked, repair counter untouched. Distinct from check 6
//     (which is a runtimeError before evaluation): here an evaluator runs and
//     returns a non-product verdict.
// ---------------------------------------------------------------------------

await check(
  'evaluator BLOCKED (no product FAIL) → needs input; repair counter untouched',
  async () => {
    const { svc, deps } = freshService();
    // manual_approval with no recorded approval → BLOCKED (a real evaluator run,
    // not a runtimeError). No product FAIL anywhere → input wait → blocked.
    const missionId = await readyMission(svc, {
      criteria: [
        {
          description: 'human sign-off',
          evaluatorId: 'manual_approval',
          evaluatorConfigJson: '{}',
          required: true,
        },
      ],
    });

    const controller = makeController(svc, deps, async () => ({
      evaluationContextFor: (criterion) =>
        ({
          criterion: {
            id: criterion.id,
            description: criterion.description,
            configJson: criterion.configJson,
          },
          workspaceReadFile: async () => null,
          workspaceFileExists: async () => false,
          workspaceHashFile: async () => null,
          runCommand: async () => ({ exitCode: 0, stdout: '', stderr: '' }),
          gitChangedPaths: async () => [],
          listArtifacts: async () => [],
          recordedApproval: async () => null, // → manual_approval returns BLOCKED
        }) satisfies EvaluationContext,
    }));

    const result = await controller.run(missionId);
    assert.equal(result.status, 'blocked', 'evaluator BLOCKED with no product FAIL → blocked');
    assert.equal(result.stopReason, 'needs_input', 'human approval is input, not runtime failure');
    assert.equal(result.attempts, 1, 'a single attempt — blocked is not repaired');
    assert.deepEqual(
      result.evidence.repairCountsByCriterion,
      {},
      '§19.2/§5: evaluator BLOCKED consumes NO repair',
    );
    // The recorded verdict was BLOCKED (the evaluator actually ran).
    const verdicts = result.evidence.attempts[0]!.verdicts;
    assert.equal(verdicts[0]?.verdict, 'BLOCKED', 'the manual_approval verdict is BLOCKED');
  },
);

// ---------------------------------------------------------------------------
// 11. A1: a mission with zero REQUIRED criteria must NOT run to a vacuous
//     completion. createMission rejects it up front, so to drive the loop's
//     defense-in-depth we insert a ready mission with ONLY an optional criterion
//     straight through the repos (bypassing the service guard), then prove the
//     loop refuses to complete it vacuously — it does NOT call completeMission.
// ---------------------------------------------------------------------------

await check(
  'A1: zero required criteria → loop refuses to complete vacuously (no [].every PASS)',
  async () => {
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
    const ts = new Date(Date.UTC(2026, 0, 1)).toISOString();
    // Insert a READY mission with only an OPTIONAL criterion (bypassing the
    // createMission guard, which would otherwise reject zero-required up front).
    await m.missions.insert({
      mission_id: 'm-vac',
      company_id: 'co-1',
      project_id: null,
      thread_id: 'thr-1',
      title: 'vacuous',
      goal: 'g',
      status: 'ready',
      runtime_id: 'pi',
      runtime_policy_json: '{}',
      budget_json: '{}',
      expected_artifacts_json: null,
      current_attempt_id: null,
      created_at: ts,
      updated_at: ts,
      completed_at: null,
    });
    await m.missionCriteria.insert({
      criterion_id: 'c-opt',
      mission_id: 'm-vac',
      description: 'optional only',
      evaluator_id: 'command_exit_zero',
      evaluator_config_json: JSON.stringify({ command: 'pnpm test' }),
      required: 0,
      order_index: 0,
      status: 'pending',
      last_evaluation_id: null,
    });

    let runAttemptCalled = false;
    const controller = makeController(svc, deps, async () => {
      runAttemptCalled = true;
      return { evaluationContextFor: (criterion) => scriptedContext(criterion, 0) };
    });

    // The loop must throw (invariant_violation) BEFORE running an attempt; it must
    // never reach completeMission via an empty-set every()===true.
    await assert.rejects(
      () => controller.run('m-vac'),
      (err: unknown) => err instanceof MissionStateError && err.code === 'invariant_violation',
      'a zero-required mission must not run a vacuous loop',
    );
    assert.equal(runAttemptCalled, false, 'no attempt was run for a zero-required mission');
    const mission = await svc.getMission('m-vac');
    assert.notEqual(mission.status, 'completed', 'the mission was NOT vacuously completed');
  },
);

// ---------------------------------------------------------------------------
// 12. A2 coordination: an evaluator ERROR verdict (infra, e.g. a capability
//     failure) → mission blocked, and it does NOT consume a per-criterion
//     repair. Distinct from a BLOCKED verdict (check 10) and a runtimeError
//     (check 6): here a deterministic evaluator returns ERROR. We drive ERROR
//     deterministically by giving command_exit_zero no `command` in its config
//     (builtin maps a missing command to ERROR), so this is self-contained.
// ---------------------------------------------------------------------------

await check('A2: evaluator ERROR (infra) → blocked; repair counter does NOT move', async () => {
  const { svc, deps } = freshService();
  const missionId = await readyMission(svc, {
    // command_exit_zero with NO command in config → the builtin returns ERROR
    // (an un-runnable check / setup problem), which the controller treats as
    // infra, NOT a product FAIL.
    criteria: [
      {
        description: 'tests pass',
        evaluatorId: 'command_exit_zero',
        evaluatorConfigJson: '{}', // no `command` → ERROR
        required: true,
      },
    ],
  });

  const controller = makeController(svc, deps, async () => ({
    // The evaluator does not need to run a command (it ERRORs on the missing
    // config first); supply a benign context.
    evaluationContextFor: (criterion) => ({
      criterion: {
        id: criterion.id,
        description: criterion.description,
        configJson: criterion.configJson,
      },
      workspaceReadFile: async () => null,
      workspaceFileExists: async () => false,
      workspaceHashFile: async () => null,
      runCommand: async () => ({ exitCode: 0, stdout: '', stderr: '' }),
      gitChangedPaths: async () => [],
      listArtifacts: async () => [],
      recordedApproval: async () => null,
    }),
  }));

  const result = await controller.run(missionId);
  assert.equal(result.status, 'blocked', 'evaluator ERROR with no product FAIL → blocked');
  assert.equal(result.stopReason, 'runtime_incompatible', 'infra stop reason');
  assert.equal(result.attempts, 1, 'a single attempt — an ERROR is not repaired');
  assert.equal(result.finalMissionStatus, 'blocked', 'mission persisted as blocked');
  assert.deepEqual(
    result.evidence.repairCountsByCriterion,
    {},
    '§19.2/§5: an ERROR verdict consumes NO repair',
  );
  // The recorded verdict was ERROR (the evaluator actually ran and errored).
  const verdicts = result.evidence.attempts[0]!.verdicts;
  assert.equal(verdicts[0]?.verdict, 'ERROR', 'the recorded verdict is ERROR');
});

if (failed > 0) {
  console.error(`\nmission-loop-controller: ${passed}/${TOTAL} passed (${failed} failed)`);
  process.exit(1);
}
console.log(`\nmission-loop-controller: ${passed}/${TOTAL} passed`);
