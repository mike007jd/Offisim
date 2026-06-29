-- 0010_agent_run_context — upgrade v9 → v10.
--
-- Durable resume now needs the original project/workspace context. Without it,
-- resume falls back to the company's default workspace and can continue a task in
-- the wrong folder. Add nullable columns so old/child rows remain readable.

ALTER TABLE agent_runs
  ADD COLUMN project_id TEXT REFERENCES projects(project_id) ON DELETE SET NULL;

ALTER TABLE agent_runs
  ADD COLUMN runtime_context_json TEXT;

CREATE INDEX IF NOT EXISTS idx_agent_runs_company_project_status
  ON agent_runs(company_id, project_id, status);
