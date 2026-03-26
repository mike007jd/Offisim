-- 021 — User-level preference memory
-- Learns user preferences, context, and goals across sessions.
-- Separate from employee memory_entries: different lifecycle, different owners.

CREATE TABLE user_preferences (
  preference_id     TEXT PRIMARY KEY,
  company_id        TEXT NOT NULL,
  category          TEXT NOT NULL CHECK(category IN ('preference', 'context', 'knowledge', 'behavior', 'goal')),
  content           TEXT NOT NULL,
  confidence        REAL NOT NULL DEFAULT 0.7 CHECK(confidence >= 0.0 AND confidence <= 1.0),
  importance        REAL NOT NULL DEFAULT 0.5 CHECK(importance >= 0.0 AND importance <= 1.0),
  source            TEXT NOT NULL DEFAULT 'inferred' CHECK(source IN ('explicit', 'inferred')),
  dedupe_key        TEXT,
  reinforcement_count INTEGER NOT NULL DEFAULT 0,
  access_count      INTEGER NOT NULL DEFAULT 0,
  source_thread_id  TEXT,
  created_at        TEXT NOT NULL DEFAULT (datetime('now')),
  accessed_at       TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_user_pref_company ON user_preferences(company_id);
CREATE INDEX idx_user_pref_category ON user_preferences(category);
CREATE INDEX idx_user_pref_importance ON user_preferences(importance DESC);
CREATE UNIQUE INDEX idx_user_pref_dedupe ON user_preferences(company_id, dedupe_key) WHERE dedupe_key IS NOT NULL;
