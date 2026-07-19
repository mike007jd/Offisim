import type { RoleSlug } from '@offisim/shared-types';

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

export type CompetitiveDraftGroupStatus =
  | 'drafting'
  | 'reviewing'
  | 'merging'
  | 'merged'
  | 'failed'
  | 'cancelled';

export interface CompetitiveDraftGroupRow {
  group_id: string;
  company_id: string;
  project_id: string;
  source_run_id: string;
  objective: string;
  status: CompetitiveDraftGroupStatus;
  winner_attempt_id: string | null;
  created_at: string;
  updated_at: string;
}

export type NewCompetitiveDraftGroup = Omit<CompetitiveDraftGroupRow, 'winner_attempt_id'> & {
  winner_attempt_id?: string | null;
};

export type CompetitiveDraftAttemptStatus =
  | 'planned'
  | 'running'
  | 'ready'
  | 'winner'
  | 'not_selected'
  | 'failed'
  | 'cancelled';

export interface CompetitiveDraftAttemptRow {
  attempt_id: string;
  group_id: string;
  ordinal: number;
  employee_id: string;
  thread_id: string;
  run_id: string;
  lease_id: string | null;
  status: CompetitiveDraftAttemptStatus;
  result_summary_json: string | null;
  usage_json: string | null;
  verification_summary: string | null;
  verification_passed: boolean | null;
  started_at: string;
  finished_at: string | null;
}

export type NewCompetitiveDraftAttempt = Omit<
  CompetitiveDraftAttemptRow,
  | 'lease_id'
  | 'result_summary_json'
  | 'usage_json'
  | 'verification_summary'
  | 'verification_passed'
  | 'finished_at'
> & {
  lease_id?: string | null;
  result_summary_json?: string | null;
  usage_json?: string | null;
  verification_summary?: string | null;
  verification_passed?: boolean | null;
  finished_at?: string | null;
};

export interface CompetitiveDraftGroupRepository {
  create(group: NewCompetitiveDraftGroup): Promise<CompetitiveDraftGroupRow>;
  findById(groupId: string): Promise<CompetitiveDraftGroupRow | null>;
  findBySourceRun(sourceRunId: string): Promise<CompetitiveDraftGroupRow | null>;
  listByProject(projectId: string): Promise<CompetitiveDraftGroupRow[]>;
  updateStatus(
    groupId: string,
    status: CompetitiveDraftGroupStatus,
    opts?: { winnerAttemptId?: string | null; updatedAt?: string },
  ): Promise<void>;
}

