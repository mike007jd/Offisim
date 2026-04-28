CREATE TABLE IF NOT EXISTS kanban_cards (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(project_id) ON DELETE CASCADE,
  company_id TEXT NOT NULL REFERENCES companies(company_id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  state TEXT NOT NULL DEFAULT 'todo',
  origin TEXT NOT NULL,
  created_by_employee_id TEXT,
  assigned_employee_id TEXT,
  parent_card_id TEXT,
  blocked_reason TEXT,
  task_run_id TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_kanban_project_state
  ON kanban_cards(project_id, state);

CREATE INDEX IF NOT EXISTS idx_kanban_assignee
  ON kanban_cards(assigned_employee_id, state);

CREATE INDEX IF NOT EXISTS idx_kanban_task_run
  ON kanban_cards(task_run_id);
