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
 * Offisim is still pre-launch, so local SQLite uses a single bootstrap schema
 * (schema.sql) instead of a versioned migration chain.
 */

import type { AssetKind } from '@offisim/asset-schema';
import type {
  BindingStatus,
  BindingType,
  InstallSourceType,
  InstallState,
} from '@offisim/shared-types';
import { sql } from 'drizzle-orm';
import {
  type AnySQLiteColumn,
  index,
  integer,
  primaryKey,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core';

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
    workspace_root: text('workspace_root'),
    created_at: text('created_at').notNull(),
    updated_at: text('updated_at').notNull(),
  },
  (table) => [index('idx_projects_company').on(table.company_id, table.status, table.updated_at)],
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

export const graphCheckpoints = sqliteTable(
  'graph_checkpoints',
  {
    checkpoint_id: text('checkpoint_id').primaryKey(),
    thread_id: text('thread_id')
      .notNull()
      .references(() => graphThreads.thread_id, { onDelete: 'cascade' }),
    checkpoint_seq: integer('checkpoint_seq').notNull(),
    checkpoint_kind: text('checkpoint_kind').notNull(),
    payload_json: text('payload_json').notNull(),
    created_at: text('created_at').notNull(),
  },
  (table) => [
    uniqueIndex('graph_checkpoints_thread_seq').on(table.thread_id, table.checkpoint_seq),
    index('idx_graph_checkpoints_thread').on(table.thread_id, table.checkpoint_seq),
  ],
);

export const taskRuns = sqliteTable(
  'task_runs',
  {
    task_run_id: text('task_run_id').primaryKey(),
    thread_id: text('thread_id')
      .notNull()
      .references(() => graphThreads.thread_id, { onDelete: 'cascade' }),
    employee_id: text('employee_id').references(() => employees.employee_id, {
      onDelete: 'set null',
    }),
    parent_task_run_id: text('parent_task_run_id').references(
      (): AnySQLiteColumn => taskRuns.task_run_id,
      { onDelete: 'set null' },
    ),
    task_type: text('task_type').notNull(),
    status: text('status').notNull(),
    input_json: text('input_json'),
    output_json: text('output_json'),
    started_at: text('started_at').notNull(),
    finished_at: text('finished_at'),
  },
  (table) => [index('idx_task_runs_thread').on(table.thread_id)],
);

export const toolCalls = sqliteTable(
  'tool_calls',
  {
    tool_call_id: text('tool_call_id').primaryKey(),
    task_run_id: text('task_run_id')
      .notNull()
      .references(() => taskRuns.task_run_id, { onDelete: 'cascade' }),
    tool_name: text('tool_name').notNull(),
    capability_name: text('capability_name'),
    rack_id: text('rack_id').references(() => racks.rack_id, {
      onDelete: 'set null',
    }),
    status: text('status').notNull(),
    review_state: text('review_state').notNull().default('none'),
    request_json: text('request_json'),
    response_json: text('response_json'),
    started_at: text('started_at').notNull(),
    finished_at: text('finished_at'),
  },
  (table) => [index('idx_tool_calls_task').on(table.task_run_id)],
);

export const handoffEvents = sqliteTable('handoff_events', {
  handoff_id: text('handoff_id').primaryKey(),
  thread_id: text('thread_id')
    .notNull()
    .references(() => graphThreads.thread_id, { onDelete: 'cascade' }),
  from_employee_id: text('from_employee_id').references(() => employees.employee_id, {
    onDelete: 'set null',
  }),
  to_employee_id: text('to_employee_id').references(() => employees.employee_id, {
    onDelete: 'set null',
  }),
  reason: text('reason'),
  payload_json: text('payload_json'),
  created_at: text('created_at').notNull(),
});

