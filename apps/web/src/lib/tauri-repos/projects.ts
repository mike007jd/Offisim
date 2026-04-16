import type { ProjectRepository, RuntimeRepositories } from '@offisim/core/browser';
import * as schema from '@offisim/db-local';
import { ACTIVE_PROJECT_STATUSES } from '@offisim/shared-types';
import type {
  NewProject,
  NewProjectAssignment,
  ProjectAssignmentRow,
  ProjectRow,
  ProjectStatus,
} from '@offisim/shared-types';
import { and, desc, eq, inArray } from 'drizzle-orm';
import type { TauriDrizzleDb } from '../tauri-drizzle';

function now(): string {
  return new Date().toISOString();
}

export interface ProjectsTauriRepos {
  projects: ProjectRepository;
  projectAssignments: RuntimeRepositories['projectAssignments'];
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

  return { projects, projectAssignments };
}
