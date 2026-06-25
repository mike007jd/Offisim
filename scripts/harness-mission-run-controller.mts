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
import {
  InMemoryEventBus,
  type RuntimeEvent,
  type RuntimeRepositories,
  createDefaultEvaluatorRegistry,
} from '../packages/core/src/browser.js';
import { createMissionMemoryRepos } from '../packages/core/src/runtime/repos/mission/memory.ts';
import { createDeliverablesMemoryRepos } from '../packages/core/src/runtime/repos/deliverables/memory.ts';
import type {
  DesktopAgentRunInput,
  DesktopAgentRunResult,
  DesktopAgentRuntime,
} from '../apps/desktop/renderer/src/runtime/desktop-agent-runtime.js';
import {
  MISSION_EVALUATION_SUBMITTED_EVENT,
  type MissionEvaluationSubmittedPayload,
} from '../apps/desktop/renderer/src/runtime/mission/mission-events.js';
import { createMissionRunController } from '../apps/desktop/renderer/src/runtime/mission/mission-run-controller.js';
import { createDevMission } from '../apps/desktop/renderer/src/runtime/mission/dev-create-mission.js';
import type { TauriEvaluationContextInput } from '../apps/desktop/renderer/src/runtime/mission/evaluation-context.js';

let passed = 0;
let failed = 0;
const TOTAL = 4;

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

/** Build the fake repos the controller needs: the real in-memory mission repos +
 *  a real in-memory deliverables repo + a minimal projects repo (findById only).
 *  Returned untyped-but-shaped as RuntimeRepositories — the controller only
 *  touches the mission repos, deliverables, and projects.findById. */
