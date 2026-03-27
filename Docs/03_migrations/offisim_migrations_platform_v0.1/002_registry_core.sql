-- Platform listing and version registry
CREATE TABLE IF NOT EXISTS listings (
  listing_id TEXT PRIMARY KEY,
  creator_id TEXT NOT NULL REFERENCES creator_profiles(creator_id) ON DELETE CASCADE,
  slug TEXT NOT NULL UNIQUE,
  kind TEXT NOT NULL CHECK (kind IN ('employee', 'skill', 'sop', 'company_template', 'office_layout', 'bundle')),
  title TEXT NOT NULL,
  summary TEXT,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'listed', 'hidden', 'retired')),
  visibility TEXT NOT NULL DEFAULT 'public' CHECK (visibility IN ('public', 'unlisted', 'private')),
  latest_package_version_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS artifacts (
  artifact_id TEXT PRIMARY KEY,
  storage_backend TEXT NOT NULL CHECK (storage_backend IN ('registry_object', 'external_url', 'github_release', 'npm')),
  object_key TEXT,
  external_url TEXT,
  size_bytes BIGINT,
  sha256 TEXT NOT NULL,
  mime_type TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS package_versions (
  package_version_id TEXT PRIMARY KEY,
  package_id TEXT NOT NULL,
  creator_id TEXT NOT NULL REFERENCES creator_profiles(creator_id) ON DELETE CASCADE,
  package_kind TEXT NOT NULL CHECK (package_kind IN ('employee', 'skill', 'sop', 'company_template', 'office_layout', 'bundle')),
  version TEXT NOT NULL,
  manifest_json JSONB NOT NULL,
  package_hash TEXT NOT NULL,
  runtime_range TEXT NOT NULL,
  schema_version TEXT NOT NULL,
  supported_environments JSONB NOT NULL,
  risk_class TEXT NOT NULL CHECK (risk_class IN ('data_asset', 'logic_asset', 'privileged_asset')),
  artifact_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(package_id, version)
);

CREATE TABLE IF NOT EXISTS listing_versions (
  listing_version_id TEXT PRIMARY KEY,
  listing_id TEXT NOT NULL REFERENCES listings(listing_id) ON DELETE CASCADE,
  package_version_id TEXT NOT NULL REFERENCES package_versions(package_version_id) ON DELETE CASCADE,
  channel TEXT NOT NULL DEFAULT 'stable' CHECK (channel IN ('stable', 'beta', 'archived')),
  is_latest BOOLEAN NOT NULL DEFAULT FALSE,
  moderation_state TEXT NOT NULL DEFAULT 'pending' CHECK (moderation_state IN ('pending', 'approved', 'rejected', 'hidden')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(listing_id, package_version_id)
);

ALTER TABLE package_versions
  ADD CONSTRAINT fk_package_versions_artifact
  FOREIGN KEY (artifact_id)
  REFERENCES artifacts(artifact_id)
  DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE listings
  ADD CONSTRAINT fk_listings_latest_pkg
  FOREIGN KEY (latest_package_version_id)
  REFERENCES package_versions(package_version_id)
  DEFERRABLE INITIALLY DEFERRED;

CREATE INDEX IF NOT EXISTS idx_listings_creator ON listings(creator_id);
CREATE INDEX IF NOT EXISTS idx_package_versions_package ON package_versions(package_id);
CREATE INDEX IF NOT EXISTS idx_listing_versions_listing ON listing_versions(listing_id);
