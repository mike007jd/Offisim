/**
 * Isolated Parallel Write oracle (PRD §23, slice M5 — WI-001..006).
 *
 * Drives the deterministic {@link createWorkspaceLeaseManager} over a FAKE
 * in-memory {@link GitWorktreeOps}: no real git, no real filesystem, no Pi. Every
 * lease decision, diff, conflict plan, merge, and cleanup is a pure function of
 * injected facts (`now` / `newId`) + the fake's recorded state, so each run is
 * byte-stable. Style mirrors the other `scripts/harness-mission-*.mts` oracles.
 *
 * Covers each WI:
 *   (a) WI-002/003 — a read / review child SHARES the root (no worktree created);
 *       a writable child gets a worktree + branch + DISTINCT cwd.
 *   (b) WI-002/003 — two writable children get two ISOLATED worktrees (distinct
 *       cwd — they cannot collide on the filesystem).
 *   (c) WI-005 — planIntegration: two children changing an OVERLAPPING path → a
 *       conflict entry (those leases `conflicted`, NOT in mergeable);
 *       non-overlapping → both mergeable.
 *   (d) WI-005 — integrate merges ONLY the mergeable leases; a fake merge-conflict
 *       → conflicted, STOP, no silent overwrite.
 *   (e) WI-006 — releaseLease removes an UNCHANGED worktree; a CHANGED worktree on
 *       abort is RETAINED (not discarded) with a reason.
 *   (f) WI-001/§23.3 — a non-Git workspace refuses a 2nd concurrent write lease
 *       (serialized); read/review still share the root.
 *
 * Inject-proof (run manually, then revert): break the overlap detection in
 * `planIntegration` (e.g. require `owners.length >= 3` instead of `>= 2`) → two
 * overlapping children both WRONGLY land in `mergeable` → check (c) fails. That
 * proves the conflict check exercises the real overlap rule, not a tautology.
 */

import assert from 'node:assert/strict';
// Anchor + contract-check the PRODUCTION renderer adapter (the git_exec binding).
// Importing it here (like harness-mission-run-controller anchors evaluation-context)
// keeps it in the reachable graph AND proves it satisfies the injected GitWorktreeOps
// contract. The factory is constructed but NO method is invoked, so no real Tauri /
// git_exec call happens (those resolve lazily inside each method).
import { parsePorcelainV1ZPaths } from '../apps/desktop/renderer/src/runtime/mission/git-porcelain.js';
import { createTauriGitWorktreeOps } from '../apps/desktop/renderer/src/runtime/mission/workspace/git-worktree-ops.js';
import {
  type GitWorktreeOps,
  type MergeResult,
  type WorkspaceLease,
  type WorkspaceLeaseManagerDeps,
  createWorkspaceLeaseManager,
} from '../packages/core/src/runtime/mission/workspace/lease-manager.ts';

let passed = 0;
let failed = 0;
const TOTAL = 16;

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
// Deterministic id / clock, mirroring the mission harnesses.
// ---------------------------------------------------------------------------

function makeDeps(gitOps: GitWorktreeOps): WorkspaceLeaseManagerDeps {
  let idSeq = 0;
  let clockSeq = 0;
  return {
    gitOps,
    newId: () => {
      idSeq += 1;
      return `lease-${idSeq.toString().padStart(4, '0')}`;
    },
    now: () => {
      clockSeq += 1;
      return new Date(Date.UTC(2026, 0, 1, 0, 0, 0, clockSeq)).toISOString();
    },
  };
}

// ---------------------------------------------------------------------------
// A fake in-memory GitWorktreeOps. Records worktrees, the per-path change set of
// each worktree, scripted merge results, and removals — so the harness can assert
// the manager's decisions WITHOUT a real git / filesystem.
// ---------------------------------------------------------------------------

