/**
 * Workspace lease / isolated-parallel-write domain types (PRD §23, slice M5 —
 * WI-001..006).
 *
 * Multi-agent write isolation is a runtime STRATEGY, not a Mission requirement
 * (§23.1). The {@link WorkspaceLeaseManager} is DETERMINISTIC logic over an
 * INJECTED {@link GitWorktreeOps}: in production that interface wraps the
 * sandboxed `git_exec` Tauri command; in the harness it is a fake in-memory
 * git. The manager itself never touches node `fs` / `child_process` / `git` —
 * the §14.2 / §28 security boundary holds (the renderer must NOT directly
 * execute workspace files / shell / git; Rust/Tauri is the final boundary).
 *
 * §23.2 read parallelism is preserved: read + read / read + review / review +
 * review SHARE the root checkout read-only (no worktree). §23.3 isolation:
 * ONLY a WRITABLE child on a Git workspace gets an independent worktree +
 * branch. Conflicts surface at MERGE time → repair or human interaction; there
 * is NO silent overwrite, NO auto three-way merge, and NO general directory
 * copy in v1 (the §23.3 exclusions). A non-Git workspace serializes writes (one
 * writer at a time).
 *
 * Additive at M5 — pure types + logic; nothing in the live run loop wires this
 * yet. The deterministic logic + its harness are what M5 verifies.
 */

// ---------------------------------------------------------------------------
// Lease lifecycle.
// ---------------------------------------------------------------------------

/**
 * A lease's lifecycle status (WI-001).
 *
 * - `active` — held and in use (the root checkout, a read-only shared lease, or
 *   a live writable worktree).
 * - `pending_merge` — a writable child whose work is ready and awaiting the
 *   root/integration controller's merge decision (§23.3).
 * - `merged` — a writable child whose branch was merged into the root.
 * - `retained` — a worktree deliberately kept on cleanup because it had changes
 *   that must not be silently discarded (WI-006 data safety), or because the
 *   caller asked to retain it.
 * - `released` — cleaned up: the worktree (if any) was removed, the lease is done.
 * - `conflicted` — a writable child whose changes overlap another child's, or
 *   whose merge reported a conflict: it is NOT auto-merged; it goes to repair or
 *   human interaction (§23.3).
 */
export type WorkspaceLeaseStatus =
  | 'active'
  | 'pending_merge'
  | 'merged'
  | 'retained'
  | 'released'
  | 'conflicted';

/** The access band a child run holds over the workspace (§23.2 / §23.3). */
export type WorkspaceAccess = 'read' | 'write' | 'review';

/**
 * A workspace lease (WI-001). Either the integration/root lease (the main
 * checkout), a read-only shared lease over the root (read / review / non-Git
 * write), or an isolated writable worktree lease (Git + write).
 */
