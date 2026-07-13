import type { NewEmployee } from '@offisim/install-core';
import type {
  InteractionKind,
  InteractionMode,
  RoleSlug,
  SkillRow,
  SkillScope,
  SkillSourceKind,
} from '@offisim/shared-types';
import type {
  ChatThread,
  NewChatThread,
  NewProject,
  NewProjectAssignment,
  ProjectAssignmentRow,
  ProjectRow,
  ProjectStatus,
  ProjectUpdatePatch,
} from '@offisim/shared-types';
import type { AssetBindingRepository } from '../repos/asset-binding-repository.js';
import type { InstallTransactionRepository } from '../repos/install-transaction-repository.js';
import type { InstalledAssetRepository } from '../repos/installed-asset-repository.js';
import type { InstalledPackageRepository } from '../repos/installed-package-repository.js';
import type { PrefabInstanceRepository } from '../repos/prefab-instance-repository.js';
import type { ZoneRepository } from '../repos/zone-repository.js';

export type {
  ProjectRow,
  NewProject,
  ProjectStatus,
  ProjectUpdatePatch,
  ProjectAssignmentRow,
  NewProjectAssignment,
  ChatThread,
  NewChatThread,
};

/** Row types — mirror db-local schema shapes */

export interface GraphThreadRow {
  thread_id: string;
  company_id: string;
  entry_mode: string;
  root_task_id: string | null;
  status: string;
  project_id: string | null;
  interaction_mode: InteractionMode;
  synopsis_json: string | null;
  compact_baseline_json: string | null;
  created_at: string;
  updated_at: string;
}

export interface TaskRunRow {
  task_run_id: string;
  thread_id: string;
  employee_id: string | null;
  parent_task_run_id: string | null;
  task_type: string;
  status: string;
  input_json: string | null;
  output_json: string | null;
  started_at: string;
  finished_at: string | null;
}

/** A single delegation run (root or child) in the multi-agent run tree. */
export interface AgentRunRow {
  run_id: string;
  thread_id: string;
  company_id: string;
  project_id: string | null;
  parent_run_id: string | null;
  root_run_id: string;
  employee_id: string | null;
  relation: string | null;
  // Work semantics stamped by the delegate tool on run.started (WorkKind);
  // null = unclassified.
  work_kind: string | null;
  objective: string | null;
  access: string | null;
  status: string;
  // Typed failure cause (RunFailureKind) written on a failed terminal.
  failure_kind: string | null;
  usage_json: string | null;
  result_summary_json: string | null;
  // Path to the Pi session JSONL that holds this run's durable context. Set when
  // the run's session is created; used by durable resume to re-continue context.
  session_file: string | null;
  runtime_context_json: string | null;
  started_at: string;
  finished_at: string | null;
}

export interface EmployeeRow {
  employee_id: string;
  company_id: string;
  source_asset_id: string | null;
  source_package_id: string | null;
  name: string;
  role_slug: RoleSlug;
  workstation_id: string | null;
  persona_json: string | null;
  config_json: string | null;
  model: string | null;
  thinking_level: string | null;
  enabled: number;
  is_external: number;
  a2a_url: string | null;
  a2a_token: string | null;
  a2a_agent_id: string | null;
  brand_key: string | null;
  agent_card_json: string | null;
  created_at: string;
  updated_at: string;
}

export interface CompanyRow {
  company_id: string;
  name: string;
  status: string;
  template_id: string | null;
  template_label: string | null;
  workspace_root: string | null;
  description_json: string | null;
  created_at: string;
  updated_at: string;
}

export interface ToolCallRow {
  tool_call_id: string;
  task_run_id: string;
  tool_name: string;
  capability_name: string | null;
  rack_id: string | null;
  status: string;
  review_state: string;
  request_json: string | null;
  response_json: string | null;
  started_at: string;
  finished_at: string | null;
}

export interface HandoffEventRow {
  handoff_id: string;
  thread_id: string;
  from_employee_id: string | null;
  to_employee_id: string | null;
  reason: string | null;
  payload_json: string | null;
  created_at: string;
}

export interface MeetingSessionRow {
  meeting_id: string;
  company_id: string;
  thread_id: string | null;
  topic: string;
  status: string;
  summary_json: string | null;
  created_at: string;
  updated_at: string;
}

export interface RuntimeEventRow {
  event_id: string;
  company_id: string;
  thread_id: string | null;
  event_type: string;
  severity: string;
  payload_json: string | null;
  created_at: string;
}

export interface LlmCallRow {
  llm_call_id: string;
  thread_id: string | null;
  task_run_id: string | null;
  node_name: string;
  provider: string;
  model: string;
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens: number;
  cache_creation_input_tokens: number;
  usage_raw_json: string | null;
  request_json: string | null;
  response_json: string | null;
  tool_calls_json: string | null;
  prompt_hash: string | null;
  tools_hash: string | null;
  response_hash: string | null;
  recording_mode: string | null;
  latency_ms: number | null;
  error_code: string | null;
  created_at: string;
}

/** Full-row insert: caller supplies llm_call_id + created_at (backend does not stamp). */
export type NewLlmCall = Omit<LlmCallRow, never>;

/** New-row types (omit auto-generated fields) */
export type NewGraphThread = Omit<
  GraphThreadRow,
  | 'created_at'
  | 'updated_at'
  | 'project_id'
  | 'interaction_mode'
  | 'synopsis_json'
  | 'compact_baseline_json'
> & {
  project_id?: string | null;
  interaction_mode?: InteractionMode;
  synopsis_json?: string | null;
  compact_baseline_json?: string | null;
};
export type NewTaskRun = Omit<TaskRunRow, 'finished_at'>;

/** Insert shape for an agent run. Lifecycle/usage columns default at write time;
 *  a fresh run carries only its scope + objective. */
export type NewAgentRun = Omit<
  AgentRunRow,
  | 'started_at'
  | 'finished_at'
  | 'usage_json'
  | 'result_summary_json'
  | 'session_file'
  | 'project_id'
  | 'runtime_context_json'
  | 'work_kind'
  | 'failure_kind'
> & {
  started_at?: string;
  finished_at?: string | null;
  usage_json?: string | null;
  result_summary_json?: string | null;
  session_file?: string | null;
  project_id?: string | null;
  runtime_context_json?: string | null;
  work_kind?: string | null;
  failure_kind?: string | null;
};
export type NewToolCall = Omit<ToolCallRow, 'finished_at'>;
export type NewHandoffEvent = Omit<HandoffEventRow, never>;
export type NewMeetingSession = Omit<MeetingSessionRow, never>;
export type NewRuntimeEvent = Omit<RuntimeEventRow, never>;

/** Repository interfaces */

export interface CompanyRepository {
  findById(companyId: string): Promise<CompanyRow | null>;
  findAll(): Promise<CompanyRow[]>;
  create(company: CompanyRow): Promise<CompanyRow>;
  update(
    companyId: string,
    fields: Partial<
      Pick<CompanyRow, 'name' | 'status' | 'template_id' | 'template_label' | 'description_json'>
    >,
  ): Promise<void>;
  delete(companyId: string): Promise<void>;
}

export interface ThreadRepository {
  create(thread: NewGraphThread): Promise<GraphThreadRow>;
  findById(threadId: string): Promise<GraphThreadRow | null>;
  findByCompany(
    companyId: string,
    opts?: { limit?: number; status?: string },
  ): Promise<GraphThreadRow[]>;
  findByCompanyAndStatus(companyId: string, status: string): Promise<GraphThreadRow[]>;
  updateStatus(threadId: string, status: string): Promise<void>;
  updateInteractionMode(threadId: string, interactionMode: InteractionMode): Promise<void>;
  updateSynopsis(threadId: string, synopsisJson: string | null): Promise<void>;
  updateCompactBaseline(threadId: string, compactBaselineJson: string | null): Promise<void>;
}

export interface TaskRunRepository {
  create(taskRun: NewTaskRun): Promise<TaskRunRow>;
  findById(taskRunId: string): Promise<TaskRunRow | null>;
  findByThread(threadId: string): Promise<TaskRunRow[]>;
  updateStatus(taskRunId: string, status: string, outputJson?: string | null): Promise<void>;
  findQueue(
    companyId: string,
    opts?: { statuses?: string[]; limit?: number },
  ): Promise<TaskRunRow[]>;
  countByStatus(companyId: string): Promise<Record<string, number>>;
}

