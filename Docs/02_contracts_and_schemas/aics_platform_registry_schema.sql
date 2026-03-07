-- AI Company Simulator — Platform Registry Schema Draft (Postgres)
-- Scope: creator identity, listings, versioned packages, artifacts, reviews, moderation

CREATE TABLE IF NOT EXISTS users (
  user_id TEXT PRIMARY KEY,
  email TEXT UNIQUE,
  auth_provider TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS creator_profiles (
  creator_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL UNIQUE REFERENCES users(user_id) ON DELETE CASCADE,
  handle TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  bio TEXT,
  website_url TEXT,
  verification_state TEXT NOT NULL DEFAULT 'unverified',
  reputation_score NUMERIC(10,2) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS listings (
  listing_id TEXT PRIMARY KEY,
  creator_id TEXT NOT NULL REFERENCES creator_profiles(creator_id) ON DELETE CASCADE,
  slug TEXT NOT NULL UNIQUE,
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  summary TEXT,
  status TEXT NOT NULL DEFAULT 'draft', -- draft | listed | hidden | retired
  visibility TEXT NOT NULL DEFAULT 'public',
  latest_package_version_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS package_versions (
  package_version_id TEXT PRIMARY KEY,
  package_id TEXT NOT NULL,
  creator_id TEXT NOT NULL REFERENCES creator_profiles(creator_id) ON DELETE CASCADE,
  package_kind TEXT NOT NULL,
  version TEXT NOT NULL,
  manifest_json JSONB NOT NULL,
  package_hash TEXT NOT NULL,
  runtime_range TEXT NOT NULL,
  schema_version TEXT NOT NULL,
  supported_environments JSONB NOT NULL,
  risk_class TEXT NOT NULL,
  artifact_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(package_id, version)
);

CREATE TABLE IF NOT EXISTS listing_versions (
  listing_version_id TEXT PRIMARY KEY,
  listing_id TEXT NOT NULL REFERENCES listings(listing_id) ON DELETE CASCADE,
  package_version_id TEXT NOT NULL REFERENCES package_versions(package_version_id) ON DELETE CASCADE,
  channel TEXT NOT NULL DEFAULT 'stable', -- stable | beta | archived
  is_latest BOOLEAN NOT NULL DEFAULT FALSE,
  moderation_state TEXT NOT NULL DEFAULT 'pending',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(listing_id, package_version_id)
);

ALTER TABLE listings
  ADD CONSTRAINT fk_listings_latest_pkg
  FOREIGN KEY (latest_package_version_id)
  REFERENCES package_versions(package_version_id)
  DEFERRABLE INITIALLY DEFERRED;

CREATE TABLE IF NOT EXISTS artifacts (
  artifact_id TEXT PRIMARY KEY,
  storage_backend TEXT NOT NULL, -- registry_object | external_url | github_release | npm
  object_key TEXT,
  external_url TEXT,
  size_bytes BIGINT,
  sha256 TEXT NOT NULL,
  mime_type TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE package_versions
  ADD CONSTRAINT fk_package_versions_artifact
  FOREIGN KEY (artifact_id)
  REFERENCES artifacts(artifact_id)
  DEFERRABLE INITIALLY DEFERRED;

CREATE TABLE IF NOT EXISTS lineage_edges (
  edge_id TEXT PRIMARY KEY,
  child_package_id TEXT NOT NULL,
  child_version TEXT,
  parent_package_id TEXT NOT NULL,
  parent_version TEXT,
  relation_type TEXT NOT NULL, -- fork | derivative | inspired_by
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS reviews (
  review_id TEXT PRIMARY KEY,
  listing_id TEXT NOT NULL REFERENCES listings(listing_id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  rating INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
  title TEXT,
  body TEXT,
  moderation_state TEXT NOT NULL DEFAULT 'visible',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(listing_id, user_id)
);

CREATE TABLE IF NOT EXISTS moderation_jobs (
  job_id TEXT PRIMARY KEY,
  target_type TEXT NOT NULL, -- listing | package_version | review
  target_id TEXT NOT NULL,
  job_kind TEXT NOT NULL,    -- manifest_scan | policy_review | lineage_check
  status TEXT NOT NULL DEFAULT 'queued',
  findings_json JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS favorites (
  favorite_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  listing_id TEXT NOT NULL REFERENCES listings(listing_id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, listing_id)
);

CREATE TABLE IF NOT EXISTS install_receipts (
  install_receipt_id TEXT PRIMARY KEY,
  user_id TEXT REFERENCES users(user_id) ON DELETE SET NULL,
  listing_id TEXT REFERENCES listings(listing_id) ON DELETE SET NULL,
  package_version_id TEXT REFERENCES package_versions(package_version_id) ON DELETE SET NULL,
  install_source TEXT NOT NULL, -- registry | url | file
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_listings_creator ON listings(creator_id);
CREATE INDEX IF NOT EXISTS idx_package_versions_package ON package_versions(package_id);
CREATE INDEX IF NOT EXISTS idx_listing_versions_listing ON listing_versions(listing_id);
CREATE INDEX IF NOT EXISTS idx_reviews_listing ON reviews(listing_id);
CREATE INDEX IF NOT EXISTS idx_moderation_jobs_target ON moderation_jobs(target_type, target_id);