export interface WorkspaceLease {
  /** Stable lease id (minted via the injected `newId`). */
  leaseId: string;
  /** `root` for the integration lease; otherwise the owning child run's id. */
  runId: string;
  /** The workspace root path this lease was acquired against. */
  workspaceRoot: string;
  /** The access band — drives whether an isolated worktree is allocated. */
  access: WorkspaceAccess | 'root';
  /**
   * The cwd the owning session must use (WI-003). For a writable Git worktree
   * lease this is the worktree path; for a shared read-only lease (and the root
   * lease) it is the workspace root.
   */
  cwd: string;
  /**
   * The branch checked out in an isolated worktree (writable Git lease only);
   * `null` for shared / root leases (which sit on the root's current branch).
   */
  branch: string | null;
  /** Whether this lease owns an independent worktree (writable Git lease only). */
  isolated: boolean;
  status: WorkspaceLeaseStatus;
  /** When a lease is retained / conflicted, a human-readable reason. */
  reason?: string;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// GitWorktreeOps — the injected I/O surface.
// ---------------------------------------------------------------------------

/** The result of merging a child branch into the root (WI-005). */
export interface MergeResult {
  ok: boolean;
  /** Paths that conflicted when `ok` is false (empty on a clean merge). */
  conflicts: string[];
}

/**
 * The injected git surface the {@link WorkspaceLeaseManager} drives (WI-002,
 * WI-004, WI-005, WI-006). Production wires each method to the sandboxed
 * `git_exec` Tauri command (path-jailed, classifier-checked, redacted); the
 * harness fakes them in memory. The manager is pure deterministic logic over
 * this interface — it constructs no git access of its own.
 *
 * Every method is synchronous in signature here but may be backed by an async
 * adapter; the manager `await`s each, so an adapter MAY return a Promise. (The
 * declared return types are the resolved shapes for clarity.)
 */
export interface GitWorktreeOps {
  /** Whether `root` is a Git repository (decides worktree vs serial, §23.3). */
  isGitRepo(root: string): boolean | Promise<boolean>;
  /** Create a worktree at `path` on a new `branch` (WI-002). */
  addWorktree(branch: string, path: string): void | Promise<void>;
  /** Remove the worktree at `path` (WI-006 cleanup). */
  removeWorktree(path: string): void | Promise<void>;
  /** Whether the worktree at `path` has uncommitted/committed changes vs the root. */
  worktreeChanged(path: string): boolean | Promise<boolean>;
  /** The paths changed in the worktree at `path` (WI-004 diff/review evidence). */
  diff(path: string): string[] | Promise<string[]>;
  /** Merge `branch` into the root (WI-005). Reports conflicts; never overwrites. */
  merge(branch: string): MergeResult | Promise<MergeResult>;
}

// ---------------------------------------------------------------------------
// Acquire / release / diff / integration results.
// ---------------------------------------------------------------------------

/**
 * The outcome of {@link WorkspaceLeaseManager.acquireChildLease}. A `granted`
 * result carries the lease; a `blocked` result (a 2nd concurrent write lease on
 * a NON-Git workspace) carries no lease — the caller must serialize the write
 * (§23.3). Git workspaces never block: each writable child gets its own
 * worktree.
 */
export type AcquireChildResult =
  | { outcome: 'granted'; lease: WorkspaceLease }
  | { outcome: 'blocked'; reason: string; blockedByRunId: string };

/** The per-child diff a reviewer verifies (WI-004). */
export interface LeaseDiff {
  leaseId: string;
  runId: string;
  changedPaths: string[];
  /** An opaque reference a reviewer/UI can use to fetch the patch (the branch). */
  patchRef: string;
}

/** A merge-time conflict between two child leases over an overlapping path (WI-005). */
export interface IntegrationConflict {
  path: string;
  /** The ids of the leases that both changed this path. */
  leaseIds: string[];
}

/**
 * The integration plan (WI-005): the writable child leases that can be merged
 * cleanly (non-overlapping), in a deterministic order, plus the conflicts that
 * must NOT be auto-merged. The manager returns the plan; the root/integration
 * controller (or a human) decides whether to {@link WorkspaceLeaseManager.integrate}
 * it (§23.3).
 */
export interface IntegrationPlan {
  /** Non-overlapping writable leases, in a stable merge order. */
  mergeable: WorkspaceLease[];
  /** Overlapping paths and the lease ids that conflict on them. */
  conflicts: IntegrationConflict[];
  /**
   * The lease ids marked `conflicted` (those in `conflicts`). Surfaced so the
   * caller can route them to repair / human interaction without re-deriving.
   */
  conflictedLeaseIds: string[];
}

/** The outcome of {@link WorkspaceLeaseManager.integrate} (WI-005). */
export interface IntegrationResult {
  /** Leases successfully merged into the root, in the order they were merged. */
  merged: WorkspaceLease[];
  /**
   * Mergeable leases that were SKIPPED at integrate time because their live status
   * was no longer `pending_merge` (e.g. the child aborted / was released, or was
   * re-classified conflicted, between planIntegration and integrate). They are
   * NEVER merged — merging a released worktree would act on a removed checkout.
   * Surfaced so the caller sees the plan's mergeable set was narrowed.
   */
  skipped: Array<{ leaseId: string; reason: string }>;
  /**
   * If a merge unexpectedly reported a conflict (it shouldn't for non-overlapping
   * leases, but the manager is defensive), the offending lease and its conflicts.
   * Integration STOPS at the first such conflict — nothing is overwritten.
   */
  conflicted: { lease: WorkspaceLease; conflicts: string[] } | null;
}