interface FakeGitConfig {
  /** Whether the root is a Git repo (false → serial-write / non-Git path). */
  isGit: boolean;
  /** Scripted changed paths per worktree cwd (key = cwd, value = changed paths). */
  changedPaths?: Map<string, string[]>;
  /** Scripted merge results per branch (key = branch). Default = clean merge. */
  mergeResults?: Map<string, MergeResult>;
}

interface FakeGit extends GitWorktreeOps {
  /** Worktree cwds currently live (addWorktree adds, removeWorktree removes). */
  readonly liveWorktrees: Set<string>;
  /** Branches created via addWorktree, in order. */
  readonly createdBranches: string[];
  /** cwds removed via removeWorktree, in order. */
  readonly removed: string[];
  /** Branches merged via merge, in order. */
  readonly mergedBranches: string[];
  /** cwds commitAll was invoked on, in order (planIntegration safety net). */
  readonly committed: string[];
}

function makeFakeGit(config: FakeGitConfig): FakeGit {
  const liveWorktrees = new Set<string>();
  const createdBranches: string[] = [];
  const removed: string[] = [];
  const mergedBranches: string[] = [];
  const committed: string[] = [];
  const changedPaths = config.changedPaths ?? new Map<string, string[]>();
  const mergeResults = config.mergeResults ?? new Map<string, MergeResult>();

  return {
    liveWorktrees,
    createdBranches,
    removed,
    mergedBranches,
    committed,
    isGitRepo: () => config.isGit,
    addWorktree: (branch: string, path: string) => {
      liveWorktrees.add(path);
      createdBranches.push(branch);
    },
    removeWorktree: (path: string) => {
      liveWorktrees.delete(path);
      removed.push(path);
    },
    discardWorktree: (path: string) => {
      liveWorktrees.delete(path);
      removed.push(path);
    },
    worktreeChanged: (path: string) => (changedPaths.get(path)?.length ?? 0) > 0,
    diff: (path: string) => changedPaths.get(path) ?? [],
    diffText: (_path: string, changedPath: string) =>
      `diff --git a/${changedPath} b/${changedPath}`,
    commitAll: (path: string) => {
      committed.push(path);
    },
    merge: (branch: string) => {
      mergedBranches.push(branch);
      return mergeResults.get(branch) ?? { ok: true, conflicts: [] };
    },
  };
}

function granted(result: { outcome: string }): result is {
  outcome: 'granted';
  lease: WorkspaceLease;
} {
  return result.outcome === 'granted';
}

// ===========================================================================
// (a) WI-002/003 — read/review SHARE the root; writable child gets a worktree.
// ===========================================================================

await check(
  'WI-002/003: read + review children SHARE the root (no worktree); writable child gets worktree+branch+distinct cwd',
  async () => {
    const git = makeFakeGit({ isGit: true });
    const mgr = createWorkspaceLeaseManager(makeDeps(git));
    const root = await mgr.acquireRootLease('/ws');

    const readRes = await mgr.acquireChildLease({
      rootLease: root,
      runId: 'run-read',
      access: 'read',
    });
    const reviewRes = await mgr.acquireChildLease({
      rootLease: root,
      runId: 'run-review',
      access: 'review',
    });
    const writeRes = await mgr.acquireChildLease({
      rootLease: root,
      runId: 'run-write',
      access: 'write',
    });

    assert.ok(granted(readRes) && granted(reviewRes) && granted(writeRes), 'all three are granted');
    const read = (readRes as { lease: WorkspaceLease }).lease;
    const review = (reviewRes as { lease: WorkspaceLease }).lease;
    const write = (writeRes as { lease: WorkspaceLease }).lease;

    // §23.2: read + review share the root read-only — no worktree, cwd = root.
    assert.equal(read.isolated, false, 'read child is not isolated');
    assert.equal(read.cwd, '/ws', 'read child cwd is the root');
    assert.equal(read.branch, null, 'read child has no branch');
    assert.equal(review.isolated, false, 'review child is not isolated');
    assert.equal(review.cwd, '/ws', 'review child cwd is the root');

    // §23.3: ONLY the writable Git child gets an isolated worktree + branch + a
    // DISTINCT cwd (not the root).
    assert.equal(write.isolated, true, 'writable child is isolated');
    assert.notEqual(write.cwd, '/ws', 'writable child cwd differs from the root');
    assert.ok(write.branch, 'writable child has a branch');
    assert.equal(
      git.createdBranches.length,
      1,
      'exactly one worktree was created (only for the writer)',
    );
    assert.ok(git.liveWorktrees.has(write.cwd), 'the writable cwd is a live worktree');
    assert.ok(!git.liveWorktrees.has('/ws'), 'the root is never a worktree');
  },
);

