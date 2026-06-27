-- 0006_collaboration_turns — upgrade v5 → v6.
--
-- PR-03 Pi Collaboration runtime. Adds the `collaboration_turns` ledger that the
-- collaboration turn controller writes to record each AI reply's lifecycle:
-- streaming / error / usage recovery — NOT a transcript copy (the visible message
-- lives in `collaboration_messages`). One row per scheduled speaker turn (direct
-- reply, a mentioned member, or a roundtable speaker), ordered within its thread.
--
-- Company-scoped only, like the rest of the Collaboration domain: NO `project_id`,
-- never an `agent_runs` / mission row. Additive, DDL-only — no existing table is
-- touched and no row is migrated, so there is no better-sqlite3 native rebuild.
-- End-state matches schema.sql exactly.
--
-- The runner wraps this file in a transaction together with the version stamp
-- (no BEGIN/COMMIT here).

CREATE TABLE IF NOT EXISTS collaboration_turns (
  turn_id            TEXT PRIMARY KEY,
  thread_id          TEXT NOT NULL REFERENCES collaboration_threads(thread_id) ON DELETE CASCADE,
  -- The boss/user message (or, in a roundtable, the round's anchor) that scheduled
  -- this speaker. Not an FK: a turn must stay readable for recovery even if the
  -- trigger message is later removed, and it may reference a not-yet-persisted id.
  trigger_message_id TEXT,
  -- The speaking employee. SET NULL on delete keeps the turn (and its usage /
  -- error recovery data) readable after the employee is dismissed.
  employee_id        TEXT REFERENCES employees(employee_id) ON DELETE SET NULL,
  -- Monotonic order of this turn within the thread (round/speaker scheduling).
  sequence_index     INTEGER NOT NULL,
  status             TEXT NOT NULL DEFAULT 'pending'
                       CHECK (status IN ('pending', 'streaming', 'complete', 'interrupted', 'failed')),
  -- The runtime request id (the collaboration host run id). Lets a recovery pass
  -- correlate a turn back to its in-flight host run / the visible message it upserts.
  runtime_request_id TEXT,
  usage_json         TEXT,
  error_summary      TEXT,
  started_at         TEXT,
  finished_at        TEXT
);

-- Turn scheduling / recovery lookup: a thread's turns in speaker order.
CREATE INDEX IF NOT EXISTS idx_collaboration_turns_thread_sequence
  ON collaboration_turns(thread_id, sequence_index);
