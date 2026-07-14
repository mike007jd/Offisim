/**
 * MissionRunController oracle (PRD §16.2 / §16.3 / §19 / §5, slice MS-005 + MS-006).
 *
 * Drives the renderer {@link createMissionRunController} over a REAL
 * MissionService + the MS-001 in-memory mission repos + the default
 * EvaluatorRegistry, but with the two live edges FAKED:
 *
 *   - a FAKE `agentRuntime`: no model. Its `execute` records the prompt it was
 *     handed (so we can assert the MS-006 repair brief reached it) and then emits
 *     the SAME `mission.evaluation.submitted` events the real Pi bridge would —
 *     the agent SIGNALING that criteria are ready. A scripted summary can even
 *     CLAIM pass.
 *   - a FAKE `createEvaluationContext`: backed by in-memory file/command/git/
 *     artifact maps, scriptable per attempt, so the REAL evaluators (e.g.
 *     command_exit_zero) produce known verdicts over a controlled "workspace".
 *
 * The controller, MissionService, and evaluators are the production code under
 * test. Covered:
 *   (a) happy path — agent submits, evaluators PASS over the fake workspace →
 *       mission completed;
 *   (b) repair (MS-006) — evaluator FAILs attempt 1, the repair brief is built
 *       into attempt 2's prompt (assert the failurePacket reached runAttempt via
 *       the prompt), evaluator PASSes attempt 2 → completed;
 *   (c) §5 — the agent CLAIMS pass in its submit_for_evaluation summary, but the
 *       fake workspace makes command_exit_zero FAIL → the mission does NOT
 *       complete. Proves the deterministic evaluator (not the agent's self-report)
 *       decides.
 *
 * Pure Node via tsx against renderer + core source (style mirrors
 * scripts/harness-conversation-run-controller.mts). Inject-proof (run manually,
 * then revert): force `makeEvaluationContext` to ignore the scripted exit code and
 * always return exitCode 0 → scenario (c) wrongly completes. That confirms the
 * verdict is the evaluator's, not the agent's claim.
 */

import assert from 'node:assert/strict';
import type {
  TaskWorkspaceBindingClaim,
  TaskWorkspaceEvaluationLeaseClaim,
} from '../apps/desktop/renderer/src/lib/tauri-commands.js';
import type {
  DesktopAgentRunInput,
  DesktopAgentRunResult,
  DesktopAgentRuntime,
} from '../apps/desktop/renderer/src/runtime/desktop-agent-runtime.js';
import { createDevMission } from '../apps/desktop/renderer/src/runtime/mission/dev-create-mission.js';
import type { TauriEvaluationContextInput } from '../apps/desktop/renderer/src/runtime/mission/evaluation-context.js';
import {
  MISSION_EVALUATION_SUBMITTED_EVENT,
  type MissionEvaluationSubmittedPayload,
} from '../apps/desktop/renderer/src/runtime/mission/mission-events.js';
import { createMissionRunController } from '../apps/desktop/renderer/src/runtime/mission/mission-run-controller.js';
import {
  InMemoryEventBus,
  type RuntimeEvent,
  type RuntimeRepositories,
  createDefaultEvaluatorRegistry,
} from '../packages/core/src/browser.js';
import { createDeliverablesMemoryRepos } from '../packages/core/src/runtime/repos/deliverables/memory.ts';
import { createMissionMemoryRepos } from '../packages/core/src/runtime/repos/mission/memory.ts';

let passed = 0;
let failed = 0;
const TOTAL = 11;

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
// In-memory test doubles.
// ---------------------------------------------------------------------------

/** A scripted per-attempt command result: the exit code the fake `runCommand`
 *  returns for a given command on a given attempt number (1-based). */
type CommandScript = (command: string, attemptNumber: number) => number;

function fakeWorkspaceBindingClaim(
  input: DesktopAgentRunInput,
  companyId: string,
  attemptNumber: number,
): TaskWorkspaceBindingClaim {
  const turnId = input.runId ?? input.attemptId ?? `attempt-${attemptNumber}`;
  return {
    workspaceRef: `harness-workspace-ref-${attemptNumber}`,
    historyId: `harness-binding-${attemptNumber}`,
    companyId,
    projectId: input.projectId ?? 'proj-1',
    threadId: input.threadId,
    turnId,
    requestId: `harness-request-${attemptNumber}`,
    access: 'write',
    source: 'mission-harness',
    confidence: 1,
    reasonCode: 'harness_fixture',
    issuedAtUnixMs: 1_700_000_000_000 + attemptNumber,
    expiresAtUnixMs: 1_700_003_600_000 + attemptNumber,
    displayPath: 'mission-harness-workspace',
  };
}

