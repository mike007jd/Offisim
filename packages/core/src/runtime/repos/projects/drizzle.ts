import * as schema from '@offisim/db-local/dist/schema.js';
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
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { generateId } from '../../../utils/generate-id.js';
import type {
  ChatThreadRepository,
  ProjectAssignmentRepository,
  ProjectRepository,
} from '../../repositories.js';

type Db = BetterSQLite3Database<typeof schema>;

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

export interface ProjectsDrizzleRepos {
  projects: ProjectRepository;
  projectAssignments: ProjectAssignmentRepository;
  chatThreads: ChatThreadRepository;
}

export function createProjectsDrizzleRepos(db: Db): ProjectsDrizzleRepos {
  const projects: ProjectRepository = {
    async create(project: NewProject) {
      const ts = now();
      const row: ProjectRow = { ...project, created_at: ts, updated_at: ts };
      db.insert(schema.projects).values(row).run();
      return row;
    },
    async findById(projectId) {
      const rows = db
        .select()
        .from(schema.projects)
        .where(eq(schema.projects.project_id, projectId))
        .all();
      return (rows[0] as ProjectRow | undefined) ?? null;
    },
    async findByCompany(companyId) {
      return db
        .select()
        .from(schema.projects)
        .where(eq(schema.projects.company_id, companyId))
        .orderBy(desc(schema.projects.updated_at))
        .all() as ProjectRow[];
    },
    async findActiveByCompany(companyId) {
      return db
        .select()
        .from(schema.projects)
        .where(
          and(
            eq(schema.projects.company_id, companyId),
            inArray(schema.projects.status, [...ACTIVE_PROJECT_STATUSES]),
          ),
        )
        .orderBy(desc(schema.projects.updated_at))
        .all() as ProjectRow[];
    },
    async updateStatus(projectId, status: ProjectStatus) {
      db.update(schema.projects)
        .set({ status, updated_at: now() })
        .where(eq(schema.projects.project_id, projectId))
        .run();
    },
    async update(projectId, patch) {
      db.update(schema.projects)
        .set({ ...patch, updated_at: now() })
        .where(eq(schema.projects.project_id, projectId))
        .run();
    },
    async delete(projectId) {
      db.delete(schema.projects).where(eq(schema.projects.project_id, projectId)).run();
    },
  };

  const projectAssignments: ProjectAssignmentRepository = {
    async assign(assignment: NewProjectAssignment) {
      const row: ProjectAssignmentRow = {
        ...assignment,
        assigned_at: now(),
      };
      db.insert(schema.projectAssignments).values(row).onConflictDoNothing().run();
      const rows = db
        .select()
        .from(schema.projectAssignments)
        .where(
          and(
            eq(schema.projectAssignments.project_id, assignment.project_id),
            eq(schema.projectAssignments.employee_id, assignment.employee_id),
          ),
        )
        .all();
      return (rows[0] as ProjectAssignmentRow | undefined) ?? row;
    },
    async unassign(projectId, employeeId) {
      db.delete(schema.projectAssignments)
        .where(
          and(
            eq(schema.projectAssignments.project_id, projectId),
            eq(schema.projectAssignments.employee_id, employeeId),
          ),
        )
        .run();
    },
    async findByProject(projectId) {
      return db
        .select()
        .from(schema.projectAssignments)
        .where(eq(schema.projectAssignments.project_id, projectId))
        .all() as ProjectAssignmentRow[];
    },
    async findByEmployee(employeeId) {
      return db
        .select()
        .from(schema.projectAssignments)
        .where(eq(schema.projectAssignments.employee_id, employeeId))
        .all() as ProjectAssignmentRow[];
    },
    async isAssigned(projectId, employeeId) {
      const rows = db
        .select()
        .from(schema.projectAssignments)
        .where(
          and(
            eq(schema.projectAssignments.project_id, projectId),
            eq(schema.projectAssignments.employee_id, employeeId),
          ),
        )
        .all();
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
      db.insert(schema.chatThreads).values(row).run();
      return chatThreadFromDbRow(row);
    },
    async findById(threadId) {
      const rows = db
        .select()
        .from(schema.chatThreads)
        .where(eq(schema.chatThreads.thread_id, threadId))
        .all() as ChatThreadDbRow[];
      const head = rows[0];
      return head ? chatThreadFromDbRow(head) : null;
    },
    async listByProject(projectId) {
      const rows = db
        .select()
        .from(schema.chatThreads)
        .where(
          and(
            eq(schema.chatThreads.project_id, projectId),
            isNull(schema.chatThreads.archived_at),
          ),
        )
        .orderBy(desc(schema.chatThreads.updated_at))
        .all() as ChatThreadDbRow[];
      return rows.map(chatThreadFromDbRow);
    },
    async updateTitle(threadId, title, opts) {
      const existing = db
        .select()
        .from(schema.chatThreads)
        .where(eq(schema.chatThreads.thread_id, threadId))
        .all() as ChatThreadDbRow[];
      const head = existing[0];
      if (!head) {
        // Row was deleted concurrently; report what would have been written.
        return { title, title_set_by_user: opts.byUser ? 1 : 0 };
      }
      if (!opts.byUser && head.title_set_by_user === 1) {
        return { title: head.title, title_set_by_user: 1 };
      }
      const nextFlag = opts.byUser ? 1 : 0;
      db.update(schema.chatThreads)
        .set({ title, title_set_by_user: nextFlag, updated_at: now() })
        .where(eq(schema.chatThreads.thread_id, threadId))
        .run();
      return { title, title_set_by_user: nextFlag === 1 ? 1 : 0 };
    },
    async touch(threadId) {
      db.update(schema.chatThreads)
        .set({ updated_at: now() })
        .where(eq(schema.chatThreads.thread_id, threadId))
        .run();
    },
    async archive(threadId) {
      const ts = now();
      db.update(schema.chatThreads)
        .set({ archived_at: ts, updated_at: ts })
        .where(
          and(
            eq(schema.chatThreads.thread_id, threadId),
            isNull(schema.chatThreads.archived_at),
          ),
        )
        .run();
    },
    async ensureProjectHasAtLeastOneThread(projectId) {
      const existing = db
        .select()
        .from(schema.chatThreads)
        .where(
          and(
            eq(schema.chatThreads.project_id, projectId),
            isNull(schema.chatThreads.archived_at),
          ),
        )
        .orderBy(desc(schema.chatThreads.updated_at))
        .all() as ChatThreadDbRow[];
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
      db.insert(schema.chatThreads).values(row).run();
      return chatThreadFromDbRow(row);
    },
  };

  return { projects, projectAssignments, chatThreads };
}
