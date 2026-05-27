export type ProjectStatus = 'planning' | 'active' | 'paused' | 'completed' | 'archived';
export type ProjectAssignmentRole = 'member' | 'lead';

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
  workspace_root: string | null;
  created_at: string;
  updated_at: string;
}

export type NewProject = Omit<ProjectRow, 'created_at' | 'updated_at'>;

/** Patch shape for `ProjectRepository.update`. Explicit `null` unbinds. */
export type ProjectUpdatePatch = Partial<
  Pick<ProjectRow, 'name' | 'description' | 'status' | 'workspace_root'>
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
 * Used by Project create / edit flows to normalize description + workspace_root
 * so the database never holds empty strings as "set" values.
 */
export function trimToNull(value: string | null | undefined): string | null {
  if (value == null) return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

const HINT_TARGET_LENGTH = 32;
const HINT_HEAD_TAIL = 14;

/**
 * Mid-truncated hint for a workspace_root path. Returns "No folder bound"
 * when null/empty; preserves head + tail when path exceeds ~32 chars so the
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