function makeFakeEvaluationLeaseLifecycle(): {
  acquired: TaskWorkspaceEvaluationLeaseClaim[];
  released: TaskWorkspaceEvaluationLeaseClaim[];
  deps: {
    acquireEvaluationLease(input: {
      bindingClaim: TaskWorkspaceBindingClaim;
      missionId: string;
      attemptId: string;
    }): Promise<TaskWorkspaceEvaluationLeaseClaim>;
    releaseEvaluationLease(input: {
      evaluationLease: TaskWorkspaceEvaluationLeaseClaim;
    }): Promise<void>;
  };
} {
  const acquired: TaskWorkspaceEvaluationLeaseClaim[] = [];
  const released: TaskWorkspaceEvaluationLeaseClaim[] = [];
  return {
    acquired,
    released,
    deps: {
      async acquireEvaluationLease({ bindingClaim, missionId, attemptId }) {
        const lease: TaskWorkspaceEvaluationLeaseClaim = {
          evaluationLeaseRef: `harness-evaluation-lease-${attemptId}`,
          historyId: bindingClaim.historyId,
          companyId: bindingClaim.companyId,
          projectId: bindingClaim.projectId,
          threadId: bindingClaim.threadId,
          turnId: bindingClaim.turnId,
          requestId: bindingClaim.requestId,
          missionId,
          attemptId,
          issuedAtUnixMs: 1_700_000_000_000,
          expiresAtUnixMs: 1_700_007_200_000,
        };
        acquired.push(lease);
        return lease;
      },
      async releaseEvaluationLease({ evaluationLease }) {
        released.push(evaluationLease);
      },
    },
  };
}

/** Build the fake repos the controller needs: the real in-memory mission repos +
 *  a real in-memory deliverables repo + a minimal projects repo (findById only).
 *  Returned untyped-but-shaped as RuntimeRepositories — the controller only
 *  touches the mission repos, deliverables, and projects.findById. */
function makeRepos(_projectWorkspaceRoot: string | null): {
  repos: RuntimeRepositories;
  mission: ReturnType<typeof createMissionMemoryRepos>;
} {
  const mission = createMissionMemoryRepos();
  const { deliverables } = createDeliverablesMemoryRepos();
  const projects = {
    async findById() {
      throw new Error(
        'Mission evaluation must not re-read Project.workspace_root after the Turn binding exists',
      );
    },
  };
  const repos = {
    missions: mission.missions,
    missionCriteria: mission.missionCriteria,
    missionAttempts: mission.missionAttempts,
    missionEvaluations: mission.missionEvaluations,
    missionEvents: mission.missionEvents,
    deliverables,
    projects,
  } as unknown as RuntimeRepositories;
  return { repos, mission };
}

/**
 * A fake DesktopAgentRuntime. On `execute` it records the prompt, increments the
 * attempt counter, and emits a `mission.evaluation.submitted` event for each
 * scripted criterion id (the agent SIGNALING "ready" — with whatever summary the
 * script gives, including a false "all pass" claim). It never calls a model.
 */
function makeFakeRuntime(
  eventBus: InMemoryEventBus,
  companyId: string,
  opts: {
    submitCriterionIds: string[];
    submitSummary: (attemptNumber: number) => string;
    /** Set to throw on a given attempt → exercises the runtimeError path. */
    throwOnAttempt?: number;
    /** Root token usage remains the persistence-only lane. */
    usage?: { input: number; output: number };
    /** Root + delegated-tree usage is the Mission budget lane. */
    budgetUsage?: { input: number; output: number };
  },
): {
  runtime: DesktopAgentRuntime;
  prompts: string[];
  inputs: DesktopAgentRunInput[];
  attempts: number;
} {
  const prompts: string[] = [];
  const inputs: DesktopAgentRunInput[] = [];
  let attempts = 0;
  const runtime: DesktopAgentRuntime = {
    async execute(input: DesktopAgentRunInput): Promise<DesktopAgentRunResult> {
      attempts += 1;
      const attemptNumber = attempts;
      prompts.push(input.text);
      inputs.push(input);
      if (opts.throwOnAttempt === attemptNumber) {
        throw new Error(`scripted transport failure on attempt ${attemptNumber}`);
      }
      // The run id the renderer sets IS the attempt id (== rootRunId on the wire).
      const runId = input.runId ?? input.attemptId ?? '';
      for (const criterionId of opts.submitCriterionIds) {
        const payload: MissionEvaluationSubmittedPayload = {
          runId,
          rootRunId: runId,
          criterionId,
          summary: opts.submitSummary(attemptNumber),
          evidenceRefs: [],
        };
        const event: RuntimeEvent<MissionEvaluationSubmittedPayload> = {
          type: MISSION_EVALUATION_SUBMITTED_EVENT,
          entityId: criterionId,
          entityType: 'runtime',
          companyId,
          threadId: input.threadId,
          timestamp: Date.now(),
          payload,
        };
        eventBus.emit(event);
      }
      return {
        text: 'done',
        workspaceBindingClaim: fakeWorkspaceBindingClaim(input, companyId, attemptNumber),
        ...(opts.usage ? { usage: opts.usage } : {}),
        ...(opts.budgetUsage ? { budgetUsage: opts.budgetUsage } : {}),
      };
    },
    abort() {},
    async answerUiRequest() {},
    async dispose() {},
  };
  return {
    runtime,
    get prompts() {
      return prompts;
    },
    get inputs() {
      return inputs;
    },
    get attempts() {
      return attempts;
    },
  } as {
    runtime: DesktopAgentRuntime;
    prompts: string[];
    inputs: DesktopAgentRunInput[];
    attempts: number;
  };
}

