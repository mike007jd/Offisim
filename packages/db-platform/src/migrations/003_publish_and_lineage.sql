-- Publish drafts and lineage
CREATE TABLE IF NOT EXISTS publish_drafts (
  draft_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  creator_id UUID NOT NULL REFERENCES creators(creator_id) ON DELETE CASCADE,
  listing_id UUID REFERENCES listings(listing_id) ON DELETE SET NULL,
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  summary TEXT,
  manifest_json JSONB,
  artifact_id TEXT,
  validation_state TEXT NOT NULL DEFAULT 'unknown',
  validation_report JSONB,
  status TEXT NOT NULL DEFAULT 'draft',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS package_lineage (
  lineage_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  package_version_id UUID NOT NULL REFERENCES package_versions(package_version_id) ON DELETE CASCADE,
  origin_listing_id UUID REFERENCES listings(listing_id) ON DELETE SET NULL,
  origin_package_id TEXT,
  forked_from_version TEXT
);

CREATE INDEX IF NOT EXISTS idx_publish_drafts_creator ON publish_drafts(creator_id, updated_at);
CREATE INDEX IF NOT EXISTS idx_package_lineage_version ON package_lineage(package_version_id);