// ===========================================================================
// (b) WI-002/003 — two writable children → two ISOLATED worktrees (distinct cwd).
// ===========================================================================

await check(
  'WI-002/003: two writable children get two ISOLATED worktrees (distinct cwd — cannot collide on fs)',
  async () => {
    const git = makeFakeGit({ isGit: true });
    const mgr = createWorkspaceLeaseManager(makeDeps(git));
    const root = await mgr.acquireRootLease('/ws');

    const aRes = await mgr.acquireChildLease({ rootLease: root, runId: 'run-a', access: 'write' });
    const bRes = await mgr.acquireChildLease({ rootLease: root, runId: 'run-b', access: 'write' });
    assert.ok(
      granted(aRes) && granted(bRes),
      'both writable children granted (Git workspace never blocks)',
    );
    const a = (aRes as { lease: WorkspaceLease }).lease;
    const b = (bRes as { lease: WorkspaceLease }).lease;

    assert.notEqual(a.cwd, b.cwd, 'the two writable children have DISTINCT cwds');
    assert.notEqual(a.branch, b.branch, 'the two writable children are on DISTINCT branches');
    assert.equal(git.liveWorktrees.size, 2, 'two independent worktrees exist');
    assert.ok(
      git.liveWorktrees.has(a.cwd) && git.liveWorktrees.has(b.cwd),
      'both cwds are live worktrees',
    );
  },
);

// ===========================================================================
// (c) WI-005 — planIntegration overlap → conflict; non-overlap → mergeable.
// ===========================================================================

await check(
  'WI-005: planIntegration — overlapping path → conflict (leases conflicted, NOT mergeable)',
  async () => {
    // Two writable children that BOTH change src/shared.ts → overlap.
    const git = makeFakeGit({ isGit: true });
    const mgr = createWorkspaceLeaseManager(makeDeps(git));
    const root = await mgr.acquireRootLease('/ws');
    const aRes = await mgr.acquireChildLease({ rootLease: root, runId: 'run-a', access: 'write' });
    const bRes = await mgr.acquireChildLease({ rootLease: root, runId: 'run-b', access: 'write' });
    const a = (aRes as { lease: WorkspaceLease }).lease;
    const b = (bRes as { lease: WorkspaceLease }).lease;
    // Script each worktree's changed paths so they OVERLAP on src/shared.ts.
    git.diff = (path: string) =>
      path === a.cwd
        ? ['src/a.ts', 'src/shared.ts']
        : path === b.cwd
          ? ['src/b.ts', 'src/shared.ts']
          : [];

    const plan = await mgr.planIntegration([a, b]);

    assert.equal(plan.conflicts.length, 1, 'one overlapping path → one conflict entry');
    assert.equal(
      plan.conflicts[0]!.path,
      'src/shared.ts',
      'the conflict is on the overlapping path',
    );
    assert.deepEqual(
      plan.conflicts[0]!.leaseIds.sort(),
      [a.leaseId, b.leaseId].sort(),
      'both leases named in the conflict',
    );
    assert.equal(plan.mergeable.length, 0, 'NEITHER overlapping lease is mergeable');
    assert.deepEqual(
      plan.conflictedLeaseIds.sort(),
      [a.leaseId, b.leaseId].sort(),
      'both leases are conflicted',
    );

    // The conflicted leases were marked `conflicted` (routed to repair/human).
    assert.equal(mgr.getLease(a.leaseId)?.status, 'conflicted', 'lease a marked conflicted');
    assert.equal(mgr.getLease(b.leaseId)?.status, 'conflicted', 'lease b marked conflicted');
  },
);

