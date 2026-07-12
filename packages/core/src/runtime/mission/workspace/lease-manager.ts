/**
 * WorkspaceLeaseManager (PRD §23.3, slice M5 — WI-001..006).
 *
 * Deterministic logic over an INJECTED {@link GitWorktreeOps} (production wraps
 * the sandboxed `git_exec`; the harness fakes it). It decides — per the §23
 * rules — when a child run shares the root read-only and when it gets an
 * isolated worktree + branch, tracks the active lease set, surfaces per-child
 * diffs for review, plans integration so OVERLAPPING writes become conflicts
 * (never an auto three-way merge), merges only the non-overlapping leases, and
 * cleans up worktrees without ever silently discarding changed work.
 *
 *   §23.2 read parallelism: read+read / read+review / review+review SHARE the
 *     root read-only — no worktree.
 *   §23.3 write isolation: ONLY a writable child on a GIT workspace gets its
 *     own worktree+branch (distinct cwd). A non-Git workspace serializes writes
 *     (a 2nd concurrent write lease is blocked, not silently parallelized).
 *   §23.3 v1 exclusions: NO auto three-way merge, NO general directory copy.
 *     Conflicts surface for repair / human interaction; never a silent overwrite.
 *
 * Determinism: `now` and `newId` are injected (no `Date.now()` / `Math.random()`),
 * so a run is byte-stable. Additive at M5 — nothing in the live loop wires this;
 * the deterministic logic + the harness are the M5 verification surface.
 */

import type {
  AcquireChildResult,
  GitWorktreeOps,
  IntegrationConflict,
  IntegrationPlan,
  IntegrationResult,
  LeaseDiff,
  WorkspaceAccess,
  WorkspaceLease,
} from './types.js';

export interface WorkspaceLeaseManagerDeps {
  /** The injected git surface (production = git_exec adapter; harness = fake). */
  gitOps: GitWorktreeOps;
  /** Injected clock (determinism — no `Date.now()`). */
  now: () => string;
  /** Injected id minter (determinism — no `Math.random()` / `crypto.randomUUID`). */
  newId: () => string;
}

export interface AcquireChildLeaseInput {
  /** The integration/root lease this child works under (from {@link acquireRootLease}). */
  rootLease: WorkspaceLease;
  /** The owning child run's id (also the lease's `runId`). */
  runId: string;
  /** The child's access band (§23.2 / §23.3). */
  access: WorkspaceAccess;
}

export interface ReleaseLeaseOptions {
  /**
   * Force-retain the worktree even if it is unchanged (e.g. the caller wants to
   * keep it for inspection). Default false: an unchanged worktree is removed.
   */
  retain?: boolean;
  /** Explicit review decision: remove the worktree even when it has changes. */
  discard?: boolean;
}

export interface WorkspaceLeaseManager {
  /** Acquire the integration/root lease over the main checkout (WI-001). */
  acquireRootLease(workspaceRoot: string): Promise<WorkspaceLease>;
  /**
   * Acquire a child lease (WI-002/003). A WRITABLE child on a Git workspace gets
   * an isolated worktree + branch (distinct cwd). A read/review child, OR any
   * child on a non-Git workspace, shares the root read-only. A 2nd concurrent
   * write on a non-Git workspace is BLOCKED (serialized, §23.3).
   */
  acquireChildLease(input: AcquireChildLeaseInput): Promise<AcquireChildResult>;
  /** Adopt a durable pending-review worktree into a fresh host for review/rework. */
  adoptLease(lease: WorkspaceLease): WorkspaceLease;
  /** Collect the per-child diff a reviewer verifies (WI-004). */
  collectDiff(lease: WorkspaceLease): Promise<LeaseDiff>;
  /**
   * Plan integration over a set of child leases (WI-005): overlapping writes →
   * conflicts (those leases go `conflicted`, NOT merged); non-overlapping →
   * mergeable, in a stable order. Returns the plan — does NOT merge. The plan's
   * `mergeable` leases are SNAPSHOT COPIES (status `pending_review`); integrate()
   * re-reads the live status before merging each one.
   */
  planIntegration(childLeases: WorkspaceLease[]): Promise<IntegrationPlan>;
  /**
   * Execute a plan (WI-005): merge ONLY the `mergeable` leases whose LIVE status is
   * still `pending_review`, in order. A lease that was released/aborted/re-classified
   * between plan and integrate is SKIPPED (recorded in `result.skipped`), never
   * merged. If a merge reports a conflict (defensive — it shouldn't for
   * non-overlapping leases), mark the lease `conflicted`, STOP, and surface it.
   * Never a silent overwrite.
   */
  integrate(plan: IntegrationPlan): Promise<IntegrationResult>;
  /**
   * Release a lease (WI-006). Removes an UNCHANGED worktree (or one the caller
   * asks to `retain`); a CHANGED worktree that is not retained is kept and the
   * lease marked `pending_review` with a reason — never silently discarded. Returns a
   * snapshot copy of the released lease.
   */
  releaseLease(leaseId: string, options?: ReleaseLeaseOptions): Promise<WorkspaceLease>;
  /** Snapshot COPIES of every tracked lease (root + children) at call time. */
  listLeases(): WorkspaceLease[];
  /** A snapshot COPY of a tracked lease by id, or null. */
  getLease(leaseId: string): WorkspaceLease | null;
}

