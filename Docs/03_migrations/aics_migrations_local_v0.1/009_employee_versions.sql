-- 009: Employee version history
CREATE TABLE IF NOT EXISTS employee_versions (
  version_id    TEXT PRIMARY KEY,
  employee_id   TEXT NOT NULL REFERENCES employees(employee_id) ON DELETE CASCADE,
  version_num   INTEGER NOT NULL,
  change_type   TEXT NOT NULL CHECK(change_type IN ('create', 'update', 'rollback')),
  snapshot_json TEXT NOT NULL,
  change_summary TEXT,
  created_by    TEXT NOT NULL DEFAULT 'user',
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_emp_ver_emp_num ON employee_versions(employee_id, version_num);
CREATE INDEX IF NOT EXISTS idx_emp_ver_emp ON employee_versions(employee_id);
