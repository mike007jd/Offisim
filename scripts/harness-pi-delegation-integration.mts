import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createChildSupervisor,
  createDelegationLimits,
  integrateCompletedDelegation,
} from './pi-child-supervisor.mjs';
import { createWorkspaceLeaseManager } from '../packages/core/src/runtime/mission/workspace/lease-manager.ts';
import type {
  GitWorktreeOps,
  MergeResult,
} from '../packages/core/src/runtime/mission/workspace/types.ts';

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
  const base = git(repo, ['rev-parse', 'HEAD']);

  const gitOps: GitWorktreeOps = {
    isGitRepo: () => true,
    addWorktree: (branch, path) => {
      git(repo, ['worktree', 'add', '-b', branch, path]);
    },
    removeWorktree: (path) => {
      git(repo, ['worktree', 'remove', '--force', path]);
    },
    worktreeChanged: (path) => git(path, ['status', '--porcelain']).length > 0,
    diff: (path) =>
      git(path, ['diff', '--name-only', `${base}...HEAD`])
        .split('\n')
        .filter(Boolean),
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

  console.log('PASS single write artifact merged into project checkout');
  console.log('PASS isolated worktree removed');
  console.log('PASS write lease released');
  console.log('PASS single and parallel modes share the integration implementation');
  console.log('PASS employee model and thinking bindings reach child createAgentSession');
  console.log('PASS unbound employee inherits root model and thinking level');
} finally {
  rmSync(repo, { recursive: true, force: true });
}
