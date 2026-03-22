import type { NewEmployee } from '@aics/install-core';
import type { NewProject, NewProjectAssignment, ProjectAssignmentRow, ProjectRow, ProjectStatus } from '@aics/shared-types';
import type { AssetBindingRepository } from '../repos/asset-binding-repository.js';
import type { InstallTransactionRepository } from '../repos/install-transaction-repository.js';
import type { InstalledAssetRepository } from '../repos/installed-asset-repository.js';
import type { InstalledPackageRepository } from '../repos/installed-package-repository.js';
import type { PrefabInstanceRepository } from '../repos/prefab-instance-repository.js';

export type { ProjectRow, NewProject, ProjectStatus, ProjectAssignmentRow, NewProjectAssignment };

/** Row types — mirror db-local schema shapes */

export interface GraphThreadRow {
  thread_id: string;
  company_id: string;
  entry_mode: string;
  root_task_id: string | null;
  status: string;
  project_id: string | null;
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
export type NewGraphThread = Omit<GraphThreadRow, 'created_at' | 'updated_at' | 'project_id'> & {
  project_id?: string | null;
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
  update(companyId: string, fields: Partial<Pick<CompanyRow, 'name' | 'status'>>): Promise<void>;
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
  created_at: string;
  updated_at: string;
}

export type NewSopTemplate = Omit<SopTemplateRow, 'created_at' | 'updated_at'>;

export interface SopTemplateRepository {
  create(template: NewSopTemplate): Promise<SopTemplateRow>;
  findById(sopTemplateId: string): Promise<SopTemplateRow | null>;
  findByCompany(companyId: string): Promise<SopTemplateRow[]>;
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
  search(companyId: string, query: string, opts?: { limit?: number }): Promise<LibraryDocumentRow[]>;
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
  update(layoutId: string, patch: Partial<Pick<OfficeLayoutRow, 'name' | 'layout_json'>>): Promise<void>;
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
  update(
    projectId: string,
    patch: Partial<Pick<ProjectRow, 'name' | 'description' | 'status'>>,
  ): Promise<void>;
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
  sopTemplates: SopTemplateRepository;
  racks: RackRepository;
  slots: SlotRepository;
  workstationRacks: WorkstationRackRepository;
  libraryDocuments: LibraryDocumentRepository;
  officeLayouts: OfficeLayoutRepository;
  prefabInstances: PrefabInstanceRepository;
  projects: ProjectRepository;
  projectAssignments: ProjectAssignmentRepository;
  /**
   * Wraps a synchronous callback in a DB transaction.
   * Only available on Drizzle (better-sqlite3) repos — memory repos omit this.
   * All repo .run() calls inside the callback share the same SQLite transaction.
   */
  transact?<T>(fn: () => T): T;
}
