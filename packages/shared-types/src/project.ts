export type ProjectStatus = 'planning' | 'active' | 'paused' | 'completed' | 'archived';

export const ACTIVE_PROJECT_STATUSES: readonly ProjectStatus[] = ['planning', 'active', 'paused'] as const;
export const COMPLETED_PROJECT_STATUSES: readonly ProjectStatus[] = ['completed', 'archived'] as const;

export interface ProjectRow {
  project_id: string;
  company_id: string;
  thread_id: string | null;
  name: string;
  description: string | null;
  status: ProjectStatus;
  created_at: string;
  updated_at: string;
}

export type NewProject = Omit<ProjectRow, 'created_at' | 'updated_at'>;

export interface ProjectAssignmentRow {
  assignment_id: string;
  project_id: string;
  employee_id: string;
  role: string;
  assigned_at: string;
}

export type NewProjectAssignment = Omit<ProjectAssignmentRow, 'assigned_at'>;