await check(
  'WI-005: planIntegration — non-overlapping writers → both mergeable (stable order)',
  async () => {
    const git = makeFakeGit({ isGit: true });
    const mgr = createWorkspaceLeaseManager(makeDeps(git));
    const root = await mgr.acquireRootLease('/ws');
    const aRes = await mgr.acquireChildLease({ rootLease: root, runId: 'run-a', access: 'write' });
    const bRes = await mgr.acquireChildLease({ rootLease: root, runId: 'run-b', access: 'write' });
    const a = (aRes as { lease: WorkspaceLease }).lease;
    const b = (bRes as { lease: WorkspaceLease }).lease;
    // DISJOINT change sets — no overlap.
    git.diff = (path: string) =>
      path === a.cwd ? ['src/a.ts'] : path === b.cwd ? ['src/b.ts'] : [];

    const plan = await mgr.planIntegration([a, b]);

    assert.equal(plan.conflicts.length, 0, 'no overlap → no conflicts');
    assert.equal(plan.mergeable.length, 2, 'both non-overlapping writers are mergeable');
    // Stable order (createdAt then leaseId): a (created first) precedes b.
    assert.deepEqual(
      plan.mergeable.map((l) => l.leaseId),
      [a.leaseId, b.leaseId],
      'mergeable list is in stable order',
    );
    // Mergeable leases moved to pending_review.
    assert.equal(mgr.getLease(a.leaseId)?.status, 'pending_review', 'lease a awaiting review');
    assert.equal(mgr.getLease(b.leaseId)?.status, 'pending_review', 'lease b awaiting review');
    // Deterministic commit safety net: merge carries committed work only, so
    // planIntegration must commit each isolated writable worktree before it
    // reads diffs (a child that edited but never committed would otherwise
    // review empty and merge nothing — caught live 2026-07-12).
    assert.deepEqual(
      git.committed,
      [a.cwd, b.cwd],
      'planIntegration commits every isolated writable worktree before diffing',
    );
  },
);

// ===========================================================================
// (d) WI-005 — integrate merges only mergeable; a fake conflict → STOP, no overwrite.
// ===========================================================================

await check(
  'WI-005: integrate merges ONLY mergeable leases; a fake merge-conflict → conflicted, STOP, no silent overwrite',
  async () => {
    const git = makeFakeGit({ isGit: true });
    const mgr = createWorkspaceLeaseManager(makeDeps(git));
    const root = await mgr.acquireRootLease('/ws');
    const aRes = await mgr.acquireChildLease({ rootLease: root, runId: 'run-a', access: 'write' });
    const bRes = await mgr.acquireChildLease({ rootLease: root, runId: 'run-b', access: 'write' });
    const a = (aRes as { lease: WorkspaceLease }).lease;
    const b = (bRes as { lease: WorkspaceLease }).lease;
    // Disjoint paths so the plan deems both mergeable...
    git.diff = (path: string) =>
      path === a.cwd ? ['src/a.ts'] : path === b.cwd ? ['src/b.ts'] : [];
    const plan = await mgr.planIntegration([a, b]);
    assert.equal(plan.mergeable.length, 2, 'both planned mergeable');

    // ...but DEFENSIVELY script git.merge to report a conflict on the SECOND branch.
    const firstBranch = plan.mergeable[0]!.branch!;
    const secondBranch = plan.mergeable[1]!.branch!;
    git.merge = (branch: string): MergeResult => {
      git.mergedBranches.push(branch);
      return branch === secondBranch
        ? { ok: false, conflicts: ['src/b.ts'] }
        : { ok: true, conflicts: [] };
    };

    const result = await mgr.integrate(plan);

    // The first lease merged; integration STOPPED at the conflicting second lease.
    assert.equal(result.merged.length, 1, 'only the first (clean) lease merged');
    assert.equal(result.merged[0]!.branch, firstBranch, 'the first mergeable branch was merged');
    assert.ok(result.conflicted, 'the conflict is surfaced');
    assert.equal(
      result.conflicted!.lease.branch,
      secondBranch,
      'the conflicting lease is the second branch',
    );
    assert.deepEqual(
      result.conflicted!.conflicts,
      ['src/b.ts'],
      'the conflicting paths are surfaced',
    );
    // STOP: the merge loop did not attempt anything past the conflict (exactly the
    // two scripted attempts, no overwrite-and-continue).
    assert.deepEqual(
      git.mergedBranches,
      [firstBranch, secondBranch],
      'merge stopped at the conflict — no further merges',
    );
    assert.equal(
      mgr.getLease(result.conflicted!.lease.leaseId)?.status,
      'conflicted',
      'the conflicting lease is marked conflicted',
    );
  },
);

