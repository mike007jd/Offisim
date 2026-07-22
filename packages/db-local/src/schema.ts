/**
 * @offisim/db-local — Drizzle ORM SQLite schema
 *
 * @authoritative src/schema.sql
 *
 * IMPORTANT: `src/schema.sql` is the SOLE authority that builds the local
 * database — it is `include_str!`'d and applied verbatim by the Rust side
 * (`apps/desktop/src-tauri/.../local_db.rs`). This TypeScript file is a
 * Drizzle *query-builder typing layer only*; it does NOT create tables and is
 * never used to provision the schema.
 *
 * Therefore:
 *  - The unique indexes and CHECK constraints declared in schema.sql are the
 *    real, enforced constraints in production.
 *  - DO NOT run `drizzle-kit push`/`generate` against this file to build or
 *    migrate the database — doing so would create a schema MISSING those
 *    constraints. No such script is wired into package.json by design; keep it
 *    that way.
 *  - When schema.sql changes, mirror it here for type-accuracy, but schema.sql
 *    always wins on any drift.
 *
 * Fresh databases apply schema.sql directly. The version number lives only in
 * `apps/desktop/src-tauri/src/local_db.rs`; there is no prelaunch migration
 * chain, so older local/dev databases are disposable and should be rebuilt.
 */