/**
 * A fake EvaluationContext factory: backed by an in-memory command script (and
 * empty file/git/artifact maps unless extended). The REAL evaluator
 * (command_exit_zero) runs over the exit code the script returns. `attemptNumber`
 * is threaded via a closure cell the harness bumps each attempt.
 */
function makeFakeEvaluationContextFactory(
  commandScript: CommandScript,
  attemptCell: { n: number },
): (
  input: TauriEvaluationContextInput,
) => import('../packages/core/src/browser.js').EvaluationContext {
  return (input: TauriEvaluationContextInput) => {
    assert.ok(
      input.evaluationLease,
      'each completed attempt must acquire a bounded evaluation lease',
    );
    assert.equal(
      input.evaluationLease.turnId,
      input.attemptRunId,
      'evaluation lease must remain tied to this exact attempt Turn',
    );
    return {
      criterion: {
        id: input.criterion.id,
        description: input.criterion.description,
        configJson: input.criterion.configJson,
      },
      workspaceReadFile: async () => null,
      workspaceFileExists: async () => false,
      workspaceHashFile: async () => null,
      runCommand: async (command: string) => ({
        exitCode: commandScript(command, attemptCell.n),
        stdout: '',
        stderr: '',
      }),
      gitChangedPaths: async () => [],
      listArtifacts: async () => [],
      recordedApproval: async () => null,
    };
  };
}

// ---------------------------------------------------------------------------
// Scenario (a): happy path — agent submits, evaluators PASS → completed.
// ---------------------------------------------------------------------------

await check(
  '(a) happy path: agent submits, evaluators PASS over fake workspace → completed',
  async () => {
    const eventBus = new InMemoryEventBus();
    const { repos, mission } = makeRepos('/tmp/fake-ws');

    const { missionId } = await createDevMission(repos, {
      companyId: 'co-1',
      threadId: 'thr-1',
      projectId: 'proj-1',
      goal: 'Make the tests pass',
      criteria: [
        {
          description: 'tests pass',
          evaluatorId: 'command_exit_zero',
          evaluatorConfigJson: JSON.stringify({ command: 'pnpm test' }),
          required: true,
        },
      ],
    });
    const criteria = await mission.missionCriteria.listByMission(missionId);
    const criterionId = criteria[0]!.criterion_id;

    const { runtime, inputs } = makeFakeRuntime(eventBus, 'co-1', {
      submitCriterionIds: [criterionId],
      submitSummary: () => 'tests green',
    });
    const attemptCell = { n: 0 };
    const leases = makeFakeEvaluationLeaseLifecycle();
    const controller = createMissionRunController({
      agentRuntime: runtime,
      repos,
      evaluatorRegistry: createDefaultEvaluatorRegistry(),
      eventBus,
      ...leases.deps,
      // Bump the attempt cell each runAttempt by hooking the factory: every
      // criterion in an attempt shares the same attempt number, and exit 0 → PASS.
      createEvaluationContext: makeFakeEvaluationContextFactory(() => 0, attemptCell),
    });

    const result = await controller.runMission(missionId);
    assert.equal(result.status, 'completed', 'all required criteria PASS → completed');
    assert.equal(result.attempts, 1, 'completed in one attempt');
    assert.equal(leases.acquired.length, 1, 'one bounded evaluation lease acquired');
    assert.equal(leases.released.length, 1, 'evaluation lease released before runMission returns');
    assert.equal(
      leases.released[0]?.evaluationLeaseRef,
      leases.acquired[0]?.evaluationLeaseRef,
      'the exact acquired lease is released',
    );
    assert.equal(
      inputs[0]?.delegationLimits,
      undefined,
      'a Mission without authored agent caps must preserve the host default path',
    );
    const finalMission = await mission.missions.findById(missionId);
    assert.equal(finalMission!.status, 'completed', 'MissionService persisted completed');
  },
);