/** Run tree for multi-agent delegation; the tree rebuilds from parent/root ids. */
export interface AgentRunStatusUpdateOptions {
  resultSummaryJson?: string | null;
  usageJson?: string | null;
  finishedAt?: string | null;
  sessionFile?: string | null;
  /** Typed failure cause (RunFailureKind); written on a failed terminal. */
  failureKind?: string | null;
}

export interface AgentRunRepository {
  create(run: NewAgentRun): Promise<AgentRunRow>;
  findById(runId: string): Promise<AgentRunRow | null>;
  findByThread(threadId: string): Promise<AgentRunRow[]>;
  /** All runs under a root (the children of one user turn). */
  findByRoot(rootRunId: string): Promise<AgentRunRow[]>;
  /** Company-scoped runs filtered to the given statuses, oldest first. Used by
   *  durable-resume reconciliation (find `running` → mark `interrupted`) and the
   *  recovery board (list `interrupted`). Empty `statuses` yields no rows. */
  findByStatus(companyId: string, statuses: string[]): Promise<AgentRunRow[]>;
  updateStatus(runId: string, status: string, opts?: AgentRunStatusUpdateOptions): Promise<void>;
  /**
   * Tenant-scoped terminal/status mutation for UI actions that originate from a
   * company-specific card. Returns false when the run does not exist in that
   * company, so a stale action can never mutate another company's run.
   */
  updateStatusForCompany(
    companyId: string,
    runId: string,
    status: string,
    opts?: AgentRunStatusUpdateOptions,
  ): Promise<boolean>;
  updateRuntimeContext(runId: string, runtimeContextJson: string | null): Promise<void>;
}

/** Updatable fields for an employee. */
export type EmployeeUpdate = Partial<
  Pick<
    EmployeeRow,
    | 'name'
    | 'role_slug'
    | 'persona_json'
    | 'config_json'
    | 'model'
    | 'thinking_level'
    | 'enabled'
    | 'workstation_id'
    | 'is_external'
    | 'a2a_url'
    | 'a2a_token'
    | 'a2a_agent_id'
    | 'brand_key'
    | 'agent_card_json'
  >
>;

/** Employee creation fields owned by the local runtime. Install templates keep
 * using NewEmployee without model presets; Personnel may add an explicit bind. */
export type EmployeeCreate = NewEmployee & {
  readonly model?: string | null;
  readonly thinking_level?: string | null;
};

export interface EmployeeRepository {
  create(employee: EmployeeCreate): Promise<{ employee_id: string }>;
  findById(employeeId: string): Promise<EmployeeRow | null>;
  findByCompany(companyId: string): Promise<EmployeeRow[]>;
  findByRole(companyId: string, roleSlug: RoleSlug): Promise<EmployeeRow[]>;
  /** Update employee fields. */
  update(employeeId: string, patch: EmployeeUpdate): Promise<void>;
  /** Delete an employee by ID. Used during install rollback. */
  delete(employeeId: string): Promise<void>;
}

export interface ToolCallRepository {
  create(toolCall: NewToolCall): Promise<ToolCallRow>;
  updateResult(toolCallId: string, status: string, responseJson: string | null): Promise<void>;
}

export interface HandoffRepository {
  create(handoff: NewHandoffEvent): Promise<HandoffEventRow>;
  findByThread(threadId: string): Promise<HandoffEventRow[]>;
}

export interface MeetingRepository {
  create(meeting: NewMeetingSession): Promise<MeetingSessionRow>;
  findById(meetingId: string): Promise<MeetingSessionRow | null>;
  findByCompany(companyId: string): Promise<MeetingSessionRow[]>;
  updateStatus(meetingId: string, status: string, summaryJson?: string | null): Promise<void>;
}

export interface EventRepository {
  insert(event: NewRuntimeEvent): Promise<void>;
  findByThread(threadId: string): Promise<RuntimeEventRow[]>;
}

export interface LlmCallRepository {
  create(call: NewLlmCall): Promise<LlmCallRow>;
  findByThread(threadId: string): Promise<LlmCallRow[]>;
  findByThreadIds(threadIds: string[]): Promise<LlmCallRow[]>;
  findByTaskRun(taskRunId: string): Promise<LlmCallRow[]>;
}

// ---------------------------------------------------------------------------
// Memory system
// ---------------------------------------------------------------------------

export interface MemoryEntryRow {
  memory_id: string;
  company_id: string;
  scope: 'employee' | 'team' | 'company';
  owner_id: string;
  category: 'experience' | 'decision' | 'knowledge' | 'preference';
  content: string;
  importance: number;
  confidence: number;
  dedupe_key: string;
  reinforcement_count: number;
  last_reinforced_at: string;
  metadata_json: string | null;
  source_thread_id: string | null;
  source_task_run_id: string | null;
  created_at: string;
  accessed_at: string;
  access_count: number;
}

export interface MemoryEntryCreate {
  memory_id: string;
  company_id: string;
  scope: 'employee' | 'team' | 'company';
  owner_id: string;
  category: 'experience' | 'decision' | 'knowledge' | 'preference';
  content: string;
  importance: number;
  confidence?: number;
  dedupe_key?: string;
  reinforcement_count?: number;
  last_reinforced_at?: string | null;
  metadata_json?: string | null;
  source_thread_id?: string | null;
  source_task_run_id?: string | null;
}

export interface MemoryDedupeLookup {
  companyId: string;
  scope: 'employee' | 'team' | 'company';
  ownerId: string;
  category: 'experience' | 'decision' | 'knowledge' | 'preference';
  dedupeKey: string;
}

export interface MemoryReinforcementPatch {
  content?: string;
  importance?: number;
  confidence?: number;
  metadataJson?: string | null;
  sourceThreadId?: string | null;
  sourceTaskRunId?: string | null;
}

/**
 * Direct field overwrite for human edits (Personnel memory tab). Unlike
 * `reinforce`, this does not gate content by length, does not max-merge
 * importance, and does not bump the reinforcement count — it writes exactly
 * what the caller passes. `reinforce` stays reserved for runtime reinforcement.
 */
export interface MemoryUpdatePatch {
  content?: string;
  importance?: number;
}

export interface MemoryRepository {
  create(entry: MemoryEntryCreate): Promise<MemoryEntryRow>;
  findById(memoryId: string): Promise<MemoryEntryRow | null>;
  findByDedupeKey(lookup: MemoryDedupeLookup): Promise<MemoryEntryRow | null>;
  search(
    query: string,
    opts: { scope?: string; ownerId?: string; companyId: string; limit?: number },
  ): Promise<MemoryEntryRow[]>;
  delete(memoryId: string): Promise<void>;
  findByOwner(
    ownerId: string,
    opts?: { category?: string; companyId?: string; scope?: string; limit?: number | null },
  ): Promise<MemoryEntryRow[]>;
  reinforce(memoryId: string, patch: MemoryReinforcementPatch): Promise<MemoryEntryRow | null>;
  update(memoryId: string, patch: MemoryUpdatePatch): Promise<MemoryEntryRow | null>;
  touchAccess(memoryId: string): Promise<void>;
}

// ---------------------------------------------------------------------------
// MCP Audit
// ---------------------------------------------------------------------------

export interface McpAuditRow {
  audit_id: string;
  thread_id: string;
  task_run_id: string | null;
  employee_id: string;
  server_name: string;
  tool_name: string;
  arguments_json: string;
  result_json: string | null;
  error: string | null;
  latency_ms: number;
  approval_status: 'not_required' | 'human_approved' | 'human_denied';
  approved_by: string | null;
  created_at: string;
}

/** Full-row insert: caller supplies audit_id + created_at (backend does not stamp). */
export type NewMcpAudit = Omit<McpAuditRow, 'approval_status' | 'approved_by'> & {
  approval_status?: McpAuditRow['approval_status'];
  approved_by?: string | null;
};

export interface McpAuditRepository {
  create(audit: NewMcpAudit): Promise<McpAuditRow>;
  listByThread(threadId: string): Promise<McpAuditRow[]>;
  hasSuccessfulToolCall(
    threadId: string,
    employeeId: string,
    serverName: string,
    toolName: string,
  ): Promise<boolean>;
}

export interface McpToolGrantRow {
  grant_id: string;
  company_id: string;
  employee_id: string;
  server_name: string;
  tool_name: string;
  scope: string;
  project_id: string | null;
  risk_class: 'read' | 'write' | 'destructive' | 'open_world';
  risk_source: 'server_annotation' | 'name_heuristic' | 'human_override' | 'trusted_manifest';
  trusted_server_id: string | null;
  granted_by: string;
  created_at: string;
}

