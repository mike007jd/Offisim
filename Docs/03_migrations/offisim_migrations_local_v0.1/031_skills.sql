-- 031: Skills — two-tier schema (company-global + employee-specific)
-- See openspec/changes/add-skills-foundation-two-tier-schema for rationale.
-- SKILL.md open-standard is the on-disk source of truth; this table is the
-- query index. Uniqueness is enforced via two partial UNIQUE indexes so that
-- SQLite treats NULL employee_id as a single "company-scope bucket" per slug.

CREATE TABLE IF NOT EXISTS skills (
  skill_id     TEXT PRIMARY KEY,
  company_id   TEXT NOT NULL REFERENCES companies(company_id) ON DELETE CASCADE,
  employee_id  TEXT REFERENCES employees(employee_id) ON DELETE CASCADE,
  scope        TEXT NOT NULL CHECK (scope IN ('company', 'employee')),
  slug         TEXT NOT NULL,
  name         TEXT NOT NULL,
  description  TEXT NOT NULL,
  version      TEXT NOT NULL DEFAULT '0.1.0',
  source_kind  TEXT NOT NULL CHECK (source_kind IN ('authored', 'installed', 'forked', 'synthesized')),
  source_ref   TEXT,
  vault_path   TEXT NOT NULL,
  created_at   INTEGER NOT NULL,
  updated_at   INTEGER NOT NULL
);

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

-- Generic key-value settings, used by bootstrap routines to track one-shot
-- migration markers (first consumer: skills_migration_v1_done).
CREATE TABLE IF NOT EXISTS settings (
  key         TEXT PRIMARY KEY,
  value       TEXT NOT NULL,
  updated_at  INTEGER NOT NULL
);
