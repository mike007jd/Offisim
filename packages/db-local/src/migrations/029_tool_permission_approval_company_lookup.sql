-- 029: Company-first reusable tool permission approval lookup.
-- Runtime-applied db-local migration. Docs/03_migrations/.../037_* mirrors
-- this change for the desktop embedded migration pack.

CREATE INDEX IF NOT EXISTS idx_tool_perm_approval_company_lookup
  ON tool_permission_approvals(company_id, thread_id, employee_id, server_name, tool_name, policy_hash);
