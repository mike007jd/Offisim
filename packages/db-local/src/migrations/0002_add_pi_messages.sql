-- 0002: per-message transcript persistence for the pi agent loop kernel.
-- Upgrades version 1 → 2. Standalone table (no FK to graph_threads) so pi
-- threads persist independent of the legacy graph thread lifecycle.

CREATE TABLE IF NOT EXISTS pi_messages (
  message_id TEXT PRIMARY KEY,
  thread_id TEXT NOT NULL,
  company_id TEXT NOT NULL,
  employee_id TEXT,
  seq INTEGER NOT NULL CHECK (seq >= 0),
  role TEXT NOT NULL,
  message_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(thread_id, seq)
);
CREATE INDEX IF NOT EXISTS idx_pi_messages_thread ON pi_messages(thread_id, seq);