// ---------------------------------------------------------------------------
// Scenario (b): repair (MS-006) — FAIL@1, repair brief in attempt 2's prompt,
// PASS@2 → completed.
// ---------------------------------------------------------------------------

await check(
  '(b) repair: FAIL@1 → repair brief reaches attempt 2 prompt → PASS@2 → completed',
  async () => {
    const eventBus = new InMemoryEventBus();
    const { repos, mission } = makeRepos('/tmp/fake-ws');

    const { missionId } = await createDevMission(repos, {
      companyId: 'co-1',
      threadId: 'thr-1',
      projectId: 'proj-1',
      goal: 'Make the build pass',
      criteria: [
        {
          description: 'build ok',
          evaluatorId: 'command_exit_zero',
          evaluatorConfigJson: JSON.stringify({ command: 'pnpm build' }),
          required: true,
        },
      ],
    });
    const criteria = await mission.missionCriteria.listByMission(missionId);
    const criterionId = criteria[0]!.criterion_id;

    const fake = makeFakeRuntime(eventBus, 'co-1', {
      submitCriterionIds: [criterionId],
      submitSummary: () => 'I think the build works',
    });
    // attempt 1 → exit 1 (FAIL); attempt 2 → exit 0 (PASS). The attempt cell is
    // bumped by the runtime stub (each execute = a new attempt) BEFORE the
    // evaluator runs, because execute() resolves before evaluationContextFor.
    const attemptCell = { n: 0 };
    const wrappedRuntime: DesktopAgentRuntime = {
      ...fake.runtime,
      async execute(input) {
        attemptCell.n += 1;
        return fake.runtime.execute(input);
      },
    };
    const controller = createMissionRunController({
      agentRuntime: wrappedRuntime,
      repos,
      evaluatorRegistry: createDefaultEvaluatorRegistry(),
      eventBus,
      ...makeFakeEvaluationLeaseLifecycle().deps,
      createEvaluationContext: makeFakeEvaluationContextFactory(
        (_command, attemptNumber) => (attemptNumber === 1 ? 1 : 0),
        attemptCell,
      ),
    });

    const result = await controller.runMission(missionId);
    assert.equal(result.status, 'completed', 'second attempt passes → completed');
    assert.equal(result.attempts, 2, 'completed in exactly two attempts');

    // MS-006: the repair attempt's prompt must carry the structured failure brief.
    assert.equal(fake.prompts.length, 2, 'two attempts ran');
    const repairPrompt = fake.prompts[1]!;
    assert.ok(repairPrompt.includes('Mission repair'), 'attempt 2 prompt is a repair brief');
    assert.ok(repairPrompt.includes(criterionId), 'repair brief names the failed criterion id');
    assert.ok(
      repairPrompt.includes('build ok'),
      'repair brief carries the failed criterion description',
    );
    // The deterministic failure summary line must be present (not the agent's note):
    // command_exit_zero with exit 1 summarizes as "`pnpm build` exited 1", surfaced
    // under the brief's "what was wrong:" line.
    assert.ok(
      repairPrompt.includes('what was wrong:'),
      'repair brief has the failure-summary line',
    );
    assert.ok(
      repairPrompt.includes('exited 1'),
      'repair brief carries the deterministic command-exit summary',
    );
    // And the first attempt's prompt was NOT a repair brief.
    assert.ok(
      !fake.prompts[0]!.includes('Mission repair'),
      'attempt 1 prompt is the initial brief',
    );
  },
);

// ---------------------------------------------------------------------------
// Scenario (c): §5 — the agent CLAIMS pass, but the evaluator FAILs over the
// fake workspace → mission does NOT complete. The evaluator decides, not the
// agent's self-reported summary.
// ---------------------------------------------------------------------------

