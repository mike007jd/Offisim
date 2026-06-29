-- 0011_mcp_audit_approval_status — upgrade v10 → v11.
--
-- MCP audit must distinguish "no human approval needed" from "approved by a
-- human". Keep old rows readable: historical boss rows map to human_approved;
-- everything else maps to not_required.

PRAGMA defer_foreign_keys = ON;

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
  approval_status TEXT NOT NULL DEFAULT 'not_required'
    CHECK (approval_status IN ('not_required', 'human_approved', 'human_denied')),
  approved_by TEXT,
  created_at TEXT NOT NULL
);

INSERT INTO mcp_audit_log_new (
  audit_id, thread_id, task_run_id, employee_id, server_name, tool_name,
  arguments_json, result_json, error, latency_ms, approval_status, approved_by, created_at
)
SELECT
  audit_id, thread_id, task_run_id, employee_id, server_name, tool_name,
  arguments_json, result_json, error, latency_ms,
  CASE approved_by WHEN 'boss' THEN 'human_approved' ELSE 'not_required' END,
  CASE approved_by WHEN 'boss' THEN approved_by ELSE NULL END,
  created_at
FROM mcp_audit_log;

DROP TABLE mcp_audit_log;
ALTER TABLE mcp_audit_log_new RENAME TO mcp_audit_log;

CREATE INDEX IF NOT EXISTS idx_mcp_audit_thread
  ON mcp_audit_log(thread_id);
CREATE INDEX IF NOT EXISTS idx_mcp_audit_employee
  ON mcp_audit_log(employee_id);
CREATE INDEX IF NOT EXISTS idx_mcp_audit_server_tool
  ON mcp_audit_log(server_name, tool_name);
