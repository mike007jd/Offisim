PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS sop_templates (
  sop_template_id TEXT PRIMARY KEY,
  company_id      TEXT NOT NULL REFERENCES companies(company_id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  description     TEXT NOT NULL DEFAULT '',
  definition_json TEXT NOT NULL,
  source_thread_id TEXT,
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_sop_templates_company ON sop_templates(company_id);