function makeRepos(projectWorkspaceRoot: string | null): {
  repos: RuntimeRepositories;
  mission: ReturnType<typeof createMissionMemoryRepos>;
} {
  const mission = createMissionMemoryRepos();
  const { deliverables } = createDeliverablesMemoryRepos();
  const projects = {
    async findById(projectId: string) {
      return {
        project_id: projectId,
        company_id: 'co-1',
        name: 'Fake',
        description: null,
        status: 'planning',
        workspace_root: projectWorkspaceRoot,
      };
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
  },
): { runtime: DesktopAgentRuntime; prompts: string[]; attempts: number } {
  const prompts: string[] = [];
  let attempts = 0;
  const runtime: DesktopAgentRuntime = {
    async execute(input: DesktopAgentRunInput): Promise<DesktopAgentRunResult> {
      attempts += 1;
      const attemptNumber = attempts;
      prompts.push(input.text);
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
      return { text: 'done' };
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
    get attempts() {
      return attempts;
    },
  } as { runtime: DesktopAgentRuntime; prompts: string[]; attempts: number };
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
): (input: TauriEvaluationContextInput) => import('../packages/core/src/browser.js').EvaluationContext {
  return (input: TauriEvaluationContextInput) => ({
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
  });
}

// ---------------------------------------------------------------------------
// Scenario (a): happy path — agent submits, evaluators PASS → completed.
// ---------------------------------------------------------------------------

await check('(a) happy path: agent submits, evaluators PASS over fake workspace → completed', async () => {
  const eventBus = new InMemoryEventBus();
  const { repos, mission } = makeRepos('/tmp/fake-ws');

  const { missionId } = await createDevMission(repos, {
    companyId: 'co-1',
    threadId: 'thr-1',
    projectId: 'proj-1',
    goal: 'Make the tests pass',
    criteria: [
      { description: 'tests pass', evaluatorId: 'command_exit_zero', evaluatorConfigJson: JSON.stringify({ command: 'pnpm test' }), required: true },
    ],
  });
  const criteria = await mission.missionCriteria.listByMission(missionId);
  const criterionId = criteria[0]!.criterion_id;

  const { runtime } = makeFakeRuntime(eventBus, 'co-1', {
    submitCriterionIds: [criterionId],
    submitSummary: () => 'tests green',
  });
  const attemptCell = { n: 0 };
  const controller = createMissionRunController({
    agentRuntime: runtime,
    repos,
    evaluatorRegistry: createDefaultEvaluatorRegistry(),
    eventBus,
    // Bump the attempt cell each runAttempt by hooking the factory: every
    // criterion in an attempt shares the same attempt number, and exit 0 → PASS.
    createEvaluationContext: makeFakeEvaluationContextFactory(() => 0, attemptCell),
  });

  const result = await controller.runMission(missionId);
  assert.equal(result.status, 'completed', 'all required criteria PASS → completed');
  assert.equal(result.attempts, 1, 'completed in one attempt');
  const finalMission = await mission.missions.findById(missionId);
  assert.equal(finalMission!.status, 'completed', 'MissionService persisted completed');
});

// ---------------------------------------------------------------------------
// Scenario (b): repair (MS-006) — FAIL@1, repair brief in attempt 2's prompt,
// PASS@2 → completed.
// ---------------------------------------------------------------------------

await check('(b) repair: FAIL@1 → repair brief reaches attempt 2 prompt → PASS@2 → completed', async () => {
  const eventBus = new InMemoryEventBus();
  const { repos, mission } = makeRepos('/tmp/fake-ws');

  const { missionId } = await createDevMission(repos, {
    companyId: 'co-1',
    threadId: 'thr-1',
    projectId: 'proj-1',
    goal: 'Make the build pass',
    criteria: [
      { description: 'build ok', evaluatorId: 'command_exit_zero', evaluatorConfigJson: JSON.stringify({ command: 'pnpm build' }), required: true },
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
  assert.ok(repairPrompt.includes('build ok'), 'repair brief carries the failed criterion description');
  // The deterministic failure summary line must be present (not the agent's note):
  // command_exit_zero with exit 1 summarizes as "`pnpm build` exited 1", surfaced
  // under the brief's "what was wrong:" line.
  assert.ok(repairPrompt.includes('what was wrong:'), 'repair brief has the failure-summary line');
  assert.ok(
    repairPrompt.includes('exited 1'),
    'repair brief carries the deterministic command-exit summary',
  );
  // And the first attempt's prompt was NOT a repair brief.
  assert.ok(!fake.prompts[0]!.includes('Mission repair'), 'attempt 1 prompt is the initial brief');
});

// ---------------------------------------------------------------------------
// Scenario (c): §5 — the agent CLAIMS pass, but the evaluator FAILs over the
// fake workspace → mission does NOT complete. The evaluator decides, not the
// agent's self-reported summary.
// ---------------------------------------------------------------------------

await check('(c) §5: agent claims PASS but command_exit_zero FAILs → mission does NOT complete', async () => {
  const eventBus = new InMemoryEventBus();
  const { repos, mission } = makeRepos('/tmp/fake-ws');

  const { missionId } = await createDevMission(repos, {
    companyId: 'co-1',
    threadId: 'thr-1',
    projectId: 'proj-1',
    goal: 'Ship it',
    criteria: [
      { description: 'tests pass', evaluatorId: 'command_exit_zero', evaluatorConfigJson: JSON.stringify({ command: 'pnpm test' }), required: true },
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
    createEvaluationContext: makeFakeEvaluationContextFactory(() => 1, attemptCell),
    // Bound the loop so the always-FAIL doesn't run the full 6 attempts.
  });

  const result = await controller.runMission(missionId);
  assert.notEqual(result.status, 'completed', 'the agent self-report must NOT yield completion (§5)');
  // An always-FAIL command produces an identical failure signature each attempt,
  // so the bounded loop stops as STUCK (which finalizes the mission as failed) —
  // the point is it is a non-completion driven by the evaluator, never the agent's
  // "ALL TESTS PASS" claim.
  assert.ok(
    result.status === 'failed' || result.status === 'stuck',
    `expected a non-completion stop (failed/stuck), got ${result.status}`,
  );
  assert.equal(result.finalMissionStatus, 'failed', 'mission finalized as failed (not completed)');
  const finalMission = await mission.missions.findById(missionId);
  assert.notEqual(finalMission!.status, 'completed', 'MissionService never wrote completed');
});

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
      { description: 'tests pass', evaluatorId: 'command_exit_zero', evaluatorConfigJson: JSON.stringify({ command: 'pnpm test' }), required: true },
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
    createEvaluationContext: makeFakeEvaluationContextFactory(() => 0, attemptCell),
  });

  const result = await controller.runMission(missionId);
  assert.equal(result.status, 'blocked', 'a transport throw is infra → blocked');
  assert.equal(result.stopReason, 'runtime_incompatible', 'stop reason is runtime_incompatible');
  assert.equal(result.attempts, 1, 'blocked after the single failed attempt');
});

// ---------------------------------------------------------------------------

console.log(`mission-run-controller: ${passed}/${TOTAL} passed`);
if (failed > 0 || passed !== TOTAL) {
  process.exitCode = 1;
}
