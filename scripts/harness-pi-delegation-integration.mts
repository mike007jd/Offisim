import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createWorkspaceLeaseManager } from '../packages/core/src/runtime/mission/workspace/lease-manager.ts';
import type {
  GitWorktreeOps,
  MergeResult,
} from '../packages/core/src/runtime/mission/workspace/types.ts';
import {
  createChildSupervisor,
  createDelegationLimits,
  integrateCompletedDelegation,
} from './pi-child-supervisor.mjs';
import {
  createTaskBashProcessRegistry,
  createTaskScopedAgentSessionFactory,
} from './pi-task-bash-process-registry.mjs';

const repo = mkdtempSync(join(tmpdir(), 'offisim-single-delegation-'));
const git = (cwd: string, args: string[]) =>
  execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();

try {
  git(repo, ['init', '-b', 'main']);
  git(repo, ['config', 'user.name', 'Offisim Harness']);
  git(repo, ['config', 'user.email', 'harness@offisim.local']);
  writeFileSync(join(repo, 'baseline.txt'), 'baseline\n');
  git(repo, ['add', 'baseline.txt']);
  git(repo, ['commit', '-m', 'baseline']);
  const rootHead = () => git(repo, ['rev-parse', 'HEAD']);

  const gitOps: GitWorktreeOps = {
    isGitRepo: () => true,
    addWorktree: (branch, path) => {
      git(repo, ['worktree', 'add', '-b', branch, path]);
    },
    removeWorktree: (path) => {
      git(repo, ['worktree', 'remove', '--force', path]);
    },
    discardWorktree: (path) => {
      git(repo, ['worktree', 'remove', '--force', path]);
    },
    worktreeChanged: (path) => git(path, ['status', '--porcelain']).length > 0,
    diff: (path) =>
      git(path, ['diff', '--name-only', rootHead(), 'HEAD']).split('\n').filter(Boolean),
    diffText: (path, changedPath) =>
      git(path, ['diff', '--unified=3', rootHead(), 'HEAD', '--', changedPath]),
    commitAll: (path, message) => {
      if (git(path, ['status', '--porcelain']).length === 0) return;
      git(path, ['add', '--all']);
      git(path, ['commit', '-m', message]);
    },
    merge: (branch): MergeResult => {
      try {
        git(repo, ['merge', '--no-ff', '--no-edit', branch]);
        return { ok: true, conflicts: [] };
      } catch {
        const conflicts = git(repo, ['diff', '--name-only', '--diff-filter=U'])
          .split('\n')
          .filter(Boolean);
        git(repo, ['merge', '--abort']);
        return { ok: false, conflicts };
      }
    },
  };

  let nextId = 0;
  const leaseManager = createWorkspaceLeaseManager({
    gitOps,
    now: () => '2026-07-11T00:00:00.000Z',
    newId: () => `lease-${++nextId}`,
  });
  const rootLease = await leaseManager.acquireRootLease(repo);
  const acquired = await leaseManager.acquireChildLease({
    rootLease,
    runId: 'run-single-write',
    access: 'write',
  });
  assert.equal(acquired.outcome, 'granted');
  if (acquired.outcome !== 'granted') throw new Error('write lease was not granted');

  const childLease = acquired.lease;
  writeFileSync(join(childLease.cwd, 'single-write-artifact.txt'), 'integrated from child\n');
  git(childLease.cwd, ['add', 'single-write-artifact.txt']);
  git(childLease.cwd, ['commit', '-m', 'single delegated write']);

  const phases: string[] = [];
  const summary = await integrateCompletedDelegation({
    tasks: [{ access: 'write' }],
    runIds: ['run-single-write'],
    leaseManager,
    rootLease,
    confirmIntegration: async () => true,
    emitSnapshot: async (_lease, phase) => {
      phases.push(phase);
    },
  });

  assert.match(summary, /Merged 1 write lease/);
  assert.equal(
    readFileSync(join(repo, 'single-write-artifact.txt'), 'utf8'),
    'integrated from child\n',
    'single write artifact must be merged into the project checkout',
  );
  assert.equal(existsSync(childLease.cwd), false, 'isolated worktree must be removed');
  assert.equal(leaseManager.getLease(childLease.leaseId)?.status, 'released');
  assert.deepEqual(phases, ['planned', 'integrated', 'released_after_merge']);

  // A child that edits but never commits (model behavior, not a guarantee —
  // caught live 2026-07-12 with a free-tier executor): the deterministic
  // commitAll safety net in planIntegration must still land the work.
  const uncommittedAcquire = await leaseManager.acquireChildLease({
    rootLease,
    runId: 'run-uncommitted-write',
    access: 'write',
  });
  assert.equal(uncommittedAcquire.outcome, 'granted');
  if (uncommittedAcquire.outcome !== 'granted') throw new Error('write lease was not granted');
  const uncommittedLease = uncommittedAcquire.lease;
  writeFileSync(join(uncommittedLease.cwd, 'uncommitted-artifact.txt'), 'never committed\n');
  const uncommittedSummary = await integrateCompletedDelegation({
    tasks: [{ access: 'write' }],
    runIds: ['run-uncommitted-write'],
    leaseManager,
    rootLease,
    confirmIntegration: async () => true,
    emitSnapshot: async () => {},
  });
  assert.match(uncommittedSummary, /Merged 1 write lease/);
  assert.equal(
    readFileSync(join(repo, 'uncommitted-artifact.txt'), 'utf8'),
    'never committed\n',
    'an uncommitted child edit must be auto-committed and merged, not silently dropped',
  );
  assert.equal(leaseManager.getLease(uncommittedLease.leaseId)?.status, 'released');
  console.log('PASS uncommitted child edit auto-committed and merged');

  const supervisorSource = readFileSync(
    fileURLToPath(new URL('./pi-child-supervisor.mjs', import.meta.url)),
    'utf8',
  );
  assert.match(
    supervisorSource,
    /async function runSingle[\s\S]*?maybeIntegrateWrites\(\[task\], \[result\.runId\]\)/,
    'single-mode supervisor must invoke the shared integration path',
  );

  const rootModel = { provider: 'fixture', id: 'root-model' };
  const modelA = { provider: 'fixture', id: 'employee-a' };
  const modelB = { provider: 'fixture', id: 'employee-b' };
  const targetFor = (model: { provider: string; id: string }) => ({
    engineId: 'api',
    accountId: 'api:fixture:0123456789abcdef',
    billingMode: 'api',
    modelId: model.id,
    modelSource: {
      kind: 'official-api',
      sourceUrl: `https://fixture.example/models/${model.id}`,
      checkedAt: '2026-07-14T00:00:00Z',
    },
  });
  const rootExecutionTarget = targetFor(rootModel);
  const rootRuntimeModelRef = `${rootModel.provider}/${rootModel.id}`;
  const executionTargetGate = {
    async prepare({
      session,
      expectedTarget,
      runtimeModelRef,
      runId,
    }: {
      session: { model?: { provider: string; id: string } };
      expectedTarget: ReturnType<typeof targetFor>;
      runtimeModelRef: string;
      runId: string;
    }) {
      assert.equal(
        `${session.model?.provider}/${session.model?.id}`,
        runtimeModelRef,
        'the prepared child session must match its exact runtime model ref',
      );
      return {
        session,
        model: session.model,
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
      assert.equal(prepared.session, session, 'the prompt must use the acknowledged child session');
    },
  };
  const rootExecutionContext = {
    expectedTarget: rootExecutionTarget,
    runtimeModelRef: rootRuntimeModelRef,
    executionTargetGate,
  };
  const modelById = new Map([
    ['fixture/employee-a', modelA],
    ['fixture/employee-b', modelB],
  ]);
  const sessionOptions: Array<Record<string, unknown>> = [];
  const resourceLoaderOptions: Array<Record<string, unknown>> = [];
  const sessionManagerCwds: string[] = [];
  const sharedValidationClaims: Array<Record<string, unknown>> = [];
  const inheritedPermissionModes: string[] = [];
  let askUiBindings = 0;
  const makeSession = (selectedModel = rootModel) => {
    let subscriber: ((event: unknown) => void) | undefined;
    return {
      model: selectedModel,
      subscribe(callback: (event: unknown) => void) {
        subscriber = callback;
        return () => {};
      },
      async prompt() {
        subscriber?.({
          type: 'message_end',
          message: {
            role: 'assistant',
            stopReason: 'stop',
            usage: { input: 1, output: 1, cost: { total: 0.001 } },
          },
        });
      },
      getLastAssistantText: () => 'Summary: fixture complete',
      abort: async () => {},
      dispose: () => {},
    };
  };
  const childRunEvents: Array<Record<string, unknown>> = [];
  const supervisor = createChildSupervisor({
    emit: (event: Record<string, unknown>) => childRunEvents.push(event),
    authStorage: {},
    modelRegistry: {},
    cwd: '.',
    settingsManager: {},
    threadId: 'thread-model-binding',
    rootRunId: 'root-model-binding',
    projectId: 'project-model-binding',
    roster: [
      {
        employeeId: 'employee-a',
        model: 'fixture/employee-a',
        executionTarget: targetFor(modelA),
        runtimeModelRef: 'fixture/employee-a',
        thinkingLevel: 'high',
        skillPaths: ['/fixture/vault/company/SKILL.md', '/fixture/vault/employee-a/SKILL.md'],
      },
      {
        employeeId: 'employee-b',
        model: 'fixture/employee-b',
        executionTarget: targetFor(modelB),
        runtimeModelRef: 'fixture/employee-b',
        thinkingLevel: 'low',
      },
      { employeeId: 'employee-inherit' },
    ],
    resolveModel: (modelId?: string) => (modelId ? modelById.get(modelId) : undefined),
    rootModel,
    ...rootExecutionContext,
    rootThinkingLevel: 'medium',
    permissionMode: 'ask',
    buildPermissionGate: (mode: string) => {
      inheritedPermissionModes.push(mode);
      return null;
    },
    bindChildUi: async () => {
      askUiBindings += 1;
    },
    limits: createDelegationLimits({ childTimeoutMs: 0 }),
    createResourceLoader: (options: Record<string, unknown>) => {
      resourceLoaderOptions.push(options);
      return { reload: async () => {} };
    },
    createSessionManager: (cwd: string) => {
      sessionManagerCwds.push(cwd);
      return {};
    },
    validateLeaseCwd: async (claim: Record<string, unknown>) => {
      sharedValidationClaims.push(claim);
      return { cwd: claim.cwd };
    },
    createAgentSession: async (options: Record<string, unknown>) => {
      sessionOptions.push(options);
      return {
        session: makeSession(
          (options.model as { provider: string; id: string } | undefined) ?? rootModel,
        ),
      };
    },
  });
  await supervisor.runSingle({ employeeId: 'employee-a', objective: 'A', access: 'read' });
  await supervisor.runSingle({ employeeId: 'employee-b', objective: 'B', access: 'read' });
  await supervisor.runSingle({ employeeId: 'employee-inherit', objective: 'C', access: 'read' });
  assert.equal(sessionOptions[0]?.model, modelA);
  assert.equal(sessionOptions[0]?.thinkingLevel, 'high');
  assert.equal(sessionOptions[1]?.model, modelB);
  assert.equal(sessionOptions[1]?.thinkingLevel, 'low');
  assert.equal(sessionOptions[2]?.model, rootModel);
  assert.equal(sessionOptions[2]?.thinkingLevel, 'medium');
  assert.deepEqual(resourceLoaderOptions[0]?.additionalSkillPaths, [
    '/fixture/vault/company/SKILL.md',
    '/fixture/vault/employee-a/SKILL.md',
  ]);
  assert.deepEqual(inheritedPermissionModes, ['ask', 'ask', 'ask']);
  assert.equal(askUiBindings, 3, 'every Ask child binds the renderer approval channel');
  assert.ok(
    resourceLoaderOptions.every((options) => options.cwd === '.') &&
      sessionManagerCwds.every((cwd) => cwd === '.') &&
      sessionOptions.every((options) => options.cwd === '.' && !('taskWorkspaceLease' in options)),
    'shared read children must inherit descriptor-bound cwd=. without an isolated lease claim',
  );
  assert.equal(
    sharedValidationClaims.length,
    0,
    'shared children must not call the isolated lease validation channel',
  );
  const childStarts = childRunEvents.filter((event) => event.runType === 'run.started');
  assert.equal(childStarts.length, 3, 'each delegated child must publish one run.started event');
  assert.ok(
    childStarts.every(
      (event) =>
        (event.payload as { projectId?: string } | undefined)?.projectId ===
        'project-model-binding',
    ),
    'every delegated run.started must inherit the root Project provenance for durable lease validation',
  );

  let directControlSubscriber: ((event: unknown) => void) | undefined;
  let directPromptStarted = false;
  const directControlSession = {
    model: rootModel,
    subscribe(callback: (event: unknown) => void) {
      directControlSubscriber = callback;
      return () => {};
    },
    async prompt() {
      directPromptStarted = true;
      directControlSubscriber?.({
        type: 'message_end',
        message: { role: 'custom', customType: 'offisim.control', content: 'review steer' },
      });
      directControlSubscriber?.({
        type: 'message_end',
        message: {
          role: 'assistant',
          stopReason: 'stop',
          usage: { input: 1, output: 1, cost: { total: 0.001 } },
        },
      });
    },
    getLastAssistantText: () => 'Summary: direct child handled steer',
    abort: async () => {},
    dispose: () => {},
  };
  let readyControlTarget: { runId: string; session: unknown } | null = null;
  let closedControlTarget: { runId: string; session: unknown } | null = null;
  const consumedControlMessages: unknown[] = [];
  const directControlSupervisor = createChildSupervisor({
    emit: () => {},
    authStorage: {},
    modelRegistry: {},
    cwd: '.',
    settingsManager: {},
    threadId: 'thread-direct-control',
    rootRunId: 'root-direct-control',
    roster: [{ employeeId: 'employee-direct' }],
    resolveModel: () => undefined,
    rootModel,
    ...rootExecutionContext,
    rootThinkingLevel: 'medium',
    buildPermissionGate: () => null,
    limits: createDelegationLimits({ childTimeoutMs: 0 }),
    createResourceLoader: () => ({ reload: async () => {} }),
    createSessionManager: () => ({}),
    createAgentSession: async () => ({ session: directControlSession }),
    onControlSessionReady: (runId: string, session: unknown) => {
      assert.equal(
        directPromptStarted,
        true,
        'the child steer target must not drain controls before its initial prompt starts',
      );
      readyControlTarget = { runId, session };
    },
    onControlSessionClosed: (runId: string, session: unknown) => {
      closedControlTarget = { runId, session };
    },
    onControlMessage: (message: unknown) => consumedControlMessages.push(message),
  });
  await directControlSupervisor.runSingle({
    employeeId: 'employee-direct',
    objective: 'Handle the queued review steer',
    access: 'read',
  });
  assert.ok(readyControlTarget, 'a direct child exposes its live session as a steer target');
  assert.deepEqual(
    closedControlTarget,
    readyControlTarget,
    'the exact direct child control target is cleared before session disposal',
  );
  assert.equal(
    consumedControlMessages.length,
    1,
    'a child custom control message is forwarded to the durable control ledger',
  );
  console.log('PASS direct child exposes and consumes the outer run steer channel');

  let freshLeaseId = 0;
  const freshLeaseManager = createWorkspaceLeaseManager({
    gitOps,
    now: () => '2026-07-11T00:30:00.000Z',
    newId: () => `fresh-lease-${++freshLeaseId}`,
  });
  const freshRoot = await freshLeaseManager.acquireRootLease(repo);
  const freshLeaseEvents: Array<Record<string, unknown>> = [];
  const freshLeaseClaims: Array<Record<string, unknown>> = [];
  const freshLeaseSessions: Array<Record<string, unknown>> = [];
  const freshLeaseSupervisor = createChildSupervisor({
    emit: (event: Record<string, unknown>) => freshLeaseEvents.push(event),
    authStorage: {},
    modelRegistry: {},
    cwd: '.',
    settingsManager: {},
    threadId: 'thread-fresh-lease',
    rootRunId: 'root-fresh-lease',
    projectId: 'project-fresh-lease',
    roster: [{ employeeId: 'employee-a' }],
    resolveModel: () => undefined,
    rootModel,
    ...rootExecutionContext,
    rootThinkingLevel: 'medium',
    buildPermissionGate: () => null,
    limits: createDelegationLimits({ childTimeoutMs: 0 }),
    createResourceLoader: () => ({ reload: async () => {} }),
    createSessionManager: () => ({}),
    createAgentSession: async (options: Record<string, unknown>) => {
      freshLeaseSessions.push(options);
      return { session: makeSession(rootModel) };
    },
    leaseManager: freshLeaseManager,
    rootLease: freshRoot,
    validateLeaseCwd: async (claim: Record<string, unknown>) => {
      freshLeaseClaims.push({ ...claim });
      return { cwd: claim.cwd };
    },
    confirmIntegration: async () => false,
  });
  const freshLeaseRun = await freshLeaseSupervisor.runSingle({
    employeeId: 'employee-a',
    objective: 'Create a fresh isolated write lease',
    access: 'write',
    workKind: 'implement',
  });
  assert.match(freshLeaseRun, /fixture complete/i);
  const acquiredFreshLease = freshLeaseEvents.find(
    (event) =>
      event.kind === 'agentRun' &&
      event.runType === 'workspace.lease.snapshot' &&
      (event.payload as Record<string, unknown>)?.phase === 'acquired',
  );
  assert.ok(acquiredFreshLease, 'fresh isolated write must emit an acquired lease snapshot');
  const freshLeasePayload = acquiredFreshLease.payload as Record<string, unknown>;
  assert.deepEqual(freshLeaseClaims, [
    {
      leaseId: freshLeasePayload.leaseId,
      registeredRunId: acquiredFreshLease.runId,
      workspaceRoot: freshLeasePayload.workspaceRoot,
      cwd: freshLeasePayload.cwd,
      branch: freshLeasePayload.branch,
    },
  ]);
  assert.equal(freshLeaseSessions[0]?.cwd, freshLeasePayload.cwd);
  assert.deepEqual(freshLeaseSessions[0]?.taskWorkspaceLease, freshLeaseClaims[0]);

  let invalidLeaseId = 0;
  const invalidLeaseManager = createWorkspaceLeaseManager({
    gitOps,
    now: () => '2026-07-11T00:45:00.000Z',
    newId: () => `invalid-lease-${++invalidLeaseId}`,
  });
  const invalidRoot = await invalidLeaseManager.acquireRootLease(repo);
  const invalidClaims: Array<Record<string, unknown>> = [];
  let invalidSessionStarts = 0;
  const invalidLeaseSupervisor = createChildSupervisor({
    emit: () => {},
    authStorage: {},
    modelRegistry: {},
    cwd: '.',
    settingsManager: {},
    threadId: 'thread-invalid-lease',
    rootRunId: 'root-invalid-lease',
    projectId: 'project-invalid-lease',
    roster: [{ employeeId: 'employee-a' }],
    resolveModel: () => undefined,
    rootModel,
    ...rootExecutionContext,
    rootThinkingLevel: 'medium',
    buildPermissionGate: () => null,
    limits: createDelegationLimits({ childTimeoutMs: 0 }),
    createResourceLoader: () => ({ reload: async () => {} }),
    createSessionManager: () => ({}),
    createAgentSession: async () => {
      invalidSessionStarts += 1;
      return { session: makeSession(rootModel) };
    },
    leaseManager: invalidLeaseManager,
    rootLease: invalidRoot,
    validateLeaseCwd: async (claim: Record<string, unknown>) => {
      invalidClaims.push({ ...claim });
      return { cwd: `${String(claim.cwd)}-replacement` };
    },
    confirmIntegration: async () => false,
  });
  const invalidLeaseRun = await invalidLeaseSupervisor.runSingle({
    employeeId: 'employee-a',
    objective: 'Reject a replaced isolated cwd',
    access: 'write',
    workKind: 'implement',
  });
  assert.match(invalidLeaseRun, /identity changed before child startup/i);
  assert.equal(invalidSessionStarts, 0, 'invalid isolated cwd must not start a Pi session');
  assert.equal(invalidClaims.length, 1);
  assert.equal(
    invalidLeaseManager.getLease(String(invalidClaims[0].leaseId))?.status,
    'released',
    'a failed isolated cwd validation must release its newly acquired lease',
  );

  let reworkId = 0;
  const originalManager = createWorkspaceLeaseManager({
    gitOps,
    now: () => '2026-07-11T01:00:00.000Z',
    newId: () => `rework-lease-${++reworkId}`,
  });
  const originalRoot = await originalManager.acquireRootLease(repo);
  const originalResult = await originalManager.acquireChildLease({
    rootLease: originalRoot,
    runId: 'run-original-review',
    access: 'write',
  });
  assert.equal(originalResult.outcome, 'granted');
  if (originalResult.outcome !== 'granted') throw new Error('rework lease was not granted');
  const originalLease = originalResult.lease;
  writeFileSync(join(originalLease.cwd, 'rework-artifact.txt'), 'first review version\n');
  git(originalLease.cwd, ['add', 'rework-artifact.txt']);
  git(originalLease.cwd, ['commit', '-m', 'reviewable delegated work']);
  await originalManager.planIntegration([originalLease]);

  let resumedId = 0;
  const resumedManager = createWorkspaceLeaseManager({
    gitOps,
    now: () => '2026-07-11T01:05:00.000Z',
    newId: () => `resumed-root-${++resumedId}`,
  });
  const resumedRoot = await resumedManager.acquireRootLease(repo);
  const reworkEvents: Array<Record<string, unknown>> = [];
  const reworkClaims: Array<Record<string, unknown>> = [];
  const reworkSessions: Array<Record<string, unknown>> = [];
  const reworkSupervisor = createChildSupervisor({
    emit: (event: Record<string, unknown>) => reworkEvents.push(event),
    authStorage: {},
    modelRegistry: {},
    cwd: '.',
    settingsManager: {},
    threadId: 'thread-rework',
    rootRunId: 'root-rework',
    projectId: 'project-rework',
    roster: [{ employeeId: 'employee-a' }],
    resolveModel: () => undefined,
    rootModel,
    ...rootExecutionContext,
    rootThinkingLevel: 'medium',
    buildPermissionGate: () => null,
    limits: createDelegationLimits({ childTimeoutMs: 0 }),
    createResourceLoader: () => ({ reload: async () => {} }),
    createSessionManager: () => ({}),
    createAgentSession: async (options: Record<string, unknown>) => {
      reworkSessions.push(options);
      return { session: makeSession(rootModel) };
    },
    leaseManager: resumedManager,
    rootLease: resumedRoot,
    validateLeaseCwd: async (claim: Record<string, unknown>) => {
      reworkClaims.push({ ...claim });
      return { cwd: claim.cwd };
    },
    confirmIntegration: async () => false,
  });
  await reworkSupervisor.runSingle({
    employeeId: 'employee-a',
    objective: 'Address the review feedback',
    access: 'write',
    workKind: 'implement',
    originRunId: originalLease.runId,
    resumeLease: {
      leaseId: originalLease.leaseId,
      runId: originalLease.runId,
      workspaceRoot: originalLease.workspaceRoot,
      cwd: originalLease.cwd,
      branch: originalLease.branch,
      createdAt: originalLease.createdAt,
    },
  });
  const acquiredRework = reworkEvents.find(
    (event) =>
      event.kind === 'agentRun' &&
      event.runType === 'workspace.lease.snapshot' &&
      (event.payload as Record<string, unknown>)?.phase === 'acquired',
  );
  assert.ok(acquiredRework, 'request changes creates a rework run');
  assert.notEqual(acquiredRework.runId, originalLease.runId, 'rework has a fresh run id');
  assert.equal(
    (acquiredRework.payload as Record<string, unknown>).leaseId,
    originalLease.leaseId,
    'rework keeps the same lease/worktree',
  );
  assert.equal(
    (acquiredRework.payload as Record<string, unknown>).originRunId,
    originalLease.runId,
    'rework remains linked to the original task',
  );
  assert.deepEqual(reworkClaims, [
    {
      leaseId: originalLease.leaseId,
      registeredRunId: originalLease.runId,
      workspaceRoot: originalLease.workspaceRoot,
      cwd: originalLease.cwd,
      branch: originalLease.branch,
    },
  ]);
  assert.equal(reworkSessions[0]?.cwd, originalLease.cwd);
  assert.deepEqual(reworkSessions[0]?.taskWorkspaceLease, reworkClaims[0]);
  assert.equal(resumedManager.getLease(originalLease.leaseId)?.status, 'pending_review');

  const failedReworkEvents: Array<Record<string, unknown>> = [];
  const failedReworkSupervisor = createChildSupervisor({
    emit: (event: Record<string, unknown>) => failedReworkEvents.push(event),
    authStorage: {},
    modelRegistry: {},
    cwd: '.',
    settingsManager: {},
    threadId: 'thread-rework-start-failure',
    rootRunId: 'root-rework-start-failure',
    projectId: 'project-rework',
    roster: [{ employeeId: 'employee-a' }],
    resolveModel: () => undefined,
    rootModel,
    ...rootExecutionContext,
    rootThinkingLevel: 'medium',
    buildPermissionGate: () => null,
    limits: createDelegationLimits({ childTimeoutMs: 0 }),
    createResourceLoader: () => ({
      reload: async () => {
        throw new Error('synthetic rework loader failure');
      },
    }),
    createSessionManager: () => ({}),
    createAgentSession: async () => ({ session: makeSession(rootModel) }),
    leaseManager: resumedManager,
    rootLease: resumedRoot,
    validateLeaseCwd: async (claim: Record<string, unknown>) => ({ cwd: claim.cwd }),
    confirmIntegration: async () => false,
  });
  const failedRework = await failedReworkSupervisor.runSingle({
    employeeId: 'employee-a',
    objective: 'Retry the review feedback',
    access: 'write',
    workKind: 'implement',
    originRunId: originalLease.runId,
    resumeLease: {
      leaseId: originalLease.leaseId,
      runId: originalLease.runId,
      workspaceRoot: originalLease.workspaceRoot,
      cwd: originalLease.cwd,
      branch: originalLease.branch,
      createdAt: originalLease.createdAt,
    },
  });
  assert.match(failedRework, /synthetic rework loader failure/);
  assert.equal(
    resumedManager.getLease(originalLease.leaseId)?.status,
    'pending_review',
    'a failed rework startup must retain its pre-existing lease for review retry',
  );
  const retainedStartFailure = failedReworkEvents.find(
    (event) =>
      event.kind === 'agentRun' &&
      event.runType === 'workspace.lease.snapshot' &&
      (event.payload as Record<string, unknown>)?.phase === 'rework_start_failed',
  );
  assert.equal(
    (retainedStartFailure?.payload as Record<string, unknown>)?.startError,
    'synthetic rework loader failure',
    'a failed rework startup must retain its actionable cause beside the retryable lease',
  );

  const delegatedBoundCalls: Array<{
    command: string;
    cwd: string;
    taskWorkspaceLease?: unknown;
    signal: AbortSignal;
  }> = [];
  const delegatedRegistry = createTaskBashProcessRegistry({
    executeBoundCommand: async (call) => {
      delegatedBoundCalls.push(call);
      assert.equal(
        delegatedRegistry.activeCount,
        1,
        'delegated Bash must remain registered while its Rust bridge call is active',
      );
      return { stdout: 'delegated bridge output', stderr: '', exitCode: 0, timedOut: false };
    },
  });
  try {
    const createDelegatedSession = createTaskScopedAgentSessionFactory(
      async (options: Record<string, unknown>) => {
        const bash = (
          options.customTools as Array<{
            name: string;
            execute: (
              toolCallId: string,
              params: { command: string },
              signal: AbortSignal,
              onUpdate: () => void,
            ) => Promise<unknown>;
          }>
        ).find((tool) => tool.name === 'bash');
        assert.ok(bash, 'child createAgentSession seam did not receive task-scoped Bash');
        let subscriber: ((event: unknown) => void) | undefined;
        return {
          session: {
            model: rootModel,
            subscribe(callback: (event: unknown) => void) {
              subscriber = callback;
              return () => {};
            },
            async prompt() {
              await bash.execute(
                'delegated-bash',
                { command: 'printf delegated' },
                new AbortController().signal,
                () => {},
              );
              subscriber?.({
                type: 'message_end',
                message: {
                  role: 'assistant',
                  stopReason: 'stop',
                  usage: { input: 1, output: 1, cost: { total: 0.001 } },
                },
              });
            },
            getLastAssistantText: () => 'Summary: delegated Bash completed',
            abort: async () => {},
            dispose: () => {},
          },
        };
      },
      delegatedRegistry,
    );
    const delegatedBashSupervisor = createChildSupervisor({
      emit: () => {},
      authStorage: {},
      modelRegistry: {},
      cwd: '.',
      settingsManager: {},
      threadId: 'thread-delegated-bash',
      rootRunId: 'root-delegated-bash',
      roster: [{ employeeId: 'employee-bash' }],
      resolveModel: () => undefined,
      rootModel,
      ...rootExecutionContext,
      rootThinkingLevel: 'medium',
      permissionMode: 'auto',
      buildPermissionGate: () => null,
      limits: createDelegationLimits({ childTimeoutMs: 0 }),
      createResourceLoader: () => ({ reload: async () => {} }),
      createSessionManager: () => ({}),
      createAgentSession: createDelegatedSession,
    });
    const delegatedResult = await delegatedBashSupervisor.runSingle({
      employeeId: 'employee-bash',
      objective: 'Run a delegated Bash task',
      access: 'write',
    });
    assert.equal(
      delegatedBoundCalls.length,
      1,
      `delegated child Bash did not cross the Rust bridge: ${delegatedResult}`,
    );
    assert.equal(delegatedBoundCalls[0]?.command, 'printf delegated');
    assert.equal(delegatedBoundCalls[0]?.cwd, '.', 'shared child Bash must inherit dot cwd');
    assert.equal(
      delegatedBoundCalls[0]?.taskWorkspaceLease,
      undefined,
      'shared child Bash must not invent an isolated lease claim',
    );
    assert.equal(delegatedRegistry.activeCount, 0, 'delegated child Bash remained registered');
  } finally {
    await delegatedRegistry.cleanup();
  }

  console.log('PASS single write artifact merged into project checkout');
  console.log('PASS isolated worktree removed');
  console.log('PASS write lease released');
  console.log('PASS single and parallel modes share the integration implementation');
  console.log('PASS employee model and thinking bindings reach child createAgentSession');
  console.log('PASS employee company + personal skill paths reach child Pi resource loader');
  console.log('PASS child sessions inherit Ask and bind the existing UI approval channel');
  console.log('PASS unbound employee inherits root model and thinking level');
  console.log('PASS request changes creates a linked rework run on the same lease/worktree');
  console.log('PASS delegated child Bash crosses the Rust bridge and drains its registry entry');
} finally {
  rmSync(repo, { recursive: true, force: true });
}
