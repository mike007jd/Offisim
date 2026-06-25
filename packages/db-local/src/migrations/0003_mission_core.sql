-- 0003_mission_core — upgrade v2 → v3.
--
-- Verified Missions core (PRD §17). Adds the six Mission tables that hold
-- Mission status/criteria truth (ADR 2026-06-25-truth-closure D4); evaluation
-- truth lives in `mission_evaluation`. Additive, DDL-only — no existing table is
-- touched and no row is migrated, so there is no better-sqlite3 native rebuild.
--
-- The runner wraps this file in a transaction together with the version stamp
-- (no BEGIN/COMMIT here).

CREATE TABLE IF NOT EXISTS mission (
  mission_id              TEXT PRIMARY KEY,
  company_id              TEXT NOT NULL REFERENCES companies(company_id) ON DELETE CASCADE,
  project_id              TEXT,
  thread_id               TEXT NOT NULL,
  title                   TEXT NOT NULL,
  goal                    TEXT NOT NULL,
  status                  TEXT NOT NULL,
  runtime_id              TEXT NOT NULL,
  runtime_policy_json     TEXT NOT NULL,
  budget_json             TEXT NOT NULL,
  expected_artifacts_json TEXT,
  current_attempt_id      TEXT,
  created_at              TEXT NOT NULL,
  updated_at              TEXT NOT NULL,
  completed_at            TEXT
);

CREATE TABLE IF NOT EXISTS mission_criterion (
  criterion_id           TEXT PRIMARY KEY,
  mission_id             TEXT NOT NULL REFERENCES mission(mission_id) ON DELETE CASCADE,
  description            TEXT NOT NULL,
  evaluator_id           TEXT NOT NULL,
  evaluator_config_json  TEXT NOT NULL,
  required               INTEGER NOT NULL DEFAULT 1,
  order_index            INTEGER NOT NULL DEFAULT 0,
  status                 TEXT NOT NULL DEFAULT 'pending',
  last_evaluation_id     TEXT
);

CREATE TABLE IF NOT EXISTS mission_attempt (
  attempt_id               TEXT PRIMARY KEY,
  mission_id               TEXT NOT NULL REFERENCES mission(mission_id) ON DELETE CASCADE,
  attempt_number           INTEGER NOT NULL,
  root_run_id              TEXT,
  runtime_session_link_id  TEXT,
  trigger                  TEXT NOT NULL,
  status                   TEXT NOT NULL,
  failure_signature        TEXT,
  started_at               TEXT NOT NULL,
  finished_at              TEXT
);

CREATE TABLE IF NOT EXISTS mission_evaluation (
  evaluation_id      TEXT PRIMARY KEY,
  mission_id         TEXT NOT NULL REFERENCES mission(mission_id) ON DELETE CASCADE,
  criterion_id       TEXT NOT NULL,
  attempt_id         TEXT NOT NULL,
  evaluator_id       TEXT NOT NULL,
  verdict            TEXT NOT NULL,
  summary            TEXT NOT NULL,
  evidence_refs_json TEXT NOT NULL,
  duration_ms        INTEGER,
  created_at         TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS runtime_session_link (
  runtime_session_link_id TEXT PRIMARY KEY,
  mission_id              TEXT NOT NULL REFERENCES mission(mission_id) ON DELETE CASCADE,
  runtime_id              TEXT NOT NULL,
  runtime_version         TEXT,
  opaque_session_ref_json TEXT NOT NULL,
  compatibility_hash      TEXT,
  workspace_lease_id      TEXT,
  last_safe_boundary      TEXT,
  status                  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS mission_event (
  mission_event_id TEXT PRIMARY KEY,
  mission_id       TEXT NOT NULL REFERENCES mission(mission_id) ON DELETE CASCADE,
  attempt_id       TEXT,
  type             TEXT NOT NULL,
  data_json        TEXT NOT NULL,
  created_at       TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_mission_company_time
  ON mission(company_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_mission_status
  ON mission(status);
CREATE INDEX IF NOT EXISTS idx_mission_criterion_mission_order
  ON mission_criterion(mission_id, order_index);
CREATE INDEX IF NOT EXISTS idx_mission_attempt_mission_number
  ON mission_attempt(mission_id, attempt_number);
CREATE INDEX IF NOT EXISTS idx_mission_evaluation_mission_criterion
  ON mission_evaluation(mission_id, criterion_id);
CREATE INDEX IF NOT EXISTS idx_mission_evaluation_attempt
  ON mission_evaluation(attempt_id);
CREATE INDEX IF NOT EXISTS idx_runtime_session_link_mission
  ON runtime_session_link(mission_id);
CREATE INDEX IF NOT EXISTS idx_mission_event_mission_time
  ON mission_event(mission_id, created_at);
