-- 0008_mcp_tool_grants — upgrade v7 → v8.
--
-- B4 MCP live wiring: default-deny per-employee tool grants, plus an FK rebuild
-- for MCP audit/approval rows. Live Pi chat runs use `chat_threads.thread_id`,
-- not `graph_threads.thread_id`; keeping the old graph_threads FK makes the
-- first live MCP audit insert fail even though headless gates stay green.
--
-- The runner wraps this file in one transaction with the version stamp.

PRAGMA defer_foreign_keys = ON;

CREATE TABLE IF NOT EXISTS mcp_tool_grants (
  grant_id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(company_id) ON DELETE CASCADE,
  employee_id TEXT NOT NULL,
  server_name TEXT NOT NULL,
  tool_name TEXT NOT NULL,
  scope TEXT NOT NULL DEFAULT 'employee',
  project_id TEXT,
  granted_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(company_id, employee_id, server_name, tool_name)
);

CREATE TABLE mcp_audit_log_new (
  audit_id TEXT PRIMARY KEY,
  thread_id TEXT NOT NULL,
  task_run_id TEXT REFERENCES task_runs(task_run_id) ON DELETE SET NULL,
  employee_id TEXT NOT NULL,
  server_name TEXT NOT NULL,
  tool_name TEXT NOT NULL,
  arguments_json TEXT NOT NULL,
  result_json TEXT,
  error TEXT,
  latency_ms INTEGER NOT NULL,
  approved_by TEXT NOT NULL DEFAULT 'auto',
  created_at TEXT NOT NULL
);

INSERT INTO mcp_audit_log_new (
  audit_id, thread_id, task_run_id, employee_id, server_name, tool_name,
  arguments_json, result_json, error, latency_ms, approved_by, created_at
)
SELECT
  audit_id, thread_id, task_run_id, employee_id, server_name, tool_name,
  arguments_json, result_json, error, latency_ms, approved_by, created_at
FROM mcp_audit_log;

DROP TABLE mcp_audit_log;
ALTER TABLE mcp_audit_log_new RENAME TO mcp_audit_log;

CREATE TABLE tool_permission_approvals_new (
  approval_id TEXT PRIMARY KEY,
  thread_id TEXT NOT NULL,
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

INSERT INTO tool_permission_approvals_new (
  approval_id, thread_id, company_id, employee_id, server_name, tool_name,
  scope, approved_by, policy_hash, consumed_at, created_at, expires_at
)
SELECT
  approval_id, thread_id, company_id, employee_id, server_name, tool_name,
  scope, approved_by, policy_hash, consumed_at, created_at, expires_at
FROM tool_permission_approvals;

DROP TABLE tool_permission_approvals;
ALTER TABLE tool_permission_approvals_new RENAME TO tool_permission_approvals;

CREATE INDEX IF NOT EXISTS idx_mcp_audit_thread
  ON mcp_audit_log(thread_id);
CREATE INDEX IF NOT EXISTS idx_mcp_audit_employee
  ON mcp_audit_log(employee_id);
CREATE INDEX IF NOT EXISTS idx_mcp_audit_server_tool
  ON mcp_audit_log(server_name, tool_name);
CREATE INDEX IF NOT EXISTS idx_mcp_tool_grants_employee
  ON mcp_tool_grants(company_id, employee_id);
CREATE INDEX IF NOT EXISTS idx_mcp_tool_grants_server_tool
  ON mcp_tool_grants(server_name, tool_name);
CREATE INDEX IF NOT EXISTS idx_tool_perm_approval_lookup
  ON tool_permission_approvals(thread_id, employee_id, server_name, tool_name, policy_hash);
CREATE INDEX IF NOT EXISTS idx_tool_perm_approval_company
  ON tool_permission_approvals(company_id, created_at);
CREATE INDEX IF NOT EXISTS idx_tool_perm_approval_company_lookup
  ON tool_permission_approvals(company_id, thread_id, employee_id, server_name, tool_name, policy_hash);
