-- 036: Deterministic harness foundation.
-- Documentation-sequence mirror of
-- packages/db-local/src/migrations/028_deterministic_harness_foundation.sql.
--
-- Adds replayable LLM recording fields, durable interaction payloads, and
-- explicit tool permission approvals.

ALTER TABLE llm_calls ADD COLUMN request_json TEXT;
ALTER TABLE llm_calls ADD COLUMN tool_calls_json TEXT;
ALTER TABLE llm_calls ADD COLUMN prompt_hash TEXT;
ALTER TABLE llm_calls ADD COLUMN tools_hash TEXT;
ALTER TABLE llm_calls ADD COLUMN response_hash TEXT;
ALTER TABLE llm_calls ADD COLUMN recording_mode TEXT;

ALTER TABLE active_thread_interactions ADD COLUMN payload_json TEXT;
ALTER TABLE interaction_history ADD COLUMN payload_json TEXT;

CREATE TABLE IF NOT EXISTS tool_permission_approvals (
  approval_id TEXT PRIMARY KEY,
  thread_id TEXT NOT NULL REFERENCES graph_threads(thread_id) ON DELETE CASCADE,
  company_id TEXT NOT NULL REFERENCES companies(company_id) ON DELETE CASCADE,
  employee_id TEXT,
  server_name TEXT NOT NULL,
  tool_name TEXT NOT NULL,
  scope TEXT NOT NULL CHECK (scope IN ('once', 'thread')),
  approved_by TEXT NOT NULL,
  policy_hash TEXT NOT NULL,
  consumed_at TEXT,
  created_at TEXT NOT NULL,
  expires_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_tool_perm_approval_lookup
  ON tool_permission_approvals(thread_id, employee_id, server_name, tool_name, policy_hash);

CREATE INDEX IF NOT EXISTS idx_tool_perm_approval_company
  ON tool_permission_approvals(company_id, created_at);
