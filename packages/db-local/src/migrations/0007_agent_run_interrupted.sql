-- 0007_agent_run_interrupted — upgrade v6 → v7.
--
-- Durable resume (Epic A): give `agent_runs` an `interrupted` lifecycle state and
-- a `session_file` pointer to the Pi session JSONL that holds the run's durable
-- context. After a host crash/kill, startup reconciliation parks the dangling
-- root run as `interrupted` (distinct from a clean `cancelled`) and resume
-- re-continues from `session_file`.
--
-- `interrupted` is a NEW value in the `status` CHECK constraint. SQLite cannot
-- ALTER a CHECK, so this is a full table rebuild (create-new → copy → drop →
-- rename → recreate indexes), NOT an additive ALTER. `session_file` is folded
-- into the same rebuild rather than a second ADD COLUMN.
--
-- FK safety: `agent_runs.parent_run_id` self-references `agent_runs(run_id)`
-- with ON DELETE SET NULL. Two hazards, both handled here:
--  1. The runner wraps this file in ONE transaction (no BEGIN/COMMIT here) and
--     `PRAGMA foreign_keys` is a no-op inside a transaction — so we use
--     `PRAGMA defer_foreign_keys = ON`, honored inside a transaction, deferring
--     every FK check to COMMIT. By then the rebuilt table holds both parent and
--     child rows, so the self-FK (and the company/employee FKs) all pass.
--  2. The new table's self-FK references `agent_runs_new` (itself), NOT the old
--     `agent_runs`. If it pointed at the old table, `DROP TABLE agent_runs` would
--     delete the old parent rows and the ON DELETE SET NULL would cascade onto
--     the freshly-copied child rows, nulling their parent_run_id. By targeting
--     `agent_runs_new`, dropping the old table touches nothing in the new one;
--     `ALTER TABLE ... RENAME` then rewrites the self-reference to `agent_runs`
--     (legacy_alter_table is OFF by default in modern SQLite).
-- No other table references `agent_runs`, so the rename rewrites nothing else.
--
-- End-state matches schema.sql exactly (column set, CHECK, indexes).

PRAGMA defer_foreign_keys = ON;

CREATE TABLE agent_runs_new (
  run_id              TEXT PRIMARY KEY,
  thread_id           TEXT NOT NULL,
  company_id          TEXT NOT NULL REFERENCES companies(company_id) ON DELETE CASCADE,
  parent_run_id       TEXT REFERENCES agent_runs_new(run_id) ON DELETE SET NULL,
  root_run_id         TEXT NOT NULL,
  employee_id         TEXT REFERENCES employees(employee_id) ON DELETE SET NULL,
  relation            TEXT,
  objective           TEXT,
  access              TEXT,
  status              TEXT NOT NULL CHECK (status IN ('running', 'interrupted', 'completed', 'failed', 'cancelled')),
  usage_json          TEXT,
  result_summary_json TEXT,
  session_file        TEXT,
  started_at          TEXT NOT NULL,
  finished_at         TEXT
);

INSERT INTO agent_runs_new (
  run_id, thread_id, company_id, parent_run_id, root_run_id, employee_id,
  relation, objective, access, status, usage_json, result_summary_json,
  started_at, finished_at
)
SELECT
  run_id, thread_id, company_id, parent_run_id, root_run_id, employee_id,
  relation, objective, access, status, usage_json, result_summary_json,
  started_at, finished_at
FROM agent_runs;

DROP TABLE agent_runs;
ALTER TABLE agent_runs_new RENAME TO agent_runs;

CREATE INDEX IF NOT EXISTS idx_agent_runs_thread ON agent_runs(thread_id);
CREATE INDEX IF NOT EXISTS idx_agent_runs_root ON agent_runs(root_run_id);
CREATE INDEX IF NOT EXISTS idx_agent_runs_parent ON agent_runs(parent_run_id);
