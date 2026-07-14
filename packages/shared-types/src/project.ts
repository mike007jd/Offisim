export type ProjectStatus = 'planning' | 'active' | 'paused' | 'completed' | 'archived';
export type ProjectAssignmentRole = 'member' | 'lead';
type SemanticTitleJobStatus = 'running' | 'completed' | 'failed' | 'cancelled';

export const ACTIVE_PROJECT_STATUSES: readonly ProjectStatus[] = [
  'planning',
  'active',
  'paused',
] as const;
export const COMPLETED_PROJECT_STATUSES: readonly ProjectStatus[] = [
  'completed',
  'archived',
] as const;

export interface ProjectRow {
  project_id: string;
  company_id: string;
  name: string;
  description: string | null;
  status: ProjectStatus;
  workspace_root: string;
  /** Project-owned gate for delegated write loops. Null means single-pass. */
  verify_command: string | null;
  /** Maximum child edit/verify attempts when a gate is configured. */
  verify_max_attempts: number;
  /** Optional per-child token cap; null uses the run-tree budget only. */
  verify_token_budget: number | null;
  created_at: string;
  updated_at: string;
}

export type NewProject = Omit<
  ProjectRow,
  'created_at' | 'updated_at' | 'verify_command' | 'verify_max_attempts' | 'verify_token_budget'
> &
  Partial<Pick<ProjectRow, 'verify_command' | 'verify_max_attempts' | 'verify_token_budget'>>;

/** Patch shape for `ProjectRepository.update`. A Project always remains folder-backed. */
export type ProjectUpdatePatch = Partial<
  Pick<
    ProjectRow,
    | 'name'
    | 'description'
    | 'status'
    | 'workspace_root'
    | 'verify_command'
    | 'verify_max_attempts'
    | 'verify_token_budget'
  >
>;

export interface ProjectAssignmentRow {
  assignment_id: string;
  project_id: string;
  employee_id: string;
  role: ProjectAssignmentRole;
  assigned_at: string;
}

export type NewProjectAssignment = Omit<ProjectAssignmentRow, 'assigned_at'>;

/**
 * Product-layer chat thread metadata. Decoupled from `graph_threads` (runtime
 * thread) on purpose — one chat thread backs many runtime threads (one per
 * `<projectId>::<threadId>::<employeeId?>` conversationKey: team chat + each
 * direct-chat target).
 */
export interface ChatThread {
  thread_id: string;
  project_id: string;
  /** Null = team/project thread; set = direct employee thread. */
  employee_id: string | null;
  title: string;
  /** 1 = user-set (sticky against boss-driven retitle); 0 = system-set. */
  title_set_by_user: 0 | 1;
  /** At-most-once background semantic-title ledger. This is audit/job state,
   * not a second title ownership lock; `title_set_by_user` remains authoritative. */
  semantic_title_job_id: string | null;
  semantic_title_status: SemanticTitleJobStatus | null;
  semantic_title_source_provenance_json: string | null;
  semantic_title_result_provenance_json: string | null;
  semantic_title_usage_json: string | null;
  semantic_title_error_code: string | null;
  summary: string | null;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * Insert shape for `chat_threads`. `title` is optional (defaults to
 * `'New thread'`); the timestamps + stickiness flag + nullable metadata
 * are filled in by the repo.
 */
export interface NewChatThread {
  thread_id: string;
  project_id: string;
  employee_id?: string | null;
  title?: string;
}

/**
 * Trim a nullable string and coerce empty / whitespace-only results to `null`.
 * Used by nullable text fields such as Project descriptions and verify commands.
 */
export function trimToNull(value: string | null | undefined): string | null {
  if (value == null) return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/** Enforce the product invariant that every Project is backed by one folder. */
export function requireProjectWorkspaceRoot(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) throw new Error('Project workspace folder is required.');
  return trimmed;
}

const HINT_TARGET_LENGTH = 32;
const HINT_HEAD_TAIL = 14;

/**
 * Mid-truncated hint for a workspace_root path. Tolerates null for callers that
 * have no active Project; preserves head + tail when path exceeds ~32 chars so the
 * user can still see the leaf directory name.
 */
export function formatWorkspaceRootHint(root: string | null | undefined): string {
  if (root == null) return 'No folder bound';
  const trimmed = root.trim();
  if (!trimmed) return 'No folder bound';
  if (trimmed.length <= HINT_TARGET_LENGTH) return trimmed;
  const head = trimmed.slice(0, HINT_HEAD_TAIL);
  const tail = trimmed.slice(-HINT_HEAD_TAIL);
  return `${head}…${tail}`;
}
