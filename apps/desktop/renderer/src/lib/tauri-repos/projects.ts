import { generateId } from '@offisim/core/browser';
import type {
  ChatThreadRepository,
  ProjectRepository,
  RuntimeRepositories,
} from '@offisim/core/browser';
import * as schema from '@offisim/db-local';
import { ACTIVE_PROJECT_STATUSES } from '@offisim/shared-types';
import type {
  ChatThread,
  NewChatThread,
  NewProject,
  NewProjectAssignment,
  ProjectAssignmentRow,
  ProjectRow,
  ProjectStatus,
} from '@offisim/shared-types';
import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import type { TauriDrizzleDb } from '../tauri-drizzle';

function now(): string {
  return new Date().toISOString();
}

interface ChatThreadDbRow {
  thread_id: string;
  project_id: string;
  employee_id: string | null;
  title: string;
  title_set_by_user: number;
  semantic_title_job_id: string | null;
  semantic_title_status: ChatThread['semantic_title_status'];
  semantic_title_source_provenance_json: string | null;
  semantic_title_result_provenance_json: string | null;
  semantic_title_usage_json: string | null;
  semantic_title_error_code: string | null;
  summary: string | null;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
}

function chatThreadFromDbRow(row: ChatThreadDbRow): ChatThread {
  return {
    thread_id: row.thread_id,
    project_id: row.project_id,
    employee_id: row.employee_id,
    title: row.title,
    title_set_by_user: row.title_set_by_user === 1 ? 1 : 0,
    semantic_title_job_id: row.semantic_title_job_id,
    semantic_title_status: row.semantic_title_status,
    semantic_title_source_provenance_json: row.semantic_title_source_provenance_json,
    semantic_title_result_provenance_json: row.semantic_title_result_provenance_json,
    semantic_title_usage_json: row.semantic_title_usage_json,
    semantic_title_error_code: row.semantic_title_error_code,
    summary: row.summary,
    archived_at: row.archived_at,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export interface ProjectsTauriRepos {
  projects: ProjectRepository;
  projectAssignments: RuntimeRepositories['projectAssignments'];
  chatThreads: ChatThreadRepository;
}

export function createProjectsTauriRepos(db: TauriDrizzleDb): ProjectsTauriRepos {
  const projects: ProjectRepository = {
    async create(p: NewProject) {
      const row: ProjectRow = {
        ...p,
        verify_command: p.verify_command ?? null,
        verify_max_attempts: p.verify_max_attempts ?? 3,
        verify_token_budget: p.verify_token_budget ?? null,
        created_at: now(),
        updated_at: now(),
      };
      await db.insert(schema.projects).values(row);
      return row;
    },
    async findById(projectId) {
      const rows = await db
        .select()
        .from(schema.projects)
        .where(eq(schema.projects.project_id, projectId));
      return (rows[0] as ProjectRow | undefined) ?? null;
    },
    async findByCompany(companyId) {
      return (await db
        .select()
        .from(schema.projects)
        .where(eq(schema.projects.company_id, companyId))
        .orderBy(desc(schema.projects.updated_at))) as ProjectRow[];
    },
    async findActiveByCompany(companyId) {
      return (await db
        .select()
        .from(schema.projects)
        .where(
          and(
            eq(schema.projects.company_id, companyId),
            inArray(schema.projects.status, [...ACTIVE_PROJECT_STATUSES]),
          ),
        )
        .orderBy(desc(schema.projects.updated_at))) as ProjectRow[];
    },
    async updateStatus(projectId, status: ProjectStatus) {
      await db
        .update(schema.projects)
        .set({ status, updated_at: now() })
        .where(eq(schema.projects.project_id, projectId));
    },
    async update(projectId, patch) {
      await db
        .update(schema.projects)
        .set({ ...patch, updated_at: now() })
        .where(eq(schema.projects.project_id, projectId));
    },
    async delete(projectId) {
      await db.delete(schema.projects).where(eq(schema.projects.project_id, projectId));
    },
  };

  const projectAssignments: RuntimeRepositories['projectAssignments'] = {
    async assign(assignment: NewProjectAssignment) {
      const row: ProjectAssignmentRow = {
        ...assignment,
        assigned_at: now(),
      };
      await db.insert(schema.projectAssignments).values(row).onConflictDoNothing();

      const rows = await db
        .select()
        .from(schema.projectAssignments)
        .where(
          and(
            eq(schema.projectAssignments.project_id, assignment.project_id),
            eq(schema.projectAssignments.employee_id, assignment.employee_id),
          ),
        );
      return (rows[0] as ProjectAssignmentRow | undefined) ?? row;
    },
    async unassign(projectId, employeeId) {
      await db
        .delete(schema.projectAssignments)
        .where(
          and(
            eq(schema.projectAssignments.project_id, projectId),
            eq(schema.projectAssignments.employee_id, employeeId),
          ),
        );
    },
    async findByProject(projectId) {
      return (await db
        .select()
        .from(schema.projectAssignments)
        .where(eq(schema.projectAssignments.project_id, projectId))) as ProjectAssignmentRow[];
    },
    async findByEmployee(employeeId) {
      return (await db
        .select()
        .from(schema.projectAssignments)
        .where(eq(schema.projectAssignments.employee_id, employeeId))) as ProjectAssignmentRow[];
    },
    async isAssigned(projectId, employeeId) {
      const rows = await db
        .select()
        .from(schema.projectAssignments)
        .where(
          and(
            eq(schema.projectAssignments.project_id, projectId),
            eq(schema.projectAssignments.employee_id, employeeId),
          ),
        );
      return rows.length > 0;
    },
  };

  const chatThreads: ChatThreadRepository = {
    async create(input: NewChatThread) {
      const ts = now();
      const row: ChatThreadDbRow = {
        thread_id: input.thread_id,
        project_id: input.project_id,
        employee_id: input.employee_id ?? null,
        title: input.title ?? 'New thread',
        title_set_by_user: 0,
        semantic_title_job_id: null,
        semantic_title_status: null,
        semantic_title_source_provenance_json: null,
        semantic_title_result_provenance_json: null,
        semantic_title_usage_json: null,
        semantic_title_error_code: null,
        summary: null,
        archived_at: null,
        created_at: ts,
        updated_at: ts,
      };
      await db.insert(schema.chatThreads).values(row);
      return chatThreadFromDbRow(row);
    },
    async findById(threadId) {
      const rows = (await db
        .select()
        .from(schema.chatThreads)
        .where(eq(schema.chatThreads.thread_id, threadId))) as ChatThreadDbRow[];
      const head = rows[0];
      return head ? chatThreadFromDbRow(head) : null;
    },
    async listByProject(projectId) {
      const rows = (await db
        .select()
        .from(schema.chatThreads)
        .where(
          and(eq(schema.chatThreads.project_id, projectId), isNull(schema.chatThreads.archived_at)),
        )
        .orderBy(desc(schema.chatThreads.updated_at))) as ChatThreadDbRow[];
      return rows.map(chatThreadFromDbRow);
    },
    async listAllByProject(projectId) {
      const rows = (await db
        .select()
        .from(schema.chatThreads)
        .where(eq(schema.chatThreads.project_id, projectId))
        .orderBy(desc(schema.chatThreads.updated_at))) as ChatThreadDbRow[];
      return rows.map(chatThreadFromDbRow);
    },
    async updateTitle(threadId, title, opts) {
      const nextFlag = opts.byUser ? 1 : 0;
      await db
        .update(schema.chatThreads)
        .set({
          title,
          title_set_by_user: nextFlag,
          updated_at: now(),
          ...(opts.byUser
            ? {
                semantic_title_status: sql`CASE WHEN ${schema.chatThreads.semantic_title_status} = 'running' THEN 'cancelled' ELSE ${schema.chatThreads.semantic_title_status} END`,
              }
            : {}),
        })
        .where(
          opts.byUser
            ? eq(schema.chatThreads.thread_id, threadId)
            : and(
                eq(schema.chatThreads.thread_id, threadId),
                eq(schema.chatThreads.title_set_by_user, 0),
              ),
        );
      const after = (await db
        .select()
        .from(schema.chatThreads)
        .where(eq(schema.chatThreads.thread_id, threadId))) as ChatThreadDbRow[];
      const persisted = after[0];
      return persisted
        ? {
            title: persisted.title,
            title_set_by_user: persisted.title_set_by_user === 1 ? 1 : 0,
            persisted: persisted.title === title && persisted.title_set_by_user === nextFlag,
          }
        : { title, title_set_by_user: nextFlag === 1 ? 1 : 0, persisted: false };
    },
    async beginSemanticTitleJob(input) {
      const existing = (await db
        .select()
        .from(schema.chatThreads)
        .where(eq(schema.chatThreads.thread_id, input.threadId))) as ChatThreadDbRow[];
      const head = existing[0];
      if (!head || head.title_set_by_user === 1 || head.semantic_title_job_id !== null)
        return false;
      await db
        .update(schema.chatThreads)
        .set({
          semantic_title_job_id: input.jobId,
          semantic_title_status: 'running',
          semantic_title_source_provenance_json: input.sourceProvenanceJson,
          semantic_title_result_provenance_json: null,
          semantic_title_usage_json: null,
          semantic_title_error_code: null,
        })
        .where(
          and(
            eq(schema.chatThreads.thread_id, input.threadId),
            eq(schema.chatThreads.title_set_by_user, 0),
            isNull(schema.chatThreads.semantic_title_job_id),
          ),
        );
      const after = (await db
        .select()
        .from(schema.chatThreads)
        .where(eq(schema.chatThreads.thread_id, input.threadId))) as ChatThreadDbRow[];
      return (
        after[0]?.semantic_title_job_id === input.jobId &&
        after[0]?.semantic_title_status === 'running' &&
        after[0]?.title_set_by_user === 0
      );
    },
    async completeSemanticTitleJob(input) {
      await db
        .update(schema.chatThreads)
        .set({
          title: input.title,
          semantic_title_status: 'completed',
          semantic_title_result_provenance_json: input.resultProvenanceJson,
          semantic_title_usage_json: input.usageJson,
          semantic_title_error_code: null,
          updated_at: now(),
        })
        .where(
          and(
            eq(schema.chatThreads.thread_id, input.threadId),
            eq(schema.chatThreads.title_set_by_user, 0),
            eq(schema.chatThreads.semantic_title_job_id, input.jobId),
            eq(schema.chatThreads.semantic_title_status, 'running'),
          ),
        );
      const after = (await db
        .select()
        .from(schema.chatThreads)
        .where(eq(schema.chatThreads.thread_id, input.threadId))) as ChatThreadDbRow[];
      return (
        after[0]?.semantic_title_job_id === input.jobId &&
        after[0]?.semantic_title_status === 'completed' &&
        after[0]?.title_set_by_user === 0 &&
        after[0]?.title === input.title
      );
    },
    async failSemanticTitleJob(input) {
      await db
        .update(schema.chatThreads)
        .set({ semantic_title_status: 'failed', semantic_title_error_code: input.errorCode })
        .where(
          and(
            eq(schema.chatThreads.thread_id, input.threadId),
            eq(schema.chatThreads.semantic_title_job_id, input.jobId),
            eq(schema.chatThreads.semantic_title_status, 'running'),
          ),
        );
    },
    async touch(threadId) {
      await db
        .update(schema.chatThreads)
        .set({ updated_at: now() })
        .where(eq(schema.chatThreads.thread_id, threadId));
    },
    async archive(threadId) {
      const ts = now();
      await db
        .update(schema.chatThreads)
        .set({ archived_at: ts, updated_at: ts })
        .where(
          and(eq(schema.chatThreads.thread_id, threadId), isNull(schema.chatThreads.archived_at)),
        );
    },
    async unarchive(threadId) {
      await db
        .update(schema.chatThreads)
        .set({ archived_at: null, updated_at: now() })
        .where(eq(schema.chatThreads.thread_id, threadId));
    },
    async delete(threadId) {
      await db.delete(schema.chatThreads).where(eq(schema.chatThreads.thread_id, threadId));
    },
    async ensureProjectHasAtLeastOneThread(projectId) {
      const existing = (await db
        .select()
        .from(schema.chatThreads)
        .where(
          and(eq(schema.chatThreads.project_id, projectId), isNull(schema.chatThreads.archived_at)),
        )
        .orderBy(desc(schema.chatThreads.updated_at))) as ChatThreadDbRow[];
      const head = existing[0];
      if (head) return chatThreadFromDbRow(head);
      const ts = now();
      const row: ChatThreadDbRow = {
        thread_id: generateId('thread'),
        project_id: projectId,
        employee_id: null,
        title: 'New thread',
        title_set_by_user: 0,
        semantic_title_job_id: null,
        semantic_title_status: null,
        semantic_title_source_provenance_json: null,
        semantic_title_result_provenance_json: null,
        semantic_title_usage_json: null,
        semantic_title_error_code: null,
        summary: null,
        archived_at: null,
        created_at: ts,
        updated_at: ts,
      };
      await db.insert(schema.chatThreads).values(row);
      return chatThreadFromDbRow(row);
    },
  };

  return { projects, projectAssignments, chatThreads };
}
