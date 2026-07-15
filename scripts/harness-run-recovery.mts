/**
 * Durable Resume oracle (Epic A, DR-003 / slice A2) — startup interrupted-run
 * reconciliation over `agent_runs`.
 *
 * Drives {@link reconcileInterruptedRuns} over the REAL in-memory
 * {@link MemoryAgentRunRepository} (the same backend the live tauri/drizzle repos
 * mirror), with an injected deterministic clock. No Pi, no SQLite, no Tauri. Each
 * reconcile decision is a pure function of the seeded rows.
 *
 * Covers:
 *   (a) a crashed `running` ROOT with no session_file → `interrupted` (NOT
 *       cancelled), finished_at stays null, card `needs_user_confirm`.
 *   (b) a still-`running` child under that root → `cancelled` with finished_at.
 *   (c) a `completed` child under that root → untouched.
 *   (d) partial usage from terminal children is aggregated onto the root + card.
 *   (e) company scoping: a `running` root in ANOTHER company is untouched.
 *   (f) a root WITH a session_file → card `resumable`.
 *   (g) an ORPHAN running child (its root already terminal) → `cancelled`.
 *   (h) POST-INVARIANT: after a pass, the company has NO run left `running`.
 *   (i) autoResumed is always false (never auto-resumes).
 *   (j) a company with no running runs → 0 cards, no throw.
 *   (k) findByStatus itself: company scoping + status filter + empty-statuses → [].
 *   (l) run context: project/workspace are surfaced, missing workspace blocks resume.
 *   (m) run context: host protocol mismatch is incompatible.
 *
 * Inject-proof (run manually, then revert):
 *   - park roots `cancelled` instead of `interrupted` → checks (a)/(f) fail.
 *   - drop the root-skip guard in aggregateSubtreeUsage (so the root row is summed
 *     AND folded in as rootUsage) → check (d) sees 20 instead of 15 and fails.
 * Both prove the assertions exercise the real logic, not a tautology.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { persistRunStartIfAbsent } from '../apps/desktop/renderer/src/runtime/recovery/persist-run-idempotency.js';
import {
  PI_HOST_PROTOCOL_VERSION,
  buildInterruptedRunCard,
  reconcileInterruptedRuns,
} from '../apps/desktop/renderer/src/runtime/recovery/reconcile-interrupted-runs.js';
import {
  RecoveryLoadGeneration,
  loadInterruptedRunRecovery,
  loadInterruptedRunRecoveryCards,
} from '../apps/desktop/renderer/src/runtime/recovery/useInterruptedRunRecovery.js';
import { MemoryAgentRunRepository } from '../packages/core/src/runtime/repos/agent-runs/memory.ts';
import type { NewAgentRun } from '../packages/core/src/runtime/repositories.ts';

let passed = 0;
let failed = 0;
const TOTAL = 28;

const recoveryHookSource = readFileSync(
  new URL(
    '../apps/desktop/renderer/src/runtime/recovery/useInterruptedRunRecovery.ts',
    import.meta.url,
  ),
  'utf8',
);
const desktopRuntimeSource = readFileSync(
  new URL('../apps/desktop/renderer/src/runtime/desktop-agent-runtime.ts', import.meta.url),
  'utf8',
);
const conversationControllerSource = readFileSync(
  new URL(
    '../apps/desktop/renderer/src/assistant/runtime/conversation-run-controller.ts',
    import.meta.url,
  ),
  'utf8',
);

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

const FIXED_NOW = '2026-06-27T12:00:00.000Z';
const now = () => FIXED_NOW;

const CO_A = 'co-A';
const CO_B = 'co-B';

/** Seed a repo with the standard crash scenario; returns the repo. */
async function seedRepo(): Promise<MemoryAgentRunRepository> {
  const repo = new MemoryAgentRunRepository();
  const runs: NewAgentRun[] = [
    // co-A: crashed root with no session_file + one running child + one completed child.
    // root1 carries its OWN partial usage so the no-double-count guard (root row
    // skipped in the child sum, folded in once as rootUsage) is load-bearing: the
    // aggregate must be children + root_own, each counted exactly once.
    {
      run_id: 'root1',
      thread_id: 't1',
      company_id: CO_A,
      project_id: 'proj-1',
      parent_run_id: null,
      root_run_id: 'root1',
      employee_id: null,
      relation: null,
      objective: 'Build feature X',
      access: null,
      status: 'running',
      started_at: '2026-06-27T10:00:00.000Z',
      session_file: null,
      runtime_context_json: JSON.stringify({
        runtime: 'pi-agent',
        projectId: 'proj-1',
        workspaceRoot: '/tmp/offisim/proj-1',
        wireProtocolVersion: PI_HOST_PROTOCOL_VERSION,
        piSdkVersion: '0.79.8',
        permissionMode: 'auto',
        model: null,
        thinkingLevel: null,
        createdAt: FIXED_NOW,
      }),
      usage_json: JSON.stringify({ input: 5, output: 5, cost: 0.05, turns: 1 }),
    },
    {
      run_id: 'child1',
      thread_id: 't1',
      company_id: CO_A,
      parent_run_id: 'root1',
      root_run_id: 'root1',
      employee_id: null,
      relation: 'delegate',
      objective: 'sub a',
      access: null,
      status: 'running',
      started_at: '2026-06-27T10:01:00.000Z',
    },
    {
      run_id: 'child2',
      thread_id: 't1',
      company_id: CO_A,
      parent_run_id: 'root1',
      root_run_id: 'root1',
      employee_id: null,
      relation: 'delegate',
      objective: 'sub b',
      access: null,
      status: 'completed',
      started_at: '2026-06-27T10:02:00.000Z',
      usage_json: JSON.stringify({ input: 10, output: 20, cost: 0.5, turns: 2 }),
    },
    // co-A: crashed root WITH a session_file (resumable).
    {
      run_id: 'root2',
      thread_id: 't2',
      company_id: CO_A,
      project_id: 'proj-2',
      parent_run_id: null,
      root_run_id: 'root2',
      employee_id: null,
      relation: null,
      objective: 'Research Y',
      access: null,
      status: 'running',
      started_at: '2026-06-27T11:00:00.000Z',
      session_file: '/sessions/root2.jsonl',
      runtime_context_json: JSON.stringify({
        runtime: 'pi-agent',
        projectId: 'proj-2',
        workspaceRoot: '/tmp/offisim/proj-2',
        wireProtocolVersion: PI_HOST_PROTOCOL_VERSION,
        piSdkVersion: '0.79.8',
        permissionMode: 'auto',
        model: null,
        thinkingLevel: null,
        createdAt: FIXED_NOW,
      }),
    },
    // co-A: an orphan running child whose root already completed.
    {
      run_id: 'rootDone',
      thread_id: 't3',
      company_id: CO_A,
      parent_run_id: null,
      root_run_id: 'rootDone',
      employee_id: null,
      relation: null,
      objective: 'done',
      access: null,
      status: 'completed',
      started_at: '2026-06-27T09:00:00.000Z',
    },
    {
      run_id: 'orphan1',
      thread_id: 't3',
      company_id: CO_A,
      parent_run_id: 'rootDone',
      root_run_id: 'rootDone',
      employee_id: null,
      relation: 'delegate',
      objective: 'orphan',
      access: null,
      status: 'running',
      started_at: '2026-06-27T09:01:00.000Z',
    },
    // co-B: a running root that must NOT be touched when reconciling co-A.
    {
      run_id: 'rootB',
      thread_id: 'tb',
      company_id: CO_B,
      parent_run_id: null,
      root_run_id: 'rootB',
      employee_id: null,
      relation: null,
      objective: 'other co',
      access: null,
      status: 'running',
      started_at: '2026-06-27T10:00:00.000Z',
    },
  ];
  for (const r of runs) await repo.create(r);
  return repo;
}

