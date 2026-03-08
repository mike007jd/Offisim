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
  findByCompany(companyId: string, opts?: { limit?: number; status?: string }): Promise<GraphThreadRow[]>;
  updateStatus(threadId: string, status: string): Promise<void>;
}

export interface TaskRunRepository {
  create(taskRun: NewTaskRun): Promise<TaskRunRow>;
  findById(taskRunId: string): Promise<TaskRunRow | null>;
  findByThread(threadId: string): Promise<TaskRunRow[]>;
  updateStatus(taskRunId: string, status: string, outputJson?: string | null): Promise<void>;
}

export interface EmployeeRepository {
  findById(employeeId: string): Promise<EmployeeRow | null>;
  findByCompany(companyId: string): Promise<EmployeeRow[]>;
  findByRole(companyId: string, roleSlug: string): Promise<EmployeeRow[]>;
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
  findByTaskRun(taskRunId: string): Promise<LlmCallRow[]>;
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
}
