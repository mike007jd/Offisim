-- Publish drafts and lineage
CREATE TABLE IF NOT EXISTS publish_drafts (
  draft_id TEXT PRIMARY KEY,
  creator_id TEXT NOT NULL REFERENCES creator_profiles(creator_id) ON DELETE CASCADE,
  listing_id TEXT REFERENCES listings(listing_id) ON DELETE SET NULL,
  artifact_id TEXT REFERENCES artifacts(artifact_id) ON DELETE SET NULL,
  manifest_json JSONB,
  validation_state TEXT NOT NULL DEFAULT 'unknown' CHECK (validation_state IN ('unknown', 'valid', 'invalid')),
  validation_report_json JSONB,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'validated', 'submitted', 'rejected')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS lineage_edges (
  edge_id TEXT PRIMARY KEY,
  child_package_id TEXT NOT NULL,
  child_version TEXT,
  parent_package_id TEXT NOT NULL,
  parent_version TEXT,
  relation_type TEXT NOT NULL CHECK (relation_type IN ('fork', 'derivative', 'inspired_by')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_publish_drafts_creator ON publish_drafts(creator_id, updated_at);
CREATE INDEX IF NOT EXISTS idx_lineage_edges_child ON lineage_edges(child_package_id);
