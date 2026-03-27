-- 005 — Agent memory system
-- 3-layer memory: employee / team / company scope

CREATE TABLE memory_entries (
  memory_id         TEXT PRIMARY KEY,
  company_id        TEXT NOT NULL,
  scope             TEXT NOT NULL CHECK(scope IN ('employee', 'team', 'company')),
  owner_id          TEXT NOT NULL,
  category          TEXT NOT NULL CHECK(category IN ('experience', 'decision', 'knowledge', 'preference')),
  content           TEXT NOT NULL,
  importance        REAL NOT NULL DEFAULT 0.5 CHECK(importance >= 0.0 AND importance <= 1.0),
  source_thread_id  TEXT,
  source_task_run_id TEXT,
  created_at        TEXT NOT NULL DEFAULT (datetime('now')),
  accessed_at       TEXT NOT NULL DEFAULT (datetime('now')),
  access_count      INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX idx_memory_scope_owner ON memory_entries(scope, owner_id);
CREATE INDEX idx_memory_company ON memory_entries(company_id);
CREATE INDEX idx_memory_importance ON memory_entries(importance DESC);
