-- Middleware summary tables — byte-aligned with packages/db-local/src/schema.ts
-- definitions at L595 (nodeSummaries) and L624 (compactSummaries). Both tables
-- are persistence targets for NodeContextMiddleware + ConversationBudget
-- summarization middleware. Missing on desktop pre-v33 → middleware before()
-- raised `no such table` → middleware chain caught as warning, LLM calls kept
-- running but agent prompt context-pack + summary budgets both empty.

CREATE TABLE IF NOT EXISTS node_summaries (
  summary_id TEXT PRIMARY KEY,
  thread_id TEXT NOT NULL REFERENCES graph_threads(thread_id) ON DELETE CASCADE,
  company_id TEXT NOT NULL REFERENCES companies(company_id) ON DELETE CASCADE,
  node_name TEXT NOT NULL,
  employee_id TEXT,
  step_index INTEGER,
  summary_text TEXT NOT NULL,
  decisions_json TEXT NOT NULL,
  files_touched_json TEXT NOT NULL,
  tools_used_json TEXT NOT NULL,
  input_token_count INTEGER NOT NULL DEFAULT 0,
  output_token_count INTEGER NOT NULL DEFAULT 0,
  message_count INTEGER NOT NULL DEFAULT 0,
  duration_ms INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_node_summaries_thread_created
  ON node_summaries(thread_id, created_at);
CREATE INDEX IF NOT EXISTS idx_node_summaries_thread_node
  ON node_summaries(thread_id, node_name, created_at);

CREATE TABLE IF NOT EXISTS compact_summaries (
  compact_id TEXT PRIMARY KEY,
  thread_id TEXT NOT NULL REFERENCES graph_threads(thread_id) ON DELETE CASCADE,
  company_id TEXT NOT NULL REFERENCES companies(company_id) ON DELETE CASCADE,
  compact_kind TEXT NOT NULL,
  summary_source TEXT NOT NULL,
  summary_text TEXT NOT NULL,
  pre_compact_message_count INTEGER NOT NULL DEFAULT 0,
  pre_compact_token_count INTEGER NOT NULL DEFAULT 0,
  messages_compacted INTEGER NOT NULL DEFAULT 0,
  failure_streak INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_compact_summaries_thread_created
  ON compact_summaries(thread_id, created_at);
CREATE INDEX IF NOT EXISTS idx_compact_summaries_thread_kind
  ON compact_summaries(thread_id, compact_kind, created_at);
