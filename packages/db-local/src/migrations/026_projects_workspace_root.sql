-- 026 — projects.workspace_root
-- Adds nullable local workspace folder binding to projects (G1 Project IDE root).
-- See change `project-workspace-root-binding` for the spec.

ALTER TABLE projects ADD COLUMN workspace_root TEXT;