async function main(): Promise<void> {
  console.log('harness:run-recovery — DR-003 startup interrupted-run reconciliation\n');

  // One shared reconcile pass over co-A; assert each effect.
  const repo = await seedRepo();
  const result = await reconcileInterruptedRuns({ repo, companyId: CO_A, now });

  await check('(a) crashed root → interrupted (not cancelled), finished_at null', async () => {
    const root1 = await repo.findById('root1');
    assert.equal(root1?.status, 'interrupted', 'root parked interrupted');
    assert.equal(root1?.finished_at, null, 'interrupted run is paused, not finished');
  });

  await check('(b) running child → cancelled with finished_at', async () => {
    const child1 = await repo.findById('child1');
    assert.equal(child1?.status, 'cancelled');
    assert.equal(child1?.finished_at, FIXED_NOW, 'cancelled child stamped with injected now()');
  });

  await check('(c) completed child untouched', async () => {
    const child2 = await repo.findById('child2');
    assert.equal(child2?.status, 'completed');
  });

  await check('(d) partial usage = children + root_own, each counted once', async () => {
    // child2 = {input:10, output:20, cost:0.5, turns:2}; root1 own = {5,5,0.05,1}.
    // The root row is skipped in the child sum and folded in once as rootUsage, so
    // the aggregate is the exact sum with no double-count. Dropping the root-skip
    // guard would yield 20 (root counted twice) and fail these assertions.
    const root1 = await repo.findById('root1');
    assert.ok(root1?.usage_json, 'root carries aggregated partial usage');
    const usage = JSON.parse(root1.usage_json);
    assert.equal(usage.input, 15, '10 (child2) + 5 (root own), counted once');
    assert.equal(usage.output, 25);
    assert.equal(usage.cost, 0.55);
    assert.equal(usage.turns, 3);
    const card = result.cards.find((c) => c.runId === 'root1');
    assert.ok(card?.partialUsageJson, 'card surfaces the partial usage');
    assert.equal(JSON.parse(card.partialUsageJson).output, 25);
  });

  await check('(e) company scoping: other company root untouched', async () => {
    const rootB = await repo.findById('rootB');
    assert.equal(rootB?.status, 'running', 'reconciling co-A must not touch co-B');
  });

  await check('(f) root with session_file → resumable card', async () => {
    const card = result.cards.find((c) => c.runId === 'root2');
    assert.equal(card?.classification, 'resumable');
    assert.equal(card?.sessionFile, '/sessions/root2.jsonl');
    assert.equal(card?.projectId, 'proj-2');
    assert.equal(card?.workspaceRoot, '/tmp/offisim/proj-2');
    const root2 = await repo.findById('root2');
    assert.equal(root2?.status, 'interrupted');
  });

  await check('(a2) no-session root → needs_user_confirm card', async () => {
    const card = result.cards.find((c) => c.runId === 'root1');
    assert.equal(card?.classification, 'needs_user_confirm');
    assert.equal(card?.cancelledChildRunIds.length, 1, 'only the running child was cancelled');
    assert.equal(card?.cancelledChildRunIds[0], 'child1');
  });

  await check('(g) orphan running child (terminal root) → cancelled', async () => {
    const orphan = await repo.findById('orphan1');
    assert.equal(orphan?.status, 'cancelled');
    const rootDone = await repo.findById('rootDone');
    assert.equal(rootDone?.status, 'completed', 'already-terminal root stays terminal');
  });

  await check('(h) post-invariant: co-A has no run left running', async () => {
    const stillRunning = await repo.findByStatus(CO_A, ['running']);
    assert.equal(stillRunning.length, 0, 'every co-A run is interrupted or cancelled');
  });

  await check('(i) result.autoResumed is always false', () => {
    assert.equal(result.autoResumed, false);
    assert.equal(result.cards.length, 2, 'two roots produced two cards');
  });

  await check('(j) company with no running runs → 0 cards, no throw', async () => {
    const empty = new MemoryAgentRunRepository();
    const r = await reconcileInterruptedRuns({ repo: empty, companyId: 'co-empty', now });
    assert.equal(r.cards.length, 0);
    assert.equal(r.autoResumed, false);
  });

  await check('(k) findByStatus: scoping + status filter + empty → []', async () => {
    const fresh = await seedRepo();
    const runningA = await fresh.findByStatus(CO_A, ['running']);
    assert.ok(
      runningA.every((r) => r.company_id === CO_A && r.status === 'running'),
      'only co-A running rows',
    );
    assert.equal((await fresh.findByStatus(CO_A, [])).length, 0, 'empty statuses → []');
    const multi = await fresh.findByStatus(CO_A, ['running', 'completed']);
    assert.ok(multi.length > runningA.length, 'multi-status returns more rows');
  });

  await check('(k2) scoped status update rejects a cross-company discard', async () => {
    const repo2 = new MemoryAgentRunRepository();
    await repo2.create({
      run_id: 'scoped-run',
      thread_id: 'scoped-thread',
      company_id: CO_A,
      parent_run_id: null,
      root_run_id: 'scoped-run',
      employee_id: null,
      relation: null,
      objective: 'scope guard',
      access: null,
      status: 'interrupted',
      started_at: FIXED_NOW,
    });

    const crossCompany = await repo2.updateStatusForCompany(CO_B, 'scoped-run', 'cancelled', {
      finishedAt: FIXED_NOW,
    });
    assert.equal(crossCompany, false, 'wrong-company action is rejected');
    assert.equal(
      (await repo2.findById('scoped-run'))?.status,
      'interrupted',
      'wrong-company action cannot mutate the row',
    );

    const sameCompany = await repo2.updateStatusForCompany(CO_A, 'scoped-run', 'cancelled', {
      finishedAt: FIXED_NOW,
    });
    assert.equal(sameCompany, true, 'owning company can discard its run');
    assert.equal((await repo2.findById('scoped-run'))?.status, 'cancelled');
  });

  await check('(k3) latest recovery load generation wins after a company switch', async () => {
    const generation = new RecoveryLoadGeneration();
    const published: string[] = [];
    let finishSlow!: () => void;
    const slow = new Promise<void>((resolve) => {
      finishSlow = resolve;
    });

    const companyAToken = generation.begin();
    const staleCompletion = slow.then(() => {
      generation.commit(companyAToken, () => published.push(CO_A));
    });
    const companyBToken = generation.begin();
    generation.commit(companyBToken, () => published.push(CO_B));
    finishSlow();
    await staleCompletion;

    assert.deepEqual(published, [CO_B], 'slow company A completion cannot overwrite company B');
  });

  await check('(k4) a failed root stays retryable and its child is not stranded', async () => {
    const repo2 = await seedRepo();
    const originalUpdateStatus = repo2.updateStatus.bind(repo2);
    let failRootOnce = true;
    repo2.updateStatus = async (runId, status, opts) => {
      if (failRootOnce && runId === 'root1' && status === 'interrupted') {
        failRootOnce = false;
        throw new Error('injected root park failure');
      }
      await originalUpdateStatus(runId, status, opts);
    };

    const first = await loadInterruptedRunRecovery({ repo: repo2, companyId: CO_A, now });
    assert.equal(first.complete, false, 'partial reconcile must stay unhydrated/retryable');
    assert.equal((await repo2.findById('root1'))?.status, 'running');
    assert.equal(
      (await repo2.findById('child1'))?.status,
      'cancelled',
      'a failed root is not pre-marked processed, so its child reaches orphan cleanup',
    );

    const second = await loadInterruptedRunRecovery({ repo: repo2, companyId: CO_A, now });
    assert.equal(second.complete, true, 'the next load retries and completes reconciliation');
    assert.equal((await repo2.findById('root1'))?.status, 'interrupted');
    assert.ok(second.cards.some((card) => card.runId === 'root1'));
  });

  await check('(l) missing workspace blocks resume classification', async () => {
    const repo2 = new MemoryAgentRunRepository();
    await repo2.create({
      run_id: 'r-missing-workspace',
      thread_id: 't-missing',
      company_id: CO_A,
      project_id: 'proj-missing',
      parent_run_id: null,
      root_run_id: 'r-missing-workspace',
      employee_id: null,
      relation: null,
      objective: 'resume safely',
      access: 'write',
      status: 'interrupted',
      started_at: '2026-06-27T10:00:00.000Z',
      session_file: '/sessions/r-missing-workspace.jsonl',
      runtime_context_json: JSON.stringify({
        runtime: 'pi-agent',
        projectId: 'proj-missing',
        workspaceRoot: '/tmp/offisim/missing',
        wireProtocolVersion: PI_HOST_PROTOCOL_VERSION,
        piSdkVersion: '0.79.8',
        permissionMode: 'auto',
        model: null,
        thinkingLevel: null,
        createdAt: FIXED_NOW,
      }),
    });
    const row = await repo2.findById('r-missing-workspace');
    assert.ok(row);
    const card = buildInterruptedRunCard(row, [], null, { workspaceExists: false });
    assert.equal(card.classification, 'incompatible');
    assert.match(card.classificationReasons.join(' '), /workspace folder is no longer accessible/);
    assert.equal(card.projectId, 'proj-missing');
    assert.equal(card.workspaceRoot, '/tmp/offisim/missing');
  });

  await check('(m) protocol mismatch marks recovery card incompatible', async () => {
    const repo2 = new MemoryAgentRunRepository();
    await repo2.create({
      run_id: 'r-protocol',
      thread_id: 't-protocol',
      company_id: CO_A,
      project_id: 'proj-protocol',
      parent_run_id: null,
      root_run_id: 'r-protocol',
      employee_id: null,
      relation: null,
      objective: 'old protocol',
      access: 'write',
      status: 'interrupted',
      started_at: '2026-06-27T10:00:00.000Z',
      session_file: '/sessions/r-protocol.jsonl',
      runtime_context_json: JSON.stringify({
        runtime: 'pi-agent',
        projectId: 'proj-protocol',
        workspaceRoot: '/tmp/offisim/protocol',
        wireProtocolVersion: 3,
        piSdkVersion: '0.79.8',
        permissionMode: 'auto',
        model: null,
        thinkingLevel: null,
        createdAt: FIXED_NOW,
      }),
    });
    const row = await repo2.findById('r-protocol');
    assert.ok(row);
    const card = buildInterruptedRunCard(row, [], null, {
      workspaceExists: true,
      currentWireProtocolVersion: 4,
    });
    assert.equal(card.classification, 'incompatible');
    assert.match(card.classificationReasons.join(' '), /does not match current protocol/);
  });

  // --- A3: insert-if-absent run.started persistence (resume-replay idempotency) ---

  await check('(l) persistRunStartIfAbsent creates a fresh run (returns true)', async () => {
    const repo2 = new MemoryAgentRunRepository();
    const created = await persistRunStartIfAbsent(repo2, {
      run_id: 'r-new',
      thread_id: 't',
      company_id: CO_A,
      parent_run_id: null,
      root_run_id: 'r-new',
      employee_id: null,
      relation: null,
      objective: 'x',
      access: null,
      status: 'running',
    });
    assert.equal(created, true, 'fresh run is created');
    assert.equal((await repo2.findById('r-new'))?.status, 'running');
  });

  await check('(m) replay of an existing run is a no-op preserving resumed state', async () => {
    const repo2 = new MemoryAgentRunRepository();
    // Original run, then resume lane flips interrupted→running and aggregates usage.
    await persistRunStartIfAbsent(repo2, {
      run_id: 'r1',
      thread_id: 't',
      company_id: CO_A,
      parent_run_id: null,
      root_run_id: 'r1',
      employee_id: null,
      relation: null,
      objective: 'x',
      access: null,
      status: 'running',
    });
    await repo2.updateStatus('r1', 'running', { usageJson: JSON.stringify({ input: 7 }) });
    // The host replays run.started for the SAME run (create-time data, no usage).
    const created = await persistRunStartIfAbsent(repo2, {
      run_id: 'r1',
      thread_id: 't',
      company_id: CO_A,
      parent_run_id: null,
      root_run_id: 'r1',
      employee_id: null,
      relation: null,
      objective: 'x',
      access: null,
      status: 'running',
    });
    assert.equal(created, false, 'replay does not create a second row');
    const row = await repo2.findById('r1');
    assert.ok(row?.usage_json, 'replay must NOT clobber the resumed row (usage preserved)');
    assert.equal(JSON.parse(row.usage_json).input, 7);
  });

  await check('(n) updateStatus can persist the Pi session_file without finishing', async () => {
    const repo2 = new MemoryAgentRunRepository();
    await persistRunStartIfAbsent(repo2, {
      run_id: 'r-session',
      thread_id: 't',
      company_id: CO_A,
      parent_run_id: null,
      root_run_id: 'r-session',
      employee_id: null,
      relation: null,
      objective: 'x',
      access: null,
      status: 'running',
    });
    await repo2.updateStatus('r-session', 'running', {
      sessionFile: '/sessions/r-session.jsonl',
    });
    const row = await repo2.findById('r-session');
    assert.equal(row?.session_file, '/sessions/r-session.jsonl');
    assert.equal(row?.finished_at, null, 'session_file write must not finish the run');
  });

  await check(
    '(o) updateRuntimeContext persists stream cursor without changing status',
    async () => {
      const repo2 = new MemoryAgentRunRepository();
      await persistRunStartIfAbsent(repo2, {
        run_id: 'r-cursor',
        thread_id: 't',
        company_id: CO_A,
        parent_run_id: null,
        root_run_id: 'r-cursor',
        employee_id: null,
        relation: null,
        objective: 'x',
        access: null,
        status: 'completed',
      });
      await repo2.updateRuntimeContext(
        'r-cursor',
        JSON.stringify({ runtime: 'pi-agent', streamCursor: 7 }),
      );
      const row = await repo2.findById('r-cursor');
      assert.equal(row?.status, 'completed', 'cursor persistence must not reopen a terminal run');
      assert.ok(row?.runtime_context_json);
      assert.equal(JSON.parse(row.runtime_context_json).streamCursor, 7);
    },
  );

  await check('(p) recovery loader lists already-interrupted roots', async () => {
    const repo2 = new MemoryAgentRunRepository();
    await repo2.create({
      run_id: 'r-existing',
      thread_id: 't-existing',
      company_id: CO_A,
      parent_run_id: null,
      root_run_id: 'r-existing',
      employee_id: null,
      relation: null,
      objective: 'resume me',
      access: null,
      status: 'interrupted',
      started_at: '2026-06-27T10:00:00.000Z',
      project_id: 'proj-existing',
      session_file: '/sessions/r-existing.jsonl',
      runtime_context_json: JSON.stringify({
        runtime: 'pi-agent',
        projectId: 'proj-existing',
        workspaceRoot: '/tmp/offisim/existing',
        wireProtocolVersion: PI_HOST_PROTOCOL_VERSION,
        piSdkVersion: '0.79.8',
        permissionMode: 'auto',
        model: null,
        thinkingLevel: null,
        createdAt: FIXED_NOW,
      }),
    });
    const cards = await loadInterruptedRunRecoveryCards({ repo: repo2, companyId: CO_A, now });
    assert.equal(cards.length, 1);
    assert.equal(cards[0]?.runId, 'r-existing');
    assert.equal(cards[0]?.classification, 'resumable');
  });

  await check('(p) recovery loader can skip reconcile while a live run is active', async () => {
    const repo2 = new MemoryAgentRunRepository();
    await repo2.create({
      run_id: 'r-live',
      thread_id: 't-live',
      company_id: CO_A,
      parent_run_id: null,
      root_run_id: 'r-live',
      employee_id: null,
      relation: null,
      objective: 'still live',
      access: null,
      status: 'running',
      started_at: '2026-06-27T10:00:00.000Z',
      session_file: '/sessions/r-live.jsonl',
    });
    const cards = await loadInterruptedRunRecoveryCards({
      repo: repo2,
      companyId: CO_A,
      now,
      skipReconcile: true,
    });
    assert.equal(cards.length, 0, 'live running roots are not recovery cards');
    const row = await repo2.findById('r-live');
    assert.equal(row?.status, 'running', 'skipReconcile must not park a live run');
    assert.equal(row?.finished_at, null);
  });

  await check('(q) adopted live roots are excluded while dead roots still reconcile', async () => {
    const repo2 = await seedRepo();
    const liveRootRunIds = new Set(['root1']);
    const reconciled = await reconcileInterruptedRuns({
      repo: repo2,
      companyId: CO_A,
      now,
      liveRootRunIds,
    });
    assert.equal((await repo2.findById('root1'))?.status, 'running');
    assert.equal((await repo2.findById('child1'))?.status, 'running');
    assert.equal((await repo2.findById('root2'))?.status, 'interrupted');
    assert.deepEqual(
      reconciled.cards.map((card) => card.runId),
      ['root2'],
      'only the unclaimed crashed root becomes a recovery card',
    );
  });

  await check('(r) Resume enters through conversation-controller ownership', () => {
    assert.match(
      recoveryHookSource,
      /conversationRunController\.resumeInterrupted\(scopeCompanyId, runId\)/,
      'the recovery card must claim the thread through ConversationRunController',
    );
    assert.doesNotMatch(
      recoveryHookSource,
      /getDesktopAgentRuntime|\.resume\(runId\)/,
      'the hook must not bypass controller ownership by invoking the runtime directly',
    );
  });

  await check('(s) runtime chooses exact-open or fresh-replay recovery', () => {
    assert.match(desktopRuntimeSource, /mode: resumeSessionFile \? 'open' : 'fresh'/);
    assert.match(desktopRuntimeSource, /sessionFile: resumeSessionFile/);
    assert.match(
      desktopRuntimeSource,
      /images: resumeSessionFile \? \[\] : restart\.images/,
      'a missing Pi session must replay the durable objective and native attachments',
    );
    const admission = desktopRuntimeSource.indexOf(
      'this.acceptingControlThreads.add(admissionThreadId)',
    );
    const durableLookup = desktopRuntimeSource.indexOf('await repo.findById(runId)', admission);
    assert.ok(admission >= 0 && durableLookup > admission, 'Resume admission must precede awaits');
    assert.match(conversationControllerSource, /threadId: run\.threadId/);
  });

  await check('(t) terminal stream release waits for durable observer settlement', () => {
    assert.match(
      desktopRuntimeSource,
      /Promise\.resolve\(completion\)[\s\S]*\.then\(\(\) => this\.settleRun\(row\.thread_id, terminalStatus\)\)/,
      'reattach must wait for the observer transcript/interaction commit before root settlement',
    );
    const settleStart = desktopRuntimeSource.indexOf('async settleRun(');
    const rootCommit = desktopRuntimeSource.indexOf('this.reconcileRoot(', settleStart);
    const streamRelease = desktopRuntimeSource.indexOf(
      "invokeCommand('agent_runtime_release_stream'",
      rootCommit,
    );
    assert.ok(
      settleStart >= 0 && rootCommit > settleStart && streamRelease > rootCommit,
      'root terminal commit must precede retained stream release',
    );
  });

  await check('(u) failed observer settlement retains the terminal stream for retry', () => {
    assert.match(
      desktopRuntimeSource,
      /\.then\(\(\) => this\.settleRun\(row\.thread_id, terminalStatus\)\)[\s\S]*reattached run settlement retained stream/,
      'observer rejection must skip root settlement/release and retain the replay source',
    );
    assert.doesNotMatch(
      desktopRuntimeSource,
      /if \(snapshot\.terminal\?\.status === 'aborted'\)[\s\S]{0,300}agent_runtime_release_stream/,
      'initial aborted snapshots must hydrate controller ownership and use the shared settlement path',
    );
  });

  console.log(`\n${passed}/${TOTAL} checks passed${failed ? `, ${failed} FAILED` : ''}.`);
  if (failed > 0 || passed !== TOTAL) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