import type { AssetKind } from '@offisim/asset-schema';
import type {
  BindingStatus,
  BindingType,
  InstallSourceType,
  InstallState,
  WorkspaceBoundProvenance,
} from '@offisim/shared-types';
import { sql } from 'drizzle-orm';
import {
  type AnySQLiteColumn,
  check,
  foreignKey,
  index,
  integer,
  primaryKey,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core';

// This module is the query-typing mirror for the local SQLite baseline, not a
// second DDL authority. SQL-only CHECK constraints and other SQLite enforcement
// that Drizzle does not model stay solely in schema.sql; mirrored table/column,
// key, index, and relation shapes are guarded by the schema drift gate.

// ---------------------------------------------------------------------------
// 001 — Core tables
// ---------------------------------------------------------------------------

export const companies = sqliteTable('companies', {
  company_id: text('company_id').primaryKey(),
  name: text('name').notNull(),
  status: text('status').notNull().default('active'),
  template_id: text('template_id'),
  template_label: text('template_label'),
  workspace_root: text('workspace_root'),
  description_json: text('description_json'),
  created_at: text('created_at').notNull(),
  updated_at: text('updated_at').notNull(),
});

export const workstations = sqliteTable(
  'workstations',
  {
    workstation_id: text('workstation_id').primaryKey(),
    company_id: text('company_id')
      .notNull()
      .references(() => companies.company_id, { onDelete: 'cascade' }),
    room_type: text('room_type').notNull(),
    label: text('label').notNull(),
    position_json: text('position_json'),
    seat_capacity: integer('seat_capacity').notNull().default(1),
    created_at: text('created_at').notNull(),
    updated_at: text('updated_at').notNull(),
  },
  (table) => [index('idx_workstations_company').on(table.company_id)],
);

export const racks = sqliteTable(
  'racks',
  {
    rack_id: text('rack_id').primaryKey(),
    company_id: text('company_id')
      .notNull()
      .references(() => companies.company_id, { onDelete: 'cascade' }),
    provider_type: text('provider_type').notNull(),
    label: text('label').notNull(),
    binding_profile_json: text('binding_profile_json'),
    status: text('status').notNull().default('unbound'),
    created_at: text('created_at').notNull(),
    updated_at: text('updated_at').notNull(),
  },
  (table) => [index('idx_racks_company').on(table.company_id)],
);

export const slots = sqliteTable('slots', {
  slot_id: text('slot_id').primaryKey(),
  rack_id: text('rack_id')
    .notNull()
    .references(() => racks.rack_id, { onDelete: 'cascade' }),
  capability_name: text('capability_name').notNull(),
  exposure_scope: text('exposure_scope').notNull(),
  status: text('status').notNull().default('available'),
  created_at: text('created_at').notNull(),
  updated_at: text('updated_at').notNull(),
});

export const workstationRacks = sqliteTable(
  'workstation_racks',
  {
    workstation_id: text('workstation_id')
      .notNull()
      .references(() => workstations.workstation_id, { onDelete: 'cascade' }),
    rack_id: text('rack_id')
      .notNull()
      .references(() => racks.rack_id, { onDelete: 'cascade' }),
    created_at: text('created_at').notNull(),
  },
  (table) => [primaryKey({ columns: [table.workstation_id, table.rack_id] })],
);

export const employees = sqliteTable(
  'employees',
  {
    employee_id: text('employee_id').primaryKey(),
    company_id: text('company_id')
      .notNull()
      .references(() => companies.company_id, { onDelete: 'cascade' }),
    source_asset_id: text('source_asset_id'),
    source_package_id: text('source_package_id'),
    name: text('name').notNull(),
    role_slug: text('role_slug').notNull(),
    workstation_id: text('workstation_id').references(() => workstations.workstation_id, {
      onDelete: 'set null',
    }),
    persona_json: text('persona_json'),
    config_json: text('config_json'),
    model: text('model'),
    thinking_level: text('thinking_level'),
    enabled: integer('enabled').notNull().default(1),
    is_external: integer('is_external').notNull().default(0),
    a2a_url: text('a2a_url'),
    a2a_token: text('a2a_token'),
    a2a_agent_id: text('a2a_agent_id'),
    brand_key: text('brand_key'),
    agent_card_json: text('agent_card_json'),
    created_at: text('created_at').notNull(),
    updated_at: text('updated_at').notNull(),
  },
  (table) => [
    uniqueIndex('idx_employees_company_employee').on(table.company_id, table.employee_id),
    index('idx_employees_company').on(table.company_id),
    index('idx_employees_is_external').on(table.is_external),
  ],
);

// ---------------------------------------------------------------------------
// 002 — Install tables
// ---------------------------------------------------------------------------

export const installTransactions = sqliteTable(
  'install_transactions',
  {
    install_txn_id: text('install_txn_id').primaryKey(),
    company_id: text('company_id')
      .notNull()
      .references(() => companies.company_id, { onDelete: 'cascade' }),
    source_type: text('source_type').$type<InstallSourceType>().notNull(),
    source_ref: text('source_ref'),
    target_package_id: text('target_package_id'),
    target_version: text('target_version'),
    idempotency_key: text('idempotency_key'),
    state: text('state').$type<InstallState>().notNull(),
    error_code: text('error_code'),
    error_detail: text('error_detail'),
    descriptor_json: text('descriptor_json'),
    actor_type: text('actor_type').notNull().default('user'),
    started_at: text('started_at').notNull(),
    finished_at: text('finished_at'),
  },
  (table) => [
    index('idx_install_transactions_company').on(table.company_id, table.started_at),
    uniqueIndex('install_transactions_company_idempotency')
      .on(table.company_id, table.idempotency_key)
      .where(
        sql`${table.idempotency_key} IS NOT NULL AND ${table.state} NOT IN ('failed', 'rolled_back', 'cancelled')`,
      ),
  ],
);

export const installedPackages = sqliteTable(
  'installed_packages',
  {
    installed_package_id: text('installed_package_id').primaryKey(),
    company_id: text('company_id')
      .notNull()
      .references(() => companies.company_id, { onDelete: 'cascade' }),
    package_id: text('package_id').notNull(),
    package_kind: text('package_kind').$type<AssetKind>().notNull(),
    version: text('version').notNull(),
    source_type: text('source_type').$type<InstallSourceType>().notNull(),
    source_ref: text('source_ref'),
    manifest_hash: text('manifest_hash').notNull(),
    package_hash: text('package_hash').notNull(),
    install_state: text('install_state').$type<InstallState>().notNull(),
    enabled: integer('enabled').notNull().default(1),
    origin_listing_id: text('origin_listing_id'),
    origin_package_version_id: text('origin_package_version_id'),
    installed_at: text('installed_at').notNull(),
    updated_at: text('updated_at').notNull(),
  },
  (table) => [
    uniqueIndex('installed_packages_company_pkg_ver').on(
      table.company_id,
      table.package_id,
      table.version,
    ),
    index('idx_installed_packages_company').on(table.company_id),
  ],
);

export const installedAssets = sqliteTable(
  'installed_assets',
  {
    installed_asset_id: text('installed_asset_id').primaryKey(),
    installed_package_id: text('installed_package_id')
      .notNull()
      .references(() => installedPackages.installed_package_id, {
        onDelete: 'cascade',
      }),
    asset_id: text('asset_id').notNull(),
    asset_kind: text('asset_kind').$type<AssetKind>().notNull(),
    local_instance_id: text('local_instance_id'),
    entrypoint: text('entrypoint'),
    enabled: integer('enabled').notNull().default(1),
    override_json: text('override_json'),
    created_at: text('created_at').notNull(),
    updated_at: text('updated_at').notNull(),
  },
  (table) => [
    uniqueIndex('installed_assets_pkg_asset').on(table.installed_package_id, table.asset_id),
    index('idx_installed_assets_pkg').on(table.installed_package_id),
  ],
);

export const assetBindings = sqliteTable(
  'asset_bindings',
  {
    binding_id: text('binding_id').primaryKey(),
    installed_asset_id: text('installed_asset_id').references(
      () => installedAssets.installed_asset_id,
      { onDelete: 'cascade' },
    ),
    install_txn_id: text('install_txn_id').references(() => installTransactions.install_txn_id, {
      onDelete: 'cascade',
    }),
    binding_type: text('binding_type').$type<BindingType>().notNull(),
    binding_key: text('binding_key').notNull(),
    binding_value_json: text('binding_value_json'),
    status: text('status').$type<BindingStatus>().notNull().default('pending'),
    created_at: text('created_at').notNull(),
    updated_at: text('updated_at').notNull(),
  },
  (table) => [index('idx_asset_bindings_txn').on(table.install_txn_id)],
);

// ---------------------------------------------------------------------------
// 003 — Runtime orchestration
// ---------------------------------------------------------------------------

export const graphThreads = sqliteTable(
  'graph_threads',
  {
    thread_id: text('thread_id').primaryKey(),
    company_id: text('company_id')
      .notNull()
      .references(() => companies.company_id, { onDelete: 'cascade' }),
    entry_mode: text('entry_mode').notNull(),
    root_task_id: text('root_task_id'),
    status: text('status').notNull(),
    project_id: text('project_id'),
    interaction_mode: text('interaction_mode').notNull().default('boss_proxy'),
    synopsis_json: text('synopsis_json'),
    compact_baseline_json: text('compact_baseline_json'),
    created_at: text('created_at').notNull(),
    updated_at: text('updated_at').notNull(),
  },
  (table) => [index('idx_graph_threads_company').on(table.company_id, table.created_at)],
);

// ---------------------------------------------------------------------------
// 010 — Projects
// ---------------------------------------------------------------------------

export const projects = sqliteTable(
  'projects',
  {
    project_id: text('project_id').primaryKey(),
    company_id: text('company_id')
      .notNull()
      .references(() => companies.company_id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    description: text('description'),
    status: text('status').notNull().default('planning'),
    workspace_root: text('workspace_root').notNull(),
    verify_command: text('verify_command'),
    verify_max_attempts: integer('verify_max_attempts').notNull().default(3),
    verify_token_budget: integer('verify_token_budget'),
    created_at: text('created_at').notNull(),
    updated_at: text('updated_at').notNull(),
  },
  (table) => [
    index('idx_projects_company').on(table.company_id, table.status, table.updated_at),
    check('projects_workspace_root_nonempty', sql`length(trim(${table.workspace_root})) > 0`),
  ],
);

/** Backend-owned proof of a native-picked Project folder. Renderer generic
 * local-DB commands cannot read or write it; only dedicated Tauri commands may. */
export const projectWorkspaceAuthority = sqliteTable(
  'project_workspace_authority',
  {
    project_id: text('project_id')
      .primaryKey()
      .references(() => projects.project_id, { onDelete: 'cascade' }),
    company_id: text('company_id')
      .notNull()
      .references(() => companies.company_id, { onDelete: 'cascade' }),
    canonical_root: text('canonical_root').notNull(),
    root_identity_json: text('root_identity_json').notNull(),
    selected_at_unix_ms: integer('selected_at_unix_ms').notNull(),
    updated_at_unix_ms: integer('updated_at_unix_ms').notNull(),
  },
  (table) => [
    index('idx_project_workspace_authority_company').on(table.company_id, table.project_id),
    check(
      'project_workspace_authority_root_nonempty',
      sql`length(trim(${table.canonical_root})) > 0`,
    ),
  ],
);

// ---------------------------------------------------------------------------
// 010b — Chat threads (product-layer thread metadata; decoupled from
// graph_threads on purpose: one chat_thread backs many runtime graph_threads rows over
// its lifetime, one per (team-chat | direct-chat target) conversationKey.)
// ---------------------------------------------------------------------------

export const chatThreads = sqliteTable(
  'chat_threads',
  {
    thread_id: text('thread_id').primaryKey(),
    project_id: text('project_id')
      .notNull()
      .references(() => projects.project_id, { onDelete: 'cascade' }),
    employee_id: text('employee_id').references(() => employees.employee_id, {
      onDelete: 'set null',
    }),
    title: text('title').notNull().default('New thread'),
    title_set_by_user: integer('title_set_by_user').notNull().default(0),
    semantic_title_job_id: text('semantic_title_job_id'),
    semantic_title_status: text('semantic_title_status'),
    semantic_title_source_provenance_json: text('semantic_title_source_provenance_json'),
    semantic_title_result_provenance_json: text('semantic_title_result_provenance_json'),
    semantic_title_usage_json: text('semantic_title_usage_json'),
    semantic_title_error_code: text('semantic_title_error_code'),
    summary: text('summary'),
    archived_at: text('archived_at'),
    created_at: text('created_at').notNull(),
    updated_at: text('updated_at').notNull(),
  },
  (table) => [
    index('idx_chat_threads_project_updated').on(table.project_id, table.updated_at),
    index('idx_chat_threads_project_employee').on(table.project_id, table.employee_id),
    // Partial index — only live (non-archived) threads. See schema.sql for
    // rationale. Replaces the older `idx_chat_threads_project_active`
    // three-column index which couldn't be used efficiently for the common
    // "list active threads for project, newest first" query.
    index('idx_chat_threads_project_active_partial')
      .on(table.project_id, table.updated_at)
      .where(sql`${table.archived_at} IS NULL`),
  ],
);

/** Durable explanation/recovery history for backend-issued task workspace bindings.
 * The live capability (`workspaceRef`) is intentionally never persisted. */
export const taskWorkspaceBindingHistory = sqliteTable(
  'task_workspace_binding_history',
  {
    binding_id: text('binding_id').primaryKey(),
    company_id: text('company_id')
      .notNull()
      .references(() => companies.company_id, { onDelete: 'cascade' }),
    project_id: text('project_id')
      .notNull()
      .references(() => projects.project_id, { onDelete: 'cascade' }),
    thread_id: text('thread_id')
      .notNull()
      .references(() => chatThreads.thread_id, { onDelete: 'cascade' }),
    turn_id: text('turn_id').notNull(),
    request_id: text('request_id').notNull().unique(),
    access: text('access').notNull(),
    canonical_root: text('canonical_root').notNull(),
    root_identity_json: text('root_identity_json').notNull(),
    workspace_basename_normalized: text('workspace_basename_normalized').notNull(),
    project_name_normalized: text('project_name_normalized').notNull(),
    workspace_anchor: text('workspace_anchor').notNull(),
    git_origin_digest: text('git_origin_digest'),
    recovery_witness_binding_id: text('recovery_witness_binding_id'),
    recovery_witness_authority_project_id: text('recovery_witness_authority_project_id'),
    authority_snapshot_canonical_root: text('authority_snapshot_canonical_root').notNull(),
    authority_snapshot_root_identity_json: text('authority_snapshot_root_identity_json').notNull(),
    authority_snapshot_updated_at_unix_ms: integer(
      'authority_snapshot_updated_at_unix_ms',
    ).notNull(),
    source: text('source').$type<WorkspaceBoundProvenance['source']>().notNull(),
    confidence: real('confidence').notNull(),
    reason_code: text('reason_code').$type<WorkspaceBoundProvenance['reasonCode']>().notNull(),
    issued_at_unix_ms: integer('issued_at_unix_ms').notNull(),
    expires_at_unix_ms: integer('expires_at_unix_ms').notNull(),
    activated_at_unix_ms: integer('activated_at_unix_ms').notNull(),
    last_used_at_unix_ms: integer('last_used_at_unix_ms').notNull(),
    status: text('status').notNull(),
    revoked_at_unix_ms: integer('revoked_at_unix_ms'),
    read_grace_until_unix_ms: integer('read_grace_until_unix_ms'),
    release_reason: text('release_reason'),
    resumed_from_binding_id: text('resumed_from_binding_id'),
  },
  (table) => [
    index('idx_task_workspace_binding_history_scope').on(
      table.company_id,
      table.thread_id,
      table.issued_at_unix_ms,
    ),
    uniqueIndex('idx_task_workspace_binding_resume_once')
      .on(table.resumed_from_binding_id)
      .where(sql`${table.resumed_from_binding_id} IS NOT NULL`),
    check('task_workspace_binding_access', sql`${table.access} IN ('read', 'write')`),
    check('task_workspace_binding_confidence', sql`${table.confidence} BETWEEN 0 AND 1`),
    check(
      'task_workspace_binding_provenance',
      sql`(${table.source} = 'project_catalog' AND ${table.reason_code} = 'current_project_folder')
          OR (${table.source} = 'conversation_history' AND ${table.reason_code} = 'recent_successful_workspace')
          OR (${table.source} = 'known_root_recovery' AND ${table.reason_code} IN ('renamed_same_filesystem_object', 'unique_name_repo_identity_match'))
          OR (${table.source} = 'resume_history' AND ${table.reason_code} = 'resume_history_identity_match')`,
    ),
    check(
      'task_workspace_binding_status',
      sql`${table.status} IN ('active', 'completed', 'failed', 'aborted', 'expired', 'app_restart')`,
    ),
  ],
);

/** Backend registration/provenance for isolated writable Git worktrees. */
export const taskWorkspaceLeaseHistory = sqliteTable(
  'task_workspace_lease_history',
  {
    lease_id: text('lease_id').primaryKey(),
    project_id: text('project_id')
      .notNull()
      .references(() => projects.project_id, { onDelete: 'cascade' }),
    created_binding_id: text('created_binding_id').notNull(),
    active_binding_id: text('active_binding_id').notNull(),
    created_root_run_id: text('created_root_run_id').notNull(),
    child_run_id: text('child_run_id').notNull(),
    created_request_id: text('created_request_id').notNull(),
    branch: text('branch').notNull(),
    canonical_worktree: text('canonical_worktree').notNull().unique(),
    worktree_identity_json: text('worktree_identity_json').notNull(),
    project_root_identity_json: text('project_root_identity_json').notNull(),
    created_at_unix_ms: integer('created_at_unix_ms').notNull(),
    updated_at_unix_ms: integer('updated_at_unix_ms').notNull(),
    status: text('status').notNull(),
  },
  (table) => [
    index('idx_task_workspace_lease_history_project_status').on(
      table.project_id,
      table.status,
      table.updated_at_unix_ms,
    ),
    uniqueIndex('idx_task_workspace_lease_history_active_branch')
      .on(table.project_id, table.branch)
      .where(sql`${table.status} = 'active'`),
    check(
      'task_workspace_lease_history_status',
      sql`${table.status} IN ('active', 'released', 'discarded', 'invalid')`,
    ),
  ],
);

/** Git-backed hidden-ref snapshots for one isolated workspace lease. */
export const workspaceCheckpoints = sqliteTable(
  'workspace_checkpoints',
  {
    checkpoint_id: text('checkpoint_id').primaryKey(),
    lease_id: text('lease_id')
      .notNull()
      .references(() => taskWorkspaceLeaseHistory.lease_id, { onDelete: 'cascade' }),
    run_id: text('run_id').notNull(),
    step: integer('step').notNull(),
    checkpoint_ref: text('checkpoint_ref').notNull().unique(),
    trigger_tool: text('trigger_tool').notNull(),
    trigger_tool_call_id: text('trigger_tool_call_id'),
    changed_paths_json: text('changed_paths_json').notNull(),
    created_at: text('created_at').notNull(),
  },
  (table) => [
    uniqueIndex('workspace_checkpoints_lease_step').on(table.lease_id, table.step),
    index('idx_workspace_checkpoints_lease_step').on(table.lease_id, table.step),
    check('workspace_checkpoints_step', sql`${table.step} >= 0`),
    check(
      'workspace_checkpoints_ref',
      sql`${table.checkpoint_ref} LIKE 'refs/offisim/checkpoints/%'`,
    ),
    check('workspace_checkpoints_changed_paths_json', sql`json_valid(${table.changed_paths_json})`),
  ],
);

/** Immutable rewind audit trail; pending/failed rows preserve attempted actions. */
export const workspaceCheckpointRollbacks = sqliteTable(
  'workspace_checkpoint_rollbacks',
  {
    rollback_id: text('rollback_id').primaryKey(),
    lease_id: text('lease_id')
      .notNull()
      .references(() => taskWorkspaceLeaseHistory.lease_id, { onDelete: 'cascade' }),
    checkpoint_id: text('checkpoint_id')
      .notNull()
      .references(() => workspaceCheckpoints.checkpoint_id, { onDelete: 'restrict' }),
    target_step: integer('target_step').notNull(),
    target_ref: text('target_ref').notNull(),
    actor: text('actor').notNull(),
    changed_paths_json: text('changed_paths_json').notNull(),
    rolled_back_at: text('rolled_back_at').notNull(),
    status: text('status').notNull(),
  },
  (table) => [
    index('idx_workspace_checkpoint_rollbacks_lease_time').on(table.lease_id, table.rolled_back_at),
    check('workspace_checkpoint_rollbacks_step', sql`${table.target_step} >= 0`),
    check(
      'workspace_checkpoint_rollbacks_ref',
      sql`${table.target_ref} LIKE 'refs/offisim/checkpoints/%'`,
    ),
    check('workspace_checkpoint_rollbacks_actor', sql`trim(${table.actor}) <> ''`),
    check(
      'workspace_checkpoint_rollbacks_changed_paths_json',
      sql`json_valid(${table.changed_paths_json})`,
    ),
    check(
      'workspace_checkpoint_rollbacks_status',
      sql`${table.status} IN ('pending', 'completed', 'failed')`,
    ),
  ],
);

// ---------------------------------------------------------------------------
// 011 — Project assignments
// ---------------------------------------------------------------------------

export const projectAssignments = sqliteTable(
  'project_assignments',
  {
    assignment_id: text('assignment_id').primaryKey(),
    project_id: text('project_id')
      .notNull()
      .references(() => projects.project_id, { onDelete: 'cascade' }),
    employee_id: text('employee_id')
      .notNull()
      .references(() => employees.employee_id, { onDelete: 'cascade' }),
    role: text('role').notNull().default('member'),
    assigned_at: text('assigned_at').notNull(),
  },
  (table) => [
    uniqueIndex('project_assignments_proj_emp').on(table.project_id, table.employee_id),
    index('idx_project_assignments_project').on(table.project_id),
    index('idx_project_assignments_employee').on(table.employee_id),
  ],
);

export const agentRuns = sqliteTable(
  'agent_runs',
  {
    run_id: text('run_id').primaryKey(),
    // thread_id is the product-layer chat_threads.thread_id (no FK — chat threads
    // have no graph_threads row; matches agent_events).
    thread_id: text('thread_id').notNull(),
    company_id: text('company_id')
      .notNull()
      .references(() => companies.company_id, { onDelete: 'cascade' }),
    project_id: text('project_id').references(() => projects.project_id, { onDelete: 'set null' }),
    parent_run_id: text('parent_run_id').references((): AnySQLiteColumn => agentRuns.run_id, {
      onDelete: 'set null',
    }),
    root_run_id: text('root_run_id').notNull(),
    employee_id: text('employee_id').references(() => employees.employee_id, {
      onDelete: 'set null',
    }),
    relation: text('relation'),
    // Work semantics stamped by the delegate tool on run.started (WorkKind);
    // null = unclassified.
    work_kind: text('work_kind'),
    objective: text('objective'),
    access: text('access'),
    // Typed failure cause (RunFailureKind) written on a failed terminal.
    failure_kind: text('failure_kind'),
    status: text('status').notNull(),
    usage_json: text('usage_json'),
    result_summary_json: text('result_summary_json'),
    // Pi session JSONL path for durable resume (nullable; set when session opens).
    session_file: text('session_file'),
    runtime_context_json: text('runtime_context_json'),
    started_at: text('started_at').notNull(),
    finished_at: text('finished_at'),
  },
  (table) => [
    index('idx_agent_runs_thread').on(table.thread_id),
    index('idx_agent_runs_company_started').on(table.company_id, table.started_at),
    index('idx_agent_runs_company_thread').on(table.company_id, table.thread_id),
    uniqueIndex('idx_agent_runs_one_unresolved_root_per_thread')
      .on(table.thread_id)
      .where(
        sql`${table.run_id} = ${table.root_run_id} AND ${table.status} IN ('running', 'interrupted')`,
      ),
    index('idx_agent_runs_root').on(table.root_run_id),
    index('idx_agent_runs_parent').on(table.parent_run_id),
    index('idx_agent_runs_company_project_status').on(
      table.company_id,
      table.project_id,
      table.status,
    ),
  ],
);

export const competitiveDraftGroups = sqliteTable(
  'competitive_draft_groups',
  {
    group_id: text('group_id').primaryKey(),
    company_id: text('company_id')
      .notNull()
      .references(() => companies.company_id, { onDelete: 'cascade' }),
    project_id: text('project_id')
      .notNull()
      .references(() => projects.project_id, { onDelete: 'cascade' }),
    source_run_id: text('source_run_id')
      .notNull()
      .references(() => agentRuns.run_id, { onDelete: 'cascade' }),
    objective: text('objective').notNull(),
    status: text('status').notNull(),
    winner_attempt_id: text('winner_attempt_id'),
    created_at: text('created_at').notNull(),
    updated_at: text('updated_at').notNull(),
  },
  (table) => [
    index('idx_competitive_draft_groups_project').on(table.project_id, table.created_at),
    index('idx_competitive_draft_groups_source').on(table.source_run_id),
  ],
);

export const competitiveDraftAttempts = sqliteTable(
  'competitive_draft_attempts',
  {
    attempt_id: text('attempt_id').primaryKey(),
    group_id: text('group_id')
      .notNull()
      .references(() => competitiveDraftGroups.group_id, { onDelete: 'cascade' }),
    ordinal: integer('ordinal').notNull(),
    employee_id: text('employee_id')
      .notNull()
      .references(() => employees.employee_id, { onDelete: 'restrict' }),
    thread_id: text('thread_id').notNull(),
    run_id: text('run_id').notNull(),
    lease_id: text('lease_id'),
    status: text('status').notNull(),
    result_summary_json: text('result_summary_json'),
    usage_json: text('usage_json'),
    verification_summary: text('verification_summary'),
    verification_passed: integer('verification_passed', { mode: 'boolean' }),
    started_at: text('started_at').notNull(),
    finished_at: text('finished_at'),
  },
  (table) => [
    uniqueIndex('idx_competitive_draft_attempts_group_ordinal').on(table.group_id, table.ordinal),
    uniqueIndex('idx_competitive_draft_attempts_group_employee').on(
      table.group_id,
      table.employee_id,
    ),
    uniqueIndex('idx_competitive_draft_attempts_run').on(table.run_id),
    uniqueIndex('idx_competitive_draft_attempts_lease').on(table.lease_id),
    index('idx_competitive_draft_attempts_group').on(table.group_id, table.ordinal),
  ],
);

export const employeeProjectMemories = sqliteTable(
  'employee_project_memories',
  {
    memory_id: text('memory_id').primaryKey(),
    company_id: text('company_id')
      .notNull()
      .references(() => companies.company_id, { onDelete: 'cascade' }),
    employee_id: text('employee_id')
      .notNull()
      .references(() => employees.employee_id, { onDelete: 'cascade' }),
    project_id: text('project_id')
      .notNull()
      .references(() => projects.project_id, { onDelete: 'cascade' }),
    memory_type: text('memory_type')
      .$type<'pitfall' | 'repository_preference' | 'convention' | 'retrospective'>()
      .notNull(),
    content: text('content').notNull(),
    source_run_id: text('source_run_id').references(() => agentRuns.run_id, {
      onDelete: 'set null',
    }),
    created_at: text('created_at').notNull(),
    updated_at: text('updated_at').notNull(),
    pinned: integer('pinned', { mode: 'boolean' }).notNull().default(false),
    hit_count: integer('hit_count').notNull().default(0),
    last_hit_at: text('last_hit_at'),
  },
  (table) => [
    index('idx_employee_project_memories_employee_project').on(
      table.employee_id,
      table.project_id,
      table.pinned,
      table.hit_count,
      table.updated_at,
    ),
    index('idx_employee_project_memories_source').on(table.source_run_id),
  ],
);

export const meetingSessions = sqliteTable(
  'meeting_sessions',
  {
    meeting_id: text('meeting_id').primaryKey(),
    company_id: text('company_id')
      .notNull()
      .references(() => companies.company_id, { onDelete: 'cascade' }),
    thread_id: text('thread_id'),
    topic: text('topic').notNull(),
    status: text('status').notNull(),
    interaction_mode: text('interaction_mode').notNull().default('boss_proxy'),
    summary_json: text('summary_json'),
    created_at: text('created_at').notNull(),
    updated_at: text('updated_at').notNull(),
  },
  (table) => [index('idx_meeting_sessions_mode').on(table.interaction_mode)],
);

// ---------------------------------------------------------------------------
// 004 — Audit & events
// ---------------------------------------------------------------------------

export const runtimeEvents = sqliteTable(
  'runtime_events',
  {
    event_id: text('event_id').primaryKey(),
    company_id: text('company_id')
      .notNull()
      .references(() => companies.company_id, { onDelete: 'cascade' }),
    thread_id: text('thread_id'),
    event_type: text('event_type').notNull(),
    severity: text('severity').notNull().default('info'),
    payload_json: text('payload_json'),
    created_at: text('created_at').notNull(),
  },
  (table) => [index('idx_runtime_events_company_time').on(table.company_id, table.created_at)],
);

// ---------------------------------------------------------------------------
// 006 — Employee version history
// ---------------------------------------------------------------------------

export const employeeVersions = sqliteTable(
  'employee_versions',
  {
    version_id: text('version_id').primaryKey(),
    employee_id: text('employee_id')
      .notNull()
      .references(() => employees.employee_id, { onDelete: 'cascade' }),
    version_num: integer('version_num').notNull(),
    change_type: text('change_type').notNull(),
    snapshot_json: text('snapshot_json').notNull(),
    change_summary: text('change_summary'),
    created_by: text('created_by').notNull().default('user'),
    created_at: text('created_at').notNull().default(sql`(datetime('now'))`),
  },
  (table) => [
    uniqueIndex('idx_emp_ver_emp_num').on(table.employee_id, table.version_num),
    index('idx_emp_ver_emp').on(table.employee_id),
  ],
);

// ---------------------------------------------------------------------------
// 005 — Agent memory system
// ---------------------------------------------------------------------------

export const memoryEntries = sqliteTable(
  'memory_entries',
  {
    memory_id: text('memory_id').primaryKey(),
    company_id: text('company_id').notNull(),
    scope: text('scope').notNull(),
    owner_id: text('owner_id').notNull(),
    category: text('category').notNull(),
    content: text('content').notNull(),
    importance: real('importance').notNull().default(0.5),
    confidence: real('confidence').notNull().default(0.7),
    dedupe_key: text('dedupe_key').notNull(),
    reinforcement_count: integer('reinforcement_count').notNull().default(1),
    last_reinforced_at: text('last_reinforced_at').notNull().default(sql`(datetime('now'))`),
    metadata_json: text('metadata_json'),
    source_thread_id: text('source_thread_id'),
    created_at: text('created_at').notNull().default(sql`(datetime('now'))`),
    accessed_at: text('accessed_at').notNull().default(sql`(datetime('now'))`),
    access_count: integer('access_count').notNull().default(0),
  },
  (table) => [
    index('idx_memory_scope_owner').on(table.scope, table.owner_id),
    index('idx_memory_company').on(table.company_id),
    index('idx_memory_importance').on(table.importance),
    index('idx_memory_dedupe').on(
      table.company_id,
      table.scope,
      table.owner_id,
      table.category,
      table.dedupe_key,
    ),
    index('idx_memory_reinforced').on(table.last_reinforced_at),
  ],
);

// ---------------------------------------------------------------------------
// 007 — Model cost rates
// ---------------------------------------------------------------------------

export const modelCostRates = sqliteTable(
  'model_cost_rates',
  {
    rate_id: text('rate_id').primaryKey(),
    provider: text('provider').notNull(),
    model_pattern: text('model_pattern').notNull(),
    input_cost_per_mtok: real('input_cost_per_mtok').notNull(),
    output_cost_per_mtok: real('output_cost_per_mtok').notNull(),
    effective_from: text('effective_from').notNull(),
    effective_until: text('effective_until'),
    created_at: text('created_at').notNull().default(sql`(datetime('now'))`),
  },
  (table) => [
    uniqueIndex('idx_cost_rates_provider_model').on(
      table.provider,
      table.model_pattern,
      table.effective_from,
    ),
  ],
);

export const companyTemplateAssets = sqliteTable(
  'company_template_assets',
  {
    company_template_asset_id: text('company_template_asset_id').primaryKey(),
    company_id: text('company_id')
      .notNull()
      .references(() => companies.company_id, { onDelete: 'cascade' }),
    template_id: text('template_id').notNull(),
    name: text('name').notNull(),
    description: text('description').notNull().default(''),
    template_json: text('template_json').notNull(),
    source_package_id: text('source_package_id').notNull(),
    source_asset_id: text('source_asset_id').notNull(),
    version: text('version'),
    created_at: text('created_at').notNull().default(sql`(datetime('now'))`),
    updated_at: text('updated_at').notNull().default(sql`(datetime('now'))`),
  },
  (table) => [index('idx_company_template_assets_company').on(table.company_id)],
);

// ---------------------------------------------------------------------------
// 007 — MCP audit log
// ---------------------------------------------------------------------------

export const mcpAuditLog = sqliteTable(
  'mcp_audit_log',
  {
    audit_id: text('audit_id').primaryKey(),
    thread_id: text('thread_id').notNull(),
    employee_id: text('employee_id').notNull(),
    server_name: text('server_name').notNull(),
    tool_name: text('tool_name').notNull(),
    arguments_json: text('arguments_json').notNull(),
    result_json: text('result_json'),
    error: text('error'),
    latency_ms: integer('latency_ms').notNull(),
    approval_status: text('approval_status').notNull().default('not_required'),
    approved_by: text('approved_by'),
    created_at: text('created_at').notNull(),
  },
  (table) => [
    index('idx_mcp_audit_thread').on(table.thread_id),
    index('idx_mcp_audit_employee').on(table.employee_id),
    index('idx_mcp_audit_server_tool').on(table.server_name, table.tool_name),
  ],
);

export const toolPermissionApprovals = sqliteTable(
  'tool_permission_approvals',
  {
    approval_id: text('approval_id').primaryKey(),
    thread_id: text('thread_id').notNull(),
    company_id: text('company_id')
      .notNull()
      .references(() => companies.company_id, { onDelete: 'cascade' }),
    employee_id: text('employee_id'),
    server_name: text('server_name').notNull(),
    tool_name: text('tool_name').notNull(),
    scope: text('scope').notNull(),
    approved_by: text('approved_by').notNull(),
    policy_hash: text('policy_hash').notNull(),
    consumed_at: text('consumed_at'),
    created_at: text('created_at').notNull(),
    expires_at: text('expires_at'),
  },
  (table) => [
    index('idx_tool_perm_approval_lookup').on(
      table.thread_id,
      table.employee_id,
      table.server_name,
      table.tool_name,
      table.policy_hash,
    ),
    index('idx_tool_perm_approval_company_lookup').on(
      table.company_id,
      table.thread_id,
      table.employee_id,
      table.server_name,
      table.tool_name,
      table.policy_hash,
    ),
    index('idx_tool_perm_approval_company').on(table.company_id, table.created_at),
  ],
);

export const mcpToolGrants = sqliteTable(
  'mcp_tool_grants',
  {
    grant_id: text('grant_id').primaryKey(),
    company_id: text('company_id')
      .notNull()
      .references(() => companies.company_id, { onDelete: 'cascade' }),
    employee_id: text('employee_id').notNull(),
    server_name: text('server_name').notNull(),
    tool_name: text('tool_name').notNull(),
    scope: text('scope').notNull().default('employee'),
    project_id: text('project_id'),
    risk_class: text('risk_class').notNull().default('write'),
    risk_source: text('risk_source').notNull().default('human_override'),
    trusted_server_id: text('trusted_server_id'),
    granted_by: text('granted_by').notNull(),
    created_at: text('created_at').notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.company_id, table.employee_id],
      foreignColumns: [employees.company_id, employees.employee_id],
    }).onDelete('cascade'),
    uniqueIndex('idx_mcp_tool_grants_unique').on(
      table.company_id,
      table.employee_id,
      table.server_name,
      table.tool_name,
    ),
    index('idx_mcp_tool_grants_employee').on(table.company_id, table.employee_id),
    index('idx_mcp_tool_grants_server_tool').on(table.server_name, table.tool_name),
  ],
);

