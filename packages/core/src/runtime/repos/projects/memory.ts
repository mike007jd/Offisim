import { ACTIVE_PROJECT_STATUSES } from '@offisim/shared-types';
import type {
  ChatThread,
  NewChatThread,
  NewProject,
  NewProjectAssignment,
  ProjectAssignmentRow,
  ProjectRow,
  ProjectStatus,
  ProjectUpdatePatch,
} from '@offisim/shared-types';
import { generateId } from '../../../utils/generate-id.js';
import type {
  ChatThreadRepository,
  ProjectAssignmentRepository,
  ProjectRepository,
} from '../../repositories.js';
import type { MemoryRepositoriesSnapshot } from '../memory-types.js';
import { cloneRows } from '../memory-utils.js';

export class MemoryProjectRepository implements ProjectRepository {
  private readonly store = new Map<string, ProjectRow>();

  constructor(initialRows?: Iterable<ProjectRow>) {
    if (!initialRows) return;
    for (const row of initialRows) {
      this.store.set(row.project_id, { ...row });
    }
  }

  async create(project: NewProject): Promise<ProjectRow> {
    const row: ProjectRow = {
      ...project,
      verify_command: project.verify_command ?? null,
      verify_max_attempts: project.verify_max_attempts ?? 3,
      verify_token_budget: project.verify_token_budget ?? null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    this.store.set(row.project_id, row);
    return row;
  }

  async findById(projectId: string): Promise<ProjectRow | null> {
    return this.store.get(projectId) ?? null;
  }

  async findByCompany(companyId: string): Promise<ProjectRow[]> {
    return [...this.store.values()]
      .filter((p) => p.company_id === companyId)
      .sort((a, b) => b.updated_at.localeCompare(a.updated_at));
  }

  async findActiveByCompany(companyId: string): Promise<ProjectRow[]> {
    return [...this.store.values()]
      .filter(
        (p) =>
          p.company_id === companyId &&
          (ACTIVE_PROJECT_STATUSES as readonly string[]).includes(p.status),
      )
      .sort((a, b) => b.updated_at.localeCompare(a.updated_at));
  }

  async updateStatus(projectId: string, status: ProjectStatus): Promise<void> {
    const row = this.store.get(projectId);
    if (row) {
      this.store.set(projectId, { ...row, status, updated_at: new Date().toISOString() });
    }
  }

  async update(projectId: string, patch: ProjectUpdatePatch): Promise<void> {
    const row = this.store.get(projectId);
    if (row) {
      this.store.set(projectId, { ...row, ...patch, updated_at: new Date().toISOString() });
    }
  }

  async delete(projectId: string): Promise<void> {
    this.store.delete(projectId);
  }

  snapshot(): ProjectRow[] {
    return cloneRows(this.store.values());
  }
}

export class MemoryProjectAssignmentRepository implements ProjectAssignmentRepository {
  private readonly store = new Map<string, ProjectAssignmentRow>();

  constructor(initialRows?: Iterable<ProjectAssignmentRow>) {
    if (!initialRows) return;
    for (const row of initialRows) {
      this.store.set(this.key(row.project_id, row.employee_id), { ...row });
    }
  }

  private key(projectId: string, employeeId: string): string {
    return `${projectId}::${employeeId}`;
  }

  async assign(assignment: NewProjectAssignment): Promise<ProjectAssignmentRow> {
    const key = this.key(assignment.project_id, assignment.employee_id);
    const existing = this.store.get(key);
    if (existing) return existing;
    const row: ProjectAssignmentRow = {
      ...assignment,
      assigned_at: new Date().toISOString(),
    };
    this.store.set(key, row);
    return row;
  }

  async unassign(projectId: string, employeeId: string): Promise<void> {
    this.store.delete(this.key(projectId, employeeId));
  }

  async findByProject(projectId: string): Promise<ProjectAssignmentRow[]> {
    return [...this.store.values()].filter((a) => a.project_id === projectId);
  }

  async findByEmployee(employeeId: string): Promise<ProjectAssignmentRow[]> {
    return [...this.store.values()].filter((a) => a.employee_id === employeeId);
  }

  async isAssigned(projectId: string, employeeId: string): Promise<boolean> {
    return this.store.has(this.key(projectId, employeeId));
  }

