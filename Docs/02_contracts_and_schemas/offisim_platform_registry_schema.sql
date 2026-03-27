-- Offisim Platform Registry Schema Snapshot (Postgres)
-- Source of truth:
--   - packages/db-platform/src/schema.ts
--   - packages/db-platform/src/migrations/
-- Scope:
--   platform auth linkage, creators, marketplace listings, package versions,
--   publish drafts, lineage, reviews, library, install receipts, moderation

-- ── 001: Offisim user records and creator profiles ─────────────────────────

CREATE TABLE IF NOT EXISTS users (
  user_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  avatar_url TEXT,
  auth_provider TEXT NOT NULL,
  auth_subject TEXT NOT NULL,
  ba_user_id TEXT UNIQUE,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS creators (
  creator_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL UNIQUE REFERENCES users(user_id),
  handle TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  bio TEXT,
  website_url TEXT,
  verification_state TEXT NOT NULL DEFAULT 'unverified',
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- ── 002: Marketplace listings and versions ─────────────────────────────────

CREATE TABLE IF NOT EXISTS listings (
  listing_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  creator_id UUID NOT NULL REFERENCES creators(creator_id),
  slug TEXT NOT NULL UNIQUE,
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  summary TEXT,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'listed',
  rating_avg REAL DEFAULT 0,
  rating_count INTEGER DEFAULT 0,
  install_count INTEGER DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS package_versions (
  package_version_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id UUID NOT NULL REFERENCES listings(listing_id),
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
  published_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS listing_tags (
  listing_id UUID NOT NULL REFERENCES listings(listing_id),
  tag TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS listing_previews (
  preview_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id UUID NOT NULL REFERENCES listings(listing_id),
  kind TEXT NOT NULL,
  url TEXT NOT NULL,
  alt_text TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0
);

-- ── 003: Publish drafts and lineage ────────────────────────────────────────

CREATE TABLE IF NOT EXISTS publish_drafts (
  draft_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  creator_id UUID NOT NULL REFERENCES creators(creator_id),
  listing_id UUID REFERENCES listings(listing_id),
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  summary TEXT,
  manifest_json JSONB,
  artifact_id TEXT,
  validation_state TEXT NOT NULL DEFAULT 'unknown',
  validation_report JSONB,
  status TEXT NOT NULL DEFAULT 'draft',
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS package_lineage (
  lineage_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  package_version_id UUID NOT NULL REFERENCES package_versions(package_version_id),
  origin_listing_id UUID REFERENCES listings(listing_id),
  origin_package_id TEXT,
  forked_from_version TEXT
);

CREATE TABLE IF NOT EXISTS moderation_jobs (
  job_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  target_type TEXT NOT NULL,
  target_id UUID NOT NULL,
  job_kind TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  result JSONB,
  assigned_to UUID REFERENCES users(user_id),
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMP
);

-- ── 004: Reviews, user library, and install receipts ───────────────────────

CREATE TABLE IF NOT EXISTS reviews (
  review_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id UUID NOT NULL REFERENCES listings(listing_id),
  user_id UUID NOT NULL REFERENCES users(user_id),
  rating INTEGER NOT NULL,
  title TEXT,
  body TEXT,
  moderation_state TEXT NOT NULL DEFAULT 'visible',
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS user_library (
  user_id UUID NOT NULL REFERENCES users(user_id),
  listing_id UUID NOT NULL REFERENCES listings(listing_id),
  package_version_id UUID REFERENCES package_versions(package_version_id),
  saved_at TIMESTAMP NOT NULL DEFAULT NOW(),
  install_receipt_id TEXT
);

CREATE TABLE IF NOT EXISTS install_receipts (
  install_receipt_id TEXT PRIMARY KEY,
  user_id UUID REFERENCES users(user_id) ON DELETE SET NULL,
  listing_id UUID REFERENCES listings(listing_id) ON DELETE SET NULL,
  package_version_id UUID REFERENCES package_versions(package_version_id) ON DELETE SET NULL,
  install_source TEXT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- ── 005: Better Auth managed tables ────────────────────────────────────────
-- Better Auth owns lifecycle for these tables. They are included here so the
-- documented snapshot matches the runtime schema exposed via Drizzle.

CREATE TABLE IF NOT EXISTS "user" (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  email_verified BOOLEAN NOT NULL DEFAULT FALSE,
  image TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS session (
  id TEXT PRIMARY KEY,
  expires_at TIMESTAMP NOT NULL,
  token TEXT NOT NULL UNIQUE,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  ip_address TEXT,
  user_agent TEXT,
  user_id TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS account (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  provider_id TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  access_token TEXT,
  refresh_token TEXT,
  id_token TEXT,
  access_token_expires_at TIMESTAMP,
  refresh_token_expires_at TIMESTAMP,
  scope TEXT,
  password TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS verification (
  id TEXT PRIMARY KEY,
  identifier TEXT NOT NULL,
  value TEXT NOT NULL,
  expires_at TIMESTAMP NOT NULL,
  created_at TIMESTAMP,
  updated_at TIMESTAMP
);

-- ── 006: API tokens and moderation flags ───────────────────────────────────

CREATE TABLE IF NOT EXISTS api_tokens (
  token_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  token_prefix TEXT NOT NULL,
  scopes JSONB NOT NULL DEFAULT '[]'::jsonb,
  last_used_at TIMESTAMP,
  expires_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS moderation_flags (
  flag_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  target_type TEXT NOT NULL,
  target_id UUID NOT NULL,
  reporter_user_id UUID NOT NULL REFERENCES users(user_id),
  reason TEXT NOT NULL,
  details TEXT,
  status TEXT NOT NULL DEFAULT 'open',
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- ── Recommended indexes from current access patterns ───────────────────────

CREATE INDEX IF NOT EXISTS idx_listings_creator_id ON listings(creator_id);
CREATE INDEX IF NOT EXISTS idx_listings_slug ON listings(slug);
CREATE INDEX IF NOT EXISTS idx_package_versions_listing_id ON package_versions(listing_id);
CREATE INDEX IF NOT EXISTS idx_listing_tags_listing_id ON listing_tags(listing_id);
CREATE INDEX IF NOT EXISTS idx_listing_previews_listing_id ON listing_previews(listing_id);
CREATE INDEX IF NOT EXISTS idx_publish_drafts_creator_id ON publish_drafts(creator_id);
CREATE INDEX IF NOT EXISTS idx_package_lineage_origin_listing_id ON package_lineage(origin_listing_id);
CREATE INDEX IF NOT EXISTS idx_reviews_listing_id ON reviews(listing_id);
CREATE INDEX IF NOT EXISTS idx_user_library_user_id ON user_library(user_id);
CREATE INDEX IF NOT EXISTS idx_install_receipts_listing_id ON install_receipts(listing_id);
CREATE INDEX IF NOT EXISTS idx_api_tokens_user_id ON api_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_moderation_flags_target ON moderation_flags(target_type, target_id);