export type NewMcpToolGrant = Omit<
  McpToolGrantRow,
  'created_at' | 'risk_class' | 'risk_source' | 'trusted_server_id'
> & {
  created_at?: string;
  risk_class?: McpToolGrantRow['risk_class'];
  risk_source?: McpToolGrantRow['risk_source'];
  trusted_server_id?: string | null;
};

export interface McpToolGrantRepository {
  create(grant: NewMcpToolGrant): Promise<McpToolGrantRow>;
  listByEmployee(companyId: string, employeeId: string): Promise<McpToolGrantRow[]>;
  updateRisk(
    companyId: string,
    employeeId: string,
    serverName: string,
    toolName: string,
    risk: Pick<McpToolGrantRow, 'risk_class' | 'risk_source' | 'trusted_server_id'>,
  ): Promise<McpToolGrantRow | null>;
  delete(
    companyId: string,
    employeeId: string,
    serverName: string,
    toolName: string,
  ): Promise<void>;
  hasGrant(
    companyId: string,
    employeeId: string,
    serverName: string,
    toolName: string,
  ): Promise<boolean>;
}

export type ToolPermissionApprovalScope = 'once' | 'thread';

export interface ToolPermissionApprovalRow {
  approval_id: string;
  thread_id: string;
  company_id: string;
  employee_id: string | null;
  server_name: string;
  tool_name: string;
  scope: ToolPermissionApprovalScope;
  approved_by: string;
  policy_hash: string;
  consumed_at: string | null;
  created_at: string;
  expires_at: string | null;
}

/** Full-row insert: caller supplies approval_id + created_at (backend does not stamp). */
export type NewToolPermissionApproval = Omit<ToolPermissionApprovalRow, never>;

export interface ToolPermissionApprovalLookup {
  threadId: string;
  companyId: string;
  serverName: string;
  toolName: string;
  employeeId?: string | null;
  policyHash?: string;
}

export interface ToolPermissionApprovalRepository {
  create(approval: NewToolPermissionApproval): Promise<ToolPermissionApprovalRow>;
  hasApproval(lookup: ToolPermissionApprovalLookup): Promise<boolean>;
  findReusableApproval(
    lookup: ToolPermissionApprovalLookup,
  ): Promise<ToolPermissionApprovalRow | null>;
  consumeApproval(approvalId: string, consumedAt: string): Promise<void>;
}

// ---------------------------------------------------------------------------
// Node summaries
// ---------------------------------------------------------------------------

export interface NodeSummaryRow {
  summary_id: string;
  thread_id: string;
  company_id: string;
  node_name: string;
  employee_id: string | null;
  step_index: number | null;
  summary_text: string;
  decisions_json: string;
  files_touched_json: string;
  tools_used_json: string;
  input_token_count: number;
  output_token_count: number;
  message_count: number;
  duration_ms: number;
  created_at: string;
}

/** Full-row insert: caller supplies summary_id + created_at (backend does not stamp). */
export type NewNodeSummary = Omit<NodeSummaryRow, never>;

export interface NodeSummaryRepository {
  create(summary: NewNodeSummary): Promise<NodeSummaryRow>;
  listByThread(threadId: string, opts?: { limit?: number }): Promise<NodeSummaryRow[]>;
  countByThread(threadId: string): Promise<number>;
  deleteByThread(threadId: string): Promise<void>;
  trimByThread(threadId: string, keepLatest: number): Promise<void>;
}

// ---------------------------------------------------------------------------
// Compact summaries
// ---------------------------------------------------------------------------

export interface CompactSummaryRow {
  compact_id: string;
  thread_id: string;
  company_id: string;
  compact_kind: string;
  summary_source: string;
  summary_text: string;
  pre_compact_message_count: number;
  pre_compact_token_count: number;
  messages_compacted: number;
  failure_streak: number;
  created_at: string;
}

/** Full-row insert: caller supplies compact_id + created_at (backend does not stamp). */
export type NewCompactSummary = Omit<CompactSummaryRow, never>;

export interface CompactSummaryRepository {
  create(summary: NewCompactSummary): Promise<CompactSummaryRow>;
  listByThread(threadId: string, opts?: { limit?: number }): Promise<CompactSummaryRow[]>;
  deleteByThread(threadId: string): Promise<void>;
}

// ---------------------------------------------------------------------------
// Durable interactions
// ---------------------------------------------------------------------------

export type InteractionHistoryStatus = 'resolved' | 'cancelled' | 'superseded';

export interface InteractionActiveRow {
  thread_id: string;
  company_id: string;
  interaction_id: string;
  kind: InteractionKind;
  interaction_mode: InteractionMode;
  request_json: string;
  payload_json: string | null;
  created_at: string;
  updated_at: string;
}

export type NewInteractionActive = InteractionActiveRow;

export interface ActiveInteractionRepository {
  upsert(row: NewInteractionActive): Promise<InteractionActiveRow>;
  findByThread(threadId: string): Promise<InteractionActiveRow | null>;
  findByCompany(companyId: string): Promise<InteractionActiveRow[]>;
  deleteByThread(threadId: string): Promise<void>;
}

export interface InteractionHistoryRow {
  history_id: string;
  interaction_id: string;
  thread_id: string;
  company_id: string;
  kind: InteractionKind;
  interaction_mode: InteractionMode;
  status: InteractionHistoryStatus;
  selected_option_id: string | null;
  freeform_response: string | null;
  request_json: string;
  response_json: string | null;
  payload_json: string | null;
  created_at: string;
  resolved_at: string;
}

export type NewInteractionHistory = InteractionHistoryRow;

export interface InteractionHistoryRepository {
  create(row: NewInteractionHistory): Promise<InteractionHistoryRow>;
  listByThread(threadId: string, opts?: { limit?: number }): Promise<InteractionHistoryRow[]>;
  listByCompany(companyId: string, opts?: { limit?: number }): Promise<InteractionHistoryRow[]>;
}

// ---------------------------------------------------------------------------
// File history
// ---------------------------------------------------------------------------

export type FileHistoryChangeKind = 'create' | 'update' | 'delete';

export interface FileHistoryRow {
  history_id: string;
  snapshot_id: string;
  thread_id: string;
  company_id: string;
  node_name: string | null;
  employee_id: string | null;
  task_run_id: string | null;
  tool_call_id: string;
  tool_name: string;
  step_index: number | null;
  file_path: string;
  change_kind: FileHistoryChangeKind;
  existed_before: number;
  backup_content: string | null;
  created_at: string;
}

export type NewFileHistory = FileHistoryRow;

export interface FileHistoryRepository {
  create(entry: NewFileHistory): Promise<FileHistoryRow>;
  listByThread(threadId: string, opts?: { limit?: number }): Promise<FileHistoryRow[]>;
  listBySnapshot(snapshotId: string): Promise<FileHistoryRow[]>;
  deleteByThread(threadId: string): Promise<void>;
}

// ---------------------------------------------------------------------------
// Employee version history
// ---------------------------------------------------------------------------

export type EmployeeVersionChangeType = 'create' | 'update' | 'rollback';

export interface EmployeeVersionRow {
  version_id: string;
  employee_id: string;
  version_num: number;
  change_type: EmployeeVersionChangeType;
  snapshot_json: string;
  change_summary: string | null;
  created_by: string;
  created_at: string;
}

export type NewEmployeeVersion = Omit<EmployeeVersionRow, 'version_id' | 'created_at'>;

export interface EmployeeVersionRepository {
  create(version: NewEmployeeVersion): Promise<EmployeeVersionRow>;
  findByEmployee(employeeId: string, opts?: { limit?: number }): Promise<EmployeeVersionRow[]>;
  findByVersion(employeeId: string, versionNum: number): Promise<EmployeeVersionRow | null>;
  getLatestVersionNum(employeeId: string): Promise<number>;
}

// ---------------------------------------------------------------------------
// Model cost rates
// ---------------------------------------------------------------------------

export interface ModelCostRateRow {
  rate_id: string;
  provider: string;
  model_pattern: string;
  input_cost_per_mtok: number;
  output_cost_per_mtok: number;
  effective_from: string;
  effective_until: string | null;
  created_at: string;
}

export type NewModelCostRate = Omit<ModelCostRateRow, 'rate_id' | 'created_at'>;