// ---------------------------------------------------------------------------
// 008 — Node summary ledger
// ---------------------------------------------------------------------------

export const nodeSummaries = sqliteTable(
  'node_summaries',
  {
    summary_id: text('summary_id').primaryKey(),
    thread_id: text('thread_id').notNull(),
    company_id: text('company_id')
      .notNull()
      .references(() => companies.company_id, { onDelete: 'cascade' }),
    node_name: text('node_name').notNull(),
    employee_id: text('employee_id'),
    step_index: integer('step_index'),
    summary_text: text('summary_text').notNull(),
    decisions_json: text('decisions_json').notNull(),
    files_touched_json: text('files_touched_json').notNull(),
    tools_used_json: text('tools_used_json').notNull(),
    input_token_count: integer('input_token_count').notNull().default(0),
    output_token_count: integer('output_token_count').notNull().default(0),
    message_count: integer('message_count').notNull().default(0),
    duration_ms: integer('duration_ms').notNull().default(0),
    created_at: text('created_at').notNull(),
  },
  (table) => [
    index('idx_node_summaries_thread_created').on(table.thread_id, table.created_at),
    index('idx_node_summaries_thread_node').on(table.thread_id, table.node_name, table.created_at),
  ],
);

export const compactSummaries = sqliteTable(
  'compact_summaries',
  {
    compact_id: text('compact_id').primaryKey(),
    thread_id: text('thread_id').notNull(),
    company_id: text('company_id')
      .notNull()
      .references(() => companies.company_id, { onDelete: 'cascade' }),
    compact_kind: text('compact_kind').notNull(),
    summary_source: text('summary_source').notNull(),
    summary_text: text('summary_text').notNull(),
    pre_compact_message_count: integer('pre_compact_message_count').notNull().default(0),
    pre_compact_token_count: integer('pre_compact_token_count').notNull().default(0),
    messages_compacted: integer('messages_compacted').notNull().default(0),
    failure_streak: integer('failure_streak').notNull().default(0),
    created_at: text('created_at').notNull(),
  },
  (table) => [
    index('idx_compact_summaries_thread_created').on(table.thread_id, table.created_at),
    index('idx_compact_summaries_thread_kind').on(
      table.thread_id,
      table.compact_kind,
      table.created_at,
    ),
  ],
);

