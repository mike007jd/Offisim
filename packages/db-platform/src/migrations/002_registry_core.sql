-- Platform listing and version registry
CREATE TABLE IF NOT EXISTS listings (
  listing_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  creator_id UUID NOT NULL REFERENCES creators(creator_id) ON DELETE CASCADE,
  slug TEXT NOT NULL UNIQUE,
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  summary TEXT,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'listed',
  rating_avg REAL DEFAULT 0,
  rating_count INTEGER DEFAULT 0,
  install_count INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS package_versions (
  package_version_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id UUID NOT NULL REFERENCES listings(listing_id) ON DELETE CASCADE,
  package_id TEXT NOT NULL,
  version TEXT NOT NULL,
  manifest_json JSONB NOT NULL,
  runtime_range TEXT NOT NULL,
  schema_version TEXT NOT NULL,
  environments JSONB NOT NULL,
  risk_class TEXT NOT NULL,
  artifact_url TEXT,
  artifact_sha256 TEXT,
  artifact_size_bytes INTEGER,
  changelog TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  published_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(package_id, version)
);

CREATE TABLE IF NOT EXISTS listing_tags (
  listing_id UUID NOT NULL REFERENCES listings(listing_id) ON DELETE CASCADE,
  tag TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS listing_previews (
  preview_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id UUID NOT NULL REFERENCES listings(listing_id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  url TEXT NOT NULL,
  alt_text TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_listings_creator ON listings(creator_id);
CREATE INDEX IF NOT EXISTS idx_package_versions_listing ON package_versions(listing_id);
CREATE INDEX IF NOT EXISTS idx_package_versions_package ON package_versions(package_id);
CREATE INDEX IF NOT EXISTS idx_listing_tags_listing ON listing_tags(listing_id);
CREATE INDEX IF NOT EXISTS idx_listing_previews_listing ON listing_previews(listing_id, sort_order);
