-- Migration 017: Project-employee assignments
CREATE TABLE IF NOT EXISTS project_assignments (
  assignment_id TEXT PRIMARY KEY,
  project_id    TEXT NOT NULL REFERENCES projects(project_id) ON DELETE CASCADE,
  employee_id   TEXT NOT NULL REFERENCES employees(employee_id) ON DELETE CASCADE,
  role          TEXT NOT NULL DEFAULT 'member',
  assigned_at   TEXT NOT NULL,
  UNIQUE(project_id, employee_id)
);
CREATE INDEX IF NOT EXISTS idx_project_assignments_project
  ON project_assignments(project_id);
CREATE INDEX IF NOT EXISTS idx_project_assignments_employee
  ON project_assignments(employee_id);
