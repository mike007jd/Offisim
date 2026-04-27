-- 027: Skills — allow LLM self-authored provenance.
--
-- SQLite cannot ALTER a CHECK constraint in place, so rebuild the table with
-- the same columns/indexes and no source_kind enum constraint.

PRAGMA foreign_keys=off;

CREATE TABLE IF NOT EXISTS skills_next (
  skill_id     TEXT PRIMARY KEY,
  company_id   TEXT NOT NULL REFERENCES companies(company_id) ON DELETE CASCADE,
  employee_id  TEXT REFERENCES employees(employee_id) ON DELETE CASCADE,
  scope        TEXT NOT NULL CHECK (scope IN ('company', 'employee')),
  slug         TEXT NOT NULL,
  name         TEXT NOT NULL,
  description  TEXT NOT NULL,
  version      TEXT NOT NULL DEFAULT '0.1.0',
  source_kind  TEXT NOT NULL,
  source_ref   TEXT,
  vault_path   TEXT NOT NULL,
  created_at   INTEGER NOT NULL,
  updated_at   INTEGER NOT NULL
);

INSERT OR IGNORE INTO skills_next (
  skill_id,
  company_id,
  employee_id,
  scope,
  slug,
  name,
  description,
  version,
  source_kind,
  source_ref,
  vault_path,
  created_at,
  updated_at
)
SELECT
  skill_id,
  company_id,
  employee_id,
  scope,
  slug,
  name,
  description,
  version,
  source_kind,
  source_ref,
  vault_path,
  created_at,
  updated_at
FROM skills;

DROP TABLE IF EXISTS skills;
ALTER TABLE skills_next RENAME TO skills;

CREATE UNIQUE INDEX IF NOT EXISTS idx_skills_company_slug
  ON skills(company_id, slug)
  WHERE employee_id IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_skills_employee_slug
  ON skills(company_id, employee_id, slug)
  WHERE employee_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_skills_company_scope
  ON skills(company_id, scope);

CREATE INDEX IF NOT EXISTS idx_skills_employee
  ON skills(employee_id)
  WHERE employee_id IS NOT NULL;

PRAGMA foreign_keys=on;