await check(
  'WI-005: integrate SKIPS a mergeable lease released between plan and integrate (no merge on a stale/removed worktree)',
  async () => {
    const git = makeFakeGit({ isGit: true });
    const mgr = createWorkspaceLeaseManager(makeDeps(git));
    const root = await mgr.acquireRootLease('/ws');
    const aRes = await mgr.acquireChildLease({ rootLease: root, runId: 'run-a', access: 'write' });
    const bRes = await mgr.acquireChildLease({ rootLease: root, runId: 'run-b', access: 'write' });
    const a = (aRes as { lease: WorkspaceLease }).lease;
    const b = (bRes as { lease: WorkspaceLease }).lease;
    // Disjoint → both planned mergeable.
    git.diff = (path: string) =>
      path === a.cwd ? ['src/a.ts'] : path === b.cwd ? ['src/b.ts'] : [];
    const plan = await mgr.planIntegration([a, b]);
    assert.equal(plan.mergeable.length, 2, 'both planned mergeable');

    // Between plan and integrate, lease A is RELEASED (e.g. its child aborted). Its
    // worktree is unchanged, so it is removed → status 'released'. The plan still
    // lists it as mergeable (a stale snapshot), but integrate must NOT merge it.
    const releasedA = await mgr.releaseLease(a.leaseId);
    assert.equal(releasedA.status, 'released', 'lease A was released before integrate');

    const result = await mgr.integrate(plan);

    // Only B merged; A was SKIPPED (its live status is no longer pending_review),
    // and git.merge was NEVER called for A's branch (no action on a removed worktree).
    assert.deepEqual(
      result.merged.map((l) => l.leaseId),
      [b.leaseId],
      'only the still-pending lease merged',
    );
    assert.equal(result.skipped.length, 1, 'the released lease was skipped, not merged');
    assert.equal(result.skipped[0]!.leaseId, a.leaseId, 'the skipped lease is the released one');
    assert.ok(
      /released|pending_review/i.test(result.skipped[0]!.reason),
      'skip reason explains the stale status',
    );
    assert.ok(
      !git.mergedBranches.includes(a.branch!),
      'git.merge was never called for the released lease',
    );
    assert.ok(
      git.mergedBranches.includes(b.branch!),
      'git.merge was called for the surviving lease',
    );
  },
);

