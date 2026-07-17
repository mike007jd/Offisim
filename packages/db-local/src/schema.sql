-- Offisim local SQLite schema — current prelaunch baseline.
-- Fresh databases apply this file directly and are stamped with the current
-- LOCAL_SCHEMA_VERSION from apps/desktop/src-tauri/src/local_db.rs.
--
-- There is no historical migration chain before public launch. Old local/dev
-- databases are disposable and should be deleted/rebuilt from this baseline.
-- Before launch, schema changes update this file and packages/db-local/src/schema.ts
-- directly; do not add compatibility migrations or fallback upgrade helpers.

DROP TABLE IF EXISTS _sqlx_migrations;

CREATE TABLE IF NOT EXISTS companies (
  company_id TEXT PRIMARY KEY NOT NULL,
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
  workstation_id TEXT PRIMARY KEY NOT NULL,
  company_id TEXT NOT NULL REFERENCES companies(company_id) ON DELETE CASCADE,
  room_type TEXT NOT NULL,
  label TEXT NOT NULL,
  position_json TEXT,
  seat_capacity INTEGER NOT NULL DEFAULT 1 CHECK (seat_capacity >= 1),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS racks (
  rack_id TEXT PRIMARY KEY NOT NULL,
  company_id TEXT NOT NULL REFERENCES companies(company_id) ON DELETE CASCADE,
  provider_type TEXT NOT NULL,
  label TEXT NOT NULL,
  binding_profile_json TEXT,
  status TEXT NOT NULL DEFAULT 'unbound' CHECK (status IN ('unbound', 'bound', 'error', 'disabled')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS slots (
  slot_id TEXT PRIMARY KEY NOT NULL,
  rack_id TEXT NOT NULL REFERENCES racks(rack_id) ON DELETE CASCADE,
  capability_name TEXT NOT NULL,
  exposure_scope TEXT NOT NULL CHECK (exposure_scope IN ('private', 'team', 'company')),
  status TEXT NOT NULL DEFAULT 'available' CHECK (status IN ('available', 'reserved', 'disabled')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS employees (
  employee_id TEXT PRIMARY KEY NOT NULL,
  company_id TEXT NOT NULL REFERENCES companies(company_id) ON DELETE CASCADE,
  source_asset_id TEXT,
  source_package_id TEXT,
  name TEXT NOT NULL,
  role_slug TEXT NOT NULL,
  workstation_id TEXT REFERENCES workstations(workstation_id) ON DELETE SET NULL,
  persona_json TEXT,
  config_json TEXT,
  model TEXT,
  thinking_level TEXT,
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  is_external INTEGER NOT NULL DEFAULT 0,
  a2a_url TEXT,
  a2a_token TEXT,
  a2a_agent_id TEXT,
  brand_key TEXT,
  agent_card_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(company_id, employee_id)
);
CREATE TABLE IF NOT EXISTS install_transactions (
  install_txn_id TEXT PRIMARY KEY NOT NULL,
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
  installed_package_id TEXT PRIMARY KEY NOT NULL,
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
  installed_asset_id TEXT PRIMARY KEY NOT NULL,
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
  binding_id TEXT PRIMARY KEY NOT NULL,
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
  task_run_id TEXT PRIMARY KEY NOT NULL,
  thread_id TEXT NOT NULL,
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
  run_id              TEXT PRIMARY KEY NOT NULL,
  -- thread_id is the product-layer chat_threads.thread_id (no FK — chat threads
  -- have no graph_threads row; matches agent_events). Cleaned up by company FK
  -- cascade + explicit per-thread deletion in local-data-deletion.
  thread_id           TEXT NOT NULL,
  company_id          TEXT NOT NULL REFERENCES companies(company_id) ON DELETE CASCADE,
  project_id          TEXT REFERENCES projects(project_id) ON DELETE SET NULL,
  parent_run_id       TEXT REFERENCES agent_runs(run_id) ON DELETE SET NULL,
  root_run_id         TEXT NOT NULL,
  employee_id         TEXT REFERENCES employees(employee_id) ON DELETE SET NULL,
  relation            TEXT,
  -- Work semantics stamped by the delegate tool on run.started (WorkKind);
  -- NULL = unclassified, never a fabricated default.
  work_kind           TEXT,
  objective           TEXT,
  access              TEXT,
  -- Typed failure cause (RunFailureKind) written on a failed terminal;
  -- NULL for running/completed/cancelled/interrupted runs.
  failure_kind        TEXT,
  -- `interrupted`: host died/was killed mid-run; startup reconcile parks the
  -- dangling root here (running→interrupted), distinct from a clean cancel.
  status              TEXT NOT NULL CHECK (status IN ('running', 'interrupted', 'completed', 'failed', 'cancelled')),
  usage_json          TEXT,
  result_summary_json TEXT,
  -- Pi session JSONL path for durable resume (set when the session opens).
  session_file        TEXT,
  runtime_context_json TEXT,
  started_at          TEXT NOT NULL,
  finished_at         TEXT
);
-- Best-of-N drafting is a product-level grouping over independent root runs.
-- Attempts intentionally keep their own thread/run identity so each engine
-- receives an isolated lifecycle and workspace lease.
CREATE TABLE IF NOT EXISTS competitive_draft_groups (
  group_id           TEXT PRIMARY KEY NOT NULL,
  company_id         TEXT NOT NULL REFERENCES companies(company_id) ON DELETE CASCADE,
  project_id         TEXT NOT NULL REFERENCES projects(project_id) ON DELETE CASCADE,
  source_run_id      TEXT NOT NULL REFERENCES agent_runs(run_id) ON DELETE CASCADE,
  objective          TEXT NOT NULL,
  status             TEXT NOT NULL CHECK (status IN ('drafting', 'reviewing', 'merging', 'merged', 'failed', 'cancelled')),
  winner_attempt_id  TEXT,
  created_at         TEXT NOT NULL,
  updated_at         TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS competitive_draft_attempts (
  attempt_id          TEXT PRIMARY KEY NOT NULL,
  group_id            TEXT NOT NULL REFERENCES competitive_draft_groups(group_id) ON DELETE CASCADE,
  ordinal             INTEGER NOT NULL CHECK (ordinal BETWEEN 1 AND 4),
  employee_id         TEXT NOT NULL REFERENCES employees(employee_id) ON DELETE RESTRICT,
  thread_id           TEXT NOT NULL,
  run_id              TEXT NOT NULL,
  lease_id            TEXT,
  status              TEXT NOT NULL CHECK (status IN ('planned', 'running', 'ready', 'winner', 'not_selected', 'failed', 'cancelled')),
  result_summary_json TEXT,
  usage_json          TEXT,
  verification_summary TEXT,
  verification_passed INTEGER CHECK (verification_passed IS NULL OR verification_passed IN (0, 1)),
  started_at          TEXT NOT NULL,
  finished_at         TEXT,
  UNIQUE(group_id, ordinal),
  UNIQUE(group_id, employee_id),
  UNIQUE(run_id),
  UNIQUE(lease_id)
);
CREATE INDEX IF NOT EXISTS idx_competitive_draft_groups_project
  ON competitive_draft_groups(project_id, created_at);
CREATE INDEX IF NOT EXISTS idx_competitive_draft_groups_source
  ON competitive_draft_groups(source_run_id);
CREATE INDEX IF NOT EXISTS idx_competitive_draft_attempts_group
  ON competitive_draft_attempts(group_id, ordinal);
-- Durable project experience owned by one employee. This is intentionally
-- separate from the generic `memories` table: these rows are injected into
-- employee runs, edited from Personnel, and capped per employee × project.
CREATE TABLE IF NOT EXISTS employee_project_memories (
  memory_id      TEXT PRIMARY KEY NOT NULL,
  company_id     TEXT NOT NULL REFERENCES companies(company_id) ON DELETE CASCADE,
  employee_id    TEXT NOT NULL REFERENCES employees(employee_id) ON DELETE CASCADE,
  project_id     TEXT NOT NULL REFERENCES projects(project_id) ON DELETE CASCADE,
  memory_type    TEXT NOT NULL CHECK (
    memory_type IN ('pitfall', 'repository_preference', 'convention', 'retrospective')
  ),
  content        TEXT NOT NULL CHECK (length(trim(content)) BETWEEN 1 AND 1600),
  source_run_id  TEXT REFERENCES agent_runs(run_id) ON DELETE SET NULL,
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL,
  pinned         INTEGER NOT NULL DEFAULT 0 CHECK (pinned IN (0, 1)),
  hit_count      INTEGER NOT NULL DEFAULT 0 CHECK (hit_count >= 0),
  last_hit_at    TEXT
);
CREATE INDEX IF NOT EXISTS idx_employee_project_memories_employee_project
  ON employee_project_memories(employee_id, project_id, pinned, hit_count, updated_at);
CREATE INDEX IF NOT EXISTS idx_employee_project_memories_source
  ON employee_project_memories(source_run_id);
CREATE TRIGGER IF NOT EXISTS trg_employee_project_memory_scope_insert
BEFORE INSERT ON employee_project_memories
WHEN NOT EXISTS (
  SELECT 1
  FROM employees AS employee
  JOIN projects AS project
    ON project.project_id = NEW.project_id
   AND project.company_id = NEW.company_id
  WHERE employee.employee_id = NEW.employee_id
    AND employee.company_id = NEW.company_id
)
OR (
  NEW.source_run_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM agent_runs AS source
    WHERE source.run_id = NEW.source_run_id
      AND source.company_id = NEW.company_id
      AND source.project_id = NEW.project_id
      AND source.employee_id = NEW.employee_id
  )
)
BEGIN
  SELECT RAISE(ABORT, 'employee project memory scope does not match');
END;
CREATE TRIGGER IF NOT EXISTS trg_employee_project_memory_scope_immutable
BEFORE UPDATE OF company_id, employee_id, project_id
ON employee_project_memories
WHEN NEW.company_id <> OLD.company_id
  OR NEW.employee_id <> OLD.employee_id
  OR NEW.project_id <> OLD.project_id
BEGIN
  SELECT RAISE(ABORT, 'employee project memory scope is immutable');
END;
CREATE TRIGGER IF NOT EXISTS trg_employee_project_memory_source_update
BEFORE UPDATE OF source_run_id ON employee_project_memories
WHEN NEW.source_run_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM agent_runs AS source
    WHERE source.run_id = NEW.source_run_id
      AND source.company_id = NEW.company_id
      AND source.project_id = NEW.project_id
      AND source.employee_id = NEW.employee_id
  )
BEGIN
  SELECT RAISE(ABORT, 'employee project memory source does not match');
END;
CREATE TRIGGER IF NOT EXISTS trg_competitive_draft_group_source_insert
BEFORE INSERT ON competitive_draft_groups
WHEN NOT EXISTS (
  SELECT 1 FROM agent_runs AS source
  WHERE source.run_id = NEW.source_run_id
    AND source.company_id = NEW.company_id
    AND source.project_id = NEW.project_id
    AND source.run_id = source.root_run_id
    AND source.parent_run_id IS NULL
)
BEGIN
  SELECT RAISE(ABORT, 'competitive draft source card provenance does not match');
END;
CREATE TRIGGER IF NOT EXISTS trg_competitive_draft_group_scope_immutable
BEFORE UPDATE OF company_id, project_id, source_run_id ON competitive_draft_groups
WHEN NEW.company_id <> OLD.company_id
  OR NEW.project_id <> OLD.project_id
  OR NEW.source_run_id <> OLD.source_run_id
BEGIN
  SELECT RAISE(ABORT, 'competitive draft group scope is immutable');
END;
CREATE TRIGGER IF NOT EXISTS trg_competitive_draft_attempt_scope_insert
BEFORE INSERT ON competitive_draft_attempts
WHEN NOT EXISTS (
  SELECT 1
  FROM competitive_draft_groups AS draft
  JOIN employees AS employee
    ON employee.employee_id = NEW.employee_id
   AND employee.company_id = draft.company_id
  JOIN chat_threads AS thread
    ON thread.thread_id = NEW.thread_id
   AND thread.project_id = draft.project_id
   AND thread.employee_id = NEW.employee_id
  WHERE draft.group_id = NEW.group_id
)
BEGIN
  SELECT RAISE(ABORT, 'competitive draft attempt scope does not match its group');
END;
CREATE TRIGGER IF NOT EXISTS trg_competitive_draft_attempt_scope_immutable
BEFORE UPDATE OF group_id, ordinal, employee_id, thread_id, run_id
ON competitive_draft_attempts
WHEN NEW.group_id <> OLD.group_id
  OR NEW.ordinal <> OLD.ordinal
  OR NEW.employee_id <> OLD.employee_id
  OR NEW.thread_id <> OLD.thread_id
  OR NEW.run_id <> OLD.run_id
BEGIN
  SELECT RAISE(ABORT, 'competitive draft attempt scope is immutable');
END;
CREATE TRIGGER IF NOT EXISTS trg_competitive_draft_winner_update
BEFORE UPDATE OF status, winner_attempt_id ON competitive_draft_groups
WHEN (
  NEW.winner_attempt_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM competitive_draft_attempts AS attempt
    WHERE attempt.attempt_id = NEW.winner_attempt_id
      AND attempt.group_id = NEW.group_id
  )
) OR (
  NEW.status IN ('merging', 'merged')
  AND NEW.winner_attempt_id IS NULL
)
BEGIN
  SELECT RAISE(ABORT, 'competitive draft winner does not belong to its group');
END;
CREATE TABLE IF NOT EXISTS tool_calls (
  tool_call_id TEXT PRIMARY KEY NOT NULL,
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
  handoff_id TEXT PRIMARY KEY NOT NULL,
  thread_id TEXT NOT NULL,
  from_employee_id TEXT REFERENCES employees(employee_id) ON DELETE SET NULL,
  to_employee_id TEXT REFERENCES employees(employee_id) ON DELETE SET NULL,
  reason TEXT,
  payload_json TEXT,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS meeting_sessions (
  meeting_id TEXT PRIMARY KEY NOT NULL,
  company_id TEXT NOT NULL REFERENCES companies(company_id) ON DELETE CASCADE,
  thread_id TEXT,
  topic TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('scheduled', 'running', 'paused', 'completed', 'cancelled')),
  summary_json TEXT,
  interaction_mode TEXT NOT NULL DEFAULT 'boss_proxy',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS runtime_events (
  event_id TEXT PRIMARY KEY NOT NULL,
  company_id TEXT NOT NULL REFERENCES companies(company_id) ON DELETE CASCADE,
  thread_id TEXT,
  event_type TEXT NOT NULL,
  severity TEXT NOT NULL DEFAULT 'info' CHECK (severity IN ('debug', 'info', 'warning', 'error')),
  payload_json TEXT,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS llm_calls (
  llm_call_id   TEXT PRIMARY KEY NOT NULL,
  thread_id     TEXT,
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
  version_id    TEXT PRIMARY KEY NOT NULL,
  employee_id   TEXT NOT NULL REFERENCES employees(employee_id) ON DELETE CASCADE,
  version_num   INTEGER NOT NULL,
  change_type   TEXT NOT NULL CHECK(change_type IN ('create', 'update', 'rollback')),
  snapshot_json TEXT NOT NULL,
  change_summary TEXT,
  created_by    TEXT NOT NULL DEFAULT 'user',
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS model_cost_rates (
  rate_id              TEXT PRIMARY KEY NOT NULL,
  provider             TEXT NOT NULL,
  model_pattern        TEXT NOT NULL,
  input_cost_per_mtok  REAL NOT NULL,
  output_cost_per_mtok REAL NOT NULL,
  effective_from       TEXT NOT NULL,
  effective_until      TEXT,
  created_at           TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS company_template_assets (
  company_template_asset_id TEXT PRIMARY KEY NOT NULL,
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
  layout_id   TEXT PRIMARY KEY NOT NULL,
  company_id  TEXT NOT NULL REFERENCES companies(company_id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  layout_json TEXT NOT NULL,
  is_active   INTEGER NOT NULL DEFAULT 0 CHECK (is_active IN (0, 1)),
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS library_documents (
  doc_id       TEXT PRIMARY KEY NOT NULL,
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
  instance_id   TEXT PRIMARY KEY NOT NULL,
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
  thread_id    TEXT PRIMARY KEY NOT NULL,
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
  project_id  TEXT PRIMARY KEY NOT NULL,
  company_id  TEXT NOT NULL REFERENCES companies(company_id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  description TEXT,
  status      TEXT NOT NULL DEFAULT 'planning'
    CHECK(status IN ('planning', 'active', 'paused', 'completed', 'archived')),
  workspace_root TEXT NOT NULL CHECK(trim(workspace_root) <> ''),
  verify_command TEXT,
  verify_max_attempts INTEGER NOT NULL DEFAULT 3 CHECK(verify_max_attempts BETWEEN 1 AND 20),
  verify_token_budget INTEGER CHECK(verify_token_budget IS NULL OR verify_token_budget > 0),
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);
-- Backend-owned proof that a Project folder came from the native folder picker.
-- `projects.workspace_root` remains a renderer-readable catalog projection, but
-- task authority is issued only when it exactly matches this protected record
-- and the live filesystem identity still matches.
CREATE TABLE IF NOT EXISTS project_workspace_authority (
  project_id          TEXT PRIMARY KEY NOT NULL REFERENCES projects(project_id) ON DELETE CASCADE,
  company_id          TEXT NOT NULL REFERENCES companies(company_id) ON DELETE CASCADE,
  canonical_root      TEXT NOT NULL CHECK(trim(canonical_root) <> ''),
  root_identity_json  TEXT NOT NULL,
  selected_at_unix_ms INTEGER NOT NULL,
  updated_at_unix_ms  INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS chat_threads (
  thread_id         TEXT PRIMARY KEY NOT NULL,
  project_id        TEXT NOT NULL REFERENCES projects(project_id) ON DELETE CASCADE,
  employee_id       TEXT REFERENCES employees(employee_id) ON DELETE SET NULL,
  title             TEXT NOT NULL DEFAULT 'New thread',
  title_set_by_user INTEGER NOT NULL DEFAULT 0 CHECK (title_set_by_user IN (0, 1)),
  semantic_title_job_id TEXT,
  semantic_title_status TEXT CHECK (
    semantic_title_status IS NULL OR
    semantic_title_status IN ('running', 'completed', 'failed', 'cancelled')
  ),
  semantic_title_source_provenance_json TEXT,
  semantic_title_result_provenance_json TEXT,
  semantic_title_usage_json TEXT,
  semantic_title_error_code TEXT,
  summary           TEXT,
  archived_at       TEXT,
  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL
);
-- Durable, non-authoritative projection of backend-issued task workspace
-- capabilities. The 256-bit binding ref never enters SQLite; only the safe
-- scope/root/reason projection survives restart for explanation and recovery.
CREATE TABLE IF NOT EXISTS task_workspace_binding_history (
  binding_id                TEXT PRIMARY KEY NOT NULL,
  company_id                TEXT NOT NULL REFERENCES companies(company_id) ON DELETE CASCADE,
  project_id                TEXT NOT NULL REFERENCES projects(project_id) ON DELETE CASCADE,
  thread_id                 TEXT NOT NULL REFERENCES chat_threads(thread_id) ON DELETE CASCADE,
  turn_id                   TEXT NOT NULL,
  request_id                TEXT NOT NULL UNIQUE,
  access                    TEXT NOT NULL CHECK(access IN ('read', 'write')),
  canonical_root            TEXT NOT NULL,
  root_identity_json        TEXT NOT NULL,
  workspace_basename_normalized TEXT NOT NULL,
  project_name_normalized   TEXT NOT NULL,
  workspace_anchor          TEXT NOT NULL,
  git_origin_digest         TEXT,
  recovery_witness_binding_id TEXT,
  recovery_witness_authority_project_id TEXT,
  authority_snapshot_canonical_root TEXT NOT NULL,
  authority_snapshot_root_identity_json TEXT NOT NULL,
  authority_snapshot_updated_at_unix_ms INTEGER NOT NULL,
  source                    TEXT NOT NULL,
  confidence                REAL NOT NULL CHECK(confidence BETWEEN 0 AND 1),
  reason_code               TEXT NOT NULL,
  issued_at_unix_ms         INTEGER NOT NULL,
  expires_at_unix_ms        INTEGER NOT NULL,
  activated_at_unix_ms      INTEGER NOT NULL,
  last_used_at_unix_ms      INTEGER NOT NULL,
  status                    TEXT NOT NULL CHECK(status IN (
    'active', 'completed', 'failed', 'aborted', 'expired', 'app_restart'
  )),
  revoked_at_unix_ms        INTEGER,
  read_grace_until_unix_ms  INTEGER,
  release_reason            TEXT,
  resumed_from_binding_id   TEXT,
  CHECK (
    (source = 'project_catalog' AND reason_code = 'current_project_folder')
    OR (source = 'conversation_history' AND reason_code = 'recent_successful_workspace')
    OR (
      source = 'known_root_recovery'
      AND reason_code IN (
        'renamed_same_filesystem_object',
        'unique_name_repo_identity_match'
      )
    )
    OR (source = 'resume_history' AND reason_code = 'resume_history_identity_match')
  )
);
-- Backend authority/provenance for isolated writable worktrees. Renderer and
-- Node lease packets are only consistency projections; a worktree is usable or
-- adoptable only while this row is active and live Git metadata still matches.
CREATE TABLE IF NOT EXISTS task_workspace_lease_history (
  lease_id                   TEXT PRIMARY KEY NOT NULL,
  project_id                 TEXT NOT NULL REFERENCES projects(project_id) ON DELETE CASCADE,
  created_binding_id         TEXT NOT NULL,
  active_binding_id          TEXT NOT NULL,
  created_root_run_id        TEXT NOT NULL,
  child_run_id               TEXT NOT NULL,
  created_request_id         TEXT NOT NULL,
  branch                     TEXT NOT NULL,
  canonical_worktree         TEXT NOT NULL UNIQUE,
  worktree_identity_json     TEXT NOT NULL,
  project_root_identity_json TEXT NOT NULL,
  created_at_unix_ms         INTEGER NOT NULL,
  updated_at_unix_ms         INTEGER NOT NULL,
  status                     TEXT NOT NULL CHECK(status IN ('active', 'released', 'discarded', 'invalid'))
);
-- Git-backed change safety net for isolated lease worktrees. Each row points at
-- a hidden ref; no checkpoint commit is attached to the employee branch.
CREATE TABLE IF NOT EXISTS workspace_checkpoints (
  checkpoint_id       TEXT PRIMARY KEY NOT NULL,
  lease_id            TEXT NOT NULL REFERENCES task_workspace_lease_history(lease_id) ON DELETE CASCADE,
  run_id              TEXT NOT NULL,
  step                INTEGER NOT NULL CHECK(step >= 0),
  checkpoint_ref      TEXT NOT NULL UNIQUE CHECK(checkpoint_ref LIKE 'refs/offisim/checkpoints/%'),
  trigger_tool        TEXT NOT NULL,
  trigger_tool_call_id TEXT,
  changed_paths_json  TEXT NOT NULL CHECK(json_valid(changed_paths_json)),
  created_at          TEXT NOT NULL,
  UNIQUE(lease_id, step)
);
CREATE TABLE IF NOT EXISTS workspace_checkpoint_rollbacks (
  rollback_id         TEXT PRIMARY KEY NOT NULL,
  lease_id            TEXT NOT NULL REFERENCES task_workspace_lease_history(lease_id) ON DELETE CASCADE,
  checkpoint_id       TEXT NOT NULL REFERENCES workspace_checkpoints(checkpoint_id) ON DELETE RESTRICT,
  target_step         INTEGER NOT NULL CHECK(target_step >= 0),
  target_ref          TEXT NOT NULL CHECK(target_ref LIKE 'refs/offisim/checkpoints/%'),
  actor               TEXT NOT NULL CHECK(trim(actor) <> ''),
  changed_paths_json  TEXT NOT NULL CHECK(json_valid(changed_paths_json)),
  rolled_back_at      TEXT NOT NULL,
  status              TEXT NOT NULL CHECK(status IN ('pending', 'completed', 'failed'))
);
CREATE TABLE IF NOT EXISTS project_assignments (
  assignment_id TEXT PRIMARY KEY NOT NULL,
  project_id    TEXT NOT NULL REFERENCES projects(project_id) ON DELETE CASCADE,
  employee_id   TEXT NOT NULL REFERENCES employees(employee_id) ON DELETE CASCADE,
  role          TEXT NOT NULL DEFAULT 'member',
  assigned_at   TEXT NOT NULL,
  UNIQUE(project_id, employee_id)
);
CREATE TABLE IF NOT EXISTS agent_events (
  event_id         TEXT PRIMARY KEY NOT NULL,
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
  knowledge_id   TEXT PRIMARY KEY NOT NULL,
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
  history_id TEXT PRIMARY KEY NOT NULL,
  snapshot_id TEXT NOT NULL,
  thread_id TEXT NOT NULL,
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
  thread_id TEXT PRIMARY KEY NOT NULL,
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
  history_id TEXT PRIMARY KEY NOT NULL,
  interaction_id TEXT NOT NULL,
  thread_id TEXT NOT NULL,
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
  audit_id TEXT PRIMARY KEY NOT NULL,
  thread_id TEXT NOT NULL,
  task_run_id TEXT REFERENCES task_runs(task_run_id) ON DELETE SET NULL,
  employee_id TEXT NOT NULL,
  server_name TEXT NOT NULL,
  tool_name TEXT NOT NULL,
  arguments_json TEXT NOT NULL,
  result_json TEXT,
  error TEXT,
  latency_ms INTEGER NOT NULL,
  approval_status TEXT NOT NULL DEFAULT 'not_required'
    CHECK (approval_status IN ('not_required', 'human_approved', 'human_denied')),
  approved_by TEXT,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS mcp_tool_grants (
  grant_id TEXT PRIMARY KEY NOT NULL,
  company_id TEXT NOT NULL REFERENCES companies(company_id) ON DELETE CASCADE,
  employee_id TEXT NOT NULL,
  server_name TEXT NOT NULL,
  tool_name TEXT NOT NULL,
  scope TEXT NOT NULL DEFAULT 'employee',
  project_id TEXT,
  risk_class TEXT NOT NULL DEFAULT 'write'
    CHECK (risk_class IN ('read', 'write', 'destructive', 'open_world')),
  risk_source TEXT NOT NULL DEFAULT 'human_override'
    CHECK (risk_source IN ('server_annotation', 'name_heuristic', 'human_override', 'trusted_manifest')),
  trusted_server_id TEXT,
  granted_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(company_id, employee_id, server_name, tool_name),
  FOREIGN KEY(company_id, employee_id)
    REFERENCES employees(company_id, employee_id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS zones (
  zone_id TEXT PRIMARY KEY NOT NULL,
  company_id TEXT NOT NULL REFERENCES companies(company_id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  archetype TEXT,
  label TEXT NOT NULL,
  accent_color TEXT NOT NULL DEFAULT '#64748b',
  floor_color INTEGER NOT NULL DEFAULT 0x2a3a5c,
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
  memory_id TEXT PRIMARY KEY NOT NULL,
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
  deliverable_id     TEXT PRIMARY KEY NOT NULL,
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
  key         TEXT PRIMARY KEY NOT NULL,
  value       TEXT NOT NULL,
  updated_at  INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS node_summaries (
  summary_id TEXT PRIMARY KEY NOT NULL,
  thread_id TEXT NOT NULL,
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
  compact_id TEXT PRIMARY KEY NOT NULL,
  thread_id TEXT NOT NULL,
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
  skill_id     TEXT PRIMARY KEY NOT NULL,
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
  approval_id TEXT PRIMARY KEY NOT NULL,
  thread_id TEXT NOT NULL,
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
CREATE INDEX IF NOT EXISTS idx_agent_runs_company_started
  ON agent_runs(company_id, started_at);
CREATE INDEX IF NOT EXISTS idx_agent_runs_company_thread
  ON agent_runs(company_id, thread_id);
-- A Conversation may own at most one unresolved root. An interrupted root keeps
-- its native-session branch reserved until Resume or Discard; renderer
-- activation barriers provide friendly errors, while this durable constraint is
-- the final authority across processes, reloads, Conversation, and Mission.
CREATE UNIQUE INDEX IF NOT EXISTS idx_agent_runs_one_unresolved_root_per_thread
  ON agent_runs(thread_id)
  WHERE run_id = root_run_id AND status IN ('running', 'interrupted');
CREATE INDEX IF NOT EXISTS idx_agent_runs_root ON agent_runs(root_run_id);
CREATE INDEX IF NOT EXISTS idx_agent_runs_parent ON agent_runs(parent_run_id);
CREATE INDEX IF NOT EXISTS idx_agent_runs_company_project_status
  ON agent_runs(company_id, project_id, status);
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
CREATE INDEX IF NOT EXISTS idx_project_workspace_authority_company
  ON project_workspace_authority(company_id, project_id);
CREATE INDEX IF NOT EXISTS idx_task_workspace_binding_history_scope
  ON task_workspace_binding_history(company_id, thread_id, issued_at_unix_ms DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_task_workspace_binding_resume_once
  ON task_workspace_binding_history(resumed_from_binding_id)
  WHERE resumed_from_binding_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_task_workspace_lease_history_project_status
  ON task_workspace_lease_history(project_id, status, updated_at_unix_ms DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_task_workspace_lease_history_active_branch
  ON task_workspace_lease_history(project_id, branch) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_workspace_checkpoints_lease_step
  ON workspace_checkpoints(lease_id, step DESC);
CREATE INDEX IF NOT EXISTS idx_workspace_checkpoint_rollbacks_lease_time
  ON workspace_checkpoint_rollbacks(lease_id, rolled_back_at DESC);

-- Backend workspace authority is deliberately stronger than the renderer's
-- generic local-DB surface. These triggers make cross-table scope/provenance
-- and destructive-delete gates atomic with the write itself; a renderer
-- preflight remains UX-only and cannot introduce a check-then-delete race.
CREATE TRIGGER IF NOT EXISTS trg_task_workspace_binding_scope_insert
BEFORE INSERT ON task_workspace_binding_history
WHEN NOT EXISTS (
  SELECT 1
  FROM chat_threads AS thread
  JOIN projects AS project ON project.project_id = thread.project_id
  WHERE thread.thread_id = NEW.thread_id
    AND project.project_id = NEW.project_id
    AND project.company_id = NEW.company_id
)
BEGIN
  SELECT RAISE(ABORT, 'task workspace binding scope does not match Company, Project, and Conversation');
END;

-- Issuance is a compare-and-swap against the exact Project authority observed
-- by the resolver. Recovery may bind a different live root, so binding root
-- columns cannot stand in for this issuer snapshot.
CREATE TRIGGER IF NOT EXISTS trg_task_workspace_binding_authority_snapshot_insert
BEFORE INSERT ON task_workspace_binding_history
WHEN NOT EXISTS (
  SELECT 1
  FROM chat_threads AS thread
  JOIN projects AS project ON project.project_id = thread.project_id
  JOIN project_workspace_authority AS authority
    ON authority.project_id = project.project_id
   AND authority.company_id = project.company_id
   AND authority.canonical_root = project.workspace_root
  WHERE thread.thread_id = NEW.thread_id
    AND project.project_id = NEW.project_id
    AND project.company_id = NEW.company_id
    AND NEW.authority_snapshot_canonical_root = project.workspace_root
    AND NEW.authority_snapshot_canonical_root = authority.canonical_root
    AND NEW.authority_snapshot_root_identity_json = authority.root_identity_json
    AND NEW.authority_snapshot_updated_at_unix_ms = authority.updated_at_unix_ms
)
BEGIN
  SELECT RAISE(ABORT, 'task workspace binding Project authority snapshot is stale');
END;

-- A recovered root is Conversation evidence, not permission to adopt a folder
-- currently claimed by another Project, Company, or retained worktree.
-- Keep this check in SQLite as the final compare-and-swap boundary after the
-- resolver's read-side ownership check.
CREATE TRIGGER IF NOT EXISTS trg_task_workspace_recovered_root_unoccupied_insert
BEFORE INSERT ON task_workspace_binding_history
WHEN NEW.source IN ('conversation_history', 'known_root_recovery')
AND (
  EXISTS (
    SELECT 1
    FROM project_workspace_authority AS authority
    WHERE authority.project_id <> NEW.project_id
      AND authority.canonical_root = NEW.canonical_root
  )
  OR EXISTS (
    SELECT 1
    FROM task_workspace_binding_history AS binding
    WHERE binding.status = 'active'
      AND binding.canonical_root = NEW.canonical_root
      AND binding.project_id <> NEW.project_id
  )
  OR EXISTS (
    SELECT 1
    FROM task_workspace_lease_history AS lease
    WHERE lease.status = 'active'
      AND lease.canonical_worktree = NEW.canonical_root
  )
)
BEGIN
  SELECT RAISE(ABORT, 'recovered workspace root is already claimed by another Project or retained worktree');
END;

-- A live binding is either backed by the current native-picked Project folder,
-- or by one completed binding from the same Conversation. Recovery rows never
-- rewrite Project catalog authority; they carry their own immutable witness.
CREATE TRIGGER IF NOT EXISTS trg_task_workspace_binding_authority_insert
BEFORE INSERT ON task_workspace_binding_history
WHEN NOT (
  (
    (
      (NEW.source = 'project_catalog' AND NEW.reason_code = 'current_project_folder')
      OR (
        NEW.source = 'resume_history'
        AND NEW.reason_code = 'resume_history_identity_match'
      )
    )
    AND NEW.recovery_witness_binding_id IS NULL
    AND NEW.recovery_witness_authority_project_id IS NULL
    AND EXISTS (
      SELECT 1
      FROM projects AS project
      JOIN project_workspace_authority AS authority
        ON authority.project_id = project.project_id
       AND authority.company_id = project.company_id
       AND authority.canonical_root = project.workspace_root
      WHERE project.project_id = NEW.project_id
        AND project.company_id = NEW.company_id
        AND authority.canonical_root = NEW.canonical_root
        AND authority.root_identity_json = NEW.root_identity_json
    )
  )
  OR (
    NEW.source = 'conversation_history'
    AND NEW.reason_code = 'recent_successful_workspace'
    AND NEW.recovery_witness_authority_project_id IS NULL
    AND EXISTS (
      SELECT 1
      FROM task_workspace_binding_history AS witness
      WHERE witness.binding_id = NEW.recovery_witness_binding_id
        AND witness.company_id = NEW.company_id
        AND witness.project_id = NEW.project_id
        AND witness.thread_id = NEW.thread_id
        AND witness.status = 'completed'
        AND witness.authority_snapshot_canonical_root = NEW.authority_snapshot_canonical_root
        AND witness.authority_snapshot_root_identity_json = NEW.authority_snapshot_root_identity_json
        AND witness.authority_snapshot_updated_at_unix_ms = NEW.authority_snapshot_updated_at_unix_ms
        AND witness.canonical_root = NEW.canonical_root
        AND witness.root_identity_json = NEW.root_identity_json
    )
  )
  OR (
    NEW.source = 'known_root_recovery'
    AND (
      (
        NEW.recovery_witness_authority_project_id IS NULL
        AND EXISTS (
          SELECT 1
          FROM task_workspace_binding_history AS witness
          WHERE witness.binding_id = NEW.recovery_witness_binding_id
            AND witness.company_id = NEW.company_id
            AND witness.project_id = NEW.project_id
            AND witness.thread_id = NEW.thread_id
            AND witness.status = 'completed'
            AND witness.authority_snapshot_canonical_root = NEW.authority_snapshot_canonical_root
            AND witness.authority_snapshot_root_identity_json = NEW.authority_snapshot_root_identity_json
            AND witness.authority_snapshot_updated_at_unix_ms = NEW.authority_snapshot_updated_at_unix_ms
            AND (
              (
                NEW.reason_code = 'renamed_same_filesystem_object'
                AND json_extract(witness.root_identity_json, '$.device') = json_extract(NEW.root_identity_json, '$.device')
                AND json_extract(witness.root_identity_json, '$.inode') = json_extract(NEW.root_identity_json, '$.inode')
              )
              OR (
                NEW.reason_code = 'unique_name_repo_identity_match'
                AND NEW.git_origin_digest IS NOT NULL
                AND NEW.git_origin_digest = witness.git_origin_digest
                AND NEW.workspace_basename_normalized IN (
                  witness.workspace_basename_normalized,
                  witness.project_name_normalized
                )
              )
            )
        )
      )
      OR (
        NEW.reason_code = 'renamed_same_filesystem_object'
        AND NEW.recovery_witness_binding_id IS NULL
        AND NEW.recovery_witness_authority_project_id = NEW.project_id
        AND EXISTS (
          SELECT 1
          FROM project_workspace_authority AS authority
          WHERE authority.project_id = NEW.recovery_witness_authority_project_id
            AND authority.company_id = NEW.company_id
            AND authority.canonical_root = NEW.authority_snapshot_canonical_root
            AND authority.root_identity_json = NEW.authority_snapshot_root_identity_json
            AND authority.updated_at_unix_ms = NEW.authority_snapshot_updated_at_unix_ms
            AND json_extract(authority.root_identity_json, '$.device') = json_extract(NEW.root_identity_json, '$.device')
            AND json_extract(authority.root_identity_json, '$.inode') = json_extract(NEW.root_identity_json, '$.inode')
        )
      )
    )
  )
)
BEGIN
  SELECT RAISE(ABORT, 'task workspace binding has no durable Project or Conversation authority');
END;

CREATE TRIGGER IF NOT EXISTS trg_project_workspace_authority_scope_insert
BEFORE INSERT ON project_workspace_authority
WHEN NOT EXISTS (
  SELECT 1 FROM projects AS project
  WHERE project.project_id = NEW.project_id
    AND project.company_id = NEW.company_id
    AND project.workspace_root = NEW.canonical_root
)
BEGIN
  SELECT RAISE(ABORT, 'Project workspace authority does not match its Project catalog scope');
END;

CREATE TRIGGER IF NOT EXISTS trg_project_workspace_authority_scope_update
BEFORE UPDATE OF project_id, company_id, canonical_root ON project_workspace_authority
WHEN NOT EXISTS (
  SELECT 1 FROM projects AS project
  WHERE project.project_id = NEW.project_id
    AND project.company_id = NEW.company_id
    AND project.workspace_root = NEW.canonical_root
)
BEGIN
  SELECT RAISE(ABORT, 'Project workspace authority does not match its Project catalog scope');
END;

-- Reverse compare-and-swap: a Project catalog write cannot retroactively seize
-- a root already proven by another Project's authority, active Conversation,
-- or retained worktree. The recovered-binding trigger above protects issuance;
-- these two protect the opposite write order.
CREATE TRIGGER IF NOT EXISTS trg_project_workspace_authority_root_unoccupied_insert
BEFORE INSERT ON project_workspace_authority
WHEN EXISTS (
  SELECT 1 FROM project_workspace_authority AS authority
  WHERE authority.project_id <> NEW.project_id
    AND authority.canonical_root = NEW.canonical_root
)
OR EXISTS (
  SELECT 1 FROM task_workspace_binding_history AS binding
  WHERE binding.project_id <> NEW.project_id
    AND binding.status = 'active'
    AND binding.canonical_root = NEW.canonical_root
)
OR EXISTS (
  SELECT 1 FROM task_workspace_lease_history AS lease
  WHERE lease.status = 'active'
    AND lease.canonical_worktree = NEW.canonical_root
)
BEGIN
  SELECT RAISE(ABORT, 'Project workspace root is already claimed by another Project, active Conversation, or retained worktree');
END;

CREATE TRIGGER IF NOT EXISTS trg_project_workspace_authority_root_unoccupied_update
BEFORE UPDATE OF project_id, canonical_root ON project_workspace_authority
WHEN (
  NEW.project_id <> OLD.project_id
  OR NEW.canonical_root <> OLD.canonical_root
)
AND (
  EXISTS (
    SELECT 1 FROM project_workspace_authority AS authority
    WHERE authority.project_id <> NEW.project_id
      AND authority.canonical_root = NEW.canonical_root
  )
  OR EXISTS (
    SELECT 1 FROM task_workspace_binding_history AS binding
    WHERE binding.project_id <> NEW.project_id
      AND binding.status = 'active'
      AND binding.canonical_root = NEW.canonical_root
  )
  OR EXISTS (
    SELECT 1 FROM task_workspace_lease_history AS lease
    WHERE lease.status = 'active'
      AND lease.canonical_worktree = NEW.canonical_root
  )
)
BEGIN
  SELECT RAISE(ABORT, 'Project workspace root is already claimed by another Project, active Conversation, or retained worktree');
END;

CREATE TRIGGER IF NOT EXISTS trg_project_workspace_authority_identity_update
BEFORE UPDATE OF canonical_root, root_identity_json ON project_workspace_authority
WHEN (NEW.canonical_root <> OLD.canonical_root OR NEW.root_identity_json <> OLD.root_identity_json)
AND (
  EXISTS (
    SELECT 1 FROM task_workspace_binding_history AS binding
    WHERE binding.project_id = OLD.project_id AND binding.status = 'active'
  )
  OR EXISTS (
    SELECT 1 FROM task_workspace_lease_history AS lease
    WHERE lease.project_id = OLD.project_id AND lease.status = 'active'
  )
)
BEGIN
  SELECT RAISE(ABORT, 'stop active tasks and review, release, or discard retained worktrees before changing this Project folder identity');
END;

-- A Conversation never moves between Projects. Re-parenting it underneath an
-- active binding would otherwise rewrite the meaning of durable scope rows.
CREATE TRIGGER IF NOT EXISTS trg_chat_threads_project_immutable
BEFORE UPDATE OF project_id ON chat_threads
WHEN NEW.project_id <> OLD.project_id
BEGIN
  SELECT RAISE(ABORT, 'A Conversation cannot be moved to another Project');
END;

-- Folder/company identity cannot change while a writer or retained worktree is
-- live. The dedicated backend update performs the same preflight for a clearer
-- product error; this trigger closes the transaction race and direct DB writes.
CREATE TRIGGER IF NOT EXISTS trg_projects_workspace_authority_update
BEFORE UPDATE OF company_id, workspace_root ON projects
WHEN (NEW.company_id <> OLD.company_id OR NEW.workspace_root <> OLD.workspace_root)
AND (
  EXISTS (
    SELECT 1 FROM task_workspace_binding_history AS binding
    WHERE binding.project_id = OLD.project_id AND binding.status = 'active'
  )
  OR EXISTS (
    SELECT 1 FROM task_workspace_lease_history AS lease
    WHERE lease.project_id = OLD.project_id AND lease.status = 'active'
  )
)
BEGIN
  SELECT RAISE(ABORT, 'stop active tasks and review, release, or discard retained worktrees before changing this Project folder');
END;

CREATE TRIGGER IF NOT EXISTS trg_task_workspace_binding_scope_update
BEFORE UPDATE OF company_id, project_id, thread_id
ON task_workspace_binding_history
WHEN NOT EXISTS (
  SELECT 1
  FROM chat_threads AS thread
  JOIN projects AS project ON project.project_id = thread.project_id
  WHERE thread.thread_id = NEW.thread_id
    AND project.project_id = NEW.project_id
    AND project.company_id = NEW.company_id
)
BEGIN
  SELECT RAISE(ABORT, 'task workspace binding scope does not match Company, Project, and Conversation');
END;

CREATE TRIGGER IF NOT EXISTS trg_task_workspace_binding_authority_immutable
BEFORE UPDATE OF
  company_id, project_id, thread_id, canonical_root, root_identity_json,
  workspace_basename_normalized, project_name_normalized, workspace_anchor,
  git_origin_digest, recovery_witness_binding_id,
  recovery_witness_authority_project_id, authority_snapshot_canonical_root,
  authority_snapshot_root_identity_json,
  authority_snapshot_updated_at_unix_ms, source, confidence, reason_code
ON task_workspace_binding_history
BEGIN
  SELECT RAISE(ABORT, 'task workspace binding authority provenance is immutable');
END;

CREATE TRIGGER IF NOT EXISTS trg_task_workspace_lease_provenance_insert
BEFORE INSERT ON task_workspace_lease_history
WHEN NOT EXISTS (
  SELECT 1
  FROM task_workspace_binding_history AS binding
  JOIN agent_runs AS child ON child.run_id = NEW.child_run_id
  JOIN agent_runs AS root ON root.run_id = NEW.created_root_run_id
  WHERE binding.binding_id = NEW.created_binding_id
    AND NEW.active_binding_id = NEW.created_binding_id
    AND binding.project_id = NEW.project_id
    AND binding.turn_id = NEW.created_root_run_id
    AND binding.request_id = NEW.created_request_id
    AND binding.access = 'write'
    AND binding.status = 'active'
    AND EXISTS (
      SELECT 1
      FROM projects AS project
      JOIN project_workspace_authority AS authority
        ON authority.project_id = project.project_id
       AND authority.company_id = project.company_id
       AND authority.canonical_root = project.workspace_root
      WHERE project.project_id = binding.project_id
        AND project.company_id = binding.company_id
        AND binding.authority_snapshot_canonical_root = project.workspace_root
        AND binding.authority_snapshot_root_identity_json = authority.root_identity_json
        AND binding.authority_snapshot_updated_at_unix_ms = authority.updated_at_unix_ms
    )
    AND (
      (
        binding.source IN ('project_catalog', 'resume_history')
        AND binding.recovery_witness_binding_id IS NULL
        AND binding.recovery_witness_authority_project_id IS NULL
        AND EXISTS (
          SELECT 1 FROM project_workspace_authority AS authority
          WHERE authority.project_id = binding.project_id
            AND authority.company_id = binding.company_id
            AND authority.canonical_root = binding.canonical_root
            AND authority.root_identity_json = binding.root_identity_json
        )
      )
      OR
      (
        binding.source IN ('conversation_history', 'known_root_recovery')
        AND (
          EXISTS (
          SELECT 1 FROM task_workspace_binding_history AS witness
          WHERE witness.binding_id = binding.recovery_witness_binding_id
            AND witness.company_id = binding.company_id
            AND witness.project_id = binding.project_id
            AND witness.thread_id = binding.thread_id
            AND witness.status = 'completed'
            AND witness.authority_snapshot_canonical_root = binding.authority_snapshot_canonical_root
            AND witness.authority_snapshot_root_identity_json = binding.authority_snapshot_root_identity_json
            AND witness.authority_snapshot_updated_at_unix_ms = binding.authority_snapshot_updated_at_unix_ms
            AND binding.recovery_witness_authority_project_id IS NULL
          )
          OR EXISTS (
            SELECT 1 FROM project_workspace_authority AS authority
            WHERE authority.project_id = binding.recovery_witness_authority_project_id
              AND authority.project_id = binding.project_id
              AND authority.company_id = binding.company_id
              AND authority.canonical_root = binding.authority_snapshot_canonical_root
              AND authority.root_identity_json = binding.authority_snapshot_root_identity_json
              AND authority.updated_at_unix_ms = binding.authority_snapshot_updated_at_unix_ms
              AND binding.recovery_witness_binding_id IS NULL
              AND binding.reason_code = 'renamed_same_filesystem_object'
          )
        )
      )
    )
    AND NEW.project_root_identity_json = binding.root_identity_json
    AND child.company_id = binding.company_id
    AND child.project_id = binding.project_id
    AND child.thread_id = binding.thread_id
    AND (
      (
        child.root_run_id = NEW.created_root_run_id
        AND child.parent_run_id IS NOT NULL
        AND child.run_id <> NEW.created_root_run_id
        AND child.status = 'running'
      )
      OR
      (
        child.run_id = NEW.created_root_run_id
        AND child.root_run_id = child.run_id
        AND child.parent_run_id IS NULL
        AND child.status = 'running'
        AND EXISTS (
          SELECT 1
          FROM competitive_draft_attempts AS attempt
          JOIN competitive_draft_groups AS draft ON draft.group_id = attempt.group_id
          WHERE attempt.run_id = child.run_id
            AND attempt.thread_id = binding.thread_id
            AND attempt.employee_id = child.employee_id
            AND attempt.status = 'running'
            AND attempt.lease_id IS NULL
            AND draft.company_id = binding.company_id
            AND draft.project_id = binding.project_id
            AND draft.status = 'drafting'
        )
      )
    )
    AND root.company_id = binding.company_id
    AND root.project_id = binding.project_id
    AND root.thread_id = binding.thread_id
    AND root.parent_run_id IS NULL
    AND root.root_run_id = root.run_id
    AND root.status = 'running'
)
BEGIN
  SELECT RAISE(ABORT, 'task workspace lease provenance does not match a live writable binding and registered run');
END;

CREATE TRIGGER IF NOT EXISTS trg_task_workspace_lease_provenance_immutable
BEFORE UPDATE OF project_id, created_binding_id, created_root_run_id, child_run_id, created_request_id
ON task_workspace_lease_history
BEGIN
  SELECT RAISE(ABORT, 'task workspace lease creation provenance is immutable');
END;

CREATE TRIGGER IF NOT EXISTS trg_task_workspace_lease_active_binding_update
BEFORE UPDATE OF active_binding_id ON task_workspace_lease_history
WHEN NOT EXISTS (
  SELECT 1
  FROM task_workspace_binding_history AS binding
  WHERE binding.binding_id = NEW.active_binding_id
    AND binding.project_id = NEW.project_id
    AND binding.access = 'write'
    AND binding.status = 'active'
    AND EXISTS (
      SELECT 1
      FROM projects AS project
      JOIN project_workspace_authority AS authority
        ON authority.project_id = project.project_id
       AND authority.company_id = project.company_id
       AND authority.canonical_root = project.workspace_root
      WHERE project.project_id = binding.project_id
        AND project.company_id = binding.company_id
        AND binding.authority_snapshot_canonical_root = project.workspace_root
        AND binding.authority_snapshot_root_identity_json = authority.root_identity_json
        AND binding.authority_snapshot_updated_at_unix_ms = authority.updated_at_unix_ms
    )
    AND (
      (
        binding.source IN ('project_catalog', 'resume_history')
        AND binding.recovery_witness_binding_id IS NULL
        AND binding.recovery_witness_authority_project_id IS NULL
        AND EXISTS (
          SELECT 1 FROM project_workspace_authority AS authority
          WHERE authority.project_id = binding.project_id
            AND authority.company_id = binding.company_id
            AND authority.canonical_root = binding.canonical_root
            AND authority.root_identity_json = binding.root_identity_json
        )
      )
      OR
      (
        binding.source IN ('conversation_history', 'known_root_recovery')
        AND (
          EXISTS (
          SELECT 1 FROM task_workspace_binding_history AS witness
          WHERE witness.binding_id = binding.recovery_witness_binding_id
            AND witness.company_id = binding.company_id
            AND witness.project_id = binding.project_id
            AND witness.thread_id = binding.thread_id
            AND witness.status = 'completed'
            AND witness.authority_snapshot_canonical_root = binding.authority_snapshot_canonical_root
            AND witness.authority_snapshot_root_identity_json = binding.authority_snapshot_root_identity_json
            AND witness.authority_snapshot_updated_at_unix_ms = binding.authority_snapshot_updated_at_unix_ms
            AND binding.recovery_witness_authority_project_id IS NULL
          )
          OR EXISTS (
            SELECT 1 FROM project_workspace_authority AS authority
            WHERE authority.project_id = binding.recovery_witness_authority_project_id
              AND authority.project_id = binding.project_id
              AND authority.company_id = binding.company_id
              AND authority.canonical_root = binding.authority_snapshot_canonical_root
              AND authority.root_identity_json = binding.authority_snapshot_root_identity_json
              AND authority.updated_at_unix_ms = binding.authority_snapshot_updated_at_unix_ms
              AND binding.recovery_witness_binding_id IS NULL
              AND binding.reason_code = 'renamed_same_filesystem_object'
          )
        )
      )
    )
)
BEGIN
  SELECT RAISE(ABORT, 'task workspace lease adoption requires an active writable binding for the same Project');
END;

CREATE TRIGGER IF NOT EXISTS trg_chat_threads_workspace_authority_delete
BEFORE DELETE ON chat_threads
WHEN EXISTS (
  SELECT 1
  FROM task_workspace_binding_history AS binding
  WHERE binding.thread_id = OLD.thread_id
    AND binding.status = 'active'
)
OR EXISTS (
  SELECT 1
  FROM task_workspace_lease_history AS lease
  WHERE lease.status = 'active'
    AND EXISTS (
      SELECT 1
      FROM task_workspace_binding_history AS binding
      WHERE binding.thread_id = OLD.thread_id
        AND binding.binding_id IN (lease.created_binding_id, lease.active_binding_id)
    )
)
BEGIN
  SELECT RAISE(ABORT, 'active task workspace must be reviewed, released, or discarded before deleting this Conversation');
END;

CREATE TRIGGER IF NOT EXISTS trg_projects_workspace_authority_delete
BEFORE DELETE ON projects
WHEN EXISTS (
  SELECT 1
  FROM task_workspace_binding_history AS binding
  WHERE binding.project_id = OLD.project_id
    AND binding.status = 'active'
)
OR EXISTS (
  SELECT 1
  FROM task_workspace_lease_history AS lease
  WHERE lease.project_id = OLD.project_id
    AND lease.status = 'active'
)
BEGIN
  SELECT RAISE(ABORT, 'active task workspace must be reviewed, released, or discarded before deleting this Project');
END;

CREATE TRIGGER IF NOT EXISTS trg_companies_workspace_authority_delete
BEFORE DELETE ON companies
WHEN EXISTS (
  SELECT 1
  FROM task_workspace_binding_history AS binding
  WHERE binding.company_id = OLD.company_id
    AND binding.status = 'active'
)
OR EXISTS (
  SELECT 1
  FROM task_workspace_lease_history AS lease
  JOIN projects AS project ON project.project_id = lease.project_id
  WHERE project.company_id = OLD.company_id
    AND lease.status = 'active'
)
BEGIN
  SELECT RAISE(ABORT, 'active task workspace must be reviewed, released, or discarded before deleting this Company');
END;
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
CREATE INDEX IF NOT EXISTS idx_mcp_tool_grants_employee
  ON mcp_tool_grants(company_id, employee_id);
CREATE INDEX IF NOT EXISTS idx_mcp_tool_grants_server_tool
  ON mcp_tool_grants(server_name, tool_name);
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
  message_id TEXT PRIMARY KEY NOT NULL,
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
  mission_id              TEXT PRIMARY KEY NOT NULL,
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
  criterion_id           TEXT PRIMARY KEY NOT NULL,
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
  attempt_id               TEXT PRIMARY KEY NOT NULL,
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
  evaluation_id      TEXT PRIMARY KEY NOT NULL,
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
  runtime_session_link_id TEXT PRIMARY KEY NOT NULL,
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
  mission_event_id TEXT PRIMARY KEY NOT NULL,
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
  thread_id          TEXT PRIMARY KEY NOT NULL,
  company_id         TEXT NOT NULL REFERENCES companies(company_id) ON DELETE CASCADE,
  kind               TEXT NOT NULL CHECK (kind IN ('direct', 'group')),
  title              TEXT NOT NULL,
  direct_employee_id TEXT REFERENCES employees(employee_id) ON DELETE SET NULL,
  reply_policy       TEXT NOT NULL DEFAULT 'mentions_only'
                       CHECK (reply_policy IN ('mentions_only', 'roundtable', 'silent')),
  capability_profile TEXT NOT NULL DEFAULT 'strict'
                       CHECK (capability_profile IN ('strict', 'collaboration_read')),
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
  member_id    TEXT PRIMARY KEY NOT NULL,
  thread_id    TEXT NOT NULL REFERENCES collaboration_threads(thread_id) ON DELETE CASCADE,
  actor_type   TEXT NOT NULL CHECK (actor_type IN ('boss', 'employee')),
  employee_id  TEXT REFERENCES employees(employee_id) ON DELETE CASCADE,
  role         TEXT NOT NULL CHECK (role IN ('owner', 'member')),
  joined_at    TEXT NOT NULL,
  left_at      TEXT
);

CREATE TABLE IF NOT EXISTS collaboration_messages (
  message_id          TEXT PRIMARY KEY NOT NULL,
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
  thread_id            TEXT PRIMARY KEY NOT NULL REFERENCES collaboration_threads(thread_id) ON DELETE CASCADE,
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
  loop_id             TEXT PRIMARY KEY NOT NULL,
  company_id          TEXT NOT NULL REFERENCES companies(company_id) ON DELETE CASCADE,
  title               TEXT NOT NULL,
  summary             TEXT NOT NULL DEFAULT '',
  profile_id          TEXT NOT NULL,
  -- The selected live revision; set after the row exists, kept through archive.
  current_revision_id TEXT,
  status              TEXT NOT NULL DEFAULT 'draft'
                        CHECK (status IN ('draft', 'ready', 'archived')),
  schedule_interval_minutes INTEGER
                        CHECK (schedule_interval_minutes IS NULL OR schedule_interval_minutes IN (15, 60, 360, 1440)),
  next_run_at         TEXT,
  last_run_at         TEXT,
  last_run_result     TEXT,
  created_at          TEXT NOT NULL,
  updated_at          TEXT NOT NULL
);

-- Immutable: any edit appends a new revision; rows are never UPDATEd in place.
CREATE TABLE IF NOT EXISTS loop_revisions (
  revision_id              TEXT PRIMARY KEY NOT NULL,
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
  binding_id    TEXT PRIMARY KEY NOT NULL,
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
  invocation_id TEXT PRIMARY KEY NOT NULL,
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

-- The first scheduled turn claims one immutable engine/account/billing lane for
-- the whole collaboration thread. A dedicated first-writer-wins row makes the
-- claim atomic even when two turns are opened concurrently.
CREATE TABLE IF NOT EXISTS collaboration_execution_lanes (
  thread_id    TEXT PRIMARY KEY NOT NULL REFERENCES collaboration_threads(thread_id) ON DELETE CASCADE,
  engine_id    TEXT NOT NULL CHECK (length(trim(engine_id)) > 0),
  account_id   TEXT NOT NULL CHECK (length(trim(account_id)) > 0),
  billing_mode TEXT NOT NULL CHECK (billing_mode IN ('api', 'subscription'))
);

CREATE TABLE IF NOT EXISTS collaboration_turns (
  turn_id            TEXT PRIMARY KEY NOT NULL,
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
  runtime_request_id TEXT NOT NULL,
  execution_target_json TEXT NOT NULL
    CHECK (
      json_valid(execution_target_json)
      AND length(trim(json_extract(execution_target_json, '$.engineId'))) > 0
      AND length(trim(json_extract(execution_target_json, '$.accountId'))) > 0
      AND json_extract(execution_target_json, '$.billingMode') IN ('api', 'subscription')
      AND length(trim(json_extract(execution_target_json, '$.modelId'))) > 0
      AND (
        (
          json_extract(execution_target_json, '$.billingMode') = 'api'
          AND json_extract(execution_target_json, '$.engineId') = 'api'
          AND json_type(execution_target_json, '$.modelSource') IS NULL
        )
        OR (
          json_extract(execution_target_json, '$.billingMode') = 'api'
          AND json_extract(execution_target_json, '$.engineId') = 'api'
          AND json_type(execution_target_json, '$.modelSource') = 'object'
          AND json_extract(execution_target_json, '$.modelSource.kind') = 'official-api'
          AND json_type(execution_target_json, '$.modelSource.sourceUrl') = 'text'
          AND lower(trim(json_extract(execution_target_json, '$.modelSource.sourceUrl'))) GLOB 'https://*'
          AND json_type(execution_target_json, '$.modelSource.checkedAt') = 'text'
          AND datetime(json_extract(execution_target_json, '$.modelSource.checkedAt')) IS NOT NULL
        )
        OR (
          json_extract(execution_target_json, '$.billingMode') = 'subscription'
          AND json_type(execution_target_json, '$.modelSource') = 'object'
          AND json_extract(execution_target_json, '$.modelSource.kind') = 'native'
          AND json_extract(execution_target_json, '$.modelSource.sourceUrl') IS NULL
          AND json_extract(execution_target_json, '$.modelSource.checkedAt') IS NULL
        )
      )
    ),
  result_provenance_json TEXT
    CHECK (
      result_provenance_json IS NULL
      OR (
        json_valid(result_provenance_json)
        AND json_extract(result_provenance_json, '$.runId') = runtime_request_id
        AND json_extract(result_provenance_json, '$.engineId') = json_extract(execution_target_json, '$.engineId')
        AND json_extract(result_provenance_json, '$.accountId') = json_extract(execution_target_json, '$.accountId')
        AND json_extract(result_provenance_json, '$.billingMode') = json_extract(execution_target_json, '$.billingMode')
        AND json_extract(result_provenance_json, '$.modelId') = json_extract(execution_target_json, '$.modelId')
        AND json_extract(result_provenance_json, '$.modelSource.kind') IS json_extract(execution_target_json, '$.modelSource.kind')
        AND json_extract(result_provenance_json, '$.modelSource.sourceUrl') IS json_extract(execution_target_json, '$.modelSource.sourceUrl')
        AND json_extract(result_provenance_json, '$.modelSource.checkedAt') IS json_extract(execution_target_json, '$.modelSource.checkedAt')
        AND length(trim(json_extract(result_provenance_json, '$.adapter.id'))) > 0
        AND length(trim(json_extract(result_provenance_json, '$.adapter.version'))) > 0
      )
    ),
  usage_json         TEXT,
  error_summary      TEXT,
  started_at         TEXT,
  finished_at        TEXT,
  CHECK (status <> 'complete' OR result_provenance_json IS NOT NULL)
);

-- turn scheduling / recovery lookup: a thread's turns in speaker order
CREATE INDEX IF NOT EXISTS idx_collaboration_turns_thread_sequence
  ON collaboration_turns(thread_id, sequence_index);

-- Defense in depth: even a caller bypassing CollaborationTurnRepository cannot
-- insert a turn until its target matches the thread's immutable lane claim.
CREATE TRIGGER IF NOT EXISTS trg_collaboration_turns_execution_lane
BEFORE INSERT ON collaboration_turns
FOR EACH ROW
WHEN NOT EXISTS (
  SELECT 1
    FROM collaboration_execution_lanes lane
   WHERE lane.thread_id = NEW.thread_id
     AND lane.engine_id = json_extract(NEW.execution_target_json, '$.engineId')
     AND lane.account_id = json_extract(NEW.execution_target_json, '$.accountId')
     AND lane.billing_mode = json_extract(NEW.execution_target_json, '$.billingMode')
)
BEGIN
  SELECT RAISE(ABORT, 'collaboration execution lane mismatch');
END;

-- ---------------------------------------------------------------------------
-- Global search (W4). This is a local-only projection: the renderer can query
-- it only through the narrow `global_search` Tauri command. Deliverable bodies
-- are deliberately excluded because they may contain large full diffs.
--
-- `agent_events` is the current visible Conversation projection, while
-- `pi_messages` remains the Pi-kernel transcript. Index both so engine lanes
-- have the same search behavior without treating either store as canonical for
-- the other.
-- ---------------------------------------------------------------------------
CREATE VIRTUAL TABLE IF NOT EXISTS global_search_fts USING fts5(
  category UNINDEXED,
  entity_id UNINDEXED,
  company_id UNINDEXED,
  project_id UNINDEXED,
  thread_id UNINDEXED,
  message_id UNINDEXED,
  title,
  content,
  path,
  updated_at UNINDEXED,
  tokenize = 'unicode61 remove_diacritics 2'
);

CREATE TRIGGER IF NOT EXISTS trg_global_search_chat_threads_insert
AFTER INSERT ON chat_threads
FOR EACH ROW
BEGIN
  INSERT INTO global_search_fts(
    category, entity_id, company_id, project_id, thread_id, message_id,
    title, content, path, updated_at
  ) VALUES (
    'conversation', NEW.thread_id,
    (SELECT company_id FROM projects WHERE project_id = NEW.project_id),
    NEW.project_id, NEW.thread_id, NULL, NEW.title, COALESCE(NEW.summary, ''),
    '', NEW.updated_at
  );
END;

CREATE TRIGGER IF NOT EXISTS trg_global_search_chat_threads_update
AFTER UPDATE OF project_id, title, summary, updated_at ON chat_threads
FOR EACH ROW
BEGIN
  DELETE FROM global_search_fts
   WHERE category = 'conversation' AND entity_id = OLD.thread_id AND message_id IS NULL;
  INSERT INTO global_search_fts(
    category, entity_id, company_id, project_id, thread_id, message_id,
    title, content, path, updated_at
  ) VALUES (
    'conversation', NEW.thread_id,
    (SELECT company_id FROM projects WHERE project_id = NEW.project_id),
    NEW.project_id, NEW.thread_id, NULL, NEW.title, COALESCE(NEW.summary, ''),
    '', NEW.updated_at
  );
END;

CREATE TRIGGER IF NOT EXISTS trg_global_search_chat_threads_delete
AFTER DELETE ON chat_threads
FOR EACH ROW
BEGIN
  DELETE FROM global_search_fts
   WHERE category = 'conversation' AND thread_id = OLD.thread_id;
END;

CREATE TRIGGER IF NOT EXISTS trg_global_search_pi_messages_insert
AFTER INSERT ON pi_messages
FOR EACH ROW
BEGIN
  INSERT INTO global_search_fts(
    category, entity_id, company_id, project_id, thread_id, message_id,
    title, content, path, updated_at
  ) VALUES (
    'conversation', NEW.message_id, NEW.company_id,
    (SELECT project_id FROM chat_threads WHERE thread_id = NEW.thread_id),
    NEW.thread_id, NEW.message_id, '',
    CASE
      WHEN json_valid(NEW.message_json)
        THEN COALESCE(json_extract(NEW.message_json, '$.content'), NEW.message_json)
      ELSE NEW.message_json
    END,
    '', NEW.created_at
  );
END;

CREATE TRIGGER IF NOT EXISTS trg_global_search_pi_messages_update
AFTER UPDATE OF thread_id, company_id, message_json, created_at ON pi_messages
FOR EACH ROW
BEGIN
  DELETE FROM global_search_fts
   WHERE category = 'conversation' AND entity_id = OLD.message_id
     AND message_id = OLD.message_id;
  INSERT INTO global_search_fts(
    category, entity_id, company_id, project_id, thread_id, message_id,
    title, content, path, updated_at
  ) VALUES (
    'conversation', NEW.message_id, NEW.company_id,
    (SELECT project_id FROM chat_threads WHERE thread_id = NEW.thread_id),
    NEW.thread_id, NEW.message_id, '',
    CASE
      WHEN json_valid(NEW.message_json)
        THEN COALESCE(json_extract(NEW.message_json, '$.content'), NEW.message_json)
      ELSE NEW.message_json
    END,
    '', NEW.created_at
  );
END;

CREATE TRIGGER IF NOT EXISTS trg_global_search_pi_messages_delete
AFTER DELETE ON pi_messages
FOR EACH ROW
BEGIN
  DELETE FROM global_search_fts
   WHERE category = 'conversation' AND entity_id = OLD.message_id
     AND message_id = OLD.message_id;
END;

CREATE TRIGGER IF NOT EXISTS trg_global_search_agent_events_insert
AFTER INSERT ON agent_events
FOR EACH ROW
WHEN NEW.event_type = 'direct_chat.message' AND json_valid(NEW.payload_json)
BEGIN
  INSERT INTO global_search_fts(
    category, entity_id, company_id, project_id, thread_id, message_id,
    title, content, path, updated_at
  ) VALUES (
    'conversation', NEW.event_id, NEW.company_id,
    COALESCE(
      NEW.project_id,
      (SELECT project_id FROM chat_threads WHERE thread_id = NEW.thread_id)
    ),
    NEW.thread_id,
    COALESCE(json_extract(NEW.payload_json, '$.message.id'), NEW.event_id),
    '', COALESCE(json_extract(NEW.payload_json, '$.message.body'), ''), '', NEW.created_at
  );
END;

CREATE TRIGGER IF NOT EXISTS trg_global_search_agent_events_update
AFTER UPDATE OF event_type, payload_json, company_id, project_id, thread_id, created_at ON agent_events
FOR EACH ROW
BEGIN
  DELETE FROM global_search_fts
   WHERE category = 'conversation' AND entity_id = OLD.event_id;
  INSERT INTO global_search_fts(
    category, entity_id, company_id, project_id, thread_id, message_id,
    title, content, path, updated_at
  )
  SELECT
    'conversation', NEW.event_id, NEW.company_id,
    COALESCE(
      NEW.project_id,
      (SELECT project_id FROM chat_threads WHERE thread_id = NEW.thread_id)
    ),
    NEW.thread_id,
    COALESCE(json_extract(NEW.payload_json, '$.message.id'), NEW.event_id),
    '', COALESCE(json_extract(NEW.payload_json, '$.message.body'), ''), '', NEW.created_at
  WHERE NEW.event_type = 'direct_chat.message' AND json_valid(NEW.payload_json);
END;

CREATE TRIGGER IF NOT EXISTS trg_global_search_agent_events_delete
AFTER DELETE ON agent_events
FOR EACH ROW
BEGIN
  DELETE FROM global_search_fts
   WHERE category = 'conversation' AND entity_id = OLD.event_id;
END;

CREATE TRIGGER IF NOT EXISTS trg_global_search_agent_runs_insert
AFTER INSERT ON agent_runs
FOR EACH ROW
WHEN NEW.run_id = NEW.root_run_id AND length(trim(COALESCE(NEW.objective, ''))) > 0
BEGIN
  INSERT INTO global_search_fts(
    category, entity_id, company_id, project_id, thread_id, message_id,
    title, content, path, updated_at
  ) VALUES (
    'card', NEW.run_id, NEW.company_id,
    COALESCE(
      NEW.project_id,
      (SELECT project_id FROM chat_threads WHERE thread_id = NEW.thread_id)
    ),
    NEW.thread_id, NULL, NEW.objective, '', '', NEW.started_at
  );
END;

CREATE TRIGGER IF NOT EXISTS trg_global_search_agent_runs_update
AFTER UPDATE OF objective, company_id, project_id, thread_id, root_run_id, started_at ON agent_runs
FOR EACH ROW
BEGIN
  DELETE FROM global_search_fts
   WHERE category = 'card' AND entity_id = OLD.run_id;
  INSERT INTO global_search_fts(
    category, entity_id, company_id, project_id, thread_id, message_id,
    title, content, path, updated_at
  )
  SELECT
    'card', NEW.run_id, NEW.company_id,
    COALESCE(
      NEW.project_id,
      (SELECT project_id FROM chat_threads WHERE thread_id = NEW.thread_id)
    ),
    NEW.thread_id, NULL, NEW.objective, '', '', NEW.started_at
  WHERE NEW.run_id = NEW.root_run_id
    AND length(trim(COALESCE(NEW.objective, ''))) > 0;
END;

CREATE TRIGGER IF NOT EXISTS trg_global_search_agent_runs_delete
AFTER DELETE ON agent_runs
FOR EACH ROW
BEGIN
  DELETE FROM global_search_fts
   WHERE category = 'card' AND entity_id = OLD.run_id;
END;

CREATE TRIGGER IF NOT EXISTS trg_global_search_deliverables_insert
AFTER INSERT ON deliverables
FOR EACH ROW
BEGIN
  INSERT INTO global_search_fts(
    category, entity_id, company_id, project_id, thread_id, message_id,
    title, content, path, updated_at
  ) VALUES (
    'output', NEW.deliverable_id, NEW.company_id,
    (
      SELECT project_id FROM chat_threads
       WHERE thread_id = COALESCE(NEW.chat_thread_id, NEW.thread_id)
    ),
    COALESCE(NEW.chat_thread_id, NEW.thread_id), NULL, NEW.title, '',
    COALESCE(NEW.file_name, ''), NEW.created_at
  );
END;

CREATE TRIGGER IF NOT EXISTS trg_global_search_deliverables_update
AFTER UPDATE OF title, file_name, company_id, chat_thread_id, thread_id, created_at ON deliverables
FOR EACH ROW
BEGIN
  DELETE FROM global_search_fts
   WHERE category = 'output' AND entity_id = OLD.deliverable_id;
  INSERT INTO global_search_fts(
    category, entity_id, company_id, project_id, thread_id, message_id,
    title, content, path, updated_at
  ) VALUES (
    'output', NEW.deliverable_id, NEW.company_id,
    (
      SELECT project_id FROM chat_threads
       WHERE thread_id = COALESCE(NEW.chat_thread_id, NEW.thread_id)
    ),
    COALESCE(NEW.chat_thread_id, NEW.thread_id), NULL, NEW.title, '',
    COALESCE(NEW.file_name, ''), NEW.created_at
  );
END;

CREATE TRIGGER IF NOT EXISTS trg_global_search_deliverables_delete
AFTER DELETE ON deliverables
FOR EACH ROW
BEGIN
  DELETE FROM global_search_fts
   WHERE category = 'output' AND entity_id = OLD.deliverable_id;
END;