export interface ModelCostRateRepository {
  create(rate: NewModelCostRate): Promise<ModelCostRateRow>;
  findByProviderModel(provider: string, model: string): Promise<ModelCostRateRow | null>;
  findAll(): Promise<ModelCostRateRow[]>;
  upsert(rate: NewModelCostRate): Promise<ModelCostRateRow>;
}

export interface CompanyTemplateAssetRow {
  company_template_asset_id: string;
  company_id: string;
  template_id: string;
  name: string;
  description: string;
  template_json: string;
  source_package_id: string;
  source_asset_id: string;
  version: string | null;
  created_at: string;
  updated_at: string;
}

export type NewCompanyTemplateAsset = Omit<CompanyTemplateAssetRow, 'created_at' | 'updated_at'>;

export interface CompanyTemplateAssetRepository {
  create(template: NewCompanyTemplateAsset): Promise<CompanyTemplateAssetRow>;
  findById(companyTemplateAssetId: string): Promise<CompanyTemplateAssetRow | null>;
  findByCompany(companyId: string): Promise<CompanyTemplateAssetRow[]>;
  delete(companyTemplateAssetId: string): Promise<void>;
}

// ---------------------------------------------------------------------------
// Rack / Slot (MCP permissions)
// ---------------------------------------------------------------------------

export const RACK_STATUS = {
  unbound: 'unbound',
  bound: 'bound',
  error: 'error',
  disabled: 'disabled',
} as const;

export type RackStatus = (typeof RACK_STATUS)[keyof typeof RACK_STATUS];

export const SLOT_STATUS = {
  available: 'available',
  reserved: 'reserved',
  disabled: 'disabled',
} as const;

export type SlotStatus = (typeof SLOT_STATUS)[keyof typeof SLOT_STATUS];

export interface RackRow {
  rack_id: string;
  company_id: string;
  provider_type: string;
  label: string;
  binding_profile_json: string | null;
  status: RackStatus;
  created_at: string;
  updated_at: string;
}

export type NewRack = Omit<RackRow, 'created_at' | 'updated_at'>;

export interface SlotRow {
  slot_id: string;
  rack_id: string;
  capability_name: string;
  exposure_scope: string;
  status: SlotStatus;
  created_at: string;
  updated_at: string;
}

export type NewSlot = Omit<SlotRow, 'created_at' | 'updated_at'>;

export interface RackRepository {
  create(rack: NewRack): Promise<RackRow>;
  findById(rackId: string): Promise<RackRow | null>;
  findByCompany(companyId: string): Promise<RackRow[]>;
  updateStatus(rackId: string, status: RackStatus): Promise<void>;
  delete(rackId: string): Promise<void>;
}

export interface SlotRepository {
  create(slot: NewSlot): Promise<SlotRow>;
  findByRack(rackId: string): Promise<SlotRow[]>;
  updateStatus(slotId: string, status: SlotStatus): Promise<void>;
  delete(slotId: string): Promise<void>;
}

// ---------------------------------------------------------------------------
// Workstation-Rack bindings (PRD 2.3: desk-scoped MCP permissions)
// ---------------------------------------------------------------------------

export interface WorkstationRackRow {
  workstation_id: string;
  rack_id: string;
  created_at: string;
}

export type NewWorkstationRack = Omit<WorkstationRackRow, 'created_at'>;

export interface WorkstationRackRepository {
  /** Bind a rack to a workstation. */
  create(binding: NewWorkstationRack): Promise<WorkstationRackRow>;
  /** Get all rack IDs bound to a workstation. */
  findByWorkstation(workstationId: string): Promise<WorkstationRackRow[]>;
  /** Get all workstation IDs that reference a rack. */
  findByRack(rackId: string): Promise<WorkstationRackRow[]>;
  /** Remove a binding. */
  delete(workstationId: string, rackId: string): Promise<void>;
}

// ---------------------------------------------------------------------------
// Workstations (employee desk/seat anchors; zone-level rows use the zone id)
// ---------------------------------------------------------------------------

export interface WorkstationRow {
  workstation_id: string;
  company_id: string;
  room_type: string;
  label: string;
  position_json: string | null;
  seat_capacity: number;
  created_at: string;
  updated_at: string;
}

export type NewWorkstation = Omit<WorkstationRow, 'created_at' | 'updated_at'> & {
  created_at?: string;
  updated_at?: string;
};

export interface WorkstationRepository {
  /**
   * Create or update a workstation. Zone-level home workstations use the zone id
   * as the workstation id, so the office scene resolves an employee's seat by
   * matching `employee.workstation_id === zone.zone_id`.
   */
  upsert(workstation: NewWorkstation): Promise<WorkstationRow>;
  findById(workstationId: string): Promise<WorkstationRow | null>;
  findByCompany(companyId: string): Promise<WorkstationRow[]>;
}

// ---------------------------------------------------------------------------
// Library documents
// ---------------------------------------------------------------------------

export interface LibraryDocumentRow {
  doc_id: string;
  company_id: string;
  title: string;
  content_text: string;
  source_type: string;
  mime_type: string | null;
  file_size: number | null;
  created_at: string;
  updated_at: string;
}

export type NewLibraryDocument = Omit<LibraryDocumentRow, 'created_at' | 'updated_at'>;

export interface LibraryDocumentRepository {
  create(doc: NewLibraryDocument): Promise<LibraryDocumentRow>;
  findById(docId: string): Promise<LibraryDocumentRow | null>;
  findByCompany(companyId: string): Promise<LibraryDocumentRow[]>;
  search(
    companyId: string,
    query: string,
    opts?: { limit?: number },
  ): Promise<LibraryDocumentRow[]>;
  delete(docId: string): Promise<void>;
}

// ---------------------------------------------------------------------------
// Office layouts
// ---------------------------------------------------------------------------

export interface OfficeLayoutRow {
  layout_id: string;
  company_id: string;
  name: string;
  layout_json: string;
  is_active: number;
  created_at: string;
  updated_at: string;
}

export type NewOfficeLayout = Omit<OfficeLayoutRow, 'created_at' | 'updated_at'>;

export interface OfficeLayoutRepository {
  create(layout: NewOfficeLayout): Promise<OfficeLayoutRow>;
  findById(layoutId: string): Promise<OfficeLayoutRow | null>;
  findByCompany(companyId: string): Promise<OfficeLayoutRow[]>;
  findActive(companyId: string): Promise<OfficeLayoutRow | null>;
  setActive(companyId: string, layoutId: string): Promise<void>;
  update(
    layoutId: string,
    patch: Partial<Pick<OfficeLayoutRow, 'name' | 'layout_json'>>,
  ): Promise<void>;
  delete(layoutId: string): Promise<void>;
}

// ---------------------------------------------------------------------------
// Projects
// ---------------------------------------------------------------------------

export interface ProjectRepository {
  create(project: NewProject): Promise<ProjectRow>;
  findById(projectId: string): Promise<ProjectRow | null>;
  findByCompany(companyId: string): Promise<ProjectRow[]>;
  findActiveByCompany(companyId: string): Promise<ProjectRow[]>;
  updateStatus(projectId: string, status: ProjectStatus): Promise<void>;
  /**
   * Patch a project. Explicit `null` for `workspace_root` unbinds the folder.
   * `description` accepts `string | null` for the same reason.
   */
  update(projectId: string, patch: ProjectUpdatePatch): Promise<void>;
  delete(projectId: string): Promise<void>;
}

// ---------------------------------------------------------------------------
// Project assignments
// ---------------------------------------------------------------------------

export interface ProjectAssignmentRepository {
  assign(assignment: NewProjectAssignment): Promise<ProjectAssignmentRow>;
  unassign(projectId: string, employeeId: string): Promise<void>;
  findByProject(projectId: string): Promise<ProjectAssignmentRow[]>;
  findByEmployee(employeeId: string): Promise<ProjectAssignmentRow[]>;
  isAssigned(projectId: string, employeeId: string): Promise<boolean>;
}

// ---------------------------------------------------------------------------
// Chat threads (product-layer thread metadata; decoupled from graph_threads)
// ---------------------------------------------------------------------------

