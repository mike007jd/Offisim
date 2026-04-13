ALTER TABLE graph_threads
  ADD COLUMN interaction_mode TEXT NOT NULL DEFAULT 'boss_proxy';

CREATE TABLE active_thread_interactions (
  thread_id TEXT PRIMARY KEY REFERENCES graph_threads(thread_id) ON DELETE CASCADE,
  company_id TEXT NOT NULL REFERENCES companies(company_id) ON DELETE CASCADE,
  interaction_id TEXT NOT NULL UNIQUE,
  kind TEXT NOT NULL,
  interaction_mode TEXT NOT NULL,
  request_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX idx_active_interactions_company
  ON active_thread_interactions(company_id, updated_at);

CREATE INDEX idx_active_interactions_kind
  ON active_thread_interactions(kind, updated_at);

CREATE TABLE interaction_history (
  history_id TEXT PRIMARY KEY,
  interaction_id TEXT NOT NULL,
  thread_id TEXT NOT NULL REFERENCES graph_threads(thread_id) ON DELETE CASCADE,
  company_id TEXT NOT NULL REFERENCES companies(company_id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  interaction_mode TEXT NOT NULL,
  status TEXT NOT NULL,
  selected_option_id TEXT,
  freeform_response TEXT,
  request_json TEXT NOT NULL,
  response_json TEXT,
  created_at TEXT NOT NULL,
  resolved_at TEXT NOT NULL
);

CREATE INDEX idx_interaction_history_thread
  ON interaction_history(thread_id, resolved_at);

CREATE INDEX idx_interaction_history_company
  ON interaction_history(company_id, resolved_at);

CREATE INDEX idx_interaction_history_kind
  ON interaction_history(kind, resolved_at);
