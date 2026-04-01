CREATE TABLE IF NOT EXISTS file_history (
  history_id TEXT PRIMARY KEY,
  snapshot_id TEXT NOT NULL,
  thread_id TEXT NOT NULL REFERENCES graph_threads(thread_id) ON DELETE CASCADE,
  company_id TEXT NOT NULL REFERENCES companies(company_id) ON DELETE CASCADE,
  node_name TEXT,
  employee_id TEXT,
  task_run_id TEXT REFERENCES task_runs(task_run_id) ON DELETE SET NULL,
  tool_call_id TEXT NOT NULL,
  tool_name TEXT NOT NULL,
  step_index INTEGER,
  file_path TEXT NOT NULL,
  change_kind TEXT NOT NULL,
  existed_before INTEGER NOT NULL DEFAULT 0,
  backup_content TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_file_history_thread_created
  ON file_history(thread_id, created_at);

CREATE INDEX IF NOT EXISTS idx_file_history_snapshot
  ON file_history(snapshot_id);

CREATE INDEX IF NOT EXISTS idx_file_history_thread_step
  ON file_history(thread_id, step_index, created_at);