await check(
  'snapshot: planIntegration / getLease return COPIES — a held reference does not mutate when the manager re-classifies',
  async () => {
    const git = makeFakeGit({ isGit: true });
    const mgr = createWorkspaceLeaseManager(makeDeps(git));
    const root = await mgr.acquireRootLease('/ws');
    const aRes = await mgr.acquireChildLease({ rootLease: root, runId: 'run-a', access: 'write' });
    const a = (aRes as { lease: WorkspaceLease }).lease;
    // The acquire result is a snapshot captured at 'active'.
    assert.equal(a.status, 'active', 'acquire returns an active snapshot');

    git.diff = (path: string) => (path === a.cwd ? ['src/a.ts'] : []);
    const plan = await mgr.planIntegration([a]);
    // The ORIGINAL captured reference must NOT have mutated to pending_review — it is
    // a decoupled copy. The plan's mergeable copy AND a fresh getLease show the new
    // live status.
    assert.equal(
      a.status,
      'active',
      'the originally-held snapshot did NOT mutate under the caller',
    );
    assert.equal(
      plan.mergeable[0]!.status,
      'pending_review',
      'the plan copy reflects the new status',
    );
    assert.equal(
      mgr.getLease(a.leaseId)?.status,
      'pending_review',
      'a fresh getLease reflects the live status',
    );

    // Mutating a returned snapshot must not corrupt the manager's internal state.
    const snap = mgr.getLease(a.leaseId)!;
    snap.status = 'released';
    snap.reason = 'tampered';
    assert.equal(
      mgr.getLease(a.leaseId)?.status,
      'pending_review',
      'tampering with a returned copy does not affect the manager',
    );
  },
);

// ===========================================================================
// (e) WI-006 — cleanup removes unchanged; abort RETAINS changed (not discarded).
// ===========================================================================

await check(
  'WI-006: releaseLease removes an UNCHANGED worktree; a CHANGED worktree on abort is RETAINED (not discarded) with a reason',
  async () => {
    const changed = new Map<string, string[]>();
    const git = makeFakeGit({ isGit: true, changedPaths: changed });
    const mgr = createWorkspaceLeaseManager(makeDeps(git));
    const root = await mgr.acquireRootLease('/ws');

    // Lease 1: an UNCHANGED worktree → released, worktree removed.
    const cleanRes = await mgr.acquireChildLease({
      rootLease: root,
      runId: 'run-clean',
      access: 'write',
    });
    const clean = (cleanRes as { lease: WorkspaceLease }).lease;
    // (no entry in `changed` for clean.cwd → worktreeChanged === false)
    const releasedClean = await mgr.releaseLease(clean.leaseId);
    assert.equal(releasedClean.status, 'released', 'an unchanged worktree is released');
    assert.ok(git.removed.includes(clean.cwd), 'the unchanged worktree was removed');
    assert.ok(!git.liveWorktrees.has(clean.cwd), 'the unchanged worktree no longer exists');

    // Lease 2: a CHANGED worktree aborted (no retain flag) → RETAINED, NOT removed.
    const dirtyRes = await mgr.acquireChildLease({
      rootLease: root,
      runId: 'run-dirty',
      access: 'write',
    });
    const dirty = (dirtyRes as { lease: WorkspaceLease }).lease;
    changed.set(dirty.cwd, ['src/work-in-progress.ts']); // it has uncommitted changes
    const releasedDirty = await mgr.releaseLease(dirty.leaseId); // abort cleanup, no retain
    assert.equal(
      releasedDirty.status,
      'pending_review',
      'a changed worktree on abort stays pending review, not discarded',
    );
    assert.ok(
      releasedDirty.reason && /retained|not discarded/i.test(releasedDirty.reason),
      'a reason is recorded',
    );
    assert.ok(
      !git.removed.includes(dirty.cwd),
      'the changed worktree was NOT removed (no silent discard)',
    );
    assert.ok(git.liveWorktrees.has(dirty.cwd), 'the changed worktree still exists for recovery');

    // Explicit retain on an UNCHANGED worktree also keeps it.
    const keepRes = await mgr.acquireChildLease({
      rootLease: root,
      runId: 'run-keep',
      access: 'write',
    });
    const keep = (keepRes as { lease: WorkspaceLease }).lease;
    const releasedKeep = await mgr.releaseLease(keep.leaseId, { retain: true });
    assert.equal(
      releasedKeep.status,
      'pending_review',
      'an explicit retain keeps the worktree for review',
    );
    assert.ok(
      !git.removed.includes(keep.cwd),
      'a retained worktree is not removed even when unchanged',
    );
  },
);

