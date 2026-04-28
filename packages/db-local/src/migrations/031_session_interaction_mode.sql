ALTER TABLE meeting_sessions
  ADD COLUMN interaction_mode TEXT NOT NULL DEFAULT 'boss_proxy';

CREATE INDEX IF NOT EXISTS idx_meeting_sessions_mode
  ON meeting_sessions(interaction_mode);
