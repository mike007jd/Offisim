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
  const modelById = new Map([
    ['fixture/employee-a', modelA],
    ['fixture/employee-b', modelB],
  ]);
  const sessionOptions: Array<Record<string, unknown>> = [];
  const makeSession = () => {
    let subscriber: ((event: unknown) => void) | undefined;
    return {
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
  const supervisor = createChildSupervisor({
    emit: () => {},
    authStorage: {},
    modelRegistry: {},
    cwd: repo,
    settingsManager: {},
    threadId: 'thread-model-binding',
    rootRunId: 'root-model-binding',
    roster: [
      {
        employeeId: 'employee-a',
        model: 'fixture/employee-a',
        thinkingLevel: 'high',
      },
      {
        employeeId: 'employee-b',
        model: 'fixture/employee-b',
        thinkingLevel: 'low',
      },
      { employeeId: 'employee-inherit' },
    ],
    resolveModel: (modelId?: string) => (modelId ? modelById.get(modelId) : undefined),
    rootModel,
    rootThinkingLevel: 'medium',
    buildPermissionGate: () => null,
    limits: createDelegationLimits({ childTimeoutMs: 0 }),
    createResourceLoader: () => ({ reload: async () => {} }),
    createSessionManager: () => ({}),
    createAgentSession: async (options: Record<string, unknown>) => {
      sessionOptions.push(options);
      return { session: makeSession() };
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
  const reworkSupervisor = createChildSupervisor({
    emit: (event: Record<string, unknown>) => reworkEvents.push(event),
    authStorage: {},
    modelRegistry: {},
    cwd: repo,
    settingsManager: {},
    threadId: 'thread-rework',
    rootRunId: 'root-rework',
    projectId: 'project-rework',
    roster: [{ employeeId: 'employee-a' }],
    resolveModel: () => undefined,
    rootModel,
    rootThinkingLevel: 'medium',
    buildPermissionGate: () => null,
    limits: createDelegationLimits({ childTimeoutMs: 0 }),
    createResourceLoader: () => ({ reload: async () => {} }),
    createSessionManager: () => ({}),
    createAgentSession: async () => ({ session: makeSession() }),
    leaseManager: resumedManager,
    rootLease: resumedRoot,
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
  assert.equal(resumedManager.getLease(originalLease.leaseId)?.status, 'pending_review');

  console.log('PASS single write artifact merged into project checkout');
  console.log('PASS isolated worktree removed');
  console.log('PASS write lease released');
  console.log('PASS single and parallel modes share the integration implementation');
  console.log('PASS employee model and thinking bindings reach child createAgentSession');
  console.log('PASS unbound employee inherits root model and thinking level');
  console.log('PASS request changes creates a linked rework run on the same lease/worktree');
} finally {
  rmSync(repo, { recursive: true, force: true });
}
