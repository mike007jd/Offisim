-- Offisim — Local Runtime Schema Snapshot (SQLite)
-- Scope: install state, runtime entities, orchestration persistence, audit logs
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS companies (
  company_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  template_id TEXT,
  template_label TEXT,
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
  entry_mode TEXT NOT NULL, -- boss_chat | meeting | install_flow | background_sync | direct_chat
  root_task_id TEXT,
  status TEXT NOT NULL,
  project_id TEXT,
  interaction_mode TEXT NOT NULL DEFAULT 'boss_proxy',
  synopsis_json TEXT,
  compact_baseline_json TEXT,
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

CREATE TABLE IF NOT EXISTS memory_entries (
  memory_id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL,
  scope TEXT NOT NULL CHECK(scope IN ('employee', 'team', 'company')),
  owner_id TEXT NOT NULL,
  category TEXT NOT NULL CHECK(category IN ('experience', 'decision', 'knowledge', 'preference')),
  content TEXT NOT NULL,
  importance REAL NOT NULL DEFAULT 0.5 CHECK(importance >= 0.0 AND importance <= 1.0),
  confidence REAL NOT NULL DEFAULT 0.7 CHECK(confidence >= 0.0 AND confidence <= 1.0),
  dedupe_key TEXT NOT NULL,
  reinforcement_count INTEGER NOT NULL DEFAULT 1,
  last_reinforced_at TEXT NOT NULL DEFAULT (datetime('now')),
  metadata_json TEXT,
  source_thread_id TEXT,
  source_task_run_id TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  accessed_at TEXT NOT NULL DEFAULT (datetime('now')),
  access_count INTEGER NOT NULL DEFAULT 0
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

CREATE TABLE IF NOT EXISTS projects (
  project_id  TEXT PRIMARY KEY,
  company_id  TEXT NOT NULL REFERENCES companies(company_id) ON DELETE CASCADE,
  thread_id   TEXT UNIQUE REFERENCES graph_threads(thread_id) ON DELETE SET NULL,
  name        TEXT NOT NULL,
  description TEXT,
  status      TEXT NOT NULL DEFAULT 'planning',
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS project_assignments (
  assignment_id TEXT PRIMARY KEY,
  project_id    TEXT NOT NULL REFERENCES projects(project_id) ON DELETE CASCADE,
  employee_id   TEXT NOT NULL REFERENCES employees(employee_id) ON DELETE CASCADE,
  role          TEXT NOT NULL DEFAULT 'member',
  assigned_at   TEXT NOT NULL,
  UNIQUE(project_id, employee_id)
);

CREATE INDEX IF NOT EXISTS idx_installed_packages_company ON installed_packages(company_id);
CREATE INDEX IF NOT EXISTS idx_installed_assets_pkg ON installed_assets(installed_package_id);
CREATE INDEX IF NOT EXISTS idx_task_runs_thread ON task_runs(thread_id);
CREATE INDEX IF NOT EXISTS idx_tool_calls_task ON tool_calls(task_run_id);
CREATE INDEX IF NOT EXISTS idx_runtime_events_company_time ON runtime_events(company_id, created_at);
CREATE INDEX IF NOT EXISTS idx_llm_calls_thread ON llm_calls(thread_id);
CREATE INDEX IF NOT EXISTS idx_llm_calls_task_run ON llm_calls(task_run_id);
CREATE INDEX IF NOT EXISTS idx_memory_scope_owner ON memory_entries(scope, owner_id);
CREATE INDEX IF NOT EXISTS idx_memory_company ON memory_entries(company_id);
CREATE INDEX IF NOT EXISTS idx_memory_importance ON memory_entries(importance DESC);
CREATE INDEX IF NOT EXISTS idx_memory_dedupe ON memory_entries(company_id, scope, owner_id, category, dedupe_key);
CREATE INDEX IF NOT EXISTS idx_memory_reinforced ON memory_entries(last_reinforced_at DESC);
CREATE INDEX IF NOT EXISTS idx_prefab_instances_company ON prefab_instances(company_id);
CREATE INDEX IF NOT EXISTS idx_projects_company ON projects(company_id, status, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_prefab_instances_zone ON prefab_instances(company_id, zone_id);
CREATE INDEX IF NOT EXISTS idx_project_assignments_project ON project_assignments(project_id);
CREATE INDEX IF NOT EXISTS idx_project_assignments_employee ON project_assignments(employee_id);

-- MCP audit log
CREATE TABLE IF NOT EXISTS mcp_audit_log (
  audit_id     TEXT PRIMARY KEY,
  thread_id    TEXT NOT NULL REFERENCES graph_threads(thread_id),
  task_run_id  TEXT REFERENCES task_runs(task_run_id) ON DELETE SET NULL,
  employee_id  TEXT NOT NULL,
  server_name  TEXT NOT NULL,
  tool_name    TEXT NOT NULL,
  arguments_json TEXT NOT NULL,
  result_json  TEXT,
  error        TEXT,
  latency_ms   INTEGER NOT NULL,
  approved_by  TEXT NOT NULL DEFAULT 'auto',
  created_at   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_mcp_audit_thread   ON mcp_audit_log(thread_id);
CREATE INDEX IF NOT EXISTS idx_mcp_audit_employee ON mcp_audit_log(employee_id);
CREATE INDEX IF NOT EXISTS idx_mcp_audit_server_tool ON mcp_audit_log(server_name, tool_name);

-- Node summary ledger
CREATE TABLE IF NOT EXISTS node_summaries (
  summary_id          TEXT PRIMARY KEY,
  thread_id           TEXT NOT NULL REFERENCES graph_threads(thread_id) ON DELETE CASCADE,
  company_id          TEXT NOT NULL REFERENCES companies(company_id) ON DELETE CASCADE,
  node_name           TEXT NOT NULL,
  employee_id         TEXT,
  step_index          INTEGER,
  summary_text        TEXT NOT NULL,
  decisions_json      TEXT NOT NULL,
  files_touched_json  TEXT NOT NULL,
  tools_used_json     TEXT NOT NULL,
  input_token_count   INTEGER NOT NULL DEFAULT 0,
  output_token_count  INTEGER NOT NULL DEFAULT 0,
  message_count       INTEGER NOT NULL DEFAULT 0,
  duration_ms         INTEGER NOT NULL DEFAULT 0,
  created_at          TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_node_summaries_thread_created
  ON node_summaries(thread_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_node_summaries_thread_node
  ON node_summaries(thread_id, node_name, created_at DESC);

CREATE TABLE IF NOT EXISTS compact_summaries (
  compact_id                 TEXT PRIMARY KEY,
  thread_id                  TEXT NOT NULL REFERENCES graph_threads(thread_id) ON DELETE CASCADE,
  company_id                 TEXT NOT NULL REFERENCES companies(company_id) ON DELETE CASCADE,
  compact_kind               TEXT NOT NULL,
  summary_source             TEXT NOT NULL,
  summary_text               TEXT NOT NULL,
  pre_compact_message_count  INTEGER NOT NULL DEFAULT 0,
  pre_compact_token_count    INTEGER NOT NULL DEFAULT 0,
  messages_compacted         INTEGER NOT NULL DEFAULT 0,
  failure_streak             INTEGER NOT NULL DEFAULT 0,
  created_at                 TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_compact_summaries_thread_created
  ON compact_summaries(thread_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_compact_summaries_thread_kind
  ON compact_summaries(thread_id, compact_kind, created_at DESC);

CREATE TABLE IF NOT EXISTS active_thread_interactions (
  thread_id TEXT PRIMARY KEY REFERENCES graph_threads(thread_id) ON DELETE CASCADE,
  company_id TEXT NOT NULL REFERENCES companies(company_id) ON DELETE CASCADE,
  interaction_id TEXT NOT NULL UNIQUE,
  kind TEXT NOT NULL,
  interaction_mode TEXT NOT NULL,
  request_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_active_interactions_company
  ON active_thread_interactions(company_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_active_interactions_kind
  ON active_thread_interactions(kind, updated_at DESC);

CREATE TABLE IF NOT EXISTS interaction_history (
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
CREATE INDEX IF NOT EXISTS idx_interaction_history_thread
  ON interaction_history(thread_id, resolved_at DESC);
CREATE INDEX IF NOT EXISTS idx_interaction_history_company
  ON interaction_history(company_id, resolved_at DESC);
CREATE INDEX IF NOT EXISTS idx_interaction_history_kind
  ON interaction_history(kind, resolved_at DESC);

-- File history ledger
CREATE TABLE IF NOT EXISTS file_history (
  history_id      TEXT PRIMARY KEY,
  snapshot_id     TEXT NOT NULL,
  thread_id       TEXT NOT NULL REFERENCES graph_threads(thread_id) ON DELETE CASCADE,
  company_id      TEXT NOT NULL REFERENCES companies(company_id) ON DELETE CASCADE,
  node_name       TEXT,
  employee_id     TEXT,
  task_run_id     TEXT REFERENCES task_runs(task_run_id) ON DELETE SET NULL,
  tool_call_id    TEXT NOT NULL,
  tool_name       TEXT NOT NULL,
  step_index      INTEGER,
  file_path       TEXT NOT NULL,
  change_kind     TEXT NOT NULL,
  existed_before  INTEGER NOT NULL DEFAULT 0,
  backup_content  TEXT,
  created_at      TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_file_history_thread_created
  ON file_history(thread_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_file_history_snapshot
  ON file_history(snapshot_id);
CREATE INDEX IF NOT EXISTS idx_file_history_thread_step
  ON file_history(thread_id, step_index, created_at DESC);