export const activeThreadInteractions = sqliteTable(
  'active_thread_interactions',
  {
    thread_id: text('thread_id').primaryKey(),
    company_id: text('company_id')
      .notNull()
      .references(() => companies.company_id, { onDelete: 'cascade' }),
    interaction_id: text('interaction_id').notNull().unique(),
    kind: text('kind').notNull(),
    interaction_mode: text('interaction_mode').notNull(),
    request_json: text('request_json').notNull(),
    payload_json: text('payload_json'),
    created_at: text('created_at').notNull(),
    updated_at: text('updated_at').notNull(),
  },
  (table) => [
    index('idx_active_interactions_company').on(table.company_id, table.updated_at),
    index('idx_active_interactions_kind').on(table.kind, table.updated_at),
  ],
);

export const interactionHistory = sqliteTable(
  'interaction_history',
  {
    history_id: text('history_id').primaryKey(),
    interaction_id: text('interaction_id').notNull(),
    thread_id: text('thread_id').notNull(),
    company_id: text('company_id')
      .notNull()
      .references(() => companies.company_id, { onDelete: 'cascade' }),
    kind: text('kind').notNull(),
    interaction_mode: text('interaction_mode').notNull(),
    status: text('status').notNull(),
    selected_option_id: text('selected_option_id'),
    freeform_response: text('freeform_response'),
    request_json: text('request_json').notNull(),
    response_json: text('response_json'),
    payload_json: text('payload_json'),
    created_at: text('created_at').notNull(),
    resolved_at: text('resolved_at').notNull(),
  },
  (table) => [
    index('idx_interaction_history_thread').on(table.thread_id, table.resolved_at),
    index('idx_interaction_history_company').on(table.company_id, table.resolved_at),
    index('idx_interaction_history_kind').on(table.kind, table.resolved_at),
  ],
);

