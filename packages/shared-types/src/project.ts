export type ProjectStatus = 'planning' | 'active' | 'paused' | 'completed' | 'archived';

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
