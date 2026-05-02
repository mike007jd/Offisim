import type { NewEmployee } from '@offisim/install-core';
import type {
  InteractionKind,
  InteractionMode,
  KanbanOrigin,
  KanbanState,
  RoleSlug,
  SkillRow,
  SkillScope,
  SkillSourceKind,
} from '@offisim/shared-types';
import type {
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
  default_model_policy_json: string | null;
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

export interface KanbanCardRow {
  id: string;
  project_id: string;
  company_id: string;
  title: string;
  note: string;
  state: KanbanState;
  origin: KanbanOrigin;
  created_by_employee_id: string | null;
  assigned_employee_id: string | null;
  parent_card_id: string | null;
  blocked_reason: string | null;
  task_run_id: string | null;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export type NewKanbanCard = Pick<KanbanCardRow, 'project_id' | 'company_id' | 'title' | 'origin'> &
  Partial<
    Pick<
      KanbanCardRow,
      | 'id'
      | 'note'
      | 'state'
      | 'created_by_employee_id'
      | 'assigned_employee_id'
      | 'parent_card_id'
      | 'blocked_reason'
      | 'task_run_id'
      | 'sort_order'
    >
  >;

export interface KanbanRepository {
  create(input: NewKanbanCard): Promise<KanbanCardRow>;
  transition(
    id: string,
    next: KanbanState,
    blockedReason?: string | null,
  ): Promise<KanbanCardRow | null>;
  transitionByTaskRun(
    taskRunId: string,
    next: KanbanState,
    blockedReason?: string | null,
  ): Promise<void>;
  listByProject(projectId: string): Promise<KanbanCardRow[]>;
  listByEmployee(employeeId: string, state?: KanbanState): Promise<KanbanCardRow[]>;
  assign(id: string, employeeId: string): Promise<void>;
}

export interface GraphCheckpointRow {
  checkpoint_id: string;
  thread_id: string;
  checkpoint_seq: number;
  checkpoint_kind: string;
  payload_json: string;
  created_at: string;
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
export type NewToolCall = Omit<ToolCallRow, 'finished_at'>;
export type NewHandoffEvent = Omit<HandoffEventRow, never>;
export type NewMeetingSession = Omit<MeetingSessionRow, never>;
export type NewGraphCheckpoint = Omit<GraphCheckpointRow, never>;
export type NewRuntimeEvent = Omit<RuntimeEventRow, never>;

/** Repository interfaces */

export interface CompanyRepository {
  findById(companyId: string): Promise<CompanyRow | null>;
  findAll(): Promise<CompanyRow[]>;
  create(company: CompanyRow): Promise<CompanyRow>;
  update(
    companyId: string,
    fields: Partial<
      Pick<
        CompanyRow,
        'name' | 'status' | 'template_id' | 'template_label' | 'default_model_policy_json'
      >
    >,
  ): Promise<void>;
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

/** Updatable fields for an employee. */
export type EmployeeUpdate = Partial<
  Pick<
    EmployeeRow,
    | 'name'
    | 'role_slug'
    | 'persona_json'
    | 'config_json'
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

export interface EmployeeRepository {
  create(employee: NewEmployee): Promise<{ employee_id: string }>;
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
  updateStatus(meetingId: string, status: string, summaryJson?: string | null): Promise<void>;
}

/**
 * @reserved Phase 3+ — Business-level execution snapshots.
 *
 * Maps to `graph_checkpoints` table. Stores business milestones
 * (meeting_turn, task_boundary, install_gate), NOT LangGraph internal state.
 *
 * LangGraph checkpoint persistence is handled by SqliteSaver
 * (via createCheckpointSaver in graph/checkpoint-saver.ts).
 *
 * This interface and its implementations (Drizzle + Memory) are retained
 * for Phase 3 when execution snapshot writing is implemented.
 */
export interface CheckpointRepository {
  save(checkpoint: NewGraphCheckpoint): Promise<void>;
  findLatest(threadId: string): Promise<GraphCheckpointRow | null>;
  findBySeq(threadId: string, seq: number): Promise<GraphCheckpointRow | null>;
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
    opts?: { category?: string; limit?: number },
  ): Promise<MemoryEntryRow[]>;
  reinforce(memoryId: string, patch: MemoryReinforcementPatch): Promise<MemoryEntryRow | null>;
  touchAccess(memoryId: string): Promise<void>;
}

// ---------------------------------------------------------------------------
// User Preferences (cross-session user-level memory)
// ---------------------------------------------------------------------------

export type UserPreferenceCategory = 'preference' | 'context' | 'knowledge' | 'behavior' | 'goal';

export interface UserPreferenceRow {
  preference_id: string;
  company_id: string;
  category: UserPreferenceCategory;
  content: string;
  confidence: number;
  importance: number;
  source: 'explicit' | 'inferred';
  dedupe_key: string | null;
  reinforcement_count: number;
  access_count: number;
  source_thread_id: string | null;
  created_at: string;
  accessed_at: string;
}

export interface UserPreferenceCreate {
  preference_id: string;
  company_id: string;
  category: UserPreferenceCategory;
  content: string;
  confidence?: number;
  importance?: number;
  source: 'explicit' | 'inferred';
  dedupe_key?: string | null;
  source_thread_id?: string | null;
}

export interface UserPreferenceRepository {
  create(entry: UserPreferenceCreate): Promise<UserPreferenceRow>;
  findByCompany(
    companyId: string,
    opts?: { category?: UserPreferenceCategory; limit?: number },
  ): Promise<UserPreferenceRow[]>;
  findByDedupeKey(companyId: string, dedupeKey: string): Promise<UserPreferenceRow | null>;
  reinforce(preferenceId: string): Promise<void>;
  touchAccess(preferenceId: string): Promise<void>;
  delete(preferenceId: string): Promise<void>;
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
  approved_by: string;
  created_at: string;
}

export type NewMcpAudit = McpAuditRow;

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

export type NewToolPermissionApproval = ToolPermissionApprovalRow;

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

export type NewNodeSummary = NodeSummaryRow;

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

export type NewCompactSummary = CompactSummaryRow;

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

// ---------------------------------------------------------------------------
// SOP Templates
// ---------------------------------------------------------------------------

export interface SopTemplateRow {
  sop_template_id: string;
  company_id: string;
  name: string;
  description: string;
  definition_json: string;
  source_thread_id: string | null;
  source_url: string | null;
  version: string | null;
  last_synced_at: string | null;
  created_at: string;
  updated_at: string;
}

export type NewSopTemplate = Omit<SopTemplateRow, 'created_at' | 'updated_at'>;

export type SopTemplateUpdate = Partial<
  Pick<
    SopTemplateRow,
    'name' | 'description' | 'definition_json' | 'source_url' | 'version' | 'last_synced_at'
  >
>;

export interface SopTemplateRepository {
  create(template: NewSopTemplate): Promise<SopTemplateRow>;
  findById(sopTemplateId: string): Promise<SopTemplateRow | null>;
  findByCompany(companyId: string): Promise<SopTemplateRow[]>;
  update(sopTemplateId: string, patch: SopTemplateUpdate): Promise<void>;
  delete(sopTemplateId: string): Promise<void>;
}

// ---------------------------------------------------------------------------
// Rack / Slot (MCP permissions)
// ---------------------------------------------------------------------------

export interface RackRow {
  rack_id: string;
  company_id: string;
  provider_type: string;
  label: string;
  binding_profile_json: string | null;
  status: string;
  created_at: string;
  updated_at: string;
}

export type NewRack = Omit<RackRow, 'created_at' | 'updated_at'>;

export interface SlotRow {
  slot_id: string;
  rack_id: string;
  capability_name: string;
  exposure_scope: string;
  status: string;
  created_at: string;
  updated_at: string;
}

export type NewSlot = Omit<SlotRow, 'created_at' | 'updated_at'>;

export interface RackRepository {
  create(rack: NewRack): Promise<RackRow>;
  findById(rackId: string): Promise<RackRow | null>;
  findByCompany(companyId: string): Promise<RackRow[]>;
  updateStatus(rackId: string, status: string): Promise<void>;
  delete(rackId: string): Promise<void>;
}

export interface SlotRepository {
  create(slot: NewSlot): Promise<SlotRow>;
  findByRack(rackId: string): Promise<SlotRow[]>;
  updateStatus(slotId: string, status: string): Promise<void>;
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
  title: string;
  content: string;
  kind: DeliverableKind | null;
  file_name: string | null;
  mime_type: string | null;
  /** JSON-stringified DeliverableContributor[] */
  contributors_json: string;
  created_at: string;
}

export type NewDeliverable = DeliverableRow;

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

/** Aggregated access point */
export interface RuntimeRepositories {
  companies: CompanyRepository;
  threads: ThreadRepository;
  taskRuns: TaskRunRepository;
  employees: EmployeeRepository;
  toolCalls: ToolCallRepository;
  handoffs: HandoffRepository;
  meetings: MeetingRepository;
  checkpoints: CheckpointRepository;
  events: EventRepository;
  llmCalls: LlmCallRepository;
  installTransactions: InstallTransactionRepository;
  installedPackages: InstalledPackageRepository;
  installedAssets: InstalledAssetRepository;
  assetBindings: AssetBindingRepository;
  memories: MemoryRepository;
  mcpAudit: McpAuditRepository;
  toolPermissionApprovals: ToolPermissionApprovalRepository;
  nodeSummaries: NodeSummaryRepository;
  compactSummaries: CompactSummaryRepository;
  activeInteractions: ActiveInteractionRepository;
  interactionHistory: InteractionHistoryRepository;
  fileHistory: FileHistoryRepository;
  employeeVersions: EmployeeVersionRepository;
  costRates: ModelCostRateRepository;
  sopTemplates: SopTemplateRepository;
  racks: RackRepository;
  slots: SlotRepository;
  workstationRacks: WorkstationRackRepository;
  libraryDocuments: LibraryDocumentRepository;
  officeLayouts: OfficeLayoutRepository;
  prefabInstances: PrefabInstanceRepository;
  zones: ZoneRepository;
  projects: ProjectRepository;
  projectAssignments: ProjectAssignmentRepository;
  kanban: KanbanRepository;
  /** User-level preferences — optional for backward compatibility. */
  userPreferences?: UserPreferenceRepository;
  /** Agent event sourcing — optional for backward compatibility. */
  agentEvents?: AgentEventRepository;
  /** Recovery knowledge base — optional for backward compatibility. */
  recoveryKnowledge?: RecoveryKnowledgeRepository;
  /** Deliverable artifact history — optional for backward compatibility. */
  deliverables?: DeliverableRepository;
  /** Two-tier skills (company-global + employee-specific) — optional for backward compatibility. */
  skills?: SkillRepository;
  /** Generic key-value settings (bootstrap markers) — optional for backward compatibility. */
  settings?: SettingsRepository;
  /**
   * Wraps a synchronous callback in a DB transaction.
   * Only available on Drizzle (better-sqlite3) repos — memory repos omit this.
   * All repo .run() calls inside the callback share the same SQLite transaction.
   */
  transact?<T>(fn: () => T): T;
}