export const meetingSessions = sqliteTable(
  'meeting_sessions',
  {
    meeting_id: text('meeting_id').primaryKey(),
    company_id: text('company_id')
      .notNull()
      .references(() => companies.company_id, { onDelete: 'cascade' }),
    thread_id: text('thread_id').references(() => graphThreads.thread_id, {
      onDelete: 'set null',
    }),
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
    thread_id: text('thread_id').references(() => graphThreads.thread_id, {
      onDelete: 'set null',
    }),
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
// 005 — LLM call tracking
// ---------------------------------------------------------------------------

export const llmCalls = sqliteTable(
  'llm_calls',
  {
    llm_call_id: text('llm_call_id').primaryKey(),
    thread_id: text('thread_id').references(() => graphThreads.thread_id, {
      onDelete: 'set null',
    }),
    task_run_id: text('task_run_id').references(() => taskRuns.task_run_id, {
      onDelete: 'set null',
    }),
    node_name: text('node_name').notNull(),
    provider: text('provider').notNull(),
    model: text('model').notNull(),
    input_tokens: integer('input_tokens').notNull(),
    output_tokens: integer('output_tokens').notNull(),
    cache_read_input_tokens: integer('cache_read_input_tokens').notNull().default(0),
    cache_creation_input_tokens: integer('cache_creation_input_tokens').notNull().default(0),
    usage_raw_json: text('usage_raw_json'),
    request_json: text('request_json'),
    response_json: text('response_json'),
    tool_calls_json: text('tool_calls_json'),
    prompt_hash: text('prompt_hash'),
    tools_hash: text('tools_hash'),
    response_hash: text('response_hash'),
    recording_mode: text('recording_mode'),
    latency_ms: integer('latency_ms'),
    error_code: text('error_code'),
    created_at: text('created_at').notNull().default(sql`(datetime('now'))`),
  },
  (table) => [
    index('idx_llm_calls_thread').on(table.thread_id),
    index('idx_llm_calls_task_run').on(table.task_run_id),
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
    source_task_run_id: text('source_task_run_id'),
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
    thread_id: text('thread_id')
      .notNull()
      .references(() => graphThreads.thread_id, { onDelete: 'cascade' }),
    task_run_id: text('task_run_id').references(() => taskRuns.task_run_id, {
      onDelete: 'set null',
    }),
    employee_id: text('employee_id').notNull(),
    server_name: text('server_name').notNull(),
    tool_name: text('tool_name').notNull(),
    arguments_json: text('arguments_json').notNull(),
    result_json: text('result_json'),
    error: text('error'),
    latency_ms: integer('latency_ms').notNull(),
    approved_by: text('approved_by').notNull().default('auto'),
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
    thread_id: text('thread_id')
      .notNull()
      .references(() => graphThreads.thread_id, { onDelete: 'cascade' }),
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

// ---------------------------------------------------------------------------
// 008 — Node summary ledger
// ---------------------------------------------------------------------------

export const nodeSummaries = sqliteTable(
  'node_summaries',
  {
    summary_id: text('summary_id').primaryKey(),
    thread_id: text('thread_id')
      .notNull()
      .references(() => graphThreads.thread_id, { onDelete: 'cascade' }),
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
    thread_id: text('thread_id')
      .notNull()
      .references(() => graphThreads.thread_id, { onDelete: 'cascade' }),
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
    thread_id: text('thread_id')
      .primaryKey()
      .references(() => graphThreads.thread_id, { onDelete: 'cascade' }),
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
    thread_id: text('thread_id')
      .notNull()
      .references(() => graphThreads.thread_id, { onDelete: 'cascade' }),
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

export const fileHistory = sqliteTable(
  'file_history',
  {
    history_id: text('history_id').primaryKey(),
    snapshot_id: text('snapshot_id').notNull(),
    thread_id: text('thread_id')
      .notNull()
      .references(() => graphThreads.thread_id, { onDelete: 'cascade' }),
    company_id: text('company_id')
      .notNull()
      .references(() => companies.company_id, { onDelete: 'cascade' }),
    node_name: text('node_name'),
    employee_id: text('employee_id'),
    task_run_id: text('task_run_id').references(() => taskRuns.task_run_id, {
      onDelete: 'set null',
    }),
    tool_call_id: text('tool_call_id').notNull(),
    tool_name: text('tool_name').notNull(),
    step_index: integer('step_index'),
    file_path: text('file_path').notNull(),
    change_kind: text('change_kind').notNull(),
    existed_before: integer('existed_before').notNull().default(0),
    backup_content: text('backup_content'),
    created_at: text('created_at').notNull(),
  },
  (table) => [
    index('idx_file_history_thread_created').on(table.thread_id, table.created_at),
    index('idx_file_history_snapshot').on(table.snapshot_id),
    index('idx_file_history_thread_step').on(table.thread_id, table.step_index, table.created_at),
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
    created_at: text('created_at').notNull().default(sql`(datetime('now'))`),
    updated_at: text('updated_at').notNull().default(sql`(datetime('now'))`),
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
// 013 — Recovery knowledge (persistent learning)
// ---------------------------------------------------------------------------

export const recoveryKnowledge = sqliteTable(
  'recovery_knowledge',
  {
    knowledge_id: text('knowledge_id').primaryKey(),
    symptom: text('symptom').notNull(),
    cause: text('cause').notNull(),
    fix_strategy: text('fix_strategy').notNull(),
    fix_config: text('fix_config'),
    success_count: integer('success_count').notNull().default(0),
    failure_count: integer('failure_count').notNull().default(0),
    last_used_at: text('last_used_at'),
    created_at: text('created_at').notNull(),
  },
  (table) => [
    uniqueIndex('idx_recovery_symptom').on(table.symptom, table.cause),
    index('idx_recovery_strategy').on(table.fix_strategy),
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
  },
  (table) => [
    index('idx_deliverables_company_time').on(table.company_id, table.created_at),
    index('idx_deliverables_thread_time').on(table.thread_id, table.created_at),
    index('idx_deliverables_chat_thread_time').on(table.chat_thread_id, table.created_at),
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
// LangGraph checkpoints — mirrors the SqliteSaver DDL already in schema.sql.
// The `checkpoint` / `metadata` / `value` payload columns are BLOB-affinity in
// schema.sql; on desktop the renderer's TauriCheckpointSaver is the SOLE reader
// + writer and stores base64-encoded serde payloads as text, so the
// tauri-plugin-sql proxy round-trips them as strings (no binary-fidelity risk).
// Declared `text()` here to bind/read as strings accordingly.
// ---------------------------------------------------------------------------

export const checkpoints = sqliteTable(
  'checkpoints',
  {
    thread_id: text('thread_id').notNull(),
    checkpoint_ns: text('checkpoint_ns').notNull().default(''),
    checkpoint_id: text('checkpoint_id').notNull(),
    parent_checkpoint_id: text('parent_checkpoint_id'),
    type: text('type'),
    checkpoint: text('checkpoint'),
    metadata: text('metadata'),
  },
  (table) => [primaryKey({ columns: [table.thread_id, table.checkpoint_ns, table.checkpoint_id] })],
);

export const writes = sqliteTable(
  'writes',
  {
    thread_id: text('thread_id').notNull(),
    checkpoint_ns: text('checkpoint_ns').notNull().default(''),
    checkpoint_id: text('checkpoint_id').notNull(),
    task_id: text('task_id').notNull(),
    idx: integer('idx').notNull(),
    channel: text('channel').notNull(),
    type: text('type'),
    value: text('value'),
  },
  (table) => [
    primaryKey({
      columns: [
        table.thread_id,
        table.checkpoint_ns,
        table.checkpoint_id,
        table.task_id,
        table.idx,
      ],
    }),
  ],
);

// ---------------------------------------------------------------------------
// pi kernel — per-message transcript persistence (replaces checkpoints/writes
// for the pi agent loop). Append-only per thread; standalone (no graph FK).
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
  (table) => [
    uniqueIndex('pi_messages_thread_seq').on(table.thread_id, table.seq),
    index('idx_pi_messages_thread').on(table.thread_id, table.seq),
  ],
);