await check(
  '(c) §5: agent claims PASS but command_exit_zero FAILs → mission does NOT complete',
  async () => {
    const eventBus = new InMemoryEventBus();
    const { repos, mission } = makeRepos('/tmp/fake-ws');

    const { missionId } = await createDevMission(repos, {
      companyId: 'co-1',
      threadId: 'thr-1',
      projectId: 'proj-1',
      goal: 'Ship it',
      criteria: [
        {
          description: 'tests pass',
          evaluatorId: 'command_exit_zero',
          evaluatorConfigJson: JSON.stringify({ command: 'pnpm test' }),
          required: true,
        },
      ],
    });
    const criteria = await mission.missionCriteria.listByMission(missionId);
    const criterionId = criteria[0]!.criterion_id;

    // The agent loudly claims success in every submission summary…
    const { runtime } = makeFakeRuntime(eventBus, 'co-1', {
      submitCriterionIds: [criterionId],
      submitSummary: () => 'ALL TESTS PASS, mission complete!',
    });
    const attemptCell = { n: 0 };
    // …but the fake workspace makes the command exit non-zero EVERY attempt → FAIL.
    const controller = createMissionRunController({
      agentRuntime: runtime,
      repos,
      evaluatorRegistry: createDefaultEvaluatorRegistry(),
      eventBus,
      ...makeFakeEvaluationLeaseLifecycle().deps,
      createEvaluationContext: makeFakeEvaluationContextFactory(() => 1, attemptCell),
      // Bound the loop so the always-FAIL doesn't run the full 6 attempts.
    });

    const result = await controller.runMission(missionId);
    assert.notEqual(
      result.status,
      'completed',
      'the agent self-report must NOT yield completion (§5)',
    );
    // An always-FAIL command produces an identical failure signature each attempt,
    // so the bounded loop stops as STUCK (which finalizes the mission as failed) —
    // the point is it is a non-completion driven by the evaluator, never the agent's
    // "ALL TESTS PASS" claim.
    assert.ok(
      result.status === 'failed' || result.status === 'stuck',
      `expected a non-completion stop (failed/stuck), got ${result.status}`,
    );
    assert.equal(
      result.finalMissionStatus,
      'failed',
      'mission finalized as failed (not completed)',
    );
    const finalMission = await mission.missions.findById(missionId);
    assert.notEqual(finalMission!.status, 'completed', 'MissionService never wrote completed');
  },
);

// ---------------------------------------------------------------------------
// Inject-proof: a runtime transport throw on attempt 1 is INFRA → blocked, with
// NO repair consumed (§19.2 / §5). Proves the controller separates a runtime
// error from a product FAIL.
// ---------------------------------------------------------------------------

await check('runtime transport throw → blocked (infra), not a product FAIL', async () => {
  const eventBus = new InMemoryEventBus();
  const { repos, mission } = makeRepos('/tmp/fake-ws');

  const { missionId } = await createDevMission(repos, {
    companyId: 'co-1',
    threadId: 'thr-1',
    projectId: 'proj-1',
    goal: 'Whatever',
    criteria: [
      {
        description: 'tests pass',
        evaluatorId: 'command_exit_zero',
        evaluatorConfigJson: JSON.stringify({ command: 'pnpm test' }),
        required: true,
      },
    ],
  });

  const { runtime } = makeFakeRuntime(eventBus, 'co-1', {
    submitCriterionIds: [],
    submitSummary: () => '',
    throwOnAttempt: 1,
  });
  const attemptCell = { n: 0 };
  const controller = createMissionRunController({
    agentRuntime: runtime,
    repos,
    evaluatorRegistry: createDefaultEvaluatorRegistry(),
    eventBus,
    ...makeFakeEvaluationLeaseLifecycle().deps,
    createEvaluationContext: makeFakeEvaluationContextFactory(() => 0, attemptCell),
  });

  const result = await controller.runMission(missionId);
  assert.equal(result.status, 'blocked', 'a transport throw is infra → blocked');
  assert.equal(result.stopReason, 'runtime_incompatible', 'stop reason is runtime_incompatible');
  assert.equal(result.attempts, 1, 'blocked after the single failed attempt');
});

await check(
  'attempt root identity persistence fails before runtime or lease acquisition',
  async () => {
    const eventBus = new InMemoryEventBus();
    const { repos } = makeRepos('/tmp/fake-ws');
    const { missionId } = await createDevMission(repos, {
      companyId: 'co-1',
      threadId: 'thr-root-persist-failure',
      projectId: 'proj-1',
      goal: 'Do not start without durable attempt identity',
      criteria: [
        {
          description: 'tests pass',
          evaluatorId: 'command_exit_zero',
          evaluatorConfigJson: JSON.stringify({ command: 'pnpm test' }),
          required: true,
        },
      ],
    });
    repos.missionAttempts.setRootRunId = async () => {
      throw new Error('scripted attempt identity persistence failure');
    };
    const fake = makeFakeRuntime(eventBus, 'co-1', {
      submitCriterionIds: [],
      submitSummary: () => '',
    });
    const leases = makeFakeEvaluationLeaseLifecycle();
    const controller = createMissionRunController({
      agentRuntime: fake.runtime,
      repos,
      evaluatorRegistry: createDefaultEvaluatorRegistry(),
      eventBus,
      ...leases.deps,
      createEvaluationContext: () => {
        throw new Error('evaluation must not start without durable attempt identity');
      },
    });

    const result = await controller.runMission(missionId);
    assert.equal(result.status, 'blocked');
    assert.equal(result.stopReason, 'runtime_incompatible');
    assert.equal(fake.attempts, 0, 'paid/writing runtime never starts');
    assert.equal(leases.acquired.length, 0, 'no evaluation lease is minted');
  },
);

