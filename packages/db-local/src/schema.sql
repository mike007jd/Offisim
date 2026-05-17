-- Offisim local SQLite baseline schema.
-- This is a pre-launch schema bootstrap, not a migration chain.
-- Keep it aligned with packages/db-local/src/schema.ts.

DROP TABLE IF EXISTS _sqlx_migrations;

CREATE TABLE IF NOT EXISTS companies (
  company_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
  workspace_root TEXT,
  default_model_policy_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
  , template_id TEXT, template_label TEXT);
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
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
  , is_external INTEGER NOT NULL DEFAULT 0, a2a_url TEXT, a2a_token TEXT, a2a_agent_id TEXT, brand_key TEXT, agent_card_json TEXT);
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
  package_kind TEXT NOT NULL CHECK (package_kind IN ('employee', 'skill', 'sop', 'company_template', 'office_layout', 'bundle')),
  version TEXT NOT NULL,
  source_type TEXT NOT NULL CHECK (source_type IN ('registry', 'url', 'file')),
  source_ref TEXT,
  manifest_hash TEXT NOT NULL,
  package_hash TEXT NOT NULL,
  install_state TEXT NOT NULL CHECK (install_state IN ('installed', 'disabled', 'broken', 'pending_upgrade')),
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  installed_at TEXT NOT NULL,
  updated_at TEXT NOT NULL, origin_listing_id TEXT, origin_package_version_id TEXT,
  UNIQUE(company_id, package_id, version)
);
CREATE TABLE IF NOT EXISTS installed_assets (
  installed_asset_id TEXT PRIMARY KEY,
  installed_package_id TEXT NOT NULL REFERENCES installed_packages(installed_package_id) ON DELETE CASCADE,
  asset_id TEXT NOT NULL,
  asset_kind TEXT NOT NULL CHECK (asset_kind IN ('employee', 'skill', 'sop', 'company_template', 'office_layout', 'bundle_item')),
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
CREATE TABLE IF NOT EXISTS graph_checkpoints (
  checkpoint_id TEXT PRIMARY KEY,
  thread_id TEXT NOT NULL REFERENCES graph_threads(thread_id) ON DELETE CASCADE,
  checkpoint_seq INTEGER NOT NULL CHECK (checkpoint_seq >= 0),
  checkpoint_kind TEXT NOT NULL CHECK (checkpoint_kind IN ('thread_boundary', 'task_boundary', 'meeting_turn', 'tool_return', 'install_gate')),
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
  status TEXT NOT NULL CHECK (status IN ('planned', 'queued', 'running', 'waiting_dependency', 'waiting_human', 'blocked', 'completed', 'failed', 'cancelled')),
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
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
  , interaction_mode TEXT NOT NULL DEFAULT 'boss_proxy');
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
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
  , request_json TEXT, tool_calls_json TEXT, prompt_hash TEXT, tools_hash TEXT, response_hash TEXT, recording_mode TEXT);
CREATE TABLE IF NOT EXISTS checkpoints (
  thread_id TEXT NOT NULL,
  checkpoint_ns TEXT NOT NULL DEFAULT '',
  checkpoint_id TEXT NOT NULL,
  parent_checkpoint_id TEXT,
  type TEXT,
  checkpoint BLOB,
  metadata BLOB,
  PRIMARY KEY (thread_id, checkpoint_ns, checkpoint_id)
);
CREATE TABLE IF NOT EXISTS writes (
  thread_id TEXT NOT NULL,
  checkpoint_ns TEXT NOT NULL DEFAULT '',
  checkpoint_id TEXT NOT NULL,
  task_id TEXT NOT NULL,
  idx INTEGER NOT NULL,
  channel TEXT NOT NULL,
  type TEXT,
  value BLOB,
  PRIMARY KEY (thread_id, checkpoint_ns, checkpoint_id, task_id, idx)
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
CREATE TABLE IF NOT EXISTS sop_templates (
  sop_template_id TEXT PRIMARY KEY,
  company_id      TEXT NOT NULL REFERENCES companies(company_id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  description     TEXT NOT NULL DEFAULT '',
  definition_json TEXT NOT NULL,
  source_thread_id TEXT,
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
  , source_url TEXT, version TEXT, last_synced_at TEXT);
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
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL
  , compact_baseline_json TEXT, interaction_mode TEXT NOT NULL DEFAULT 'boss_proxy', synopsis_json TEXT);
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
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
  , payload_json TEXT);
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
  , payload_json TEXT);
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
  created_at         TEXT NOT NULL
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
CREATE TABLE IF NOT EXISTS kanban_cards (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(project_id) ON DELETE CASCADE,
  company_id TEXT NOT NULL REFERENCES companies(company_id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  state TEXT NOT NULL DEFAULT 'todo',
  origin TEXT NOT NULL,
  created_by_employee_id TEXT,
  assigned_employee_id TEXT,
  parent_card_id TEXT,
  blocked_reason TEXT,
  task_run_id TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_workstations_company ON workstations(company_id);
CREATE INDEX IF NOT EXISTS idx_racks_company ON racks(company_id);
CREATE INDEX IF NOT EXISTS idx_employees_company ON employees(company_id);
CREATE INDEX IF NOT EXISTS idx_install_transactions_company ON install_transactions(company_id, started_at);
CREATE INDEX IF NOT EXISTS idx_installed_packages_company ON installed_packages(company_id);
CREATE INDEX IF NOT EXISTS idx_installed_assets_pkg ON installed_assets(installed_package_id);
CREATE INDEX IF NOT EXISTS idx_asset_bindings_txn ON asset_bindings(install_txn_id);
CREATE INDEX IF NOT EXISTS idx_graph_checkpoints_thread ON graph_checkpoints(thread_id, checkpoint_seq);
CREATE INDEX IF NOT EXISTS idx_task_runs_thread ON task_runs(thread_id);
CREATE INDEX IF NOT EXISTS idx_tool_calls_task ON tool_calls(task_run_id);
CREATE INDEX IF NOT EXISTS idx_runtime_events_company_time ON runtime_events(company_id, created_at);
CREATE INDEX IF NOT EXISTS idx_llm_calls_thread ON llm_calls(thread_id);
CREATE INDEX IF NOT EXISTS idx_llm_calls_task_run ON llm_calls(task_run_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_emp_ver_emp_num ON employee_versions(employee_id, version_num);
CREATE INDEX IF NOT EXISTS idx_emp_ver_emp ON employee_versions(employee_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_cost_rates_provider_model
  ON model_cost_rates(provider, model_pattern, effective_from);
CREATE INDEX IF NOT EXISTS idx_sop_templates_company ON sop_templates(company_id);
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
CREATE INDEX IF NOT EXISTS idx_chat_threads_project_active
  ON chat_threads(project_id, archived_at, updated_at DESC);
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
CREATE INDEX IF NOT EXISTS idx_kanban_project_state
  ON kanban_cards(project_id, state);
CREATE INDEX IF NOT EXISTS idx_kanban_assignee
  ON kanban_cards(assigned_employee_id, state);
CREATE INDEX IF NOT EXISTS idx_kanban_task_run
  ON kanban_cards(task_run_id);
CREATE INDEX IF NOT EXISTS idx_meeting_sessions_mode
  ON meeting_sessions(interaction_mode);