export interface ChatThreadRepository {
  create(input: NewChatThread): Promise<ChatThread>;
  findById(threadId: string): Promise<ChatThread | null>;
  /** Non-archived threads for the project, ordered by `updated_at DESC`. */
  listByProject(projectId: string): Promise<ChatThread[]>;
  /** All threads for the project, including soft-archived rows. Used by hard-delete cascades. */
  listAllByProject(projectId: string): Promise<ChatThread[]>;
  /**
   * Update the thread title.
   *
   * - When `byUser === true`, persist the title and set `title_set_by_user = 1`.
   * - When `byUser === false`, no-op if the row already has `title_set_by_user = 1`
   *   (preserves a user-set rename); otherwise persist the title and keep
   *   `title_set_by_user = 0`.
   *
   * Returns the row's persisted `title_set_by_user` after the call so callers
   * (e.g. boss auto-title) can detect a no-op without re-reading.
   */
  updateTitle(
    threadId: string,
    title: string,
    opts: { byUser: boolean },
  ): Promise<{ title: string; title_set_by_user: 0 | 1; persisted: boolean }>;
  /** Claim the thread's one semantic-title job. A manual title or an existing
   * claim refuses the write, preventing restart/retry duplicate billing. */
  beginSemanticTitleJob(input: {
    threadId: string;
    jobId: string;
    sourceProvenanceJson: string;
  }): Promise<boolean>;
  /** Persist a generated title only while this job still owns an unrenamed row. */
  completeSemanticTitleJob(input: {
    threadId: string;
    jobId: string;
    title: string;
    resultProvenanceJson: string;
    usageJson: string | null;
  }): Promise<boolean>;
  /** Close a claimed job without changing its readable fallback title. */
  failSemanticTitleJob(input: {
    threadId: string;
    jobId: string;
    errorCode: string;
  }): Promise<void>;
  /** Bumps `updated_at`. Used after activity on the thread. */
  touch(threadId: string): Promise<void>;
  /** Sets `archived_at` to now. Idempotent — no-op when already archived. */
  archive(threadId: string): Promise<void>;
  /** Clears `archived_at`. Idempotent — no-op when the row is already active or missing. */
  unarchive(threadId: string): Promise<void>;
  /** Hard delete. Callers that own an AttachmentStore must cascade blobs before invoking this. */
  delete(threadId: string): Promise<void>;
  /**
   * Idempotent: if the project has zero non-archived `chat_threads` rows,
   * insert one with `title = 'New thread'`. Returns the most-recently-updated
   * non-archived thread for the project (the freshly-created one or the
   * existing one).
   */
  ensureProjectHasAtLeastOneThread(projectId: string): Promise<ChatThread>;
}

// ---------------------------------------------------------------------------
// Agent events (event sourcing)
// ---------------------------------------------------------------------------

export interface AgentEventRow {
  event_id: string;
  project_id: string | null;
  thread_id: string;
  company_id: string;
  agent_name: string;
  event_type: string;
  payload_json: string;
  parent_event_id: string | null;
  created_at: string;
}

export type NewAgentEvent = Omit<AgentEventRow, 'created_at'> & { created_at?: string };

export interface AgentEventRepository {
  append(event: NewAgentEvent): Promise<AgentEventRow>;
  findByProject(
    projectId: string,
    opts?: { limit?: number; eventType?: string },
  ): Promise<AgentEventRow[]>;
  findByThread(
    threadId: string,
    opts?: { limit?: number; eventType?: string },
  ): Promise<AgentEventRow[]>;
  findByAgent(
    agentName: string,
    opts?: { limit?: number; eventType?: string },
  ): Promise<AgentEventRow[]>;
  findCausalChain(eventId: string): Promise<AgentEventRow[]>;
  /** Recent events across all agents for a thread — used by Recovery Agent for context. */
  findRecent(threadId: string, limit: number): Promise<AgentEventRow[]>;
}

// ---------------------------------------------------------------------------
// Deliverables (structured artifact history)
// ---------------------------------------------------------------------------

export type DeliverableKind = 'document' | 'file';

/** Validates an untyped SQLite TEXT value against the `DeliverableKind` union. */
export function coerceDeliverableKind(raw: string | null): DeliverableKind | null {
  return raw === 'document' || raw === 'file' ? raw : null;
}

export interface DeliverableContributor {
  employeeId: string;
  employeeName: string;
  sourceKind?: 'employee';
  roleSlug: RoleSlug;
  isExternal: boolean;
  brandKey: string | null;
}

export function employeeBrandFields(e: {
  is_external: number;
  brand_key: string | null;
}): { isExternal: boolean; brandKey: string | null } {
  return { isExternal: e.is_external === 1, brandKey: e.brand_key ?? null };
}

export interface DeliverableRow {
  deliverable_id: string;
  company_id: string;
  thread_id: string | null;
  chat_thread_id: string | null;
  title: string;
  content: string;
  kind: DeliverableKind | null;
  file_name: string | null;
  mime_type: string | null;
  /** JSON-stringified DeliverableContributor[] */
  contributors_json: string;
  created_at: string;
  /** Run that produced this deliverable (agent_runs.run_id), or null. */
  run_id: string | null;
  /** Hex sha256 of `content` at insert time, or null. */
  content_hash: string | null;
  /** Monotonic version for a logical artifact; starts at 1. */
  version: number;
}

/** Full-row insert: caller supplies deliverable_id + created_at (backend does not stamp). */
export type NewDeliverable = Omit<DeliverableRow, never>;

/** Metadata-only projection — `content` is omitted; `content_size` is byte length. */
export type DeliverableSummaryRow = Omit<DeliverableRow, 'content'> & {
  content_size: number;
};

export interface DeliverableRepository {
  /** Idempotent insert keyed on deliverable_id (INSERT OR IGNORE semantics). */
  insert(row: NewDeliverable): Promise<void>;
  /** Returns the full row including content, or null if not found. */
  findById(deliverableId: string): Promise<DeliverableRow | null>;
  /**
   * Lists deliverables for a company, newest first. Excludes `content`; rows
   * carry `content_size` (UTF-8 byte length) instead. Default limit is 100.
   */
  listByCompany(
    companyId: string,
    opts?: { threadId?: string; limit?: number },
  ): Promise<DeliverableSummaryRow[]>;
  /** Like `listByCompany` but returns full rows (content included) in one round-trip. */
  listByCompanyWithContent(
    companyId: string,
    opts?: { threadId?: string; limit?: number },
  ): Promise<DeliverableRow[]>;
  /**
   * Deliverables published under a given run (the `run_id` column added in
   * VM-002), newest first. Excludes `content`. Used by the Mission evaluation
   * context (MS-005) to back the `artifact_published` evaluator with the
   * attempt's published artifacts.
   */
  listByRunId(runId: string, opts?: { limit?: number }): Promise<DeliverableSummaryRow[]>;
}

// ---------------------------------------------------------------------------
// Verified Missions core (PRD §17). Snake_case rows mirror the SQLite columns;
// the camelCase domain model lives in `@offisim/shared-types` mission module.
// Mission status/criteria truth is here (ADR 2026-06-25-truth-closure D4);
// evaluation truth is `mission_evaluation`.
// ---------------------------------------------------------------------------

export interface MissionRow {
  mission_id: string;
  company_id: string;
  project_id: string | null;
  thread_id: string;
  title: string;
  goal: string;
  status: string;
  runtime_id: string;
  runtime_policy_json: string;
  budget_json: string;
  expected_artifacts_json: string | null;
  current_attempt_id: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
}

export type NewMission = MissionRow;

export interface MissionCriterionRow {
  criterion_id: string;
  mission_id: string;
  description: string;
  evaluator_id: string;
  evaluator_config_json: string;
  /** 0 | 1 — required criteria must pass for Mission completion. */
  required: number;
  order_index: number;
  status: string;
  last_evaluation_id: string | null;
}

export type NewMissionCriterion = MissionCriterionRow;

export interface MissionAttemptRow {
  attempt_id: string;
  mission_id: string;
  attempt_number: number;
  root_run_id: string | null;
  runtime_session_link_id: string | null;
  trigger: string;
  status: string;
  failure_signature: string | null;
  started_at: string;
  finished_at: string | null;
}

export type NewMissionAttempt = MissionAttemptRow;

export interface MissionEvaluationRow {
  evaluation_id: string;
  mission_id: string;
  criterion_id: string;
  attempt_id: string;
  evaluator_id: string;
  verdict: string;
  summary: string;
  evidence_refs_json: string;
  duration_ms: number | null;
  created_at: string;
}

export type NewMissionEvaluation = MissionEvaluationRow;

