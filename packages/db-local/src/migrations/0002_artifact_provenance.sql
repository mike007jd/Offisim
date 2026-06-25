-- 0002_artifact_provenance — upgrade v1 → v2.
--
-- Gives `deliverables` artifact provenance so the first-party `publish_artifact`
-- tool can persist a versioned, hashed deliverable row:
--   run_id        — the agent run that produced it (agent_runs.run_id), nullable, no FK
--   content_hash  — hex sha256 of `content` at insert time, nullable
--   version       — monotonic version for a logical artifact, starts at 1
--
-- DDL-only; the runner wraps this file in a transaction together with the
-- version stamp (no BEGIN/COMMIT here).
ALTER TABLE deliverables ADD COLUMN run_id TEXT;
ALTER TABLE deliverables ADD COLUMN content_hash TEXT;
ALTER TABLE deliverables ADD COLUMN version INTEGER NOT NULL DEFAULT 1;
CREATE INDEX IF NOT EXISTS idx_deliverables_run_id ON deliverables(run_id);
