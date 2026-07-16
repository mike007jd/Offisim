import assert from 'node:assert/strict';
import { createChildSupervisor, createDelegationLimits } from './pi-child-supervisor.mjs';

type VerifyResult = { exitCode: number; stdout: string; stderr: string };

async function runScenario({
  verifyResults,
  verifyConfig,
  usage = { input: 2, output: 1 },
}: {
  verifyResults: VerifyResult[];
  verifyConfig?: { command: string; maxAttempts: number; tokenBudget?: number };
  usage?: { input: number; output: number };
}) {
  const lines: Array<Record<string, unknown>> = [];
  const prompts: string[] = [];
  let verifyCalls = 0;
  let listener: ((event: Record<string, unknown>) => void) | null = null;
  let lastText = '';
  const lease = {
    leaseId: 'lease-1',
    runId: '',
    workspaceRoot: '/fixture/project',
    access: 'write',
    cwd: '/fixture/project/.offisim/worktrees/lease-1',
    branch: 'offisim/lease/test',
    isolated: true,
    status: 'active',
    createdAt: '2026-07-12T00:00:00.000Z',
  };
  const leaseManager = {
    async acquireChildLease({ runId }: { runId: string }) {
      lease.runId = runId;
      return { outcome: 'granted', lease: { ...lease } };
    },
    async collectDiff() {
      return { changedPaths: ['src/fix.ts'], files: [] };
    },
    listLeases() {
      return [{ ...lease }];
    },
    async planIntegration() {
      return { conflicts: [], mergeable: [{ ...lease }] };
    },
    async integrate() {
      throw new Error('integration must stay review-gated in this harness');
    },
    async releaseLease() {
      return { ...lease, status: 'released' };
    },
  };
  const rootModel = { provider: 'fixture', id: 'fixture-stable' };
  const runtimeModelRef = `${rootModel.provider}/${rootModel.id}`;
  const expectedTarget = {
    engineId: 'api',
    accountId: 'api:fixture:0123456789abcdef',
    billingMode: 'api',
    modelId: rootModel.id,
    modelSource: {
      kind: 'official-api',
      sourceUrl: 'https://fixture.example/models/fixture-stable',
      checkedAt: '2026-07-14T00:00:00Z',
    },
  } as const;
  const executionTargetGate = {
    async prepare({ session, runId }: { session: unknown; runId: string }) {
      return {
        session,
        model: rootModel,
        runtimeModelRef,
        targetDigest: `digest:${runtimeModelRef}`,
        identity: {
          ...expectedTarget,
          runId,
          adapter: { id: 'pi-agent', version: '0.80.9' },
        },
      };
    },
    assertPrepared(prepared: { session: unknown }, session: unknown) {
      assert.equal(prepared.session, session);
    },
  };
  const supervisor = createChildSupervisor({
    emit: (line: Record<string, unknown>) => lines.push(line),
    cwd: '/fixture/project',
    projectId: 'project-1',
    threadId: 'thread-1',
    rootRunId: 'root-1',
    roster: [{ employeeId: 'executor-1', name: 'Executor' }],
    resolveModel: (modelRef?: string) => (modelRef === runtimeModelRef ? rootModel : undefined),
    rootModel,
    expectedTarget,
    runtimeModelRef,
    executionTargetGate,
    settingsManager: {},
    authStorage: {},
    modelRegistry: {},
    buildPermissionGate: () => null,
    limits: createDelegationLimits(),
    rootLease: { ...lease, leaseId: 'root-lease', cwd: lease.workspaceRoot, isolated: false },
    leaseManager,
    validateLeaseCwd: async (claim: { cwd: string }) => ({ cwd: claim.cwd }),
    confirmIntegration: async () => false,
    verifyConfig,
    requestVerifyResult: async ({ cwd }: { cwd: string }) => {
      assert.equal(cwd, lease.cwd, 'verification must run in the child worktree');
      const result = verifyResults[verifyCalls++];
      assert.ok(result, 'unexpected verification call');
      return { ok: true, result };
    },
    createResourceLoader: () => ({ reload: async () => {} }),
    createSessionManager: () => ({}),
    createAgentSession: async () => ({
      session: {
        model: rootModel,
        subscribe(next: (event: Record<string, unknown>) => void) {
          listener = next;
          return () => {
            listener = null;
          };
        },
        async prompt(prompt: string) {
          prompts.push(prompt);
          lastText = `Attempt ${prompts.length} completed`;
          listener?.({
            type: 'message_end',
            message: { role: 'assistant', usage: { ...usage, cost: { total: 0 } } },
          });
        },
        getLastAssistantText: () => lastText,
        abort: async () => {},
        dispose: () => {},
      },
    }),
  });
  const summary = await supervisor.runSingle({
    employeeId: 'executor-1',
    objective: 'Fix the project',
    access: 'write',
  });
  return { lines, prompts, verifyCalls, summary };
}

const green = await runScenario({
  verifyConfig: { command: 'pnpm test', maxAttempts: 3 },
  verifyResults: [
    { exitCode: 1, stdout: 'one test failed', stderr: '' },
    { exitCode: 0, stdout: 'all tests passed', stderr: '' },
  ],
});
assert.equal(green.prompts.length, 2);
assert.equal(green.verifyCalls, 2);
assert.match(green.prompts[1] ?? '', /one test failed/);
assert.ok(green.lines.some((line) => line.runType === 'run.completed'));
assert.match(green.summary, /awaiting review/);

const stuck = await runScenario({
  verifyConfig: { command: 'pnpm test', maxAttempts: 3 },
  verifyResults: [
    { exitCode: 1, stdout: 'same failure', stderr: '' },
    { exitCode: 1, stdout: 'same failure', stderr: '' },
  ],
});
assert.equal(stuck.prompts.length, 2);
assert.equal(stuck.verifyCalls, 2);
assert.ok(
  stuck.lines.some(
    (line) =>
      line.runType === 'run.failed' &&
      (line.payload as Record<string, unknown>)?.failureKind === 'tool',
  ),
);
assert.match(stuck.summary, /same failure repeated/);

const budget = await runScenario({
  verifyConfig: { command: 'pnpm test', maxAttempts: 3, tokenBudget: 2 },
  verifyResults: [{ exitCode: 1, stdout: 'still red', stderr: '' }],
});
assert.equal(budget.prompts.length, 1);
assert.equal(budget.verifyCalls, 1);
assert.ok(
  budget.lines.some(
    (line) =>
      line.runType === 'run.failed' &&
      (line.payload as Record<string, unknown>)?.failureKind === 'budget',
  ),
);
assert.match(budget.summary, /token budget was exhausted/);

const singlePass = await runScenario({ verifyResults: [] });
assert.equal(singlePass.prompts.length, 1);
assert.equal(singlePass.verifyCalls, 0);
assert.ok(singlePass.lines.some((line) => line.runType === 'run.completed'));

console.log('[harness-pi-loop-until-green] ok: retry-green, stuck, budget, single-pass');
