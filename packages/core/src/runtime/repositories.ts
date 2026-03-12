import type { NewEmployee } from '@aics/install-core';
import type { AssetBindingRepository } from '../repos/asset-binding-repository.js';
import type { InstallTransactionRepository } from '../repos/install-transaction-repository.js';
import type { InstalledAssetRepository } from '../repos/installed-asset-repository.js';
import type { InstalledPackageRepository } from '../repos/installed-package-repository.js';

/** Row types — mirror db-local schema shapes */

export interface GraphThreadRow {
  thread_id: string;
  company_id: string;
  entry_mode: string;
  root_task_id: string | null;
  status: string;
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
  role_slug: string;
  workstation_id: string | null;
  persona_json: string | null;
  config_json: string | null;
  enabled: number;
  created_at: string;
  updated_at: string;
}

export interface CompanyRow {
  company_id: string;
  name: string;
  status: string;
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
  response_json: string | null;
  latency_ms: number | null;
  error_code: string | null;
  created_at: string;
}

export type NewLlmCall = Omit<LlmCallRow, never>;

/** New-row types (omit auto-generated fields) */
export type NewGraphThread = Omit<GraphThreadRow, 'created_at' | 'updated_at'>;
export type NewTaskRun = Omit<TaskRunRow, 'finished_at'>;
export type NewToolCall = Omit<ToolCallRow, 'finished_at'>;
export type NewHandoffEvent = Omit<HandoffEventRow, never>;
export type NewMeetingSession = Omit<MeetingSessionRow, never>;
export type NewGraphCheckpoint = Omit<GraphCheckpointRow, never>;
export type NewRuntimeEvent = Omit<RuntimeEventRow, never>;

/** Repository interfaces */

export interface CompanyRepository {
  findById(companyId: string): Promise<CompanyRow | null>;
}

export interface ThreadRepository {
  create(thread: NewGraphThread): Promise<GraphThreadRow>;
  findById(threadId: string): Promise<GraphThreadRow | null>;
  findByCompany(
    companyId: string,
    opts?: { limit?: number; status?: string },
  ): Promise<GraphThreadRow[]>;
  updateStatus(threadId: string, status: string): Promise<void>;
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
    'name' | 'role_slug' | 'persona_json' | 'config_json' | 'enabled' | 'workstation_id'
  >
>;

export interface EmployeeRepository {
  create(employee: NewEmployee): Promise<{ employee_id: string }>;
  findById(employeeId: string): Promise<EmployeeRow | null>;
  findByCompany(companyId: string): Promise<EmployeeRow[]>;
  findByRole(companyId: string, roleSlug: string): Promise<EmployeeRow[]>;
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
  source_thread_id?: string | null;
  source_task_run_id?: string | null;
}

export interface MemoryRepository {
  create(entry: MemoryEntryCreate): Promise<MemoryEntryRow>;
  findById(memoryId: string): Promise<MemoryEntryRow | null>;
  search(
    query: string,
    opts: { scope?: string; ownerId?: string; companyId: string; limit?: number },
  ): Promise<MemoryEntryRow[]>;
  delete(memoryId: string): Promise<void>;
  findByOwner(
    ownerId: string,
    opts?: { category?: string; limit?: number },
  ): Promise<MemoryEntryRow[]>;
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
  approved_by: string;
  created_at: string;
}

export type NewMcpAudit = McpAuditRow;

export interface McpAuditRepository {
  create(audit: NewMcpAudit): Promise<McpAuditRow>;
  listByThread(threadId: string): Promise<McpAuditRow[]>;
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
  employeeVersions: EmployeeVersionRepository;
  costRates: ModelCostRateRepository;
}