// ---------------------------------------------------------------------------
// 009 — Library documents
// ---------------------------------------------------------------------------

export const libraryDocuments = sqliteTable(
  'library_documents',
  {
    doc_id: text('doc_id').primaryKey(),
    company_id: text('company_id')
      .notNull()
      .references(() => companies.company_id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    content_text: text('content_text').notNull().default(''),
    source_type: text('source_type').notNull().default('file'),
    mime_type: text('mime_type'),
    file_size: integer('file_size'),
    created_at: text('created_at').notNull().default(sql`(datetime('now'))`),
    updated_at: text('updated_at').notNull().default(sql`(datetime('now'))`),
  },
  (table) => [index('idx_library_docs_company').on(table.company_id)],
);

// ---------------------------------------------------------------------------
// 009 — Prefab instances
// ---------------------------------------------------------------------------

export const prefabInstances = sqliteTable(
  'prefab_instances',
  {
    instance_id: text('instance_id').primaryKey(),
    company_id: text('company_id')
      .notNull()
      .references(() => companies.company_id, { onDelete: 'cascade' }),
    prefab_id: text('prefab_id').notNull(),
    zone_id: text('zone_id').notNull(),
    position_x: real('position_x').notNull().default(0),
    position_y: real('position_y').notNull().default(0),
    rotation: integer('rotation').notNull().default(0),
    bindings_json: text('bindings_json'),
    config_json: text('config_json'),
    enabled: integer('enabled').notNull().default(1),
    // No DB-side default in schema.sql (the sole DDL authority): callers must
    // supply both timestamps, and the insert type must say so.
    created_at: text('created_at').notNull(),
    updated_at: text('updated_at').notNull(),
  },
  (table) => [
    index('idx_prefab_instances_company').on(table.company_id),
    index('idx_prefab_instances_zone').on(table.company_id, table.zone_id),
  ],
);

// ---------------------------------------------------------------------------
// 012 — Agent events (event sourcing)
// ---------------------------------------------------------------------------

export const agentEvents = sqliteTable(
  'agent_events',
  {
    event_id: text('event_id').primaryKey(),
    project_id: text('project_id').references(() => projects.project_id, { onDelete: 'cascade' }),
    thread_id: text('thread_id').notNull(),
    company_id: text('company_id').notNull(),
    agent_name: text('agent_name').notNull(),
    event_type: text('event_type').notNull(),
    payload_json: text('payload_json').notNull(),
    parent_event_id: text('parent_event_id'),
    created_at: text('created_at').notNull(),
  },
  (table) => [
    index('idx_agent_events_project').on(table.project_id, table.created_at),
    index('idx_agent_events_thread').on(table.thread_id, table.event_type),
    index('idx_agent_events_agent').on(table.agent_name, table.event_type),
    index('idx_agent_events_parent').on(table.parent_event_id),
  ],
);

// ---------------------------------------------------------------------------
// Office layouts
// ---------------------------------------------------------------------------

export const officeLayouts = sqliteTable(
  'office_layouts',
  {
    layout_id: text('layout_id').primaryKey(),
    company_id: text('company_id')
      .notNull()
      .references(() => companies.company_id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    layout_json: text('layout_json').notNull(),
    is_active: integer('is_active').notNull().default(0),
    created_at: text('created_at').notNull().default(sql`(datetime('now'))`),
    updated_at: text('updated_at').notNull().default(sql`(datetime('now'))`),
  },
  (table) => [index('idx_office_layouts_company').on(table.company_id)],
);

// ---------------------------------------------------------------------------
// Zones — spatial regions within the office
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// 023 — Deliverables (structured artifact history)
// ---------------------------------------------------------------------------

export const deliverables = sqliteTable(
  'deliverables',
  {
    deliverable_id: text('deliverable_id').primaryKey(),
    company_id: text('company_id')
      .notNull()
      .references(() => companies.company_id, { onDelete: 'cascade' }),
    thread_id: text('thread_id'),
    chat_thread_id: text('chat_thread_id'),
    title: text('title').notNull(),
    content: text('content').notNull(),
    kind: text('kind'),
    file_name: text('file_name'),
    mime_type: text('mime_type'),
    contributors_json: text('contributors_json').notNull(),
    created_at: text('created_at').notNull(),
    run_id: text('run_id'),
    content_hash: text('content_hash'),
    version: integer('version').notNull().default(1),
  },
  (table) => [
    index('idx_deliverables_company_time').on(table.company_id, table.created_at),
    index('idx_deliverables_thread_time').on(table.thread_id, table.created_at),
    index('idx_deliverables_chat_thread_time').on(table.chat_thread_id, table.created_at),
    index('idx_deliverables_run_id').on(table.run_id),
  ],
);

// ---------------------------------------------------------------------------
// Settings (generic key-value; compatibility bootstrap markers)
// ---------------------------------------------------------------------------

export const settings = sqliteTable('settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  updated_at: integer('updated_at').notNull(),
});

// ---------------------------------------------------------------------------
// 025 — Skills (two-tier schema: company-global + employee-specific)
// ---------------------------------------------------------------------------

export const skills = sqliteTable(
  'skills',
  {
    skill_id: text('skill_id').primaryKey(),
    company_id: text('company_id')
      .notNull()
      .references(() => companies.company_id, { onDelete: 'cascade' }),
    employee_id: text('employee_id').references(() => employees.employee_id, {
      onDelete: 'cascade',
    }),
    scope: text('scope').notNull(),
    slug: text('slug').notNull(),
    name: text('name').notNull(),
    description: text('description').notNull(),
    version: text('version').notNull().default('0.1.0'),
    source_kind: text('source_kind').notNull(),
    source_ref: text('source_ref'),
    vault_path: text('vault_path').notNull(),
    created_at: integer('created_at').notNull(),
    updated_at: integer('updated_at').notNull(),
  },
  (table) => [
    uniqueIndex('idx_skills_company_slug')
      .on(table.company_id, table.slug)
      .where(sql`employee_id IS NULL`),
    uniqueIndex('idx_skills_employee_slug')
      .on(table.company_id, table.employee_id, table.slug)
      .where(sql`employee_id IS NOT NULL`),
    index('idx_skills_company_scope').on(table.company_id, table.scope),
    index('idx_skills_employee').on(table.employee_id).where(sql`employee_id IS NOT NULL`),
  ],
);

export const zones = sqliteTable(
  'zones',
  {
    zone_id: text('zone_id').primaryKey(),
    company_id: text('company_id')
      .notNull()
      .references(() => companies.company_id, { onDelete: 'cascade' }),
    kind: text('kind').notNull(),
    archetype: text('archetype'),
    label: text('label').notNull(),
    accent_color: text('accent_color').notNull().default('#64748b'),
    floor_color: integer('floor_color').notNull().default(0x2a3a5c),
    cx: real('cx').notNull().default(0),
    cz: real('cz').notNull().default(0),
    w: real('w').notNull().default(10),
    d: real('d').notNull().default(8),
    target_roles_json: text('target_roles_json'),
    allowed_categories_json: text('allowed_categories_json'),
    activity_types_json: text('activity_types_json'),
    desk_slots: integer('desk_slots').notNull().default(0),
    sort_order: integer('sort_order').notNull().default(0),
    created_at: text('created_at').notNull().default(sql`(datetime('now'))`),
    updated_at: text('updated_at').notNull().default(sql`(datetime('now'))`),
  },
  (table) => [index('idx_zones_company').on(table.company_id)],
);

// ---------------------------------------------------------------------------
// pi kernel — per-message transcript persistence for the pi agent loop.
// Append-only per thread; standalone (no graph FK).
// ---------------------------------------------------------------------------

export const piMessages = sqliteTable(
  'pi_messages',
  {
    message_id: text('message_id').primaryKey(),
    thread_id: text('thread_id').notNull(),
    company_id: text('company_id').notNull(),
    employee_id: text('employee_id'),
    seq: integer('seq').notNull(),
    role: text('role').notNull(),
    message_json: text('message_json').notNull(),
    created_at: text('created_at').notNull(),
  },
  // UNIQUE(thread_id, seq) also backs thread-scoped ordering / MAX(seq) / last-row
  // lookups — no separate index needed.
  (table) => [uniqueIndex('pi_messages_thread_seq').on(table.thread_id, table.seq)],
);

// ---------------------------------------------------------------------------
// Verified Missions core (PRD §17). Mission status/criteria truth lives here;
// evaluation truth is `mission_evaluation` (ADR 2026-06-25-truth-closure D4).
// ---------------------------------------------------------------------------

export const mission = sqliteTable(
  'mission',
  {
    mission_id: text('mission_id').primaryKey(),
    company_id: text('company_id')
      .notNull()
      .references(() => companies.company_id, { onDelete: 'cascade' }),
    project_id: text('project_id'),
    thread_id: text('thread_id').notNull(),
    title: text('title').notNull(),
    goal: text('goal').notNull(),
    status: text('status').notNull(),
    runtime_id: text('runtime_id').notNull(),
    runtime_policy_json: text('runtime_policy_json').notNull(),
    budget_json: text('budget_json').notNull(),
    expected_artifacts_json: text('expected_artifacts_json'),
    current_attempt_id: text('current_attempt_id'),
    created_at: text('created_at').notNull(),
    updated_at: text('updated_at').notNull(),
    completed_at: text('completed_at'),
  },
  (table) => [
    index('idx_mission_company_time').on(table.company_id, table.created_at),
    index('idx_mission_status').on(table.status),
  ],
);

export const missionCriterion = sqliteTable(
  'mission_criterion',
  {
    criterion_id: text('criterion_id').primaryKey(),
    mission_id: text('mission_id')
      .notNull()
      .references(() => mission.mission_id, { onDelete: 'cascade' }),
    description: text('description').notNull(),
    evaluator_id: text('evaluator_id').notNull(),
    evaluator_config_json: text('evaluator_config_json').notNull(),
    required: integer('required').notNull().default(1),
    order_index: integer('order_index').notNull().default(0),
    status: text('status').notNull().default('pending'),
    last_evaluation_id: text('last_evaluation_id'),
  },
  (table) => [index('idx_mission_criterion_mission_order').on(table.mission_id, table.order_index)],
);

export const missionAttempt = sqliteTable(
  'mission_attempt',
  {
    attempt_id: text('attempt_id').primaryKey(),
    mission_id: text('mission_id')
      .notNull()
      .references(() => mission.mission_id, { onDelete: 'cascade' }),
    attempt_number: integer('attempt_number').notNull(),
    root_run_id: text('root_run_id'),
    runtime_session_link_id: text('runtime_session_link_id'),
    trigger: text('trigger').notNull(),
    status: text('status').notNull(),
    failure_signature: text('failure_signature'),
    started_at: text('started_at').notNull(),
    finished_at: text('finished_at'),
  },
  (table) => [
    index('idx_mission_attempt_mission_number').on(table.mission_id, table.attempt_number),
  ],
);

export const missionEvaluation = sqliteTable(
  'mission_evaluation',
  {
    evaluation_id: text('evaluation_id').primaryKey(),
    mission_id: text('mission_id')
      .notNull()
      .references(() => mission.mission_id, { onDelete: 'cascade' }),
    criterion_id: text('criterion_id').notNull(),
    attempt_id: text('attempt_id').notNull(),
    evaluator_id: text('evaluator_id').notNull(),
    verdict: text('verdict').notNull(),
    summary: text('summary').notNull(),
    evidence_refs_json: text('evidence_refs_json').notNull(),
    duration_ms: integer('duration_ms'),
    created_at: text('created_at').notNull(),
  },
  (table) => [
    index('idx_mission_evaluation_mission_criterion').on(table.mission_id, table.criterion_id),
    index('idx_mission_evaluation_attempt').on(table.attempt_id),
  ],
);

export const runtimeSessionLink = sqliteTable(
  'runtime_session_link',
  {
    runtime_session_link_id: text('runtime_session_link_id').primaryKey(),
    mission_id: text('mission_id')
      .notNull()
      .references(() => mission.mission_id, { onDelete: 'cascade' }),
    runtime_id: text('runtime_id').notNull(),
    runtime_version: text('runtime_version'),
    opaque_session_ref_json: text('opaque_session_ref_json').notNull(),
    compatibility_hash: text('compatibility_hash'),
    workspace_lease_id: text('workspace_lease_id'),
    last_safe_boundary: text('last_safe_boundary'),
    status: text('status').notNull(),
  },
  (table) => [index('idx_runtime_session_link_mission').on(table.mission_id)],
);

export const missionEvent = sqliteTable(
  'mission_event',
  {
    mission_event_id: text('mission_event_id').primaryKey(),
    mission_id: text('mission_id')
      .notNull()
      .references(() => mission.mission_id, { onDelete: 'cascade' }),
    attempt_id: text('attempt_id'),
    type: text('type').notNull(),
    data_json: text('data_json').notNull(),
    created_at: text('created_at').notNull(),
  },
  (table) => [index('idx_mission_event_mission_time').on(table.mission_id, table.created_at)],
);

// ---------------------------------------------------------------------------
// Collaboration (PR-02). Company-scoped daily chat (direct + group), FULLY
// separate from project-scoped `chat_threads`: no `project_id`. The real
// CHECK / partial-unique constraints are enforced by schema.sql; this is the
// Drizzle typing layer only (see header).
// ---------------------------------------------------------------------------

export const collaborationThreads = sqliteTable(
  'collaboration_threads',
  {
    thread_id: text('thread_id').primaryKey(),
    company_id: text('company_id')
      .notNull()
      .references(() => companies.company_id, { onDelete: 'cascade' }),
    kind: text('kind').notNull(),
    title: text('title').notNull(),
    direct_employee_id: text('direct_employee_id').references(() => employees.employee_id, {
      onDelete: 'set null',
    }),
    reply_policy: text('reply_policy').notNull().default('mentions_only'),
    capability_profile: text('capability_profile').notNull().default('strict'),
    round_speaker_limit: integer('round_speaker_limit').notNull().default(3),
    created_by: text('created_by').notNull().default('boss'),
    archived_at: text('archived_at'),
    created_at: text('created_at').notNull(),
    updated_at: text('updated_at').notNull(),
  },
  (table) => [
    index('idx_collaboration_threads_company_updated').on(table.company_id, table.updated_at),
    // At most one ACTIVE direct thread per (company, employee). Archived rows are
    // excluded so an archived direct thread is restored, not duplicated.
    uniqueIndex('idx_collaboration_threads_active_direct')
      .on(table.company_id, table.direct_employee_id)
      .where(sql`${table.kind} = 'direct' AND ${table.archived_at} IS NULL`),
  ],
);

export const collaborationThreadMembers = sqliteTable(
  'collaboration_thread_members',
  {
    member_id: text('member_id').primaryKey(),
    thread_id: text('thread_id')
      .notNull()
      .references(() => collaborationThreads.thread_id, { onDelete: 'cascade' }),
    actor_type: text('actor_type').notNull(),
    employee_id: text('employee_id').references(() => employees.employee_id, {
      onDelete: 'cascade',
    }),
    role: text('role').notNull(),
    joined_at: text('joined_at').notNull(),
    left_at: text('left_at'),
  },
  (table) => [
    index('idx_collaboration_members_thread').on(table.thread_id),
    index('idx_collaboration_members_employee').on(table.employee_id),
  ],
);

export const collaborationMessages = sqliteTable(
  'collaboration_messages',
  {
    message_id: text('message_id').primaryKey(),
    thread_id: text('thread_id')
      .notNull()
      .references(() => collaborationThreads.thread_id, { onDelete: 'cascade' }),
    sender_type: text('sender_type').notNull(),
    sender_employee_id: text('sender_employee_id').references(() => employees.employee_id, {
      onDelete: 'set null',
    }),
    body: text('body').notNull(),
    reply_to_message_id: text('reply_to_message_id'),
    status: text('status').notNull().default('complete'),
    idempotency_key: text('idempotency_key'),
    metadata_json: text('metadata_json'),
    created_at: text('created_at').notNull(),
    edited_at: text('edited_at'),
  },
  (table) => [
    index('idx_collaboration_messages_thread_time').on(
      table.thread_id,
      table.created_at,
      table.message_id,
    ),
    // Double-send dedup: at most one message per (thread, idempotency_key).
    uniqueIndex('idx_collaboration_messages_idempotency')
      .on(table.thread_id, table.idempotency_key)
      .where(sql`${table.idempotency_key} IS NOT NULL`),
  ],
);

export const collaborationReadState = sqliteTable('collaboration_read_state', {
  thread_id: text('thread_id')
    .primaryKey()
    .references(() => collaborationThreads.thread_id, { onDelete: 'cascade' }),
  last_read_message_id: text('last_read_message_id'),
  updated_at: text('updated_at').notNull(),
});

// ---------------------------------------------------------------------------
// Loop domain (PR-07). A saveable, versioned, reusable wrapper around the
// Mission engine. Definitions point at an immutable selected revision; every
// edit appends a new revision. SAVING a Loop writes ONLY these tables — never a
// mission / chat_thread / attempt / run. The real CHECK constraints live in
// schema.sql; this is the Drizzle typing layer only.
// ---------------------------------------------------------------------------

export const loopDefinitions = sqliteTable(
  'loop_definitions',
  {
    loop_id: text('loop_id').primaryKey(),
    company_id: text('company_id')
      .notNull()
      .references(() => companies.company_id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    summary: text('summary').notNull().default(''),
    profile_id: text('profile_id').notNull(),
    // No FK: the selected revision is set after the row exists, and the column
    // must survive an archive that keeps revisions with invocation history.
    current_revision_id: text('current_revision_id'),
    status: text('status').notNull().default('draft'),
    schedule_interval_minutes: integer('schedule_interval_minutes'),
    next_run_at: text('next_run_at'),
    last_run_at: text('last_run_at'),
    last_run_result: text('last_run_result'),
    created_at: text('created_at').notNull(),
    updated_at: text('updated_at').notNull(),
  },
  (table) => [
    index('idx_loop_definitions_company_updated').on(table.company_id, table.updated_at),
    index('idx_loop_definitions_status').on(table.status),
  ],
);

export const loopRevisions = sqliteTable(
  'loop_revisions',
  {
    revision_id: text('revision_id').primaryKey(),
    loop_id: text('loop_id')
      .notNull()
      .references(() => loopDefinitions.loop_id, { onDelete: 'cascade' }),
    revision_number: integer('revision_number').notNull(),
    source_prompt: text('source_prompt').notNull(),
    enhanced_prompt: text('enhanced_prompt'),
    compiled_ir_json: text('compiled_ir_json').notNull(),
    compiler_profile_id: text('compiler_profile_id').notNull(),
    compiler_profile_version: text('compiler_profile_version').notNull(),
    compiler_version: text('compiler_version').notNull(),
    compile_status: text('compile_status').notNull(),
    questions_json: text('questions_json').notNull().default('[]'),
    validation_json: text('validation_json').notNull().default('{}'),
    created_at: text('created_at').notNull(),
  },
  (table) => [
    // Monotonic revision numbering is enforced unique per loop.
    uniqueIndex('idx_loop_revisions_loop_number').on(table.loop_id, table.revision_number),
    index('idx_loop_revisions_loop_created').on(table.loop_id, table.created_at),
  ],
);

export const loopSkillBindings = sqliteTable(
  'loop_skill_bindings',
  {
    binding_id: text('binding_id').primaryKey(),
    revision_id: text('revision_id')
      .notNull()
      .references(() => loopRevisions.revision_id, { onDelete: 'cascade' }),
    skill_id: text('skill_id').notNull(),
    skill_version: text('skill_version').notNull(),
    order_index: integer('order_index').notNull().default(0),
    config_json: text('config_json').notNull().default('{}'),
  },
  (table) => [
    index('idx_loop_skill_bindings_revision_order').on(table.revision_id, table.order_index),
  ],
);

// Written ONLY at Office Send materialization (PR-10), never on Save/Use. No FK
// to loop_revisions: an invocation must remain readable even if a definition is
// later archived; deletion of a definition with invocation history is forbidden
// by the service, not by a cascade here.
export const loopInvocations = sqliteTable(
  'loop_invocations',
  {
    invocation_id: text('invocation_id').primaryKey(),
    loop_id: text('loop_id').notNull(),
    revision_id: text('revision_id').notNull(),
    company_id: text('company_id')
      .notNull()
      .references(() => companies.company_id, { onDelete: 'cascade' }),
    project_id: text('project_id'),
    thread_id: text('thread_id').notNull(),
    message_id: text('message_id').notNull(),
    mission_id: text('mission_id'),
    status: text('status').notNull(),
    created_at: text('created_at').notNull(),
  },
  (table) => [
    index('idx_loop_invocations_loop').on(table.loop_id),
    index('idx_loop_invocations_revision').on(table.revision_id),
    index('idx_loop_invocations_company_created').on(table.company_id, table.created_at),
  ],
);

// ---------------------------------------------------------------------------
// Collaboration turns (PR-03). Ledger of each AI reply's lifecycle on a
// Collaboration thread: streaming / error / usage recovery — NOT a transcript
// copy (the visible message lives in `collaboration_messages`). Company-scoped
// only: no `project_id`, never an `agent_runs` / mission row. The real CHECK
// constraint lives in schema.sql; this is the Drizzle typing layer only.
// ---------------------------------------------------------------------------

export const collaborationExecutionLanes = sqliteTable('collaboration_execution_lanes', {
  thread_id: text('thread_id')
    .primaryKey()
    .references(() => collaborationThreads.thread_id, { onDelete: 'cascade' }),
  engine_id: text('engine_id').notNull(),
  account_id: text('account_id').notNull(),
  billing_mode: text('billing_mode').notNull(),
});

export const collaborationTurns = sqliteTable(
  'collaboration_turns',
  {
    turn_id: text('turn_id').primaryKey(),
    thread_id: text('thread_id')
      .notNull()
      .references(() => collaborationThreads.thread_id, { onDelete: 'cascade' }),
    // Not an FK: a turn stays readable for recovery even if the trigger message
    // is removed, and may reference a not-yet-persisted id.
    trigger_message_id: text('trigger_message_id'),
    employee_id: text('employee_id').references(() => employees.employee_id, {
      onDelete: 'set null',
    }),
    sequence_index: integer('sequence_index').notNull(),
    status: text('status').notNull().default('pending'),
    runtime_request_id: text('runtime_request_id').notNull(),
    execution_target_json: text('execution_target_json').notNull(),
    result_provenance_json: text('result_provenance_json'),
    usage_json: text('usage_json'),
    error_summary: text('error_summary'),
    started_at: text('started_at'),
    finished_at: text('finished_at'),
  },
  (table) => [
    index('idx_collaboration_turns_thread_sequence').on(table.thread_id, table.sequence_index),
  ],
);