await check(
  'completed runtime result without a Turn claim → blocked before evaluation',
  async () => {
    const eventBus = new InMemoryEventBus();
    const { repos } = makeRepos('/tmp/catalog-root-that-must-not-be-read');
    const { missionId } = await createDevMission(repos, {
      companyId: 'co-1',
      threadId: 'thr-missing-claim',
      projectId: 'proj-1',
      goal: 'Never verify against a reconstructed workspace',
      criteria: [
        {
          description: 'tests pass',
          evaluatorId: 'command_exit_zero',
          evaluatorConfigJson: JSON.stringify({ command: 'pnpm test' }),
          required: true,
        },
      ],
    });
    const runtime = {
      ...makeFakeRuntime(eventBus, 'co-1', {
        submitCriterionIds: [],
        submitSummary: () => '',
      }).runtime,
      async execute(): Promise<DesktopAgentRunResult> {
        return { text: 'invalid success' } as unknown as DesktopAgentRunResult;
      },
    } satisfies DesktopAgentRuntime;
    const controller = createMissionRunController({
      agentRuntime: runtime,
      repos,
      evaluatorRegistry: createDefaultEvaluatorRegistry(),
      eventBus,
      ...makeFakeEvaluationLeaseLifecycle().deps,
      createEvaluationContext: () => {
        throw new Error('evaluator must not run without the exact Turn claim');
      },
    });

    const result = await controller.runMission(missionId);
    assert.equal(result.status, 'blocked');
    assert.equal(result.stopReason, 'runtime_incompatible');
  },
);

await check('evaluator throw still releases the exact evaluation lease', async () => {
  const eventBus = new InMemoryEventBus();
  const { repos } = makeRepos('/tmp/catalog-root-that-must-not-be-read');
  const { missionId } = await createDevMission(repos, {
    companyId: 'co-1',
    threadId: 'thr-evaluator-throw',
    projectId: 'proj-1',
    goal: 'Release authority even when verification crashes',
    criteria: [
      {
        description: 'tests pass',
        evaluatorId: 'command_exit_zero',
        evaluatorConfigJson: JSON.stringify({ command: 'pnpm test' }),
        required: true,
      },
    ],
  });
  const { runtime } = makeFakeRuntime(eventBus, 'co-1', {
    submitCriterionIds: [],
    submitSummary: () => '',
  });
  const leases = makeFakeEvaluationLeaseLifecycle();
  const controller = createMissionRunController({
    agentRuntime: runtime,
    repos,
    evaluatorRegistry: createDefaultEvaluatorRegistry(),
    eventBus,
    ...leases.deps,
    createEvaluationContext: () => {
      throw new Error('scripted evaluator context failure');
    },
  });

  await assert.rejects(controller.runMission(missionId), /scripted evaluator context failure/u);
  assert.equal(leases.acquired.length, 1);
  assert.equal(leases.released.length, 1);
  assert.equal(leases.released[0]?.evaluationLeaseRef, leases.acquired[0]?.evaluationLeaseRef);
});

await check('lease cleanup failure cannot rewrite a completed Mission result', async () => {
  const eventBus = new InMemoryEventBus();
  const { repos } = makeRepos('/tmp/catalog-root-that-must-not-be-read');
  const { missionId } = await createDevMission(repos, {
    companyId: 'co-1',
    threadId: 'thr-cleanup-failure',
    projectId: 'proj-1',
    goal: 'Keep business truth stable when cleanup transport fails',
    criteria: [
      {
        description: 'tests pass',
        evaluatorId: 'command_exit_zero',
        evaluatorConfigJson: JSON.stringify({ command: 'pnpm test' }),
        required: true,
      },
    ],
  });
  const { runtime } = makeFakeRuntime(eventBus, 'co-1', {
    submitCriterionIds: [],
    submitSummary: () => '',
  });
  const leases = makeFakeEvaluationLeaseLifecycle();
  let cleanupAttempts = 0;
  const controller = createMissionRunController({
    agentRuntime: runtime,
    repos,
    evaluatorRegistry: createDefaultEvaluatorRegistry(),
    eventBus,
    acquireEvaluationLease: leases.deps.acquireEvaluationLease,
    releaseEvaluationLease: async () => {
      cleanupAttempts += 1;
      throw new Error('scripted release transport failure');
    },
    createEvaluationContext: makeFakeEvaluationContextFactory(() => 0, { n: 1 }),
  });

  const result = await controller.runMission(missionId);
  assert.equal(result.status, 'completed');
  assert.equal(cleanupAttempts, 1, 'cleanup was attempted exactly once');
});

