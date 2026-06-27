-- Offisim local SQLite schema — always the LATEST end-state shape.
-- Prelaunch: this is the single flattened public baseline (LOCAL_SCHEMA_VERSION
-- = 1). Fresh databases apply this file directly and are stamped via
-- PRAGMA user_version. src/migrations/ is empty until the first post-launch
-- schema change (public migration history starts after the first release).
--
-- The first schema change shipped after 1.0 must do all of:
--   1. update this file AND packages/db-local/src/schema.ts
--   2. bump LOCAL_SCHEMA_VERSION in apps/desktop/src-tauri/src/local_db.rs
--   3. add src/migrations/NNNN_<name>.sql and register it in MIGRATIONS there
-- See src/migrations/README.md.

DROP TABLE IF EXISTS _sqlx_migrations;

CREATE TABLE IF NOT EXISTS companies (
  company_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
  template_id TEXT,
  template_label TEXT,
  workspace_root TEXT,
  description_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS workstations (
  workstation_id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(company_id) ON DELETE CASCADE,
  room_type TEXT NOT NULL,
  label TEXT NOT NULL,
  position_json TEXT,
  seat_capacity INTEGER NOT NULL DEFAULT 1 CHECK (seat_capacity >= 1),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS racks (
  rack_id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(company_id) ON DELETE CASCADE,
  provider_type TEXT NOT NULL,
  label TEXT NOT NULL,
  binding_profile_json TEXT,
  status TEXT NOT NULL DEFAULT 'unbound' CHECK (status IN ('unbound', 'bound', 'error', 'disabled')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS slots (
  slot_id TEXT PRIMARY KEY,
  rack_id TEXT NOT NULL REFERENCES racks(rack_id) ON DELETE CASCADE,
  capability_name TEXT NOT NULL,
  exposure_scope TEXT NOT NULL CHECK (exposure_scope IN ('private', 'team', 'company')),
  status TEXT NOT NULL DEFAULT 'available' CHECK (status IN ('available', 'reserved', 'disabled')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
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
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  is_external INTEGER NOT NULL DEFAULT 0,
  a2a_url TEXT,
  a2a_token TEXT,
  a2a_agent_id TEXT,
  brand_key TEXT,
  agent_card_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS install_transactions (
  install_txn_id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(company_id) ON DELETE CASCADE,
  source_type TEXT NOT NULL CHECK (source_type IN ('registry', 'url', 'file')),
  source_ref TEXT,
  target_package_id TEXT,
  target_version TEXT,
  idempotency_key TEXT,
  state TEXT NOT NULL CHECK (
    state IN (
      'created',
      'manifest_loaded',
      'integrity_checked',
      'compatibility_checked',
      'dependency_planned',
      'awaiting_confirmation',
      'awaiting_bindings',
      'ready_to_install',
      'materializing',
      'installed',
      'failed',
      'rolled_back',
      'cancelled'
    )
  ),
  error_code TEXT,
  error_detail TEXT,
  descriptor_json TEXT,
  actor_type TEXT NOT NULL DEFAULT 'user' CHECK (actor_type IN ('user', 'system')),
  started_at TEXT NOT NULL,
  finished_at TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS install_transactions_company_idempotency
  ON install_transactions(company_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL
    AND state NOT IN ('failed', 'rolled_back', 'cancelled');
CREATE TABLE IF NOT EXISTS installed_packages (
  installed_package_id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(company_id) ON DELETE CASCADE,
  package_id TEXT NOT NULL,
  package_kind TEXT NOT NULL CHECK (package_kind IN ('employee', 'skill', 'company_template', 'office_layout', 'prefab', 'bundle')),
  version TEXT NOT NULL,
  source_type TEXT NOT NULL CHECK (source_type IN ('registry', 'url', 'file')),
  source_ref TEXT,
  manifest_hash TEXT NOT NULL,
  package_hash TEXT NOT NULL,
  install_state TEXT NOT NULL CHECK (install_state IN ('installed', 'disabled', 'broken', 'pending_upgrade')),
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  origin_listing_id TEXT,
  origin_package_version_id TEXT,
  installed_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(company_id, package_id, version)
);
CREATE TABLE IF NOT EXISTS installed_assets (
  installed_asset_id TEXT PRIMARY KEY,
  installed_package_id TEXT NOT NULL REFERENCES installed_packages(installed_package_id) ON DELETE CASCADE,
  asset_id TEXT NOT NULL,
  asset_kind TEXT NOT NULL CHECK (asset_kind IN ('employee', 'skill', 'company_template', 'office_layout', 'prefab', 'bundle')),
  local_instance_id TEXT,
  entrypoint TEXT,
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  override_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(installed_package_id, asset_id)
);
CREATE TABLE IF NOT EXISTS asset_bindings (
  binding_id TEXT PRIMARY KEY,
  installed_asset_id TEXT REFERENCES installed_assets(installed_asset_id) ON DELETE CASCADE,
  install_txn_id TEXT REFERENCES install_transactions(install_txn_id) ON DELETE CASCADE,
  binding_type TEXT NOT NULL CHECK (binding_type IN ('model_profile', 'secret_slot', 'workspace_map', 'mcp_slot')),
  binding_key TEXT NOT NULL,
  binding_value_json TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'satisfied', 'skipped', 'error')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (installed_asset_id IS NOT NULL OR install_txn_id IS NOT NULL)
);
CREATE TABLE IF NOT EXISTS task_runs (
  task_run_id TEXT PRIMARY KEY,
  thread_id TEXT NOT NULL REFERENCES graph_threads(thread_id) ON DELETE CASCADE,
  employee_id TEXT REFERENCES employees(employee_id) ON DELETE SET NULL,
  parent_task_run_id TEXT REFERENCES task_runs(task_run_id) ON DELETE SET NULL,
  task_type TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('planned', 'queued', 'running', 'waiting_dependency', 'waiting_human', 'blocked', 'completed', 'failed', 'cancelled')),
  input_json TEXT,
  output_json TEXT,
  started_at TEXT NOT NULL,
  finished_at TEXT
);
-- Multi-agent delegation run tree. A row per run (root or delegated child);
-- the tree is rebuilt from parent_run_id / root_run_id. Distinct from task_runs
-- (work items) — agent_runs are cognition instances of an employee identity.
CREATE TABLE IF NOT EXISTS agent_runs (
  run_id              TEXT PRIMARY KEY,
  -- thread_id is the product-layer chat_threads.thread_id (no FK — chat threads
  -- have no graph_threads row; matches agent_events). Cleaned up by company FK
  -- cascade + explicit per-thread deletion in local-data-deletion.
  thread_id           TEXT NOT NULL,
  company_id          TEXT NOT NULL REFERENCES companies(company_id) ON DELETE CASCADE,
  parent_run_id       TEXT REFERENCES agent_runs(run_id) ON DELETE SET NULL,
  root_run_id         TEXT NOT NULL,
  employee_id         TEXT REFERENCES employees(employee_id) ON DELETE SET NULL,
  relation            TEXT,
  objective           TEXT,
  access              TEXT,
  -- `interrupted`: host died/was killed mid-run; startup reconcile parks the
  -- dangling root here (running→interrupted), distinct from a clean cancel.
  status              TEXT NOT NULL CHECK (status IN ('running', 'interrupted', 'completed', 'failed', 'cancelled')),
  usage_json          TEXT,
  result_summary_json TEXT,
  -- Pi session JSONL path for durable resume (set when the session opens).
  session_file        TEXT,
  started_at          TEXT NOT NULL,
  finished_at         TEXT
);
CREATE TABLE IF NOT EXISTS tool_calls (
  tool_call_id TEXT PRIMARY KEY,
  task_run_id TEXT NOT NULL REFERENCES task_runs(task_run_id) ON DELETE CASCADE,
  tool_name TEXT NOT NULL,
  capability_name TEXT,
  rack_id TEXT REFERENCES racks(rack_id) ON DELETE SET NULL,
  status TEXT NOT NULL CHECK (status IN ('queued', 'running', 'completed', 'failed', 'cancelled')),
  review_state TEXT NOT NULL DEFAULT 'none' CHECK (review_state IN ('none', 'required', 'approved', 'rejected')),
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
  status TEXT NOT NULL CHECK (status IN ('scheduled', 'running', 'paused', 'completed', 'cancelled')),
  summary_json TEXT,
  interaction_mode TEXT NOT NULL DEFAULT 'boss_proxy',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS runtime_events (
  event_id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(company_id) ON DELETE CASCADE,
  thread_id TEXT REFERENCES graph_threads(thread_id) ON DELETE SET NULL,
  event_type TEXT NOT NULL,
  severity TEXT NOT NULL DEFAULT 'info' CHECK (severity IN ('debug', 'info', 'warning', 'error')),
  payload_json TEXT,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS llm_calls (
  llm_call_id   TEXT PRIMARY KEY,
  thread_id     TEXT REFERENCES graph_threads(thread_id) ON DELETE SET NULL,
  task_run_id   TEXT REFERENCES task_runs(task_run_id) ON DELETE SET NULL,
  node_name     TEXT NOT NULL,
  provider      TEXT NOT NULL,
  model         TEXT NOT NULL,
  input_tokens  INTEGER NOT NULL,
  output_tokens INTEGER NOT NULL,
  cache_read_input_tokens INTEGER NOT NULL DEFAULT 0,
  cache_creation_input_tokens INTEGER NOT NULL DEFAULT 0,
  usage_raw_json TEXT,
  response_json  TEXT,
  latency_ms    INTEGER,
  error_code    TEXT,
  request_json TEXT,
  tool_calls_json TEXT,
  prompt_hash TEXT,
  tools_hash TEXT,
  response_hash TEXT,
  recording_mode TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS employee_versions (
  version_id    TEXT PRIMARY KEY,
  employee_id   TEXT NOT NULL REFERENCES employees(employee_id) ON DELETE CASCADE,
  version_num   INTEGER NOT NULL,
  change_type   TEXT NOT NULL CHECK(change_type IN ('create', 'update', 'rollback')),
  snapshot_json TEXT NOT NULL,
  change_summary TEXT,
  created_by    TEXT NOT NULL DEFAULT 'user',
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
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
CREATE TABLE IF NOT EXISTS company_template_assets (
  company_template_asset_id TEXT PRIMARY KEY,
  company_id      TEXT NOT NULL REFERENCES companies(company_id) ON DELETE CASCADE,
  template_id     TEXT NOT NULL,
  name            TEXT NOT NULL,
  description     TEXT NOT NULL DEFAULT '',
  template_json   TEXT NOT NULL,
  source_package_id TEXT NOT NULL,
  source_asset_id TEXT NOT NULL,
  version         TEXT,
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS office_layouts (
  layout_id   TEXT PRIMARY KEY,
  company_id  TEXT NOT NULL REFERENCES companies(company_id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  layout_json TEXT NOT NULL,
  is_active   INTEGER NOT NULL DEFAULT 0 CHECK (is_active IN (0, 1)),
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS library_documents (
  doc_id       TEXT PRIMARY KEY,
  company_id   TEXT NOT NULL REFERENCES companies(company_id) ON DELETE CASCADE,
  title        TEXT NOT NULL,
  content_text TEXT NOT NULL DEFAULT '',
  source_type  TEXT NOT NULL DEFAULT 'file',
  mime_type    TEXT,
  file_size    INTEGER,
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at   TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS workstation_racks (
  workstation_id TEXT NOT NULL REFERENCES workstations(workstation_id) ON DELETE CASCADE,
  rack_id TEXT NOT NULL REFERENCES racks(rack_id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  PRIMARY KEY (workstation_id, rack_id)
);
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
CREATE TABLE IF NOT EXISTS "graph_threads" (
  thread_id    TEXT PRIMARY KEY,
  company_id   TEXT NOT NULL REFERENCES companies(company_id) ON DELETE CASCADE,
  entry_mode   TEXT NOT NULL CHECK (entry_mode IN (
    'boss_chat', 'meeting', 'install_flow', 'background_sync', 'direct_chat'
  )),
  root_task_id TEXT,
  status       TEXT NOT NULL CHECK (status IN (
    'queued', 'running', 'blocked', 'paused', 'completed', 'failed', 'cancelled'
  )),
  project_id   TEXT,
  compact_baseline_json TEXT,
  interaction_mode TEXT NOT NULL DEFAULT 'boss_proxy',
  synopsis_json TEXT,
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS projects (
  project_id  TEXT PRIMARY KEY,
  company_id  TEXT NOT NULL REFERENCES companies(company_id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  description TEXT,
  status      TEXT NOT NULL DEFAULT 'planning'
    CHECK(status IN ('planning', 'active', 'paused', 'completed', 'archived')),
  workspace_root TEXT,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS chat_threads (
  thread_id         TEXT PRIMARY KEY,
  project_id        TEXT NOT NULL REFERENCES projects(project_id) ON DELETE CASCADE,
  employee_id       TEXT REFERENCES employees(employee_id) ON DELETE SET NULL,
  title             TEXT NOT NULL DEFAULT 'New thread',
  title_set_by_user INTEGER NOT NULL DEFAULT 0 CHECK (title_set_by_user IN (0, 1)),
  summary           TEXT,
  archived_at       TEXT,
  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS project_assignments (
  assignment_id TEXT PRIMARY KEY,
  project_id    TEXT NOT NULL REFERENCES projects(project_id) ON DELETE CASCADE,
  employee_id   TEXT NOT NULL REFERENCES employees(employee_id) ON DELETE CASCADE,
  role          TEXT NOT NULL DEFAULT 'member',
  assigned_at   TEXT NOT NULL,
  UNIQUE(project_id, employee_id)
);
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
CREATE TABLE IF NOT EXISTS file_history (
  history_id TEXT PRIMARY KEY,
  snapshot_id TEXT NOT NULL,
  thread_id TEXT NOT NULL REFERENCES graph_threads(thread_id) ON DELETE CASCADE,
  company_id TEXT NOT NULL REFERENCES companies(company_id) ON DELETE CASCADE,
  node_name TEXT,
  employee_id TEXT,
  task_run_id TEXT REFERENCES task_runs(task_run_id) ON DELETE SET NULL,
  tool_call_id TEXT NOT NULL,
  tool_name TEXT NOT NULL,
  step_index INTEGER,
  file_path TEXT NOT NULL,
  change_kind TEXT NOT NULL,
  existed_before INTEGER NOT NULL DEFAULT 0,
  backup_content TEXT,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS active_thread_interactions (
  thread_id TEXT PRIMARY KEY REFERENCES graph_threads(thread_id) ON DELETE CASCADE,
  company_id TEXT NOT NULL REFERENCES companies(company_id) ON DELETE CASCADE,
  interaction_id TEXT NOT NULL UNIQUE,
  kind TEXT NOT NULL,
  interaction_mode TEXT NOT NULL,
  request_json TEXT NOT NULL,
  payload_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
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
  payload_json TEXT,
  created_at TEXT NOT NULL,
  resolved_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS "mcp_audit_log" (
  audit_id TEXT PRIMARY KEY,
  thread_id TEXT NOT NULL REFERENCES graph_threads(thread_id) ON DELETE CASCADE,
  task_run_id TEXT REFERENCES task_runs(task_run_id) ON DELETE SET NULL,
  employee_id TEXT NOT NULL,
  server_name TEXT NOT NULL,
  tool_name TEXT NOT NULL,
  arguments_json TEXT NOT NULL,
  result_json TEXT,
  error TEXT,
  latency_ms INTEGER NOT NULL,
  approved_by TEXT NOT NULL DEFAULT 'auto',
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS zones (
  zone_id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(company_id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  archetype TEXT,
  label TEXT NOT NULL,
  accent_color TEXT NOT NULL DEFAULT '#64748b',
  floor_color REAL NOT NULL DEFAULT 0x2a3a5c,
  cx REAL NOT NULL DEFAULT 0,
  cz REAL NOT NULL DEFAULT 0,
  w REAL NOT NULL DEFAULT 10,
  d REAL NOT NULL DEFAULT 8,
  target_roles_json TEXT,
  allowed_categories_json TEXT,
  activity_types_json TEXT,
  desk_slots INTEGER NOT NULL DEFAULT 0,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS "memory_entries" (
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
CREATE TABLE IF NOT EXISTS deliverables (
  deliverable_id     TEXT PRIMARY KEY,
  company_id         TEXT NOT NULL REFERENCES companies(company_id) ON DELETE CASCADE,
  thread_id          TEXT,
  chat_thread_id     TEXT,
  title              TEXT NOT NULL,
  content            TEXT NOT NULL,
  kind               TEXT,
  file_name          TEXT,
  mime_type          TEXT,
  contributors_json  TEXT NOT NULL,
  created_at         TEXT NOT NULL,
  run_id             TEXT,
  content_hash       TEXT,
  version            INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS settings (
  key         TEXT PRIMARY KEY,
  value       TEXT NOT NULL,
  updated_at  INTEGER NOT NULL
);
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
CREATE TABLE IF NOT EXISTS "skills" (
  skill_id     TEXT PRIMARY KEY,
  company_id   TEXT NOT NULL REFERENCES companies(company_id) ON DELETE CASCADE,
  employee_id  TEXT REFERENCES employees(employee_id) ON DELETE CASCADE,
  scope        TEXT NOT NULL CHECK (scope IN ('company', 'employee')),
  slug         TEXT NOT NULL,
  name         TEXT NOT NULL,
  description  TEXT NOT NULL,
  version      TEXT NOT NULL DEFAULT '0.1.0',
  source_kind  TEXT NOT NULL,
  source_ref   TEXT,
  vault_path   TEXT NOT NULL,
  created_at   INTEGER NOT NULL,
  updated_at   INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS tool_permission_approvals (
  approval_id TEXT PRIMARY KEY,
  thread_id TEXT NOT NULL REFERENCES graph_threads(thread_id) ON DELETE CASCADE,
  company_id TEXT NOT NULL REFERENCES companies(company_id) ON DELETE CASCADE,
  employee_id TEXT,
  server_name TEXT NOT NULL,
  tool_name TEXT NOT NULL,
  scope TEXT NOT NULL CHECK (scope IN ('once', 'thread')),
  approved_by TEXT NOT NULL,
  policy_hash TEXT NOT NULL,
  consumed_at TEXT,
  created_at TEXT NOT NULL,
  expires_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_workstations_company ON workstations(company_id);
CREATE INDEX IF NOT EXISTS idx_racks_company ON racks(company_id);
CREATE INDEX IF NOT EXISTS idx_employees_company ON employees(company_id);
CREATE INDEX IF NOT EXISTS idx_install_transactions_company ON install_transactions(company_id, started_at);
CREATE INDEX IF NOT EXISTS idx_installed_packages_company ON installed_packages(company_id);
CREATE INDEX IF NOT EXISTS idx_installed_assets_pkg ON installed_assets(installed_package_id);
CREATE INDEX IF NOT EXISTS idx_asset_bindings_txn ON asset_bindings(install_txn_id);
CREATE INDEX IF NOT EXISTS idx_task_runs_thread ON task_runs(thread_id);
CREATE INDEX IF NOT EXISTS idx_agent_runs_thread ON agent_runs(thread_id);
CREATE INDEX IF NOT EXISTS idx_agent_runs_root ON agent_runs(root_run_id);
CREATE INDEX IF NOT EXISTS idx_agent_runs_parent ON agent_runs(parent_run_id);
CREATE INDEX IF NOT EXISTS idx_tool_calls_task ON tool_calls(task_run_id);
CREATE INDEX IF NOT EXISTS idx_runtime_events_company_time ON runtime_events(company_id, created_at);
CREATE INDEX IF NOT EXISTS idx_llm_calls_thread ON llm_calls(thread_id);
CREATE INDEX IF NOT EXISTS idx_llm_calls_task_run ON llm_calls(task_run_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_emp_ver_emp_num ON employee_versions(employee_id, version_num);
CREATE INDEX IF NOT EXISTS idx_emp_ver_emp ON employee_versions(employee_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_cost_rates_provider_model
  ON model_cost_rates(provider, model_pattern, effective_from);
CREATE INDEX IF NOT EXISTS idx_company_template_assets_company ON company_template_assets(company_id);
CREATE INDEX IF NOT EXISTS idx_office_layouts_company ON office_layouts(company_id);
CREATE INDEX IF NOT EXISTS idx_library_docs_company ON library_documents(company_id);
CREATE INDEX IF NOT EXISTS idx_prefab_instances_company
  ON prefab_instances(company_id);
CREATE INDEX IF NOT EXISTS idx_prefab_instances_zone
  ON prefab_instances(company_id, zone_id);
CREATE INDEX IF NOT EXISTS idx_graph_threads_company ON graph_threads(company_id, created_at);
CREATE INDEX IF NOT EXISTS idx_projects_company
  ON projects(company_id, status, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_chat_threads_project_updated
  ON chat_threads(project_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_chat_threads_project_employee
  ON chat_threads(project_id, employee_id);
-- Partial index: only non-archived threads contribute. The legacy three-col
-- index on (project_id, archived_at, updated_at DESC) couldn't be used by the
-- common "active threads for project" lookup because SQLite can't seek past a
-- NULL filter cleanly. WHERE archived_at IS NULL flips the same query into a
-- pure (project_id, updated_at DESC) scan and shrinks the index footprint.
CREATE INDEX IF NOT EXISTS idx_chat_threads_project_active_partial
  ON chat_threads(project_id, updated_at DESC) WHERE archived_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_project_assignments_project
  ON project_assignments(project_id);
CREATE INDEX IF NOT EXISTS idx_project_assignments_employee
  ON project_assignments(employee_id);
CREATE INDEX IF NOT EXISTS idx_agent_events_project ON agent_events(project_id, created_at);
CREATE INDEX IF NOT EXISTS idx_agent_events_thread  ON agent_events(thread_id, event_type);
CREATE INDEX IF NOT EXISTS idx_agent_events_agent   ON agent_events(agent_name, event_type);
CREATE INDEX IF NOT EXISTS idx_agent_events_parent  ON agent_events(parent_event_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_recovery_symptom ON recovery_knowledge(symptom, cause);
CREATE INDEX IF NOT EXISTS idx_recovery_strategy ON recovery_knowledge(fix_strategy);
CREATE INDEX IF NOT EXISTS idx_file_history_thread_created
  ON file_history(thread_id, created_at);
CREATE INDEX IF NOT EXISTS idx_file_history_snapshot
  ON file_history(snapshot_id);
CREATE INDEX IF NOT EXISTS idx_file_history_thread_step
  ON file_history(thread_id, step_index, created_at);
CREATE INDEX IF NOT EXISTS idx_active_interactions_company
  ON active_thread_interactions(company_id, updated_at);
CREATE INDEX IF NOT EXISTS idx_active_interactions_kind
  ON active_thread_interactions(kind, updated_at);
CREATE INDEX IF NOT EXISTS idx_interaction_history_thread
  ON interaction_history(thread_id, resolved_at);
CREATE INDEX IF NOT EXISTS idx_interaction_history_company
  ON interaction_history(company_id, resolved_at);
CREATE INDEX IF NOT EXISTS idx_interaction_history_kind
  ON interaction_history(kind, resolved_at);
CREATE INDEX IF NOT EXISTS idx_mcp_audit_thread
  ON mcp_audit_log(thread_id);
CREATE INDEX IF NOT EXISTS idx_mcp_audit_employee
  ON mcp_audit_log(employee_id);
CREATE INDEX IF NOT EXISTS idx_mcp_audit_server_tool
  ON mcp_audit_log(server_name, tool_name);
CREATE INDEX IF NOT EXISTS idx_zones_company
  ON zones(company_id);
CREATE INDEX IF NOT EXISTS idx_memory_scope_owner ON memory_entries(scope, owner_id);
CREATE INDEX IF NOT EXISTS idx_memory_company ON memory_entries(company_id);
CREATE INDEX IF NOT EXISTS idx_memory_importance ON memory_entries(importance DESC);
CREATE INDEX IF NOT EXISTS idx_memory_dedupe
  ON memory_entries(company_id, scope, owner_id, category, dedupe_key);
CREATE INDEX IF NOT EXISTS idx_memory_reinforced
  ON memory_entries(last_reinforced_at DESC);
CREATE INDEX IF NOT EXISTS idx_deliverables_company_time
  ON deliverables(company_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_deliverables_thread_time
  ON deliverables(thread_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_deliverables_chat_thread_time
  ON deliverables(chat_thread_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_deliverables_run_id
  ON deliverables(run_id);
CREATE INDEX IF NOT EXISTS idx_employees_is_external ON employees(is_external);
CREATE INDEX IF NOT EXISTS idx_node_summaries_thread_created
  ON node_summaries(thread_id, created_at);
CREATE INDEX IF NOT EXISTS idx_node_summaries_thread_node
  ON node_summaries(thread_id, node_name, created_at);
CREATE INDEX IF NOT EXISTS idx_compact_summaries_thread_created
  ON compact_summaries(thread_id, created_at);
CREATE INDEX IF NOT EXISTS idx_compact_summaries_thread_kind
  ON compact_summaries(thread_id, compact_kind, created_at);
CREATE UNIQUE INDEX IF NOT EXISTS idx_skills_company_slug
  ON skills(company_id, slug)
  WHERE employee_id IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_skills_employee_slug
  ON skills(company_id, employee_id, slug)
  WHERE employee_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_skills_company_scope
  ON skills(company_id, scope);
CREATE INDEX IF NOT EXISTS idx_skills_employee
  ON skills(employee_id)
  WHERE employee_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_tool_perm_approval_lookup
  ON tool_permission_approvals(thread_id, employee_id, server_name, tool_name, policy_hash);
CREATE INDEX IF NOT EXISTS idx_tool_perm_approval_company
  ON tool_permission_approvals(company_id, created_at);
CREATE INDEX IF NOT EXISTS idx_tool_perm_approval_company_lookup
  ON tool_permission_approvals(company_id, thread_id, employee_id, server_name, tool_name, policy_hash);
CREATE INDEX IF NOT EXISTS idx_meeting_sessions_mode
  ON meeting_sessions(interaction_mode);

-- pi kernel per-message transcript persistence for the pi agent loop.
-- One row per pi message, append-only per thread.
-- No FK to graph_threads: pi threads are standalone and survive independent of
-- the legacy graph thread lifecycle.
CREATE TABLE IF NOT EXISTS pi_messages (
  message_id TEXT PRIMARY KEY,
  thread_id TEXT NOT NULL,
  company_id TEXT NOT NULL,
  employee_id TEXT,
  seq INTEGER NOT NULL CHECK (seq >= 0),
  role TEXT NOT NULL,
  message_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  -- UNIQUE on (thread_id, seq) also backs every thread-scoped ordering / MAX(seq)
  -- / last-row lookup, so no separate index is needed.
  UNIQUE(thread_id, seq)
);

-- ---------------------------------------------------------------------------
-- Verified Missions core (PRD §17). Mission status/criteria truth lives here
-- (ADR 2026-06-25-truth-closure D4); evaluation truth is `mission_evaluation`.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS mission (
  mission_id              TEXT PRIMARY KEY,
  company_id              TEXT NOT NULL REFERENCES companies(company_id) ON DELETE CASCADE,
  project_id              TEXT,
  thread_id               TEXT NOT NULL,
  title                   TEXT NOT NULL,
  goal                    TEXT NOT NULL,
  status                  TEXT NOT NULL,
  runtime_id              TEXT NOT NULL,
  runtime_policy_json     TEXT NOT NULL,
  budget_json             TEXT NOT NULL,
  expected_artifacts_json TEXT,
  current_attempt_id      TEXT,
  created_at              TEXT NOT NULL,
  updated_at              TEXT NOT NULL,
  completed_at            TEXT
);

CREATE TABLE IF NOT EXISTS mission_criterion (
  criterion_id           TEXT PRIMARY KEY,
  mission_id             TEXT NOT NULL REFERENCES mission(mission_id) ON DELETE CASCADE,
  description            TEXT NOT NULL,
  evaluator_id           TEXT NOT NULL,
  evaluator_config_json  TEXT NOT NULL,
  required               INTEGER NOT NULL DEFAULT 1,
  order_index            INTEGER NOT NULL DEFAULT 0,
  status                 TEXT NOT NULL DEFAULT 'pending',
  last_evaluation_id     TEXT
);

CREATE TABLE IF NOT EXISTS mission_attempt (
  attempt_id               TEXT PRIMARY KEY,
  mission_id               TEXT NOT NULL REFERENCES mission(mission_id) ON DELETE CASCADE,
  attempt_number           INTEGER NOT NULL,
  root_run_id              TEXT,
  runtime_session_link_id  TEXT,
  trigger                  TEXT NOT NULL,
  status                   TEXT NOT NULL,
  failure_signature        TEXT,
  started_at               TEXT NOT NULL,
  finished_at              TEXT
);

CREATE TABLE IF NOT EXISTS mission_evaluation (
  evaluation_id      TEXT PRIMARY KEY,
  mission_id         TEXT NOT NULL REFERENCES mission(mission_id) ON DELETE CASCADE,
  criterion_id       TEXT NOT NULL,
  attempt_id         TEXT NOT NULL,
  evaluator_id       TEXT NOT NULL,
  verdict            TEXT NOT NULL,
  summary            TEXT NOT NULL,
  evidence_refs_json TEXT NOT NULL,
  duration_ms        INTEGER,
  created_at         TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS runtime_session_link (
  runtime_session_link_id TEXT PRIMARY KEY,
  mission_id              TEXT NOT NULL REFERENCES mission(mission_id) ON DELETE CASCADE,
  runtime_id              TEXT NOT NULL,
  runtime_version         TEXT,
  opaque_session_ref_json TEXT NOT NULL,
  compatibility_hash      TEXT,
  workspace_lease_id      TEXT,
  last_safe_boundary      TEXT,
  status                  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS mission_event (
  mission_event_id TEXT PRIMARY KEY,
  mission_id       TEXT NOT NULL REFERENCES mission(mission_id) ON DELETE CASCADE,
  attempt_id       TEXT,
  type             TEXT NOT NULL,
  data_json        TEXT NOT NULL,
  created_at       TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_mission_company_time
  ON mission(company_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_mission_status
  ON mission(status);
CREATE INDEX IF NOT EXISTS idx_mission_criterion_mission_order
  ON mission_criterion(mission_id, order_index);
CREATE INDEX IF NOT EXISTS idx_mission_attempt_mission_number
  ON mission_attempt(mission_id, attempt_number);
CREATE INDEX IF NOT EXISTS idx_mission_evaluation_mission_criterion
  ON mission_evaluation(mission_id, criterion_id);
CREATE INDEX IF NOT EXISTS idx_mission_evaluation_attempt
  ON mission_evaluation(attempt_id);
CREATE INDEX IF NOT EXISTS idx_runtime_session_link_mission
  ON runtime_session_link(mission_id);
CREATE INDEX IF NOT EXISTS idx_mission_event_mission_time
  ON mission_event(mission_id, created_at);

-- ---------------------------------------------------------------------------
-- Collaboration (PR-02). Company-scoped daily chat (direct + group), FULLY
-- separate from project-scoped `chat_threads`: no `project_id`, never surfaced
-- in Office work sessions, never crosses into the chatThreads repository.
-- Additive only — no existing table is touched and no row is migrated.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS collaboration_threads (
  thread_id          TEXT PRIMARY KEY,
  company_id         TEXT NOT NULL REFERENCES companies(company_id) ON DELETE CASCADE,
  kind               TEXT NOT NULL CHECK (kind IN ('direct', 'group')),
  title              TEXT NOT NULL,
  direct_employee_id TEXT REFERENCES employees(employee_id) ON DELETE SET NULL,
  reply_policy       TEXT NOT NULL DEFAULT 'mentions_only'
                       CHECK (reply_policy IN ('mentions_only', 'roundtable', 'silent')),
  round_speaker_limit INTEGER NOT NULL DEFAULT 3,
  created_by         TEXT NOT NULL DEFAULT 'boss',
  archived_at        TEXT,
  created_at         TEXT NOT NULL,
  updated_at         TEXT NOT NULL,
  -- A group thread must not carry a direct_employee_id (data hygiene; the
  -- active-direct partial index already excludes non-direct rows). A direct
  -- thread MAY have a null direct_employee_id after the employee is deleted
  -- (ON DELETE SET NULL keeps the thread + message snapshots readable).
  CHECK (kind = 'direct' OR direct_employee_id IS NULL)
);

CREATE TABLE IF NOT EXISTS collaboration_thread_members (
  member_id    TEXT PRIMARY KEY,
  thread_id    TEXT NOT NULL REFERENCES collaboration_threads(thread_id) ON DELETE CASCADE,
  actor_type   TEXT NOT NULL CHECK (actor_type IN ('boss', 'employee')),
  employee_id  TEXT REFERENCES employees(employee_id) ON DELETE CASCADE,
  role         TEXT NOT NULL CHECK (role IN ('owner', 'member')),
  joined_at    TEXT NOT NULL,
  left_at      TEXT
);

CREATE TABLE IF NOT EXISTS collaboration_messages (
  message_id          TEXT PRIMARY KEY,
  thread_id           TEXT NOT NULL REFERENCES collaboration_threads(thread_id) ON DELETE CASCADE,
  sender_type         TEXT NOT NULL CHECK (sender_type IN ('boss', 'employee', 'system')),
  sender_employee_id  TEXT REFERENCES employees(employee_id) ON DELETE SET NULL,
  body                TEXT NOT NULL,
  reply_to_message_id TEXT,
  status              TEXT NOT NULL DEFAULT 'complete'
                        CHECK (status IN ('pending', 'streaming', 'complete', 'interrupted', 'failed')),
  idempotency_key     TEXT,
  metadata_json       TEXT,
  created_at          TEXT NOT NULL,
  edited_at           TEXT
);
-- idempotency_key: double-send dedup via the partial-unique index below; a
-- concurrent second append fails at the DB layer so the service catch-rereads
-- the single winner (a metadata-only key would race).

-- No boss/user account id in the current product → last-read boundary per thread.
-- Unread is COMPUTED from this boundary, never stored as a drifting counter.
CREATE TABLE IF NOT EXISTS collaboration_read_state (
  thread_id            TEXT PRIMARY KEY REFERENCES collaboration_threads(thread_id) ON DELETE CASCADE,
  last_read_message_id TEXT,
  updated_at           TEXT NOT NULL
);

-- company list ordered by recency
CREATE INDEX IF NOT EXISTS idx_collaboration_threads_company_updated
  ON collaboration_threads(company_id, updated_at DESC);
-- at most one ACTIVE direct thread per (company, employee); archived rows are
-- excluded so an archived direct thread can be restored instead of duplicated.
CREATE UNIQUE INDEX IF NOT EXISTS idx_collaboration_threads_active_direct
  ON collaboration_threads(company_id, direct_employee_id)
  WHERE kind = 'direct' AND archived_at IS NULL;
-- message timeline / pagination cursor
CREATE INDEX IF NOT EXISTS idx_collaboration_messages_thread_time
  ON collaboration_messages(thread_id, created_at, message_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_collaboration_messages_idempotency
  ON collaboration_messages(thread_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;
-- membership lookup (active members of a thread; reverse employee→threads)
CREATE INDEX IF NOT EXISTS idx_collaboration_members_thread
  ON collaboration_thread_members(thread_id);
CREATE INDEX IF NOT EXISTS idx_collaboration_members_employee
  ON collaboration_thread_members(employee_id);

-- ---------------------------------------------------------------------------
-- Loop domain (PR-07). A saveable, versioned, reusable wrapper around the
-- Mission engine. `loop_definitions` point at a selected immutable revision;
-- every edit appends a `loop_revisions` row (insert-only). SAVING a Loop writes
-- ONLY these four tables — never mission / chat_threads / mission_attempt.
-- `loop_invocations` is written ONLY at Office Send materialization (PR-10).
-- Additive only — no existing table is touched and no row is migrated.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS loop_definitions (
  loop_id             TEXT PRIMARY KEY,
  company_id          TEXT NOT NULL REFERENCES companies(company_id) ON DELETE CASCADE,
  title               TEXT NOT NULL,
  summary             TEXT NOT NULL DEFAULT '',
  profile_id          TEXT NOT NULL,
  -- The selected live revision; set after the row exists, kept through archive.
  current_revision_id TEXT,
  status              TEXT NOT NULL DEFAULT 'draft'
                        CHECK (status IN ('draft', 'ready', 'archived')),
  created_at          TEXT NOT NULL,
  updated_at          TEXT NOT NULL
);

-- Immutable: any edit appends a new revision; rows are never UPDATEd in place.
CREATE TABLE IF NOT EXISTS loop_revisions (
  revision_id              TEXT PRIMARY KEY,
  loop_id                  TEXT NOT NULL REFERENCES loop_definitions(loop_id) ON DELETE CASCADE,
  revision_number          INTEGER NOT NULL,
  source_prompt            TEXT NOT NULL,
  enhanced_prompt          TEXT,
  compiled_ir_json         TEXT NOT NULL,
  compiler_profile_id      TEXT NOT NULL,
  compiler_profile_version TEXT NOT NULL,
  compiler_version         TEXT NOT NULL,
  compile_status           TEXT NOT NULL
                             CHECK (compile_status IN ('ready', 'needs_input', 'invalid')),
  questions_json           TEXT NOT NULL DEFAULT '[]',
  validation_json          TEXT NOT NULL DEFAULT '{}',
  created_at               TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS loop_skill_bindings (
  binding_id    TEXT PRIMARY KEY,
  revision_id   TEXT NOT NULL REFERENCES loop_revisions(revision_id) ON DELETE CASCADE,
  skill_id      TEXT NOT NULL,
  skill_version TEXT NOT NULL,
  order_index   INTEGER NOT NULL DEFAULT 0,
  config_json   TEXT NOT NULL DEFAULT '{}'
);

-- No FK to loop_revisions: an invocation must stay readable after a definition
-- is archived. The service forbids physically deleting a definition that has
-- invocation history (archive instead); there is no cascade from here.
CREATE TABLE IF NOT EXISTS loop_invocations (
  invocation_id TEXT PRIMARY KEY,
  loop_id       TEXT NOT NULL,
  revision_id   TEXT NOT NULL,
  company_id    TEXT NOT NULL REFERENCES companies(company_id) ON DELETE CASCADE,
  project_id    TEXT,
  thread_id     TEXT NOT NULL,
  message_id    TEXT NOT NULL,
  mission_id    TEXT,
  status        TEXT NOT NULL,
  created_at    TEXT NOT NULL
);

-- company list ordered by recency
CREATE INDEX IF NOT EXISTS idx_loop_definitions_company_updated
  ON loop_definitions(company_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_loop_definitions_status
  ON loop_definitions(status);
-- monotonic revision numbering, unique per loop
CREATE UNIQUE INDEX IF NOT EXISTS idx_loop_revisions_loop_number
  ON loop_revisions(loop_id, revision_number);
CREATE INDEX IF NOT EXISTS idx_loop_revisions_loop_created
  ON loop_revisions(loop_id, created_at);
CREATE INDEX IF NOT EXISTS idx_loop_skill_bindings_revision_order
  ON loop_skill_bindings(revision_id, order_index);
CREATE INDEX IF NOT EXISTS idx_loop_invocations_loop
  ON loop_invocations(loop_id);
CREATE INDEX IF NOT EXISTS idx_loop_invocations_revision
  ON loop_invocations(revision_id);
CREATE INDEX IF NOT EXISTS idx_loop_invocations_company_created
  ON loop_invocations(company_id, created_at);

-- ---------------------------------------------------------------------------
-- Collaboration turns (PR-03). Ledger of each AI reply's lifecycle on a
-- Collaboration thread: streaming / error / usage recovery — NOT a transcript
-- copy (the visible message lives in `collaboration_messages`). One row per
-- scheduled speaker turn (direct reply, a mentioned member, or a roundtable
-- speaker). Company-scoped only, like the rest of the domain: no `project_id`,
-- never an `agent_runs` / mission row.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS collaboration_turns (
  turn_id            TEXT PRIMARY KEY,
  thread_id          TEXT NOT NULL REFERENCES collaboration_threads(thread_id) ON DELETE CASCADE,
  -- The message that scheduled this speaker. Not an FK (a turn stays readable for
  -- recovery even if the trigger message is removed, and may reference a
  -- not-yet-persisted id).
  trigger_message_id TEXT,
  -- SET NULL on delete keeps the turn (usage / error recovery) readable after the
  -- employee is dismissed.
  employee_id        TEXT REFERENCES employees(employee_id) ON DELETE SET NULL,
  sequence_index     INTEGER NOT NULL,
  status             TEXT NOT NULL DEFAULT 'pending'
                       CHECK (status IN ('pending', 'streaming', 'complete', 'interrupted', 'failed')),
  runtime_request_id TEXT,
  usage_json         TEXT,
  error_summary      TEXT,
  started_at         TEXT,
  finished_at        TEXT
);

-- turn scheduling / recovery lookup: a thread's turns in speaker order
CREATE INDEX IF NOT EXISTS idx_collaboration_turns_thread_sequence
  ON collaboration_turns(thread_id, sequence_index);