/** A tracked lease is `active` and counts toward concurrency limits. */
const ACTIVE_WRITE_STATUSES: ReadonlySet<string> = new Set(['active', 'pending_review']);

export function createWorkspaceLeaseManager(
  deps: WorkspaceLeaseManagerDeps,
): WorkspaceLeaseManager {
  const { gitOps, now, newId } = deps;

  /** The tracked lease set, keyed by leaseId (insertion order preserved). */
  const leases = new Map<string, WorkspaceLease>();
  /** Cache `isGitRepo(root)` per root so a manager makes one decision per workspace. */
  const gitRepoByRoot = new Map<string, boolean>();

  async function rootIsGit(workspaceRoot: string): Promise<boolean> {
    const cached = gitRepoByRoot.get(workspaceRoot);
    if (cached !== undefined) return cached;
    const result = await gitOps.isGitRepo(workspaceRoot);
    gitRepoByRoot.set(workspaceRoot, result);
    return result;
  }

  function track(lease: WorkspaceLease): WorkspaceLease {
    leases.set(lease.leaseId, lease);
    return lease;
  }

  /**
   * A shallow COPY of a lease for a public output. The manager mutates its OWN
   * internal Map entries (status → conflicted / pending_review / merged / discarded
   * / released); callers must never hold a live reference that mutates under them
   * (they would observe a "snapshot" silently change). Every public boundary
   * (acquireChildLease, getLease, listLeases, planIntegration's mergeable,
   * integrate's merged/conflicted, releaseLease) returns copies; a caller re-reads
   * current status via getLease. `WorkspaceLease` is flat (no nested objects), so
   * a spread is a complete, decoupled snapshot.
   */
  function snapshot(lease: WorkspaceLease): WorkspaceLease {
    return { ...lease };
  }

  async function acquireRootLease(workspaceRoot: string): Promise<WorkspaceLease> {
    // Resolve git-ness eagerly so the cache is warm for child decisions, and so
    // a non-Git root never silently behaves like a Git one.
    await rootIsGit(workspaceRoot);
    return snapshot(
      track({
        leaseId: newId(),
        runId: 'root',
        workspaceRoot,
        access: 'root',
        cwd: workspaceRoot,
        branch: null,
        isolated: false,
        status: 'active',
        createdAt: now(),
      }),
    );
  }

  async function acquireChildLease(input: AcquireChildLeaseInput): Promise<AcquireChildResult> {
    const { rootLease, runId, access } = input;
    const workspaceRoot = rootLease.workspaceRoot;
    const isGit = await rootIsGit(workspaceRoot);

    // §23.2: read / review SHARE the root read-only (no worktree), on Git or not.
    if (access === 'read' || access === 'review') {
      return {
        outcome: 'granted',
        lease: snapshot(sharedReadOnlyLease(workspaceRoot, runId, access)),
      };
    }

    // access === 'write' from here.
    if (!isGit) {
      // §23.3: a non-Git workspace serializes writes — at most one active write
      // lease at a time. A 2nd concurrent write is BLOCKED (the caller queues it),
      // never silently parallelized onto a shared cwd (which would collide).
      const existingWriter = activeWriteLease();
      if (existingWriter) {
        return {
          outcome: 'blocked',
          reason:
            'non-Git workspace serializes writes: another write lease is active (§23.3) — queue this write until it releases',
          blockedByRunId: existingWriter.runId,
        };
      }
      // The single permitted serial writer shares the root cwd (no worktree).
      return {
        outcome: 'granted',
        lease: snapshot(
          track({
            leaseId: newId(),
            runId,
            workspaceRoot,
            access,
            cwd: workspaceRoot,
            branch: null,
            isolated: false,
            status: 'active',
            createdAt: now(),
          }),
        ),
      };
    }

    // §23.3: Git + write → an ISOLATED worktree + branch with a DISTINCT cwd, so
    // two writable children can never collide on the filesystem.
    const leaseId = newId();
    const branch = branchFor(runId, leaseId);
    const worktreePath = worktreePathFor(workspaceRoot, leaseId);
    await gitOps.addWorktree(branch, worktreePath);
    return {
      outcome: 'granted',
      lease: snapshot(
        track({
          leaseId,
          runId,
          workspaceRoot,
          access,
          cwd: worktreePath,
          branch,
          isolated: true,
          status: 'active',
          createdAt: now(),
        }),
      ),
    };
  }

  /**
   * A non-isolated read-only lease over the root (read / review children).
   *
   * DEFENSIVE: this must never mint a `write` lease — a writable child on a Git
   * workspace requires an ISOLATED worktree (§23.3), and a non-Git writer goes
   * through the serial gate, not here. Throwing guards against a future refactor
   * routing `write` through this un-isolated path (which would let two writers
   * collide on the shared root cwd).
   */
  function sharedReadOnlyLease(
    workspaceRoot: string,
    runId: string,
    access: WorkspaceAccess,
  ): WorkspaceLease {
    if (access === 'write') {
      throw new Error(
        'sharedReadOnlyLease must not be used for a write lease — writers get an isolated worktree (Git) or the serial gate (non-Git), §23.3',
      );
    }
    return track({
      leaseId: newId(),
      runId,
      workspaceRoot,
      access,
      cwd: workspaceRoot,
      branch: null,
      isolated: false,
      status: 'active',
      createdAt: now(),
    });
  }

  /** The active WRITABLE lease (for the non-Git serial gate), or null. */
  function activeWriteLease(): WorkspaceLease | null {
    for (const lease of leases.values()) {
      if (lease.access === 'write' && ACTIVE_WRITE_STATUSES.has(lease.status)) return lease;
    }
    return null;
  }

  async function collectDiff(lease: WorkspaceLease): Promise<LeaseDiff> {
    // A shared (non-isolated) lease has no independent worktree to diff — its
    // changed paths come from the root checkout itself. We still report through
    // the same shape so a reviewer treats every writer uniformly.
    const changedPaths = lease.isolated
      ? await gitOps.diff(lease.cwd)
      : await gitOps.diff(lease.workspaceRoot);
    const cwd = lease.isolated ? lease.cwd : lease.workspaceRoot;
    const files = await Promise.all(
      changedPaths.map(async (path) => ({ path, diff: await gitOps.diffText(cwd, path) })),
    );
    return {
      leaseId: lease.leaseId,
      runId: lease.runId,
      changedPaths,
      files,
      patchRef: lease.branch ?? lease.workspaceRoot,
    };
  }

  function adoptLease(input: WorkspaceLease): WorkspaceLease {
    if (input.access !== 'write' || !input.isolated || !input.branch) {
      throw new Error('Only an isolated writable lease can be adopted.');
    }
    if (
      !input.branch.startsWith('offisim/lease/') ||
      !input.branch.endsWith(`-${sanitizeRef(input.leaseId)}`)
    ) {
      throw new Error(`Lease branch does not match its Offisim lease id: ${input.leaseId}`);
    }
    const expectedCwd = worktreePathFor(input.workspaceRoot, input.leaseId);
    if (input.cwd !== expectedCwd) {
      throw new Error(`Lease cwd does not match its jailed worktree path: ${input.leaseId}`);
    }
    const adopted: WorkspaceLease = {
      ...input,
      status: input.status === 'active' ? 'active' : 'pending_review',
    };
    track(adopted);
    return snapshot(adopted);
  }

  async function planIntegration(childLeases: WorkspaceLease[]): Promise<IntegrationPlan> {
    // Only WRITABLE leases integrate — read/review leases produce nothing to merge.
    const writable = childLeases.filter((l) => l.access === 'write');

    // Merge carries COMMITTED work only, and the overlap detection below reads
    // committed diffs. A child is instructed to commit its own work, but that is
    // model behavior, not a guarantee — deterministically commit any uncommitted
    // remainder first so review, overlap detection, and merge all see the same
    // complete change set. Only isolated worktrees: a non-isolated write lease
    // edits the user's root checkout, which is never auto-committed.
    for (const lease of writable) {
      if (!lease.isolated) continue;
      await gitOps.commitAll(lease.cwd, `offisim: delegated work (${lease.runId})`);
    }

    // Compute each writable lease's changed paths once.
    const changedByLease = new Map<string, Set<string>>();
    for (const lease of writable) {
      const diff = await collectDiff(lease);
      changedByLease.set(lease.leaseId, new Set(diff.changedPaths));
    }

    // Find every path two-or-more writable leases both touched → a conflict.
    const leasesByPath = new Map<string, string[]>();
    for (const lease of writable) {
      for (const path of changedByLease.get(lease.leaseId) ?? []) {
        const owners = leasesByPath.get(path) ?? [];
        owners.push(lease.leaseId);
        leasesByPath.set(path, owners);
      }
    }

    const conflicts: IntegrationConflict[] = [];
    const conflictedLeaseIds = new Set<string>();
    // Deterministic order: sort conflict entries by path.
    for (const path of [...leasesByPath.keys()].sort()) {
      const owners = leasesByPath.get(path) ?? [];
      if (owners.length >= 2) {
        const sortedOwners = [...owners].sort();
        conflicts.push({ path, leaseIds: sortedOwners });
        for (const id of sortedOwners) conflictedLeaseIds.add(id);
      }
    }

    // Mergeable order: writable leases with NO conflicting path, in a stable order
    // (by createdAt then leaseId — both injected/deterministic, and both immutable,
    // so sorting the caller's snapshots is sound). The input `childLeases` may be
    // stale snapshots; resolve each to the manager's LIVE Map entry below for the
    // status mutation + the returned copy, so the plan never reflects a stale status.
    const mergeableOrdered = writable
      .filter((l) => !conflictedLeaseIds.has(l.leaseId))
      .sort(byStableOrder);

    // Conflicted leases are marked `conflicted` on the manager's OWN Map entry and
    // routed to repair/human (§23.3), never auto-merged.
    for (const id of conflictedLeaseIds) {
      const lease = leases.get(id);
      if (lease) {
        lease.status = 'conflicted';
        lease.reason =
          'overlapping write with another child lease — routed to repair/human, not auto-merged (§23.3)';
      }
    }
    // A clean mergeable lease moves to pending_review so its state reflects that it
    // is awaiting the integration controller's decision. Mutate the LIVE Map entry,
    // then return a SNAPSHOT of it — the plan a caller holds is a decoupled copy
    // (status === 'pending_review'); the caller re-reads live status via getLease,
    // and integrate() re-checks the live Map entry before merging.
    const mergeableSnapshots: WorkspaceLease[] = [];
    for (const ordered of mergeableOrdered) {
      const live = leases.get(ordered.leaseId);
      if (!live) continue; // untracked (shouldn't happen for a writable lease) — drop it.
      if (live.status === 'active') live.status = 'pending_review';
      mergeableSnapshots.push(snapshot(live));
    }

    return {
      mergeable: mergeableSnapshots,
      conflicts,
      conflictedLeaseIds: [...conflictedLeaseIds],
    };
  }

  async function integrate(plan: IntegrationPlan): Promise<IntegrationResult> {
    const merged: WorkspaceLease[] = [];
    const skipped: Array<{ leaseId: string; reason: string }> = [];
    for (const planned of plan.mergeable) {
      // Re-resolve the LIVE Map entry — the plan carries a decoupled snapshot, and
      // a lease can have changed between planIntegration and integrate (the child
      // aborted/was released → 'released', or was re-classified 'conflicted'). Merge
      // ONLY a lease whose CURRENT status is still 'pending_review'; anything else is
      // skipped, never merged (merging a released worktree acts on a removed
      // checkout — silent corruption).
      const lease = leases.get(planned.leaseId);
      if (!lease) {
        skipped.push({
          leaseId: planned.leaseId,
          reason: 'lease no longer tracked by the manager',
        });
        continue;
      }
      if (lease.status !== 'pending_review') {
        skipped.push({
          leaseId: lease.leaseId,
          reason: `lease status is '${lease.status}', not 'pending_review' — released/aborted/conflicted between plan and integrate; not merged`,
        });
        continue;
      }

      const branch = lease.branch;
      if (!branch) {
        // A non-isolated writable lease (the non-Git serial writer) has no branch
        // to merge — its work already lives in the root checkout. Mark it merged
        // (its changes are already integrated) and continue.
        lease.status = 'merged';
        merged.push(snapshot(lease));
        continue;
      }
      const result = await gitOps.merge(branch);
      if (!result.ok) {
        // DEFENSIVE: planIntegration excludes overlapping leases, so a clean merge
        // is expected. If git still reports a conflict, never overwrite — mark the
        // lease conflicted, STOP, and surface it for repair/human (§23.3).
        lease.status = 'conflicted';
        lease.reason = `merge reported a conflict on [${result.conflicts.join(', ')}] — not overwritten (§23.3)`;
        return {
          merged,
          skipped,
          conflicted: { lease: snapshot(lease), conflicts: result.conflicts },
        };
      }
      lease.status = 'merged';
      merged.push(snapshot(lease));
    }
    return { merged, skipped, conflicted: null };
  }

  async function releaseLease(
    leaseId: string,
    options: ReleaseLeaseOptions = {},
  ): Promise<WorkspaceLease> {
    const lease = leases.get(leaseId);
    if (!lease) {
      throw new Error(`Unknown workspace lease '${leaseId}'`);
    }

    // A non-isolated lease (root, read/review, non-Git writer) owns no worktree to
    // remove — releasing it just marks it released. (Return a snapshot — the caller
    // must not hold a live reference that mutates under them.)
    if (!lease.isolated) {
      lease.status = 'released';
      return snapshot(lease);
    }

    const retain = options.retain === true;
    const discard = options.discard === true;

    if (discard) {
      await gitOps.discardWorktree(lease.cwd);
      lease.status = 'discarded';
      lease.reason = 'discarded by user after diff review';
      return snapshot(lease);
    }
    const changed = await gitOps.worktreeChanged(lease.cwd);

    if (changed && !retain) {
      // WI-006 DATA SAFETY: a changed worktree is NEVER silently discarded on
      // cleanup. Default policy = retain it and mark `retained` with a reason so
      // the changes survive for inspection / manual recovery.
      lease.status = 'pending_review';
      lease.reason =
        'worktree had uncommitted changes at cleanup — retained (not discarded) for recovery (§23.3 WI-006)';
      return snapshot(lease);
    }

    if (retain) {
      // Explicit retain: keep the worktree, mark retained with the caller's intent.
      lease.status = 'pending_review';
      lease.reason = lease.reason ?? 'retained by caller request';
      return snapshot(lease);
    }

    // Unchanged + not retained → safe to remove the worktree and release.
    await gitOps.removeWorktree(lease.cwd);
    lease.status = 'released';
    return snapshot(lease);
  }

  function byStableOrder(a: WorkspaceLease, b: WorkspaceLease): number {
    if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? -1 : 1;
    return a.leaseId < b.leaseId ? -1 : a.leaseId > b.leaseId ? 1 : 0;
  }

  function branchFor(runId: string, leaseId: string): string {
    return `offisim/lease/${sanitizeRef(runId)}-${sanitizeRef(leaseId)}`;
  }

  function worktreePathFor(workspaceRoot: string, leaseId: string): string {
    // Isolated worktrees live under a dedicated, jailed subdir of the workspace
    // (the same `.offisim/tmp` convention git_exec already permits for clones).
    const base = workspaceRoot.endsWith('/') ? workspaceRoot.slice(0, -1) : workspaceRoot;
    return `${base}/.offisim/worktrees/${sanitizeRef(leaseId)}`;
  }

  return {
    acquireRootLease,
    acquireChildLease,
    adoptLease,
    collectDiff,
    planIntegration,
    integrate,
    releaseLease,
    // Public reads return SNAPSHOT COPIES — the manager keeps mutating its own
    // internal Map entries; a caller re-reads current status via getLease.
    listLeases: () => [...leases.values()].map(snapshot),
    getLease: (id: string) => {
      const lease = leases.get(id);
      return lease ? snapshot(lease) : null;
    },
  };
}

/**
 * Sanitize an id for use in a git ref / path segment: keep word chars, dot, and
 * dash; replace everything else with `-`. Pure + deterministic (no I/O).
 */
function sanitizeRef(value: string): string {
  return value.replace(/[^A-Za-z0-9._-]/g, '-');
}