// ---------------------------------------------------------------------------
// Scenario (d): §19.2 token budget + M2/M3 wiring. The authored tokenBudget is
// fed into the loop and the host's reported run usage debits it, so an attempt
// that exhausts the budget stops the loop with `token_budget` (instead of
// repairing). Also asserts the attempt's root_run_id was stamped (== attemptId).
//
// Inject-proof (run manually, then revert): delete the `budget` spread in
// runMission OR the `usage` surfacing in runAttempt → the loop never debits, so
// the always-FAIL mission stops as STUCK/attempt-cap, not `token_budget`. That
// confirms BOTH the budget parse and the usage channel are load-bearing.
// ---------------------------------------------------------------------------

await check(
  '(d) token budget: reported usage debits the authored budget → stop token_budget; root_run_id stamped',
  async () => {
    const eventBus = new InMemoryEventBus();
    const { repos, mission } = makeRepos('/tmp/fake-ws');

    const { missionId } = await createDevMission(repos, {
      companyId: 'co-1',
      threadId: 'thr-1',
      projectId: 'proj-1',
      goal: 'Burn the budget',
      // Root usage alone stays below this cap; delegated-tree usage crosses it.
      budgetJson: JSON.stringify({
        tokenBudget: 100,
        maxConcurrentAgents: 3,
        maxTotalAgents: 7,
        maxRecursionDepth: 2,
      }),
      criteria: [
        {
          description: 'tests pass',
          evaluatorId: 'command_exit_zero',
          evaluatorConfigJson: JSON.stringify({ command: 'pnpm test' }),
          required: true,
        },
      ],
    });
    const criteria = await mission.missionCriteria.listByMission(missionId);
    const criterionId = criteria[0]!.criterion_id;

    const { runtime, inputs } = makeFakeRuntime(eventBus, 'co-1', {
      submitCriterionIds: [criterionId],
      submitSummary: () => 'I tried',
      usage: { input: 5, output: 5 }, // root-only persistence usage = 10
      budgetUsage: { input: 1_005, output: 5 }, // root 10 + delegated children 1,000
    });
    const attemptCell = { n: 0 };
    const leases = makeFakeEvaluationLeaseLifecycle();
    // The command FAILs every attempt, so completion never short-circuits the
    // budget check — the loop wants to repair but the budget is already spent.
    const controller = createMissionRunController({
      agentRuntime: runtime,
      repos,
      evaluatorRegistry: createDefaultEvaluatorRegistry(),
      eventBus,
      ...leases.deps,
      createEvaluationContext: makeFakeEvaluationContextFactory(() => 1, attemptCell),
    });

    const result = await controller.runMission(missionId);
    assert.equal(result.stopReason, 'token_budget', 'the exhausted token budget stops the loop');
    assert.equal(leases.released.length, 1, 'token-budget early return releases its lease');
    assert.deepEqual(
      inputs[0]?.delegationLimits,
      {
        maxDepth: 2,
        maxParallelPerDelegation: 3,
        maxTotalChildren: 7,
        maxTotalTokens: 100,
      },
      'Mission agent caps must map directly into Pi delegation supervisor caps',
    );
    assert.equal(
      result.attempts,
      1,
      'stopped after the first (budget-blowing) attempt — no repair',
    );

    // M2/M3: the attempt row records which agent run produced it (runId === attemptId).
    const attempts = await mission.missionAttempts.listByMission(missionId);
    assert.equal(attempts.length, 1, 'exactly one attempt');
    const attempt = attempts[0]!;
    assert.equal(
      attempt.root_run_id,
      attempt.attempt_id,
      'root_run_id stamped with the attempt id (the live runner sets runId === attemptId)',
    );
  },
);

