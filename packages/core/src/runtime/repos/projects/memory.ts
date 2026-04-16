import { ACTIVE_PROJECT_STATUSES } from '@offisim/shared-types';
import type {
  NewProject,
  NewProjectAssignment,
  ProjectAssignmentRow,
  ProjectRow,
  ProjectStatus,
} from '@offisim/shared-types';
import type {
  ProjectAssignmentRepository,
  ProjectRepository,
} from '../../repositories.js';
import type { MemoryRepositoriesSnapshot } from '../memory-types.js';

function cloneRows<T extends object>(rows: Iterable<T>): T[] {
  return [...rows].map((row) => ({ ...row }));
}

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

  async update(
    projectId: string,
    patch: Partial<Pick<ProjectRow, 'name' | 'description' | 'status'>>,
  ): Promise<void> {
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

export interface ProjectsMemoryRepos {
  projects: MemoryProjectRepository;
  projectAssignments: MemoryProjectAssignmentRepository;
}

export function createProjectsMemoryRepos(
  snapshot?: Partial<MemoryRepositoriesSnapshot>,
): ProjectsMemoryRepos {
  const projects = new MemoryProjectRepository(snapshot?.projects);
  const projectAssignments = new MemoryProjectAssignmentRepository(snapshot?.projectAssignments);
  return { projects, projectAssignments };
}