export interface RuntimeSessionLinkRow {
  runtime_session_link_id: string;
  mission_id: string;
  runtime_id: string;
  runtime_version: string | null;
  opaque_session_ref_json: string;
  compatibility_hash: string | null;
  workspace_lease_id: string | null;
  last_safe_boundary: string | null;
  status: string;
}

export type NewRuntimeSessionLink = RuntimeSessionLinkRow;

export interface MissionEventRow {
  mission_event_id: string;
  mission_id: string;
  attempt_id: string | null;
  type: string;
  data_json: string;
  created_at: string;
}

export type NewMissionEvent = MissionEventRow;

/** Patch for mission mutations driven by the state machine. */
export interface MissionStatusUpdate {
  status: string;
  /** ISO timestamp to stamp `updated_at`; caller supplies (backend does not auto-stamp). */
  updatedAt: string;
  currentAttemptId?: string | null;
  completedAt?: string | null;
  /**
   * Compare-and-swap guard (A4). When set, the update only applies if the row's
   * CURRENT `status` equals `expectedStatus`; otherwise it is a no-op. This
   * closes the lost-update race where a concurrent cancel is silently
   * overwritten by a stale verifying/repairing write. `undefined` → no guard
   * (unconditional update, kept for non-racing callers).
   */
  expectedStatus?: string;
}

export interface MissionRepository {
  /** Idempotent insert keyed on mission_id (INSERT OR IGNORE semantics). */
  insert(row: NewMission): Promise<void>;
  /** Delete the Mission aggregate root. Persistent backends cascade every child row. */
  delete(missionId: string): Promise<void>;
  findById(missionId: string): Promise<MissionRow | null>;
  listByCompany(companyId: string, opts?: { limit?: number }): Promise<MissionRow[]>;
  /**
   * All missions for a company whose `status` is in `statuses`, UNBOUNDED (no
   * default 100-row cap). Crash-recovery reconciliation (DR-003) uses this to
   * fetch every non-terminal mission (running/verifying/repairing): a company
   * with >100 missions must not silently drop a crashed one beyond the
   * `listByCompany` default limit, or it would stay stuck forever. Order is
   * unspecified — the caller reconciles each mission independently.
   */
  listByStatus(companyId: string, statuses: readonly string[]): Promise<MissionRow[]>;
  /**
   * Apply a status patch. Returns `true` when a row was updated, `false` when
   * the compare-and-swap guard (`patch.expectedStatus`) did not match the row's
   * current status or the row does not exist (A4). With no `expectedStatus` the
   * update is unconditional and returns `true` iff the row exists.
   */
  updateStatus(missionId: string, patch: MissionStatusUpdate): Promise<boolean>;
}

export interface MissionCriterionRepository {
  insert(row: NewMissionCriterion): Promise<void>;
  findById(criterionId: string): Promise<MissionCriterionRow | null>;
  listByMission(missionId: string): Promise<MissionCriterionRow[]>;
  updateStatus(criterionId: string, status: string): Promise<void>;
  setLastEvaluation(criterionId: string, evaluationId: string | null): Promise<void>;
}

export interface MissionAttemptRepository {
  insert(row: NewMissionAttempt): Promise<void>;
  findById(attemptId: string): Promise<MissionAttemptRow | null>;
  listByMission(missionId: string): Promise<MissionAttemptRow[]>;
  updateStatus(
    attemptId: string,
    status: string,
    opts?: { failureSignature?: string | null; finishedAt?: string | null },
  ): Promise<void>;
  /**
   * Stamp the attempt's root agent run id once the live runner knows it
   * (M2/M3 live wiring). `runId === attemptId` by design, so this records the
   * `agent_runs.run_id` that produced the attempt — enabling cross-table joins
   * for usage/cost and future durable recovery. No-op if the attempt is absent.
   */
  setRootRunId(attemptId: string, rootRunId: string): Promise<void>;
}

export interface MissionEvaluationRepository {
  insert(row: NewMissionEvaluation): Promise<void>;
  findById(evaluationId: string): Promise<MissionEvaluationRow | null>;
  listByMission(missionId: string): Promise<MissionEvaluationRow[]>;
  listByAttempt(attemptId: string): Promise<MissionEvaluationRow[]>;
}

export interface RuntimeSessionLinkRepository {
  insert(row: NewRuntimeSessionLink): Promise<void>;
  findById(runtimeSessionLinkId: string): Promise<RuntimeSessionLinkRow | null>;
  listByMission(missionId: string): Promise<RuntimeSessionLinkRow[]>;
  update(
    runtimeSessionLinkId: string,
    patch: Partial<
      Pick<
        RuntimeSessionLinkRow,
        'status' | 'compatibility_hash' | 'workspace_lease_id' | 'last_safe_boundary'
      >
    >,
  ): Promise<void>;
}

export interface MissionEventRepository {
  insert(row: NewMissionEvent): Promise<void>;
  listByMission(missionId: string, opts?: { limit?: number }): Promise<MissionEventRow[]>;
}

// ---------------------------------------------------------------------------
// Loop domain (PR-07). A saveable, versioned, reusable wrapper around the Mission
// engine. Snake_case rows mirror the SQLite columns; the camelCase domain model
// lives in `@offisim/shared-types` loops module. Definitions point at an immutable
// selected revision; every edit appends a `loop_revisions` row (INSERT-ONLY — the
// repository exposes NO update/delete for a revision). SAVING a Loop writes ONLY
// these tables, never mission / chat_threads / mission_attempt.
// ---------------------------------------------------------------------------

export interface LoopDefinitionRow {
  loop_id: string;
  company_id: string;
  title: string;
  summary: string;
  profile_id: string;
  current_revision_id: string | null;
  status: string;
  schedule_interval_minutes: number | null;
  next_run_at: string | null;
  last_run_at: string | null;
  last_run_result: string | null;
  created_at: string;
  updated_at: string;
}

export type NewLoopDefinition = LoopDefinitionRow;

export interface LoopRevisionRow {
  revision_id: string;
  loop_id: string;
  revision_number: number;
  source_prompt: string;
  enhanced_prompt: string | null;
  compiled_ir_json: string;
  compiler_profile_id: string;
  compiler_profile_version: string;
  compiler_version: string;
  compile_status: string;
  questions_json: string;
  validation_json: string;
  created_at: string;
}

export type NewLoopRevision = LoopRevisionRow;

export interface LoopSkillBindingRow {
  binding_id: string;
  revision_id: string;
  skill_id: string;
  skill_version: string;
  order_index: number;
  config_json: string;
}

export type NewLoopSkillBinding = LoopSkillBindingRow;

export interface LoopInvocationRow {
  invocation_id: string;
  loop_id: string;
  revision_id: string;
  company_id: string;
  project_id: string | null;
  thread_id: string;
  message_id: string;
  mission_id: string | null;
  status: string;
  created_at: string;
}

export type NewLoopInvocation = LoopInvocationRow;

/** Patch for the mutable definition fields (title/summary/status/selected revision). */
export interface LoopDefinitionUpdate {
  title?: string;
  summary?: string;
  status?: string;
  /** `null` clears the selected revision; `undefined` leaves it unchanged. */
  currentRevisionId?: string | null;
  scheduleIntervalMinutes?: number | null;
  nextRunAt?: string | null;
  lastRunAt?: string | null;
  lastRunResult?: string | null;
  /** ISO timestamp to stamp `updated_at`; caller supplies. */
  updatedAt: string;
}

export interface LoopDefinitionRepository {
  /** Idempotent insert keyed on loop_id (INSERT OR IGNORE semantics). */
  insert(row: NewLoopDefinition): Promise<void>;
  findById(loopId: string): Promise<LoopDefinitionRow | null>;
  listByCompany(companyId: string, opts?: { limit?: number }): Promise<LoopDefinitionRow[]>;
  /** Patch the mutable definition fields (never the revisions — those are insert-only). */
  update(loopId: string, patch: LoopDefinitionUpdate): Promise<void>;
  /**
   * Compare-and-swap one exact scheduler slot. On success, advances next_run_at
   * before any external run side effect and records a durable `Starting` claim.
   */
  claimScheduledRun(
    loopId: string,
    expectedNextRunAt: string,
    claim: { claimedAt: string; nextRunAt: string },
  ): Promise<boolean>;
  /**
   * Physically delete a definition. The SERVICE forbids this when invocation
   * history exists (archive instead); the repo method itself is unconditional so
   * the service owns the policy. Cascades revisions + bindings via FK.
   */
  delete(loopId: string): Promise<void>;
}

