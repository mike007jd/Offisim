-- Phase 2.1: LLM call tracking for cost and audit

CREATE TABLE IF NOT EXISTS llm_calls (
  llm_call_id   TEXT PRIMARY KEY,
  thread_id     TEXT REFERENCES graph_threads(thread_id) ON DELETE SET NULL,
  task_run_id   TEXT REFERENCES task_runs(task_run_id) ON DELETE SET NULL,
  node_name     TEXT NOT NULL,
  provider      TEXT NOT NULL,
  model         TEXT NOT NULL,
  input_tokens  INTEGER NOT NULL,
  output_tokens INTEGER NOT NULL,
  usage_raw_json TEXT,
  response_json  TEXT,
  latency_ms    INTEGER,
  error_code    TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_llm_calls_thread ON llm_calls(thread_id);
CREATE INDEX IF NOT EXISTS idx_llm_calls_task_run ON llm_calls(task_run_id);
