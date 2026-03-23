-- Migration 018: Agent events — immutable decision log for event sourcing
-- Foundation for Recovery Agent, Heartbeat, and Dynamic Re-Planning

CREATE TABLE IF NOT EXISTS agent_events (
  event_id         TEXT PRIMARY KEY,
  project_id       TEXT REFERENCES projects(project_id) ON DELETE CASCADE,
  thread_id        TEXT NOT NULL,
  company_id       TEXT NOT NULL,
  agent_name       TEXT NOT NULL,   -- 'boss', 'manager', 'pm', 'employee:e-dev-1', 'error', 'recovery', 'hr'
  event_type       TEXT NOT NULL,   -- 'decision', 'action', 'error', 'recovery', 'heartbeat', 'replan'
  payload_json     TEXT NOT NULL,   -- structured event data (immutable, schema-free for extensibility)
  parent_event_id  TEXT,            -- causal chain: this event was caused by which event
  created_at       TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_agent_events_project ON agent_events(project_id, created_at);
CREATE INDEX IF NOT EXISTS idx_agent_events_thread  ON agent_events(thread_id, event_type);
CREATE INDEX IF NOT EXISTS idx_agent_events_agent   ON agent_events(agent_name, event_type);
CREATE INDEX IF NOT EXISTS idx_agent_events_parent  ON agent_events(parent_event_id);
