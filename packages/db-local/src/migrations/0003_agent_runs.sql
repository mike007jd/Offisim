-- 0003: agent_runs — multi-agent delegation run tree. Upgrades version 2 → 3.
-- A row per run (root or delegated child); the tree is rebuilt from
-- parent_run_id / root_run_id. Distinct from task_runs (work items): agent_runs
-- are cognition instances of an employee identity.

CREATE TABLE IF NOT EXISTS agent_runs (
  run_id              TEXT PRIMARY KEY,
  thread_id           TEXT NOT NULL REFERENCES graph_threads(thread_id) ON DELETE CASCADE,
  company_id          TEXT NOT NULL REFERENCES companies(company_id) ON DELETE CASCADE,
  parent_run_id       TEXT REFERENCES agent_runs(run_id) ON DELETE SET NULL,
  root_run_id         TEXT NOT NULL,
  employee_id         TEXT REFERENCES employees(employee_id) ON DELETE SET NULL,
  relation            TEXT,
  objective           TEXT,
  access              TEXT,
  status              TEXT NOT NULL CHECK (status IN ('running', 'completed', 'failed', 'cancelled')),
  usage_json          TEXT,
  result_summary_json TEXT,
  started_at          TEXT NOT NULL,
  finished_at         TEXT
);

CREATE INDEX IF NOT EXISTS idx_agent_runs_thread ON agent_runs(thread_id);
CREATE INDEX IF NOT EXISTS idx_agent_runs_root ON agent_runs(root_run_id);
CREATE INDEX IF NOT EXISTS idx_agent_runs_parent ON agent_runs(parent_run_id);
