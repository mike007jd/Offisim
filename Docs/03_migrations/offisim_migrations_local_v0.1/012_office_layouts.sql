PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS office_layouts (
  layout_id   TEXT PRIMARY KEY,
  company_id  TEXT NOT NULL REFERENCES companies(company_id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  layout_json TEXT NOT NULL,
  is_active   INTEGER NOT NULL DEFAULT 0 CHECK (is_active IN (0, 1)),
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_office_layouts_company ON office_layouts(company_id);
