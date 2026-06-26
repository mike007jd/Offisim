-- 0005_loop_core — upgrade v4 → v5.
--
-- Loop domain (PR-07). Adds the four Loop tables that hold a saveable, versioned,
-- reusable wrapper around the Mission engine: `loop_definitions` point at an
-- immutable selected `loop_revisions` row; `loop_skill_bindings` carry per-revision
-- skills; `loop_invocations` is written ONLY at Office Send materialization (PR-10).
-- Additive, DDL-only — no existing table is touched and no row is migrated, so
-- there is no better-sqlite3 native rebuild. End-state matches schema.sql exactly.
--
-- The runner wraps this file in a transaction together with the version stamp
-- (no BEGIN/COMMIT here).

CREATE TABLE IF NOT EXISTS loop_definitions (
  loop_id             TEXT PRIMARY KEY,
  company_id          TEXT NOT NULL REFERENCES companies(company_id) ON DELETE CASCADE,
  title               TEXT NOT NULL,
  summary             TEXT NOT NULL DEFAULT '',
  profile_id          TEXT NOT NULL,
  current_revision_id TEXT,
  status              TEXT NOT NULL DEFAULT 'draft'
                        CHECK (status IN ('draft', 'ready', 'archived')),
  created_at          TEXT NOT NULL,
  updated_at          TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS loop_revisions (
  revision_id              TEXT PRIMARY KEY,
  loop_id                  TEXT NOT NULL REFERENCES loop_definitions(loop_id) ON DELETE CASCADE,
  revision_number          INTEGER NOT NULL,
  source_prompt            TEXT NOT NULL,
  enhanced_prompt          TEXT,
  compiled_ir_json         TEXT NOT NULL,
  compiler_profile_id      TEXT NOT NULL,
  compiler_profile_version TEXT NOT NULL,
  compiler_version         TEXT NOT NULL,
  compile_status           TEXT NOT NULL
                             CHECK (compile_status IN ('ready', 'needs_input', 'invalid')),
  questions_json           TEXT NOT NULL DEFAULT '[]',
  validation_json          TEXT NOT NULL DEFAULT '{}',
  created_at               TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS loop_skill_bindings (
  binding_id    TEXT PRIMARY KEY,
  revision_id   TEXT NOT NULL REFERENCES loop_revisions(revision_id) ON DELETE CASCADE,
  skill_id      TEXT NOT NULL,
  skill_version TEXT NOT NULL,
  order_index   INTEGER NOT NULL DEFAULT 0,
  config_json   TEXT NOT NULL DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS loop_invocations (
  invocation_id TEXT PRIMARY KEY,
  loop_id       TEXT NOT NULL,
  revision_id   TEXT NOT NULL,
  company_id    TEXT NOT NULL REFERENCES companies(company_id) ON DELETE CASCADE,
  project_id    TEXT,
  thread_id     TEXT NOT NULL,
  message_id    TEXT NOT NULL,
  mission_id    TEXT,
  status        TEXT NOT NULL,
  created_at    TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_loop_definitions_company_updated
  ON loop_definitions(company_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_loop_definitions_status
  ON loop_definitions(status);
CREATE UNIQUE INDEX IF NOT EXISTS idx_loop_revisions_loop_number
  ON loop_revisions(loop_id, revision_number);
CREATE INDEX IF NOT EXISTS idx_loop_revisions_loop_created
  ON loop_revisions(loop_id, created_at);
CREATE INDEX IF NOT EXISTS idx_loop_skill_bindings_revision_order
  ON loop_skill_bindings(revision_id, order_index);
CREATE INDEX IF NOT EXISTS idx_loop_invocations_loop
  ON loop_invocations(loop_id);
CREATE INDEX IF NOT EXISTS idx_loop_invocations_revision
  ON loop_invocations(revision_id);
CREATE INDEX IF NOT EXISTS idx_loop_invocations_company_created
  ON loop_invocations(company_id, created_at);