export interface LoopRevisionRepository {
  /** Insert-only. There is intentionally NO update/delete for a revision. */
  insert(row: NewLoopRevision): Promise<void>;
  findById(revisionId: string): Promise<LoopRevisionRow | null>;
  listByLoop(loopId: string): Promise<LoopRevisionRow[]>;
  /**
   * The highest `revision_number` for a loop, or 0 when none exist. Callers add 1
   * for the next monotonic number; the UNIQUE(loop_id, revision_number) index is
   * the authority that rejects a duplicate under a concurrent save.
   */
  maxRevisionNumber(loopId: string): Promise<number>;
}

export interface LoopSkillBindingRepository {
  insert(row: NewLoopSkillBinding): Promise<void>;
  listByRevision(revisionId: string): Promise<LoopSkillBindingRow[]>;
}

export interface LoopInvocationRepository {
  /** Written ONLY at Office Send materialization (PR-10), never on Save/Use. */
  insert(row: NewLoopInvocation): Promise<void>;
  findById(invocationId: string): Promise<LoopInvocationRow | null>;
  listByLoop(loopId: string): Promise<LoopInvocationRow[]>;
  /** Count invocations for a loop — the service uses this to refuse a physical delete. */
  countByLoop(loopId: string): Promise<number>;
  /** Stamp the Mission this invocation materialized into (PR-10). */
  setMissionId(invocationId: string, missionId: string): Promise<void>;
  /**
   * Hard-delete an invocation row (PR-10 send-time compensation). Used ONLY to undo
   * a just-inserted invocation when the rest of the Send transaction (mission
   * create / link) fails — so a failed send leaves NO orphan. Idempotent: deleting
   * a missing id is a no-op.
   */
  deleteById(invocationId: string): Promise<void>;
}

// ---------------------------------------------------------------------------
// Collaboration (PR-02). Company-scoped daily chat (direct + group), fully
// separate from project-scoped `chat_threads`. Snake_case rows mirror the
// SQLite columns; the camelCase domain model lives in `@offisim/shared-types`
// collaboration module. NO method here accepts or returns `project_id`.
// ---------------------------------------------------------------------------

export interface CollaborationThreadRow {
  thread_id: string;
  company_id: string;
  kind: string;
  title: string;
  direct_employee_id: string | null;
  reply_policy: string;
  capability_profile: string;
  round_speaker_limit: number;
  created_by: string;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
}

export type NewCollaborationThread = CollaborationThreadRow;

export interface CollaborationThreadMemberRow {
  member_id: string;
  thread_id: string;
  actor_type: string;
  employee_id: string | null;
  role: string;
  joined_at: string;
  left_at: string | null;
}

export type NewCollaborationThreadMember = CollaborationThreadMemberRow;

export interface CollaborationMessageRow {
  message_id: string;
  thread_id: string;
  sender_type: string;
  sender_employee_id: string | null;
  body: string;
  reply_to_message_id: string | null;
  status: string;
  /**
   * Double-send idempotency key, deduped by a partial-unique index per thread.
   * A dedicated column (not a metadata field) so a concurrent second append
   * fails at the DB layer and the service catch-rereads the single winner.
   */
  idempotency_key: string | null;
  metadata_json: string | null;
  created_at: string;
  edited_at: string | null;
}

export type NewCollaborationMessage = CollaborationMessageRow;

export interface CollaborationReadStateRow {
  thread_id: string;
  last_read_message_id: string | null;
  updated_at: string;
}

/**
 * A collaboration turn ledger row (PR-03). Records one scheduled AI reply's
 * lifecycle (streaming / error / usage recovery) — NOT a transcript copy. The
 * visible message lives in `collaboration_messages`; this row exists so a stop /
 * retry / recovery pass can reason about an in-flight speaker turn.
 */
export interface CollaborationTurnRow {
  turn_id: string;
  thread_id: string;
  trigger_message_id: string | null;
  employee_id: string | null;
  sequence_index: number;
  status: string;
  runtime_request_id: string | null;
  usage_json: string | null;
  error_summary: string | null;
  started_at: string | null;
  finished_at: string | null;
}

export type NewCollaborationTurn = CollaborationTurnRow;

/** Patch for the mutable turn fields the controller advances over a turn's life. */
export interface CollaborationTurnPatch {
  status?: string;
  runtime_request_id?: string | null;
  usage_json?: string | null;
  error_summary?: string | null;
  started_at?: string | null;
  finished_at?: string | null;
}

/**
 * Patch for the mutable fields of an existing collaboration message (PR-03
 * streaming upsert). Only `body` / `status` / `edited_at` are mutable; the keyset
 * (`created_at`, `message_id`) is immutable so pagination never shifts.
 */
export interface CollaborationMessagePatch {
  body?: string;
  status?: string;
  edited_at?: string | null;
}

/** Patch for the small set of mutable thread fields the service updates. */
export interface CollaborationThreadPatch {
  title?: string;
  reply_policy?: string;
  capability_profile?: string;
  round_speaker_limit?: number;
  archived_at?: string | null;
  updated_at: string;
}

export interface CollaborationThreadRepository {
  /** Idempotent insert keyed on thread_id (INSERT OR IGNORE semantics). */
  insert(row: NewCollaborationThread): Promise<void>;
  findById(threadId: string): Promise<CollaborationThreadRow | null>;
  /**
   * The single ACTIVE direct thread for `(companyId, employeeId)`, or null. Used
   * by `getOrCreateDirect` to enforce the active-direct uniqueness invariant
   * before inserting.
   */
  findActiveDirect(companyId: string, employeeId: string): Promise<CollaborationThreadRow | null>;
  /**
   * The most-recently-archived direct thread for `(companyId, employeeId)`, or
   * null. `getOrCreateDirect` restores this instead of creating a duplicate.
   */
  findArchivedDirect(companyId: string, employeeId: string): Promise<CollaborationThreadRow | null>;
  /** Non-archived threads for the company; caller orders by last activity. */
  listByCompany(companyId: string): Promise<CollaborationThreadRow[]>;
  update(threadId: string, patch: CollaborationThreadPatch): Promise<void>;
}

export interface CollaborationMemberRepository {
  insert(row: NewCollaborationThreadMember): Promise<void>;
  /** Active members (left_at IS NULL) of the thread. */
  listActiveByThread(threadId: string): Promise<CollaborationThreadMemberRow[]>;
  /** All members of the thread, including those that left. */
  listAllByThread(threadId: string): Promise<CollaborationThreadMemberRow[]>;
  /** Mark a member as left at `leftAt` (idempotent — no-op if already left). */
  markLeft(memberId: string, leftAt: string): Promise<void>;
}

export interface CollaborationMessageRepository {
  insert(row: NewCollaborationMessage): Promise<void>;
  findById(messageId: string): Promise<CollaborationMessageRow | null>;
  /**
   * Look up a previously-appended message by its `idempotency_key` column value
   * (a dedicated column deduped by a partial-unique index — NOT a metadata
   * field), scoped to the thread. Backs append idempotency.
   */
  findByIdempotencyKey(
    threadId: string,
    idempotencyKey: string,
  ): Promise<CollaborationMessageRow | null>;
  /**
   * One page of messages for the thread, NEWEST first, keyset-paginated by
   * `(created_at, message_id)`. `before` returns rows strictly older than the
   * cursor — no duplicates across pages, no gaps. `limit` rows are returned.
   */
  listByThread(
    threadId: string,
    opts?: {
      limit?: number;
      before?: { createdAt: string; messageId: string };
    },
  ): Promise<CollaborationMessageRow[]>;
  /** The newest message in the thread, or null. Used for list ordering. */
  findLatestByThread(threadId: string): Promise<CollaborationMessageRow | null>;
  /** Count messages strictly newer than `messageId` — backs unread computation. */
  countSince(threadId: string, messageId: string | null): Promise<number>;
  /**
   * Update an EXISTING message's mutable fields (PR-03 streaming upsert). The
   * collaboration turn controller inserts a `streaming` placeholder under a stable
   * `message_id`, then advances `body` / `status` / `edited_at` as the reply
   * settles — so the visible row stays authoritative across stop / retry / failure
   * without re-inserting. A no-op when the message id is absent. Never moves the
   * keyset (`created_at` / `message_id` are immutable here).
   */
  update(messageId: string, patch: CollaborationMessagePatch): Promise<void>;
}

