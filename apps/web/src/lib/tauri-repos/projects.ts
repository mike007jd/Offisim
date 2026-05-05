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
import { and, desc, eq, inArray, isNull } from 'drizzle-orm';
import type { TauriDrizzleDb } from '../tauri-drizzle';

function now(): string {
  return new Date().toISOString();
}

interface ChatThreadDbRow {
  thread_id: string;
  project_id: string;
  title: string;
  title_set_by_user: number;
  summary: string | null;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
}

function chatThreadFromDbRow(row: ChatThreadDbRow): ChatThread {
  return {
    thread_id: row.thread_id,
    project_id: row.project_id,
    title: row.title,
    title_set_by_user: row.title_set_by_user === 1 ? 1 : 0,
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
      const row: ProjectRow = { ...p, created_at: now(), updated_at: now() };
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
        title: input.title ?? 'New thread',
        title_set_by_user: 0,
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
          and(
            eq(schema.chatThreads.project_id, projectId),
            isNull(schema.chatThreads.archived_at),
          ),
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
      const existing = (await db
        .select()
        .from(schema.chatThreads)
        .where(eq(schema.chatThreads.thread_id, threadId))) as ChatThreadDbRow[];
      const head = existing[0];
      if (!head) {
        return { title, title_set_by_user: opts.byUser ? 1 : 0 };
      }
      if (!opts.byUser && head.title_set_by_user === 1) {
        return { title: head.title, title_set_by_user: 1 };
      }
      const nextFlag = opts.byUser ? 1 : 0;
      await db
        .update(schema.chatThreads)
        .set({ title, title_set_by_user: nextFlag, updated_at: now() })
        .where(eq(schema.chatThreads.thread_id, threadId));
      return { title, title_set_by_user: nextFlag === 1 ? 1 : 0 };
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
          and(
            eq(schema.chatThreads.thread_id, threadId),
            isNull(schema.chatThreads.archived_at),
          ),
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
          and(
            eq(schema.chatThreads.project_id, projectId),
            isNull(schema.chatThreads.archived_at),
          ),
        )
        .orderBy(desc(schema.chatThreads.updated_at))) as ChatThreadDbRow[];
      const head = existing[0];
      if (head) return chatThreadFromDbRow(head);
      const ts = now();
      const row: ChatThreadDbRow = {
        thread_id: generateId('thread'),
        project_id: projectId,
        title: 'New thread',
        title_set_by_user: 0,
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
