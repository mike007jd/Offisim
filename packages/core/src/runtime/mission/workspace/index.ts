/**
 * Isolated Parallel Write barrel (PRD §23, slice M5 — WI-001..006).
 *
 * Re-exported from `@offisim/core/browser` so the renderer git-worktree adapter
 * + the harness consume the deterministic WorkspaceLeaseManager through the
 * public entry. Every piece is pure logic over an injected {@link GitWorktreeOps}
 * (production wraps the sandboxed `git_exec`; the harness fakes it) — no node fs
 * / shell / git here. The live wiring + the `.app` worktree path are a later
 * M-pass; this slice is the logic + its harness.
 */

// WI-001..006 — WorkspaceLeaseManager.
export { createWorkspaceLeaseManager } from './lease-manager.js';
export {
  createWorkspaceCheckpointManager,
  isCheckpointCandidateTool,
} from './checkpoint-manager.js';
export type {
  WorkspaceLeaseManager,
  WorkspaceLeaseManagerDeps,
  AcquireChildLeaseInput,
  ReleaseLeaseOptions,
} from './lease-manager.js';
export type {
  WorkspaceCheckpointManager,
  WorkspaceCheckpointManagerDeps,
  WorkspaceCheckpointTrigger,
} from './checkpoint-manager.js';

// Domain types.
export type {
  WorkspaceLease,
  WorkspaceLeaseStatus,
  WorkspaceAccess,
  GitWorktreeOps,
  MergeResult,
  AcquireChildResult,
  LeaseDiff,
  IntegrationConflict,
  IntegrationPlan,
  IntegrationResult,
  WorkspaceCheckpoint,
  WorkspaceCheckpointRollback,
  CreateWorkspaceCheckpointInput,
} from './types.js';
