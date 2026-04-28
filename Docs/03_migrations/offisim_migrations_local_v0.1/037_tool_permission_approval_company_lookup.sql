-- 037: Company-first reusable tool permission approval lookup.
-- Keeps the existing thread-first index from 036 intact and adds a covering
-- index for the runtime lookup that defensively filters by company_id.

CREATE INDEX IF NOT EXISTS idx_tool_perm_approval_company_lookup
  ON tool_permission_approvals(company_id, thread_id, employee_id, server_name, tool_name, policy_hash);
