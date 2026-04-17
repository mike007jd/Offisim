-- 023: Deliverables — structured artifact history from deliverable.created events
-- Row-per-deliverable with inline content (see persist-deliverable-history change)

CREATE TABLE IF NOT EXISTS deliverables (
  deliverable_id     TEXT PRIMARY KEY,
  company_id         TEXT NOT NULL REFERENCES companies(company_id) ON DELETE CASCADE,
  thread_id          TEXT,
  title              TEXT NOT NULL,
  content            TEXT NOT NULL,
  kind               TEXT,
  file_name          TEXT,
  mime_type          TEXT,
  contributors_json  TEXT NOT NULL,
  created_at         TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_deliverables_company_time
  ON deliverables(company_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_deliverables_thread_time
  ON deliverables(thread_id, created_at DESC);
