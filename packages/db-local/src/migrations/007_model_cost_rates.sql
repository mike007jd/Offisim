-- 007: Model cost rates for LLM usage tracking
CREATE TABLE IF NOT EXISTS model_cost_rates (
  rate_id              TEXT PRIMARY KEY,
  provider             TEXT NOT NULL,
  model_pattern        TEXT NOT NULL,
  input_cost_per_mtok  REAL NOT NULL,
  output_cost_per_mtok REAL NOT NULL,
  effective_from       TEXT NOT NULL,
  effective_until      TEXT,
  created_at           TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_cost_rates_provider_model
  ON model_cost_rates(provider, model_pattern, effective_from);
