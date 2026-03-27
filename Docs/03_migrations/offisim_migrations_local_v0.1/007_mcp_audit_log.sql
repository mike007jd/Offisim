-- MCP tool call audit log (P3)
CREATE TABLE IF NOT EXISTS mcp_audit_log (
  audit_id       TEXT PRIMARY KEY,
  thread_id      TEXT NOT NULL REFERENCES graph_threads(thread_id),
  task_run_id    TEXT REFERENCES task_runs(task_run_id) ON DELETE SET NULL,
  employee_id    TEXT NOT NULL,
  server_name    TEXT NOT NULL,
  tool_name      TEXT NOT NULL,
  arguments_json TEXT NOT NULL,
  result_json    TEXT,
  error          TEXT,
  latency_ms     INTEGER NOT NULL,
  approved_by    TEXT NOT NULL DEFAULT 'auto',
  created_at     TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_mcp_audit_thread ON mcp_audit_log(thread_id);
CREATE INDEX IF NOT EXISTS idx_mcp_audit_employee ON mcp_audit_log(employee_id);
CREATE INDEX IF NOT EXISTS idx_mcp_audit_server ON mcp_audit_log(server_name);
