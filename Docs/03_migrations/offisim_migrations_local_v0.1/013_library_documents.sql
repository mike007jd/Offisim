PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS library_documents (
  doc_id       TEXT PRIMARY KEY,
  company_id   TEXT NOT NULL REFERENCES companies(company_id) ON DELETE CASCADE,
  title        TEXT NOT NULL,
  content_text TEXT NOT NULL DEFAULT '',
  source_type  TEXT NOT NULL DEFAULT 'file',
  mime_type    TEXT,
  file_size    INTEGER,
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_library_docs_company ON library_documents(company_id);