// ===========================================================================
// (f) WI-001 / §23.3 — non-Git workspace refuses a 2nd concurrent write (serial).
// ===========================================================================

await check(
  '§23.3: a non-Git workspace refuses a 2nd concurrent write lease (serialized); read/review still share the root',
  async () => {
    const git = makeFakeGit({ isGit: false }); // NON-Git workspace
    const mgr = createWorkspaceLeaseManager(makeDeps(git));
    const root = await mgr.acquireRootLease('/plain');

    // First write: granted, shares the root (no worktree on a non-Git workspace).
    const firstRes = await mgr.acquireChildLease({
      rootLease: root,
      runId: 'run-1',
      access: 'write',
    });
    assert.ok(granted(firstRes), 'the first write lease is granted');
    const first = (firstRes as { lease: WorkspaceLease }).lease;
    assert.equal(first.isolated, false, 'non-Git write lease has no worktree');
    assert.equal(first.cwd, '/plain', 'non-Git write lease shares the root cwd');
    assert.equal(git.createdBranches.length, 0, 'no worktree was created on a non-Git workspace');

    // Second CONCURRENT write: BLOCKED (serialized) while the first is active.
    const secondRes = await mgr.acquireChildLease({
      rootLease: root,
      runId: 'run-2',
      access: 'write',
    });
    assert.equal(
      secondRes.outcome,
      'blocked',
      '§23.3: a 2nd concurrent write on a non-Git workspace is blocked',
    );
    if (secondRes.outcome === 'blocked') {
      assert.equal(secondRes.blockedByRunId, 'run-1', 'the block names the active writer');
      assert.ok(/serial/i.test(secondRes.reason), 'the reason explains serialization');
    }

    // read / review still share the root concurrently (reads never block, §23.2).
    const readRes = await mgr.acquireChildLease({
      rootLease: root,
      runId: 'run-read',
      access: 'read',
    });
    const reviewRes = await mgr.acquireChildLease({
      rootLease: root,
      runId: 'run-review',
      access: 'review',
    });
    assert.ok(
      granted(readRes) && granted(reviewRes),
      'reads/reviews are granted even while a write is active',
    );

    // After the first writer releases, a new write is admitted (serialized, not lost).
    await mgr.releaseLease(first.leaseId);
    const thirdRes = await mgr.acquireChildLease({
      rootLease: root,
      runId: 'run-3',
      access: 'write',
    });
    assert.ok(granted(thirdRes), 'after the first writer releases, the next write is admitted');
  },
);

await check('P3: completed write enters pending_review, merges, then releases', async () => {
  const changed = new Map<string, string[]>();
  const git = makeFakeGit({ isGit: true, changedPaths: changed });
  const mgr = createWorkspaceLeaseManager(makeDeps(git));
  const root = await mgr.acquireRootLease('/ws');
  const result = await mgr.acquireChildLease({
    rootLease: root,
    runId: 'run-review',
    access: 'write',
  });
  const lease = (result as { lease: WorkspaceLease }).lease;
  changed.set(lease.cwd, ['src/review.ts']);
  const plan = await mgr.planIntegration([lease]);
  assert.equal(mgr.getLease(lease.leaseId)?.status, 'pending_review');
  const integrated = await mgr.integrate(plan);
  assert.equal(integrated.merged[0]?.status, 'merged');
  changed.delete(lease.cwd);
  const released = await mgr.releaseLease(lease.leaseId);
  assert.equal(released.status, 'released');
});

await check(
  'P3: discard force-removes a changed review worktree and records discarded',
  async () => {
    const changed = new Map<string, string[]>();
    const git = makeFakeGit({ isGit: true, changedPaths: changed });
    const mgr = createWorkspaceLeaseManager(makeDeps(git));
    const root = await mgr.acquireRootLease('/ws');
    const result = await mgr.acquireChildLease({
      rootLease: root,
      runId: 'run-discard',
      access: 'write',
    });
    const lease = (result as { lease: WorkspaceLease }).lease;
    changed.set(lease.cwd, ['src/discard.ts']);
    await mgr.planIntegration([lease]);
    const discarded = await mgr.releaseLease(lease.leaseId, { discard: true });
    assert.equal(discarded.status, 'discarded');
    assert.ok(git.removed.includes(lease.cwd));
  },
);

