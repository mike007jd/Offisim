-- 0009_collaboration_profile — upgrade v8 → v9.
--
-- Adds the Connect capability profile switch. Existing daily-chat threads remain
-- strict; only explicit user toggles can enable read-only collaboration tools.

ALTER TABLE collaboration_threads
  ADD COLUMN capability_profile TEXT NOT NULL DEFAULT 'strict'
  CHECK (capability_profile IN ('strict', 'collaboration_read'));
