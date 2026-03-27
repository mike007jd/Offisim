-- Reviews, favorites, install receipts, moderation
CREATE TABLE IF NOT EXISTS reviews (
  review_id TEXT PRIMARY KEY,
  listing_id TEXT NOT NULL REFERENCES listings(listing_id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  rating INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
  title TEXT,
  body TEXT,
  moderation_state TEXT NOT NULL DEFAULT 'visible' CHECK (moderation_state IN ('visible', 'hidden', 'flagged')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(listing_id, user_id)
);

CREATE TABLE IF NOT EXISTS moderation_jobs (
  job_id TEXT PRIMARY KEY,
  target_type TEXT NOT NULL CHECK (target_type IN ('listing', 'package_version', 'review', 'publish_draft')),
  target_id TEXT NOT NULL,
  job_kind TEXT NOT NULL CHECK (job_kind IN ('manifest_scan', 'policy_review', 'lineage_check', 'risk_review')),
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'approved', 'rejected', 'failed')),
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
  install_source TEXT NOT NULL CHECK (install_source IN ('registry', 'url', 'file')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_reviews_listing ON reviews(listing_id);
CREATE INDEX IF NOT EXISTS idx_moderation_jobs_target ON moderation_jobs(target_type, target_id);
CREATE INDEX IF NOT EXISTS idx_install_receipts_user ON install_receipts(user_id, created_at);