await check(
  '(e) user cancel aborts Mission execute preflight before native work starts',
  async () => {
    const eventBus = new InMemoryEventBus();
    const { repos } = makeRepos('/tmp/fake-ws');
    const { missionId } = await createDevMission(repos, {
      companyId: 'co-1',
      threadId: 'thr-cancel-preflight',
      projectId: 'proj-1',
      goal: 'Cancel before native work',
      criteria: [
        {
          description: 'tests pass',
          evaluatorId: 'command_exit_zero',
          evaluatorConfigJson: JSON.stringify({ command: 'pnpm test' }),
          required: true,
        },
      ],
    });
    let signalSeen: AbortSignal | undefined;
    let releasePreflight!: () => void;
    const preflight = new Promise<void>((resolve) => {
      releasePreflight = resolve;
    });
    let nativeStarts = 0;
    const runtime: DesktopAgentRuntime = {
      async execute(_input, signal) {
        signalSeen = signal;
        await preflight;
        if (signal?.aborted) {
          const error = new Error('Mission cancelled in preflight');
          error.name = 'AbortError';
          throw error;
        }
        nativeStarts += 1;
        return { text: 'must not start' };
      },
      resume: async () => ({ text: '' }),
      abort() {},
      abortChild() {},
      async answerUiRequest() {},
      async dispose() {},
    };
    const controller = createMissionRunController({
      agentRuntime: runtime,
      repos,
      evaluatorRegistry: createDefaultEvaluatorRegistry(),
      eventBus,
      ...makeFakeEvaluationLeaseLifecycle().deps,
      createEvaluationContext: makeFakeEvaluationContextFactory(() => 0, { n: 1 }),
    });

    const resultPromise = controller.runMission(missionId);
    while (!signalSeen) await new Promise((resolve) => setTimeout(resolve, 1));
    controller.abortMission(missionId);
    releasePreflight();
    const result = await resultPromise;

    assert.equal(signalSeen.aborted, true);
    assert.equal(nativeStarts, 0);
    assert.equal(result.status, 'blocked');
  },
);

await check(
  '(f) wall-clock timer aborts a never-resolving Pi run → wall_clock_budget, not runtime_incompatible',
  async () => {
    const eventBus = new InMemoryEventBus();
    const { repos } = makeRepos('/tmp/fake-ws');
    const { missionId } = await createDevMission(repos, {
      companyId: 'co-1',
      threadId: 'thr-wall-clock',
      projectId: 'proj-1',
      goal: 'Bound the run',
      budgetJson: JSON.stringify({ wallClockMinutes: 1 }),
      criteria: [
        {
          description: 'tests pass',
          evaluatorId: 'command_exit_zero',
          evaluatorConfigJson: JSON.stringify({ command: 'pnpm test' }),
          required: true,
        },
      ],
    });

    let resolveStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      resolveStarted = resolve;
    });
    let abortCount = 0;
    let executionSignal: AbortSignal | undefined;
    const runtime: DesktopAgentRuntime = {
      execute: async (_input, signal) => {
        executionSignal = signal;
        resolveStarted();
        return new Promise<DesktopAgentRunResult>(() => {});
      },
      resume: async () => ({ text: '' }),
      abort: () => {
        abortCount += 1;
      },
      abortChild() {},
      async answerUiRequest() {},
      async dispose() {},
    };
    let fireDeadline: (() => void) | undefined;
    let cleared = 0;
    const controller = createMissionRunController({
      agentRuntime: runtime,
      repos,
      evaluatorRegistry: createDefaultEvaluatorRegistry(),
      eventBus,
      ...makeFakeEvaluationLeaseLifecycle().deps,
      createEvaluationContext: makeFakeEvaluationContextFactory(() => 0, { n: 1 }),
      now: () => '2026-01-01T00:00:00.000Z',
      scheduleDeadline: (callback, delayMs) => {
        assert.equal(delayMs, 60_000, 'runtime timer uses the canonical absolute deadline');
        fireDeadline = callback;
        return 'deadline-handle';
      },
      cancelDeadline: (handle) => {
        assert.equal(handle, 'deadline-handle');
        cleared += 1;
      },
    });

    const resultPromise = controller.runMission(missionId);
    await started;
    assert.ok(fireDeadline, 'deadline timer armed while execute remained pending');
    fireDeadline!();
    const result = await resultPromise;

    assert.equal(executionSignal?.aborted, true, 'deadline aborts the preflight-safe signal');
    assert.equal(abortCount, 1, 'deadline aborts the active Pi thread exactly once');
    assert.equal(cleared, 1, 'deadline timer is cleared in finally');
    assert.equal(result.status, 'failed');
    assert.equal(result.stopReason, 'wall_clock_budget');
    assert.notEqual(result.stopReason, 'runtime_incompatible');
  },
);

// ---------------------------------------------------------------------------

console.log(`mission-run-controller: ${passed}/${TOTAL} passed`);
if (failed > 0 || passed !== TOTAL) {
  process.exitCode = 1;
}