  snapshot(): ProjectAssignmentRow[] {
    return cloneRows(this.store.values());
  }
}

export class MemoryChatThreadRepository implements ChatThreadRepository {
  private readonly store = new Map<string, ChatThread>();

  constructor(initialRows?: Iterable<ChatThread>) {
    if (!initialRows) return;
    for (const row of initialRows) {
      this.store.set(row.thread_id, { ...row });
    }
  }

  async create(input: NewChatThread): Promise<ChatThread> {
    const ts = new Date().toISOString();
    const row: ChatThread = {
      thread_id: input.thread_id,
      project_id: input.project_id,
      employee_id: input.employee_id ?? null,
      title: input.title ?? 'New thread',
      title_set_by_user: 0,
      summary: null,
      archived_at: null,
      created_at: ts,
      updated_at: ts,
    };
    this.store.set(row.thread_id, row);
    return { ...row };
  }

  async findById(threadId: string): Promise<ChatThread | null> {
    const row = this.store.get(threadId);
    return row ? { ...row } : null;
  }

  async listByProject(projectId: string): Promise<ChatThread[]> {
    return [...this.store.values()]
      .filter((t) => t.project_id === projectId && t.archived_at == null)
      .sort((a, b) => b.updated_at.localeCompare(a.updated_at))
      .map((t) => ({ ...t }));
  }

  async listAllByProject(projectId: string): Promise<ChatThread[]> {
    return [...this.store.values()]
      .filter((t) => t.project_id === projectId)
      .sort((a, b) => b.updated_at.localeCompare(a.updated_at))
      .map((t) => ({ ...t }));
  }

  async updateTitle(
    threadId: string,
    title: string,
    opts: { byUser: boolean },
  ): Promise<{ title: string; title_set_by_user: 0 | 1 }> {
    const row = this.store.get(threadId);
    if (!row) {
      return { title, title_set_by_user: opts.byUser ? 1 : 0 };
    }
    if (!opts.byUser && row.title_set_by_user === 1) {
      return { title: row.title, title_set_by_user: 1 };
    }
    const next: ChatThread = {
      ...row,
      title,
      title_set_by_user: opts.byUser ? 1 : 0,
      updated_at: new Date().toISOString(),
    };
    this.store.set(threadId, next);
    return { title: next.title, title_set_by_user: next.title_set_by_user };
  }

  async touch(threadId: string): Promise<void> {
    const row = this.store.get(threadId);
    if (!row) return;
    this.store.set(threadId, { ...row, updated_at: new Date().toISOString() });
  }

  async archive(threadId: string): Promise<void> {
    const row = this.store.get(threadId);
    if (!row || row.archived_at != null) return;
    const ts = new Date().toISOString();
    this.store.set(threadId, { ...row, archived_at: ts, updated_at: ts });
  }

  async unarchive(threadId: string): Promise<void> {
    const row = this.store.get(threadId);
    if (!row || row.archived_at == null) return;
    this.store.set(threadId, { ...row, archived_at: null, updated_at: new Date().toISOString() });
  }

  async delete(threadId: string): Promise<void> {
    this.store.delete(threadId);
  }

  async ensureProjectHasAtLeastOneThread(projectId: string): Promise<ChatThread> {
    const existing = await this.listByProject(projectId);
    if (existing.length > 0) {
      const head = existing[0];
      if (!head) throw new Error('listByProject returned empty array after length check');
      return head;
    }
    return this.create({
      thread_id: generateId('thread'),
      project_id: projectId,
    });
  }

  snapshot(): ChatThread[] {
    return cloneRows(this.store.values());
  }
}

export interface ProjectsMemoryRepos {
  projects: MemoryProjectRepository;
  projectAssignments: MemoryProjectAssignmentRepository;
  chatThreads: MemoryChatThreadRepository;
}

export function createProjectsMemoryRepos(
  snapshot?: Partial<MemoryRepositoriesSnapshot>,
): ProjectsMemoryRepos {
  const projects = new MemoryProjectRepository(snapshot?.projects);
  const projectAssignments = new MemoryProjectAssignmentRepository(snapshot?.projectAssignments);
  const chatThreads = new MemoryChatThreadRepository(snapshot?.chatThreads);
  return { projects, projectAssignments, chatThreads };
}
