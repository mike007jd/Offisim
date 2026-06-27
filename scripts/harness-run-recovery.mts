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
 *
 * Inject-proof (run manually, then revert):
 *   - park roots `cancelled` instead of `interrupted` → checks (a)/(f) fail.
 *   - drop the root-skip guard in aggregateSubtreeUsage (so the root row is summed
 *     AND folded in as rootUsage) → check (d) sees 20 instead of 15 and fails.
 * Both prove the assertions exercise the real logic, not a tautology.
 */

import assert from 'node:assert/strict';
import type { NewAgentRun } from '../packages/core/src/runtime/repositories.ts';
import { MemoryAgentRunRepository } from '../packages/core/src/runtime/repos/agent-runs/memory.ts';
import { persistRunStartIfAbsent } from '../apps/desktop/renderer/src/runtime/recovery/persist-run-idempotency.js';
import { reconcileInterruptedRuns } from '../apps/desktop/renderer/src/runtime/recovery/reconcile-interrupted-runs.js';

let passed = 0;
let failed = 0;
const TOTAL = 14;

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
    { run_id: 'root1', thread_id: 't1', company_id: CO_A, parent_run_id: null, root_run_id: 'root1', employee_id: null, relation: null, objective: 'Build feature X', access: null, status: 'running', started_at: '2026-06-27T10:00:00.000Z', session_file: null, usage_json: JSON.stringify({ input: 5, output: 5, cost: 0.05, turns: 1 }) },
    { run_id: 'child1', thread_id: 't1', company_id: CO_A, parent_run_id: 'root1', root_run_id: 'root1', employee_id: null, relation: 'delegate', objective: 'sub a', access: null, status: 'running', started_at: '2026-06-27T10:01:00.000Z' },
    { run_id: 'child2', thread_id: 't1', company_id: CO_A, parent_run_id: 'root1', root_run_id: 'root1', employee_id: null, relation: 'delegate', objective: 'sub b', access: null, status: 'completed', started_at: '2026-06-27T10:02:00.000Z', usage_json: JSON.stringify({ input: 10, output: 20, cost: 0.5, turns: 2 }) },
    // co-A: crashed root WITH a session_file (resumable).
    { run_id: 'root2', thread_id: 't2', company_id: CO_A, parent_run_id: null, root_run_id: 'root2', employee_id: null, relation: null, objective: 'Research Y', access: null, status: 'running', started_at: '2026-06-27T11:00:00.000Z', session_file: '/sessions/root2.jsonl' },
    // co-A: an orphan running child whose root already completed.
    { run_id: 'rootDone', thread_id: 't3', company_id: CO_A, parent_run_id: null, root_run_id: 'rootDone', employee_id: null, relation: null, objective: 'done', access: null, status: 'completed', started_at: '2026-06-27T09:00:00.000Z' },
    { run_id: 'orphan1', thread_id: 't3', company_id: CO_A, parent_run_id: 'rootDone', root_run_id: 'rootDone', employee_id: null, relation: 'delegate', objective: 'orphan', access: null, status: 'running', started_at: '2026-06-27T09:01:00.000Z' },
    // co-B: a running root that must NOT be touched when reconciling co-A.
    { run_id: 'rootB', thread_id: 'tb', company_id: CO_B, parent_run_id: null, root_run_id: 'rootB', employee_id: null, relation: null, objective: 'other co', access: null, status: 'running', started_at: '2026-06-27T10:00:00.000Z' },
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
    const usage = JSON.parse(root1!.usage_json!);
    assert.equal(usage.input, 15, '10 (child2) + 5 (root own), counted once');
    assert.equal(usage.output, 25);
    assert.equal(usage.cost, 0.55);
    assert.equal(usage.turns, 3);
    const card = result.cards.find((c) => c.runId === 'root1');
    assert.ok(card?.partialUsageJson, 'card surfaces the partial usage');
    assert.equal(JSON.parse(card!.partialUsageJson!).output, 25);
  });

  await check('(e) company scoping: other company root untouched', async () => {
    const rootB = await repo.findById('rootB');
    assert.equal(rootB?.status, 'running', 'reconciling co-A must not touch co-B');
  });

  await check('(f) root with session_file → resumable card', async () => {
    const card = result.cards.find((c) => c.runId === 'root2');
    assert.equal(card?.classification, 'resumable');
    assert.equal(card?.sessionFile, '/sessions/root2.jsonl');
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

  // --- A3: insert-if-absent run.started persistence (resume-replay idempotency) ---

  await check('(l) persistRunStartIfAbsent creates a fresh run (returns true)', async () => {
    const repo2 = new MemoryAgentRunRepository();
    const created = await persistRunStartIfAbsent(repo2, {
      run_id: 'r-new', thread_id: 't', company_id: CO_A, parent_run_id: null,
      root_run_id: 'r-new', employee_id: null, relation: null, objective: 'x', access: null,
      status: 'running',
    });
    assert.equal(created, true, 'fresh run is created');
    assert.equal((await repo2.findById('r-new'))?.status, 'running');
  });

  await check('(m) replay of an existing run is a no-op preserving resumed state', async () => {
    const repo2 = new MemoryAgentRunRepository();
    // Original run, then resume lane flips interrupted→running and aggregates usage.
    await persistRunStartIfAbsent(repo2, {
      run_id: 'r1', thread_id: 't', company_id: CO_A, parent_run_id: null,
      root_run_id: 'r1', employee_id: null, relation: null, objective: 'x', access: null,
      status: 'running',
    });
    await repo2.updateStatus('r1', 'running', { usageJson: JSON.stringify({ input: 7 }) });
    // The host replays run.started for the SAME run (create-time data, no usage).
    const created = await persistRunStartIfAbsent(repo2, {
      run_id: 'r1', thread_id: 't', company_id: CO_A, parent_run_id: null,
      root_run_id: 'r1', employee_id: null, relation: null, objective: 'x', access: null,
      status: 'running',
    });
    assert.equal(created, false, 'replay does not create a second row');
    const row = await repo2.findById('r1');
    assert.ok(row?.usage_json, 'replay must NOT clobber the resumed row (usage preserved)');
    assert.equal(JSON.parse(row!.usage_json!).input, 7);
  });

  console.log(`\n${passed}/${TOTAL} checks passed${failed ? `, ${failed} FAILED` : ''}.`);
  if (failed > 0 || passed !== TOTAL) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