export interface CompetitiveDraftAttemptRepository {
  create(attempt: NewCompetitiveDraftAttempt): Promise<CompetitiveDraftAttemptRow>;
  findById(attemptId: string): Promise<CompetitiveDraftAttemptRow | null>;
  findByLeaseId(leaseId: string): Promise<CompetitiveDraftAttemptRow | null>;
  listByGroup(groupId: string): Promise<CompetitiveDraftAttemptRow[]>;
  listByEmployee(employeeId: string): Promise<CompetitiveDraftAttemptRow[]>;
  update(
    attemptId: string,
    patch: Partial<
      Pick<
        CompetitiveDraftAttemptRow,
        | 'lease_id'
        | 'status'
        | 'result_summary_json'
        | 'usage_json'
        | 'verification_summary'
        | 'verification_passed'
        | 'finished_at'
      >
    >,
  ): Promise<void>;
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

export const RESETTABLE_NATIVE_SESSION_PRESTART_CODES = [
  'native-session-missing',
  'native-session-invalid',
  'native-session-runtime-incompatible',
  'native-session-context-invalid',
] as const;

export type ResettableNativeSessionPrestartCode =
  (typeof RESETTABLE_NATIVE_SESSION_PRESTART_CODES)[number];

export function isResettableNativeSessionPrestartCode(
  value: unknown,
): value is ResettableNativeSessionPrestartCode {
  return (
    typeof value === 'string' &&
    (RESETTABLE_NATIVE_SESSION_PRESTART_CODES as readonly string[]).includes(value)
  );
}

export interface FreshSessionConversationProjection {
  userMessageId: string;
  assistantMessageId: string;
  source: 'office' | 'workspace';
  model?: string;
  permissionMode?: string;
  thinkingLevel?: string;
}

export interface FreshSessionContext {
  nativeSessionPrestartErrorCode: ResettableNativeSessionPrestartCode;
  projectId: string | null;
  projection: FreshSessionConversationProjection;
}

function trimmedString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

/**
 * Decode the sole durable authority for a plain-Conversation Fresh action.
 * Persistence queries may narrow candidate rows, but every backend and caller
 * must pass this typed predicate before exposing or executing the action.
 */
export function decodeFreshSessionContext(row: AgentRunRow): FreshSessionContext | null {
  if (
    row.run_id !== row.root_run_id ||
    row.parent_run_id !== null ||
    row.status !== 'failed' ||
    row.session_file !== null ||
    !row.runtime_context_json
  ) {
    return null;
  }

  let context: Record<string, unknown>;
  try {
    const parsed = JSON.parse(row.runtime_context_json) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    context = parsed as Record<string, unknown>;
  } catch {
    return null;
  }

  if (
    !isResettableNativeSessionPrestartCode(context.nativeSessionPrestartErrorCode) ||
    context.nativeSessionReset === true ||
    context.recoveryLane !== 'conversation' ||
    !context.conversationProjection ||
    typeof context.conversationProjection !== 'object' ||
    Array.isArray(context.conversationProjection)
  ) {
    return null;
  }

  const projection = context.conversationProjection as Record<string, unknown>;
  const userMessageId = trimmedString(projection.userMessageId);
  const assistantMessageId = trimmedString(projection.assistantMessageId);
  const source = projection.source;
  if (!userMessageId || !assistantMessageId || (source !== 'office' && source !== 'workspace')) {
    return null;
  }

  const model = trimmedString(context.model);
  const permissionMode = trimmedString(context.permissionMode);
  const thinkingLevel = trimmedString(context.thinkingLevel);
  return {
    nativeSessionPrestartErrorCode: context.nativeSessionPrestartErrorCode,
    projectId: trimmedString(context.projectId),
    projection: {
      userMessageId,
      assistantMessageId,
      source,
      ...(model ? { model } : {}),
      ...(permissionMode ? { permissionMode } : {}),
      ...(thinkingLevel ? { thinkingLevel } : {}),
    },
  };
}

export interface AgentRunRepository {
  create(run: NewAgentRun): Promise<AgentRunRow>;
  findById(runId: string): Promise<AgentRunRow | null>;
  findByThread(threadId: string): Promise<AgentRunRow[]>;
  findByEmployee(employeeId: string): Promise<AgentRunRow[]>;
  /** All runs under a root (the children of one user turn). */
  findByRoot(rootRunId: string): Promise<AgentRunRow[]>;
  /** Company-scoped runs filtered to the given statuses, oldest first. Used by
   *  durable-resume reconciliation (find `running` → mark `interrupted`) and the
   *  recovery board (list `interrupted`). Empty `statuses` yields no rows. */
  findByStatus(companyId: string, statuses: string[]): Promise<AgentRunRow[]>;
  /** Exact current-Conversation hydration lookup: returns the latest durable
   * root only when it remains an exact plain-Conversation Fresh candidate. */
  findLatestFreshSessionCandidate(companyId: string, threadId: string): Promise<AgentRunRow | null>;
  /** Exact source lookup for one Fresh action. Returns the row only while it is
   * still the latest root in that company/thread and remains Fresh-eligible. */
  findFreshSessionSource(
    companyId: string,
    threadId: string,
    sourceRunId: string,
  ): Promise<AgentRunRow | null>;
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
  findById(eventId: string): Promise<AgentEventRow | null>;
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
