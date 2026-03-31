-- Reviews, library, install receipts, moderation
CREATE TABLE IF NOT EXISTS reviews (
  review_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id UUID NOT NULL REFERENCES listings(listing_id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  rating INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
  title TEXT,
  body TEXT,
  moderation_state TEXT NOT NULL DEFAULT 'visible',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(listing_id, user_id)
);

CREATE TABLE IF NOT EXISTS user_library (
  user_id UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  listing_id UUID NOT NULL REFERENCES listings(listing_id) ON DELETE CASCADE,
  package_version_id UUID REFERENCES package_versions(package_version_id) ON DELETE SET NULL,
  saved_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  install_receipt_id TEXT
);

CREATE TABLE IF NOT EXISTS install_receipts (
  install_receipt_id TEXT PRIMARY KEY,
  user_id UUID REFERENCES users(user_id) ON DELETE SET NULL,
  listing_id UUID REFERENCES listings(listing_id) ON DELETE SET NULL,
  package_version_id UUID REFERENCES package_versions(package_version_id) ON DELETE SET NULL,
  install_source TEXT NOT NULL CHECK (install_source IN ('registry', 'url', 'file')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS moderation_jobs (
  job_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  target_type TEXT NOT NULL,
  target_id UUID NOT NULL,
  job_kind TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  result JSONB,
  assigned_to UUID REFERENCES users(user_id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS moderation_flags (
  flag_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  target_type TEXT NOT NULL,
  target_id UUID NOT NULL,
  reporter_user_id UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  reason TEXT NOT NULL,
  details TEXT,
  status TEXT NOT NULL DEFAULT 'open',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_reviews_listing ON reviews(listing_id);
CREATE INDEX IF NOT EXISTS idx_user_library_user ON user_library(user_id, saved_at);
CREATE INDEX IF NOT EXISTS idx_install_receipts_user ON install_receipts(user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_moderation_jobs_target ON moderation_jobs(target_type, target_id);
CREATE INDEX IF NOT EXISTS idx_moderation_flags_target ON moderation_flags(target_type, target_id);
