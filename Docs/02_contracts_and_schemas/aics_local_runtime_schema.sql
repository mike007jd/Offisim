-- AI Company Simulator — Local Runtime Schema Draft (SQLite)
-- Scope: install state, runtime entities, orchestration persistence, audit logs
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS companies (
  company_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  workspace_root TEXT,
  default_model_policy_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS workstations (
  workstation_id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(company_id) ON DELETE CASCADE,
  room_type TEXT NOT NULL,
  label TEXT NOT NULL,
  position_json TEXT,
  seat_capacity INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS racks (
  rack_id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(company_id) ON DELETE CASCADE,
  provider_type TEXT NOT NULL,
  label TEXT NOT NULL,
  binding_profile_json TEXT,
  status TEXT NOT NULL DEFAULT 'unbound',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS slots (
  slot_id TEXT PRIMARY KEY,
  rack_id TEXT NOT NULL REFERENCES racks(rack_id) ON DELETE CASCADE,
  capability_name TEXT NOT NULL,
  exposure_scope TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'available',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS workstation_racks (
  workstation_id TEXT NOT NULL REFERENCES workstations(workstation_id) ON DELETE CASCADE,
  rack_id TEXT NOT NULL REFERENCES racks(rack_id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  PRIMARY KEY (workstation_id, rack_id)
);

CREATE TABLE IF NOT EXISTS employees (
  employee_id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(company_id) ON DELETE CASCADE,
  source_asset_id TEXT,
  source_package_id TEXT,
  name TEXT NOT NULL,
  role_slug TEXT NOT NULL,
  workstation_id TEXT REFERENCES workstations(workstation_id) ON DELETE SET NULL,
  persona_json TEXT,
  config_json TEXT,
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS installed_packages (
  installed_package_id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(company_id) ON DELETE CASCADE,
  package_id TEXT NOT NULL,
  package_kind TEXT NOT NULL,
  version TEXT NOT NULL,
  source_type TEXT NOT NULL,  -- registry | url | file
  source_ref TEXT,
  manifest_hash TEXT NOT NULL,
  package_hash TEXT NOT NULL,
  install_state TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  installed_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS installed_assets (
  installed_asset_id TEXT PRIMARY KEY,
  installed_package_id TEXT NOT NULL REFERENCES installed_packages(installed_package_id) ON DELETE CASCADE,
  asset_id TEXT NOT NULL,
  asset_kind TEXT NOT NULL,
  local_instance_id TEXT,
  entrypoint TEXT,
  enabled INTEGER NOT NULL DEFAULT 1,
  override_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS asset_bindings (
  binding_id TEXT PRIMARY KEY,
  installed_asset_id TEXT REFERENCES installed_assets(installed_asset_id) ON DELETE CASCADE,
  install_txn_id TEXT REFERENCES install_transactions(install_txn_id) ON DELETE SET NULL,
  binding_type TEXT NOT NULL, -- model_profile | secret_slot | workspace_map | mcp_slot
  binding_key TEXT NOT NULL,
  binding_value_json TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (installed_asset_id IS NOT NULL OR install_txn_id IS NOT NULL)
);

CREATE TABLE IF NOT EXISTS install_transactions (
  install_txn_id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(company_id) ON DELETE CASCADE,
  source_type TEXT NOT NULL,
  source_ref TEXT,
  target_package_id TEXT,
  target_version TEXT,
  state TEXT NOT NULL,
  error_code TEXT,
  error_detail TEXT,
  descriptor_json TEXT,
  actor_type TEXT NOT NULL DEFAULT 'user',
  started_at TEXT NOT NULL,
  finished_at TEXT
);

CREATE TABLE IF NOT EXISTS graph_threads (
  thread_id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(company_id) ON DELETE CASCADE,
  entry_mode TEXT NOT NULL, -- boss_chat | meeting | install_flow | background_sync
  root_task_id TEXT,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS graph_checkpoints (
  checkpoint_id TEXT PRIMARY KEY,
  thread_id TEXT NOT NULL REFERENCES graph_threads(thread_id) ON DELETE CASCADE,
  checkpoint_seq INTEGER NOT NULL,
  checkpoint_kind TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(thread_id, checkpoint_seq)
);

CREATE TABLE IF NOT EXISTS task_runs (
  task_run_id TEXT PRIMARY KEY,
  thread_id TEXT NOT NULL REFERENCES graph_threads(thread_id) ON DELETE CASCADE,
  employee_id TEXT REFERENCES employees(employee_id) ON DELETE SET NULL,
  parent_task_run_id TEXT REFERENCES task_runs(task_run_id) ON DELETE SET NULL,
  task_type TEXT NOT NULL,
  status TEXT NOT NULL,
  input_json TEXT,
  output_json TEXT,
  started_at TEXT NOT NULL,
  finished_at TEXT
);

CREATE TABLE IF NOT EXISTS tool_calls (
  tool_call_id TEXT PRIMARY KEY,
  task_run_id TEXT NOT NULL REFERENCES task_runs(task_run_id) ON DELETE CASCADE,
  tool_name TEXT NOT NULL,
  capability_name TEXT,
  rack_id TEXT REFERENCES racks(rack_id) ON DELETE SET NULL,
  status TEXT NOT NULL,
  review_state TEXT NOT NULL DEFAULT 'none',
  request_json TEXT,
  response_json TEXT,
  started_at TEXT NOT NULL,
  finished_at TEXT
);

CREATE TABLE IF NOT EXISTS handoff_events (
  handoff_id TEXT PRIMARY KEY,
  thread_id TEXT NOT NULL REFERENCES graph_threads(thread_id) ON DELETE CASCADE,
  from_employee_id TEXT REFERENCES employees(employee_id) ON DELETE SET NULL,
  to_employee_id TEXT REFERENCES employees(employee_id) ON DELETE SET NULL,
  reason TEXT,
  payload_json TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS meeting_sessions (
  meeting_id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(company_id) ON DELETE CASCADE,
  thread_id TEXT REFERENCES graph_threads(thread_id) ON DELETE SET NULL,
  topic TEXT NOT NULL,
  status TEXT NOT NULL,
  summary_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS runtime_events (
  event_id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(company_id) ON DELETE CASCADE,
  thread_id TEXT REFERENCES graph_threads(thread_id) ON DELETE SET NULL,
  event_type TEXT NOT NULL,
  severity TEXT NOT NULL DEFAULT 'info',
  payload_json TEXT,
  created_at TEXT NOT NULL
);

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

-- Prefab System: office elements as stateful, bindable AI-concept entities
CREATE TABLE IF NOT EXISTS prefab_instances (
  instance_id   TEXT PRIMARY KEY,
  company_id    TEXT NOT NULL REFERENCES companies(company_id) ON DELETE CASCADE,
  prefab_id     TEXT NOT NULL,
  zone_id       TEXT NOT NULL,
  position_x    REAL NOT NULL DEFAULT 0,
  position_y    REAL NOT NULL DEFAULT 0,
  rotation      INTEGER NOT NULL DEFAULT 0,
  bindings_json TEXT,
  config_json   TEXT,
  enabled       INTEGER NOT NULL DEFAULT 1,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_installed_packages_company ON installed_packages(company_id);
CREATE INDEX IF NOT EXISTS idx_installed_assets_pkg ON installed_assets(installed_package_id);
CREATE INDEX IF NOT EXISTS idx_task_runs_thread ON task_runs(thread_id);
CREATE INDEX IF NOT EXISTS idx_tool_calls_task ON tool_calls(task_run_id);
CREATE INDEX IF NOT EXISTS idx_runtime_events_company_time ON runtime_events(company_id, created_at);
CREATE INDEX IF NOT EXISTS idx_llm_calls_thread ON llm_calls(thread_id);
CREATE INDEX IF NOT EXISTS idx_llm_calls_task_run ON llm_calls(task_run_id);
CREATE INDEX IF NOT EXISTS idx_prefab_instances_company ON prefab_instances(company_id);
CREATE INDEX IF NOT EXISTS idx_prefab_instances_zone ON prefab_instances(company_id, zone_id);