await check('P3: request changes adopts the same lease/worktree for a new run', async () => {
  const git = makeFakeGit({ isGit: true });
  const first = createWorkspaceLeaseManager(makeDeps(git));
  const root = await first.acquireRootLease('/ws');
  const result = await first.acquireChildLease({
    rootLease: root,
    runId: 'run-original',
    access: 'write',
  });
  const lease = (result as { lease: WorkspaceLease }).lease;
  await first.planIntegration([lease]);

  const resumed = createWorkspaceLeaseManager(makeDeps(git));
  const adopted = resumed.adoptLease({ ...lease, runId: 'run-rework', status: 'active' });
  assert.equal(adopted.leaseId, lease.leaseId);
  assert.equal(adopted.cwd, lease.cwd);
  assert.equal(adopted.runId, 'run-rework');
  const nextPlan = await resumed.planIntegration([adopted]);
  assert.equal(nextPlan.mergeable[0]?.status, 'pending_review');
});

await check('P3: durable lease adoption rejects an unrelated branch', async () => {
  const git = makeFakeGit({ isGit: true });
  const mgr = createWorkspaceLeaseManager(makeDeps(git));
  assert.throws(() =>
    mgr.adoptLease({
      leaseId: 'lease-0002',
      runId: 'run-rework',
      workspaceRoot: '/ws',
      access: 'write',
      cwd: '/ws/.offisim/worktrees/lease-0002',
      branch: 'main',
      isolated: true,
      status: 'active',
      createdAt: '2026-01-01T00:00:00.000Z',
    }),
  );
});

// ===========================================================================
// (g) Production adapter contract — the renderer git_exec binding satisfies the
// injected GitWorktreeOps shape (constructed, not invoked: no real Tauri call).
// ===========================================================================

await check(
  'renderer adapter: createTauriGitWorktreeOps satisfies the GitWorktreeOps contract',
  () => {
    const ops: GitWorktreeOps = createTauriGitWorktreeOps({ projectId: 'proj-1' });
    for (const method of [
      'isGitRepo',
      'addWorktree',
      'removeWorktree',
      'discardWorktree',
      'worktreeChanged',
      'diff',
      'diffText',
      'commitAll',
      'merge',
    ] as const) {
      assert.equal(typeof ops[method], 'function', `adapter exposes ${method}()`);
    }
    // The manager type-accepts the production adapter as its gitOps (compile-time
    // contract — this also proves the wiring shape the live M5 pass will use).
    const deps: WorkspaceLeaseManagerDeps = { gitOps: ops, now: () => 'now', newId: () => 'id' };
    assert.ok(
      createWorkspaceLeaseManager(deps),
      'the manager accepts the production adapter as gitOps',
    );
  },
);

await check('porcelain -z preserves spaces, Unicode, quotes, and leading whitespace', () => {
  assert.deepEqual(
    parsePorcelainV1ZPaths(
      '?? docs/file with space.md\0 M 中文/"quoted".md\0??  leading-space.md\0',
    ),
    ['docs/file with space.md', '中文/"quoted".md', ' leading-space.md'],
  );
});

await check('porcelain -z rename returns target and source for explicit staging', () => {
  assert.deepEqual(parsePorcelainV1ZPaths('R  new name.md\0old name.md\0'), [
    'new name.md',
    'old name.md',
  ]);
});

if (failed > 0) {
  console.error(`\nworkspace-lease: ${passed}/${TOTAL} passed (${failed} failed)`);
  process.exit(1);
}
console.log(`\nworkspace-lease: ${passed}/${TOTAL} passed`);
