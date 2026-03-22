/**
 * @aics/db-local — Drizzle ORM SQLite schema
 *
 * Derived from the migration DDL files in src/migrations/.
 * Those SQL files remain the canonical source of truth for column
 * definitions, constraints, and indexes.
 */

import { sql } from 'drizzle-orm';
import { index, integer, primaryKey, real, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

// ---------------------------------------------------------------------------
// 001 — Core tables
// ---------------------------------------------------------------------------

export const companies = sqliteTable('companies', {
  company_id: text('company_id').primaryKey(),
  name: text('name').notNull(),
  status: text('status').notNull().default('active'),
  workspace_root: text('workspace_root'),
  default_model_policy_json: text('default_model_policy_json'),
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
  (table) => [
    primaryKey({ columns: [table.workstation_id, table.rack_id] }),
  ],
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
    created_at: text('created_at').notNull(),
    updated_at: text('updated_at').notNull(),
  },
  (table) => [index('idx_employees_company').on(table.company_id)],
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
    source_type: text('source_type').notNull(),
    source_ref: text('source_ref'),
    target_package_id: text('target_package_id'),
    target_version: text('target_version'),
    state: text('state').notNull(),
    error_code: text('error_code'),
    error_detail: text('error_detail'),
    descriptor_json: text('descriptor_json'),
    actor_type: text('actor_type').notNull().default('user'),
    started_at: text('started_at').notNull(),
    finished_at: text('finished_at'),
  },
  (table) => [index('idx_install_transactions_company').on(table.company_id, table.started_at)],
);

export const installedPackages = sqliteTable(
  'installed_packages',
  {
    installed_package_id: text('installed_package_id').primaryKey(),
    company_id: text('company_id')
      .notNull()
      .references(() => companies.company_id, { onDelete: 'cascade' }),
    package_id: text('package_id').notNull(),
    package_kind: text('package_kind').notNull(),
    version: text('version').notNull(),
    source_type: text('source_type').notNull(),
    source_ref: text('source_ref'),
    manifest_hash: text('manifest_hash').notNull(),
    package_hash: text('package_hash').notNull(),
    install_state: text('install_state').notNull(),
    enabled: integer('enabled').notNull().default(1),
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
    asset_kind: text('asset_kind').notNull(),
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
    binding_type: text('binding_type').notNull(),
    binding_key: text('binding_key').notNull(),
    binding_value_json: text('binding_value_json'),
    status: text('status').notNull().default('pending'),
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
    thread_id: text('thread_id'),
    name: text('name').notNull(),
    description: text('description'),
    status: text('status').notNull().default('planning'),
    created_at: text('created_at').notNull(),
    updated_at: text('updated_at').notNull(),
  },
  (table) => [
    index('idx_projects_company').on(table.company_id, table.status, table.updated_at),
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
    parent_task_run_id: text('parent_task_run_id'),
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

export const meetingSessions = sqliteTable('meeting_sessions', {
  meeting_id: text('meeting_id').primaryKey(),
  company_id: text('company_id')
    .notNull()
    .references(() => companies.company_id, { onDelete: 'cascade' }),
  thread_id: text('thread_id').references(() => graphThreads.thread_id, {
    onDelete: 'set null',
  }),
  topic: text('topic').notNull(),
  status: text('status').notNull(),
  summary_json: text('summary_json'),
  created_at: text('created_at').notNull(),
  updated_at: text('updated_at').notNull(),
});

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
    usage_raw_json: text('usage_raw_json'),
    response_json: text('response_json'),
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

// ---------------------------------------------------------------------------
// 008 — SOP templates
// ---------------------------------------------------------------------------

export const sopTemplates = sqliteTable('sop_templates', {
  sop_template_id: text('sop_template_id').primaryKey(),
  company_id: text('company_id').notNull().references(() => companies.company_id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  description: text('description').notNull().default(''),
  definition_json: text('definition_json').notNull(),
  source_thread_id: text('source_thread_id'),
  created_at: text('created_at').notNull().default(sql`(datetime('now'))`),
  updated_at: text('updated_at').notNull().default(sql`(datetime('now'))`),
});

// ---------------------------------------------------------------------------
// 007 — MCP audit log
// ---------------------------------------------------------------------------

export const mcpAuditLog = sqliteTable(
  'mcp_audit_log',
  {
    audit_id: text('audit_id').primaryKey(),
    thread_id: text('thread_id')
      .notNull()
      .references(() => graphThreads.thread_id),
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
    index('idx_mcp_audit_server').on(table.server_name),
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
    company_id: text('company_id').notNull().references(() => companies.company_id, { onDelete: 'cascade' }),
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
// 012 — Office layouts
// ---------------------------------------------------------------------------

export const officeLayouts = sqliteTable(
  'office_layouts',
  {
    layout_id: text('layout_id').primaryKey(),
    company_id: text('company_id').notNull().references(() => companies.company_id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    layout_json: text('layout_json').notNull(),
    is_active: integer('is_active').notNull().default(0),
    created_at: text('created_at').notNull().default(sql`(datetime('now'))`),
    updated_at: text('updated_at').notNull().default(sql`(datetime('now'))`),
  },
  (table) => [index('idx_office_layouts_company').on(table.company_id)],
);
