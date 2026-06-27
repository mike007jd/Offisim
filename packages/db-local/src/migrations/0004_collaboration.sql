-- 0004_collaboration — upgrade v3 → v4.
--
-- PR-02 Collaboration: company-scoped daily chat (direct + group) that is FULLY
-- separate from project-scoped `chat_threads`. No `project_id`, never surfaced
-- in Office work sessions, never crosses into the chatThreads repository.
-- Additive, DDL-only — no existing table is touched and no row is migrated, so
-- there is no better-sqlite3 native rebuild. End-state matches schema.sql.
--
-- The runner wraps this file in a transaction together with the version stamp
-- (no BEGIN/COMMIT here).

CREATE TABLE IF NOT EXISTS collaboration_threads (
  thread_id          TEXT PRIMARY KEY,
  company_id         TEXT NOT NULL REFERENCES companies(company_id) ON DELETE CASCADE,
  kind               TEXT NOT NULL CHECK (kind IN ('direct', 'group')),
  title              TEXT NOT NULL,
  direct_employee_id TEXT REFERENCES employees(employee_id) ON DELETE SET NULL,
  reply_policy       TEXT NOT NULL DEFAULT 'mentions_only'
                       CHECK (reply_policy IN ('mentions_only', 'roundtable', 'silent')),
  round_speaker_limit INTEGER NOT NULL DEFAULT 3,
  created_by         TEXT NOT NULL DEFAULT 'boss',
  archived_at        TEXT,
  created_at         TEXT NOT NULL,
  updated_at         TEXT NOT NULL,
  -- A group thread must not carry a direct_employee_id (data hygiene; the
  -- active-direct partial index already excludes non-direct rows). A direct
  -- thread MAY have a null direct_employee_id after the employee is deleted
  -- (ON DELETE SET NULL keeps the thread + message snapshots readable).
  CHECK (kind = 'direct' OR direct_employee_id IS NULL)
);

CREATE TABLE IF NOT EXISTS collaboration_thread_members (
  member_id    TEXT PRIMARY KEY,
  thread_id    TEXT NOT NULL REFERENCES collaboration_threads(thread_id) ON DELETE CASCADE,
  actor_type   TEXT NOT NULL CHECK (actor_type IN ('boss', 'employee')),
  employee_id  TEXT REFERENCES employees(employee_id) ON DELETE CASCADE,
  role         TEXT NOT NULL CHECK (role IN ('owner', 'member')),
  joined_at    TEXT NOT NULL,
  left_at      TEXT
);

CREATE TABLE IF NOT EXISTS collaboration_messages (
  message_id          TEXT PRIMARY KEY,
  thread_id           TEXT NOT NULL REFERENCES collaboration_threads(thread_id) ON DELETE CASCADE,
  sender_type         TEXT NOT NULL CHECK (sender_type IN ('boss', 'employee', 'system')),
  sender_employee_id  TEXT REFERENCES employees(employee_id) ON DELETE SET NULL,
  body                TEXT NOT NULL,
  reply_to_message_id TEXT,
  status              TEXT NOT NULL DEFAULT 'complete'
                        CHECK (status IN ('pending', 'streaming', 'complete', 'interrupted', 'failed')),
  idempotency_key     TEXT,
  metadata_json       TEXT,
  created_at          TEXT NOT NULL,
  edited_at           TEXT
);

CREATE TABLE IF NOT EXISTS collaboration_read_state (
  thread_id            TEXT PRIMARY KEY REFERENCES collaboration_threads(thread_id) ON DELETE CASCADE,
  last_read_message_id TEXT,
  updated_at           TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_collaboration_threads_company_updated
  ON collaboration_threads(company_id, updated_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_collaboration_threads_active_direct
  ON collaboration_threads(company_id, direct_employee_id)
  WHERE kind = 'direct' AND archived_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_collaboration_messages_thread_time
  ON collaboration_messages(thread_id, created_at, message_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_collaboration_messages_idempotency
  ON collaboration_messages(thread_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_collaboration_members_thread
  ON collaboration_thread_members(thread_id);
CREATE INDEX IF NOT EXISTS idx_collaboration_members_employee
  ON collaboration_thread_members(employee_id);
