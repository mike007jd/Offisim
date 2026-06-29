-- 0012_mcp_tool_grant_risk — upgrade v11 → v12.
--
-- Persist per-grant risk classification. MCP server annotations remain hints;
-- human overrides and trusted manifests can pin the effective read/write class.

ALTER TABLE mcp_tool_grants
  ADD COLUMN risk_class TEXT NOT NULL DEFAULT 'write'
  CHECK (risk_class IN ('read', 'write', 'destructive', 'open_world'));

ALTER TABLE mcp_tool_grants
  ADD COLUMN risk_source TEXT NOT NULL DEFAULT 'human_override'
  CHECK (risk_source IN ('server_annotation', 'name_heuristic', 'human_override', 'trusted_manifest'));

ALTER TABLE mcp_tool_grants
  ADD COLUMN trusted_server_id TEXT;