export interface CollaborationReadStateRepository {
  findByThread(threadId: string): Promise<CollaborationReadStateRow | null>;
  /** Upsert the last-read boundary for the thread. */
  upsert(row: CollaborationReadStateRow): Promise<void>;
}

export interface CollaborationTurnRepository {
  /** Idempotent insert keyed on turn_id (INSERT OR IGNORE semantics). */
  insert(row: NewCollaborationTurn): Promise<void>;
  findById(turnId: string): Promise<CollaborationTurnRow | null>;
  /** The thread's turns in speaker order (ascending sequence_index). */
  listByThread(threadId: string): Promise<CollaborationTurnRow[]>;
  /** Advance a turn's lifecycle fields (status / usage / error / timestamps). */
  update(turnId: string, patch: CollaborationTurnPatch): Promise<void>;
}

// ---------------------------------------------------------------------------
// Settings (generic key-value for one-shot bootstrap markers)
// ---------------------------------------------------------------------------

export interface SettingsRepository {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
}

// ---------------------------------------------------------------------------
// Skills (two-tier: company-global + employee-specific)
// ---------------------------------------------------------------------------

export type { SkillRow, SkillScope, SkillSourceKind };

export type NewSkill = SkillRow;

export type SkillUpdate = Partial<
  Pick<
    SkillRow,
    'name' | 'description' | 'version' | 'source_kind' | 'source_ref' | 'vault_path' | 'updated_at'
  >
>;

export interface SkillRepository {
  insert(row: NewSkill): Promise<void>;
  update(skillId: string, patch: SkillUpdate): Promise<void>;
  delete(skillId: string): Promise<void>;
  findById(skillId: string): Promise<SkillRow | null>;
  /** Every skill in the company, irrespective of scope — caller partitions by `row.scope` / `row.employee_id`. */
  listByCompany(companyId: string): Promise<SkillRow[]>;
  listByCompanyScope(companyId: string): Promise<SkillRow[]>;
  listByEmployee(companyId: string, employeeId: string): Promise<SkillRow[]>;
  findBySlug(companyId: string, employeeId: string | null, slug: string): Promise<SkillRow | null>;
}

// ---------------------------------------------------------------------------
// Recovery knowledge (persistent learning)
// ---------------------------------------------------------------------------

export interface RecoveryKnowledgeRow {
  knowledge_id: string;
  symptom: string;
  cause: string;
  fix_strategy: string;
  fix_config: string | null;
  success_count: number;
  failure_count: number;
  last_used_at: string | null;
  created_at: string;
}

export type NewRecoveryKnowledge = Omit<
  RecoveryKnowledgeRow,
  'success_count' | 'failure_count' | 'last_used_at' | 'created_at'
>;

export interface RecoveryKnowledgeRepository {
  upsert(entry: NewRecoveryKnowledge): Promise<RecoveryKnowledgeRow>;
  findBySymptom(symptom: string): Promise<RecoveryKnowledgeRow[]>;
  findBestFix(symptom: string): Promise<RecoveryKnowledgeRow | null>;
  incrementSuccess(knowledgeId: string): Promise<void>;
  incrementFailure(knowledgeId: string): Promise<void>;
  findAll(opts?: { limit?: number }): Promise<RecoveryKnowledgeRow[]>;
}

/** A persisted pi-kernel transcript message row (table `pi_messages`). */
export interface PiMessageRow {
  message_id: string;
  thread_id: string;
  company_id: string;
  /** Worker that owns this thread turn (null = boss). Used to resume as the right worker. */
  employee_id: string | null;
  seq: number;
  role: string;
  message_json: string;
  created_at: string;
}

/** Per-message persistence for the pi agent loop (replaces graph checkpoints). */
export interface PiMessageRepository {
  listByThread(threadId: string): Promise<PiMessageRow[]>;
  append(rows: readonly PiMessageRow[]): Promise<void>;
  /** Highest persisted seq for the thread, or -1 when empty. */
  maxSeq(threadId: string): Promise<number>;
  /** `employee_id` of the thread's last row (null = boss / empty) — for resume. */
  lastEmployeeId(threadId: string): Promise<string | null>;
  /** Delete the oldest persisted rows for a thread, preserving seq values of the remaining tail. */
  deleteFirstByThread(threadId: string, count: number): Promise<void>;
  deleteByThread(threadId: string): Promise<void>;
}

/** Aggregated access point */
export interface RuntimeRepositories {
  companies: CompanyRepository;
  threads: ThreadRepository;
  taskRuns: TaskRunRepository;
  employees: EmployeeRepository;
  toolCalls: ToolCallRepository;
  handoffs: HandoffRepository;
  meetings: MeetingRepository;
  events: EventRepository;
  llmCalls: LlmCallRepository;
  installTransactions: InstallTransactionRepository;
  installedPackages: InstalledPackageRepository;
  installedAssets: InstalledAssetRepository;
  assetBindings: AssetBindingRepository;
  memories: MemoryRepository;
  mcpAudit: McpAuditRepository;
  mcpToolGrants: McpToolGrantRepository;
  toolPermissionApprovals: ToolPermissionApprovalRepository;
  nodeSummaries: NodeSummaryRepository;
  compactSummaries: CompactSummaryRepository;
  activeInteractions: ActiveInteractionRepository;
  interactionHistory: InteractionHistoryRepository;
  fileHistory: FileHistoryRepository;
  employeeVersions: EmployeeVersionRepository;
  costRates: ModelCostRateRepository;
  companyTemplates: CompanyTemplateAssetRepository;
  racks: RackRepository;
  slots: SlotRepository;
  workstationRacks: WorkstationRackRepository;
  libraryDocuments: LibraryDocumentRepository;
  officeLayouts: OfficeLayoutRepository;
  prefabInstances: PrefabInstanceRepository;
  zones: ZoneRepository;
  /** Workstation rows (zone-level home seats + future desk anchors). */
  workstations: WorkstationRepository;
  projects: ProjectRepository;
  projectAssignments: ProjectAssignmentRepository;
  chatThreads: ChatThreadRepository;
  /** Agent event sourcing. */
  agentEvents: AgentEventRepository;
  /** Recovery knowledge base. */
  recoveryKnowledge: RecoveryKnowledgeRepository;
  /** Deliverable artifact history. */
  deliverables: DeliverableRepository;
  /** Two-tier skills (company-global + employee-specific). */
  skills: SkillRepository;
  /** Generic key-value settings (bootstrap markers). */
  settings: SettingsRepository;
  /**
   * Wraps a synchronous callback in a DB transaction.
   * Only available on Drizzle (better-sqlite3) repos — memory repos omit this.
   * All repo .run() calls inside the callback share the same SQLite transaction.
   */
  transact?<T>(fn: () => T): T;
  /**
   * Async variant of {@link transact}. Available on every backend (Drizzle,
   * Tauri sqlite-proxy, in-memory). Use this whenever a multi-write flow
   * needs to run inside one logical transaction and the body has any awaits.
   *
   * - Drizzle (Node): wraps in a real `better-sqlite3` transaction.
   * - Tauri sqlite-proxy: queues writes and commits them in a single
   *   `local_db_execute_transaction` IPC call. SELECTs inside the callback
   *   read committed state (no read-your-own-write isolation).
   * - In-memory: no-op — calls fn() directly.
   */
  asyncTransact<T>(fn: (txRepos?: RuntimeRepositories) => Promise<T>): Promise<T>;

  /** pi-kernel per-message transcript persistence. */
  piMessages: PiMessageRepository;
  /** Multi-agent delegation run tree. */
  agentRuns: AgentRunRepository;
  /** Verified Missions core (PRD §17). */
  missions: MissionRepository;
  missionCriteria: MissionCriterionRepository;
  missionAttempts: MissionAttemptRepository;
  missionEvaluations: MissionEvaluationRepository;
  runtimeSessionLinks: RuntimeSessionLinkRepository;
  missionEvents: MissionEventRepository;
  /** Loop domain (PR-07). */
  loopDefinitions: LoopDefinitionRepository;
  loopRevisions: LoopRevisionRepository;
  loopSkillBindings: LoopSkillBindingRepository;
  loopInvocations: LoopInvocationRepository;
  /** Company-scoped Collaboration chat (PR-02). */
  collaborationThreads: CollaborationThreadRepository;
  collaborationMembers: CollaborationMemberRepository;
  collaborationMessages: CollaborationMessageRepository;
  collaborationReadState: CollaborationReadStateRepository;
  collaborationTurns: CollaborationTurnRepository;
}
