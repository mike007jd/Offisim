-- Migration 019: Recovery knowledge — persistent learning for the Recovery Agent
-- Tracks symptom->cause->fix mappings with success/failure counters

CREATE TABLE IF NOT EXISTS recovery_knowledge (
  knowledge_id   TEXT PRIMARY KEY,
  symptom        TEXT NOT NULL,    -- 'LLM_TIMEOUT', 'TOOL_CALL_FAILED:read_file', 'PARSE_ERROR:json'
  cause          TEXT NOT NULL,    -- 'rate_limit', 'file_not_found', 'malformed_llm_output'
  fix_strategy   TEXT NOT NULL,    -- 'retry_with_backoff', 'switch_model', 'skip_and_continue', 'replan_step', 'escalate', or custom
  fix_config     TEXT,             -- JSON config for the strategy: {"maxRetries": 3, "backoffMs": 5000}
  success_count  INTEGER NOT NULL DEFAULT 0,
  failure_count  INTEGER NOT NULL DEFAULT 0,
  last_used_at   TEXT,
  created_at     TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_recovery_symptom ON recovery_knowledge(symptom, cause);
CREATE INDEX IF NOT EXISTS idx_recovery_strategy ON recovery_knowledge(fix_strategy);
