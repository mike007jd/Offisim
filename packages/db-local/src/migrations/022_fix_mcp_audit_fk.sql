-- 022: Fix mcp_audit_log.thread_id FK — add ON DELETE CASCADE
-- SQLite cannot ALTER FK constraints, so recreate the table.

CREATE TABLE mcp_audit_log_new (
  audit_id     TEXT PRIMARY KEY,
  thread_id    TEXT NOT NULL REFERENCES graph_threads(thread_id) ON DELETE CASCADE,
  task_run_id  TEXT REFERENCES task_runs(task_run_id) ON DELETE SET NULL,
  employee_id  TEXT NOT NULL,
  server_name  TEXT NOT NULL,
  tool_name    TEXT NOT NULL,
  arguments_json TEXT NOT NULL,
  result_json  TEXT,
  error        TEXT,
  latency_ms   INTEGER NOT NULL,
  approved_by  TEXT NOT NULL DEFAULT 'auto',
  created_at   TEXT NOT NULL
);

INSERT INTO mcp_audit_log_new
  SELECT audit_id, thread_id, task_run_id, employee_id, server_name,
         tool_name, arguments_json, result_json, error, latency_ms,
         approved_by, created_at
  FROM mcp_audit_log;

DROP TABLE mcp_audit_log;
ALTER TABLE mcp_audit_log_new RENAME TO mcp_audit_log;

-- Re-create indexes
CREATE INDEX IF NOT EXISTS idx_mcp_audit_thread     ON mcp_audit_log(thread_id);
CREATE INDEX IF NOT EXISTS idx_mcp_audit_employee   ON mcp_audit_log(employee_id);
CREATE INDEX IF NOT EXISTS idx_mcp_audit_server_tool ON mcp_audit_log(server_name, tool_name);
