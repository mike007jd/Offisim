import type {
  AgentRunUsage,
  AiExecutionTarget,
  AiRuntimeStatus,
  AttachmentMeta,
  CollaborationProfile,
  TurnExecutionProvenance,
  WorkspaceBoundProvenance,
  WorkspaceUnavailableProvenance,
} from '@offisim/shared-types';
import type { Channel } from '@tauri-apps/api/core';

interface LocalDbTransactionStatement {
  sql: string;
  params?: readonly unknown[];
}

export interface GlobalSearchResult {
  category: 'conversation' | 'card' | 'output';
  entityId: string;
  companyId: string | null;
  companyName: string | null;
  projectId: string | null;
  projectName: string | null;
  threadId: string | null;
  messageId: string | null;
  title: string;
  snippet: string;
  path: string | null;
  updatedAt: string | null;
}

interface ProjectFilePreview {
  content: string;
  truncated: boolean;
  totalSize: number;
}

interface ProjectPreviewMeta {
  fileName: string;
  mimeType?: string | null;
  extension?: string | null;
  byteLength: number;
  modifiedAt?: string | null;
  text?: string | null;
  truncated: boolean;
}

interface ProjectDirEntry {
  name: string;
  path: string;
  isFile: boolean;
  isDirectory: boolean;
  isSymlink: boolean;
  size?: number | null;
}

export interface ProjectWorkspaceSelectionClaim {
  selectionRef: string;
  displayPath: string;
  expiresAtUnixMs: number;
}

interface ProjectCreateCommandInput {
  projectId: string;
  companyId: string;
  name: string;
  description: string | null;
  status: 'planning' | 'active' | 'paused' | 'completed' | 'archived';
  workspaceSelectionRef: string;
  verifyCommand: string | null;
  verifyMaxAttempts: number;
  verifyTokenBudget: number | null;
}

interface ProjectUpdateCommandInput {
  projectId: string;
  name: string;
  description: string | null;
  status: 'planning' | 'active' | 'paused' | 'completed' | 'archived';
  workspaceSelectionRef: string | null;
  verifyCommand: string | null;
  verifyMaxAttempts: number;
  verifyTokenBudget: number | null;
}

type WorkspaceBindingProvenanceFields<Provenance> = Provenance extends WorkspaceBoundProvenance
  ? Pick<Provenance, 'source' | 'reasonCode'>
  : never;

interface TaskWorkspaceBindingProjectionBase {
  historyId: string;
  companyId: string;
  projectId: string;
  threadId: string;
  turnId: string;
  requestId: string;
  access: 'read' | 'write';
  confidence: number;
  issuedAtUnixMs: number;
  expiresAtUnixMs: number;
  displayPath: string;
}

/** Persistable, non-secret explanation of the backend-issued workspace binding. */
export type TaskWorkspaceBindingProjection = TaskWorkspaceBindingProjectionBase &
  WorkspaceBindingProvenanceFields<WorkspaceBoundProvenance>;

/** Ephemeral claim used only when invoking binding-scoped backend commands. */
export type TaskWorkspaceBindingClaim = TaskWorkspaceBindingProjection & {
  workspaceRef: string;
};

/**
 * Ephemeral, bounded authority for deterministic Mission evaluation. It keeps
 * read access plus classifier-bounded verification execution on the exact Turn
 * binding. It exposes no direct project-write API and can only derive from the
 * Mission attempt's original Write Turn.
 */
export interface TaskWorkspaceEvaluationLeaseClaim {
  evaluationLeaseRef: string;
  historyId: string;
  companyId: string;
  projectId: string;
  threadId: string;
  turnId: string;
  requestId: string;
  missionId: string;
  attemptId: string;
  issuedAtUnixMs: number;
  expiresAtUnixMs: number;
}

export interface TaskWorkspaceResumeCompatibilityArgs {
  historyId: string;
  companyId: string;
  projectId: string;
  threadId: string;
  rootRunId: string;
  access: 'read' | 'write';
}

export interface TaskWorkspaceResumeCompatibility {
  status: 'same' | 'missing' | 'changed';
  reason: string;
}

interface TaskWorkspaceDeletionPreflight {
  allowed: boolean;
  activeBindings: number;
  activeLeases: number;
}

/** Parse the persistable projection while deliberately discarding capability refs/raw roots. */
export function parseTaskWorkspaceBindingProjection(
  value: unknown,
): TaskWorkspaceBindingProjection | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  const stringKeys = [
    'historyId',
    'companyId',
    'projectId',
    'threadId',
    'turnId',
    'requestId',
    'access',
    'displayPath',
  ] as const;
  if (stringKeys.some((key) => typeof record[key] !== 'string')) return null;
  if (record.access !== 'read' && record.access !== 'write') return null;
  const provenance = parseWorkspaceBoundProvenance(
    record.source,
    record.reasonCode,
    record.displayPath,
  );
  if (!provenance) return null;
  if (typeof record.confidence !== 'number' || !Number.isFinite(record.confidence)) return null;
  if (typeof record.issuedAtUnixMs !== 'number' || !Number.isFinite(record.issuedAtUnixMs)) {
    return null;
  }
  if (typeof record.expiresAtUnixMs !== 'number' || !Number.isFinite(record.expiresAtUnixMs)) {
    return null;
  }
  const {
    availability: _availability,
    displayPath: _displayPath,
    ...provenanceFields
  } = provenance;
  return {
    historyId: record.historyId as string,
    companyId: record.companyId as string,
    projectId: record.projectId as string,
    threadId: record.threadId as string,
    turnId: record.turnId as string,
    requestId: record.requestId as string,
    access: record.access,
    ...provenanceFields,
    confidence: record.confidence,
    issuedAtUnixMs: record.issuedAtUnixMs,
    expiresAtUnixMs: record.expiresAtUnixMs,
    displayPath: record.displayPath as string,
  };
}

export function parseWorkspaceBoundProvenance(
  source: unknown,
  reasonCode: unknown,
  displayPath: unknown,
): WorkspaceBoundProvenance | null {
  if (typeof displayPath !== 'string' || !displayPath.trim()) return null;
  if (source === 'project_catalog' && reasonCode === 'current_project_folder') {
    return { availability: 'bound', source, reasonCode, displayPath };
  }
  if (source === 'conversation_history' && reasonCode === 'recent_successful_workspace') {
    return { availability: 'bound', source, reasonCode, displayPath };
  }
  if (
    source === 'known_root_recovery' &&
    (reasonCode === 'renamed_same_filesystem_object' ||
      reasonCode === 'unique_name_repo_identity_match')
  ) {
    return { availability: 'bound', source, reasonCode, displayPath };
  }
  if (source === 'resume_history' && reasonCode === 'resume_history_identity_match') {
    return { availability: 'bound', source, reasonCode, displayPath };
  }
  return null;
}

export interface CodexPetMetadata {
  id: string;
  displayName: string;
  description: string;
  version: string;
  byteSize: number;
  width: number;
  height: number;
}

interface InvalidCodexPetEntry {
  folder: string;
  code: string;
  message: string;
}

export interface CodexPetCatalog {
  sourcePath: string;
  selectedPetId?: string | null;
  pets: CodexPetMetadata[];
  invalidEntries: InvalidCodexPetEntry[];
}

interface BashExecuteResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  timedOut: boolean;
  projectId: string;
  cwd: string;
  networkPolicy: string;
  approvalId?: string | null;
}

export interface NativeStageSessionScope {
  companyId: string;
  projectId: string;
  threadId?: string | null;
}

export interface TerminalOutputChunk {
  startCursor: number;
  endCursor: number;
  dataBase64: string;
}

export interface TerminalSessionSnapshot {
  sessionId: string;
  scope: NativeStageSessionScope;
  cwd: string;
  shell: string;
  status: 'running' | 'closing' | 'exited' | 'closed' | 'error';
  startCursor: number;
  endCursor: number;
  chunks: TerminalOutputChunk[];
  gap: boolean;
  exitCode?: number | null;
  error?: string | null;
}

export interface BrowserSessionBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface BrowserSessionSnapshot {
  sessionId: string;
  scope: NativeStageSessionScope;
  status: 'creating' | 'loading' | 'ready' | 'hidden' | 'error' | 'closed';
  url: string;
  title?: string | null;
  canGoBack: boolean;
  canGoForward: boolean;
  sequence: number;
  visible: boolean;
  error?: string | null;
}

interface CompetitiveDraftContext {
  groupId: string;
  sourceRunId: string;
  attemptId: string;
  attemptIndex: number;
  totalAttempts: number;
}

interface PiAgentExecuteRequest {
  requestId: string;
  text: string;
  images?: Array<{ data: string; mimeType: string }> | null;
  expectedTarget: AiExecutionTarget;
  runtimeModelRef: string;
  companyId: string;
  threadId: string;
  projectId: string;
  workspaceRequirement: 'optional' | 'required';
  /** Normal Turns continue the tracked native Conversation session. `fresh` is
   * accepted only for the explicit recovery action authorized by the failed
   * root identified below. */
  nativeSessionMode: 'tracked' | 'fresh';
  /** Engine-owned opaque session reference. Never a native file path. */
  nativeSessionId?: string | null;
  nativeSessionResetSourceRunId?: string | null;
  employeeId?: string | null;
  model?: string | null;
  permissionMode?: string | null;
  thinkingLevel?: string | null;
  systemPromptAppend?: string | null;
  projectExperience?: string | null;
  skillPaths?: string[] | null;
  projectSkillPaths?: string[] | null;
  rootRunId: string;
  /** Required only for resume; backend reissues authority from persisted history. */
  workspaceBindingHistoryId?: string | null;
  roster?: unknown;
  missionContextJson?: string | null;
  mcpTools?: unknown;
  directDelegation?: unknown;
  competitiveDraft?: CompetitiveDraftContext;
}

/** Closed renderer mirror of Rust's `#[serde(deny_unknown_fields)]` Codex request. */
interface CodexAgentExecuteRequest {
  requestId: string;
  text: string;
  expectedTarget: AiExecutionTarget;
  companyId: string;
  threadId: string;
  projectId?: string | null;
  employeeId?: string | null;
  rootRunId?: string | null;
  workspaceBindingHistoryId?: string | null;
  nativeSessionMode: 'tracked' | 'fresh';
  nativeSessionResetSourceRunId?: string | null;
  permissionMode?: string | null;
  systemPromptAppend?: string | null;
  projectExperience?: string | null;
  skillPaths?: string[] | null;
  projectSkillPaths?: string[] | null;
  clientUserMessageId?: string | null;
  workspaceRequirement: 'optional' | 'required';
  nativeSessionId?: string | null;
  competitiveDraft?: CompetitiveDraftContext;
}

interface ClaudeAgentExecuteRequest {
  requestId: string;
  text: string;
  expectedTarget: AiExecutionTarget;
  companyId: string;
  threadId: string;
  projectId?: string | null;
  employeeId?: string | null;
  rootRunId?: string | null;
  workspaceBindingHistoryId?: string | null;
  nativeSessionMode: 'tracked' | 'fresh';
  nativeSessionResetSourceRunId?: string | null;
  permissionMode?: string | null;
  systemPromptAppend?: string | null;
  projectExperience?: string | null;
  skillPaths?: string[] | null;
  projectSkillPaths?: string[] | null;
  workspaceRequirement: 'optional' | 'required';
  nativeSessionId?: string | null;
  competitiveDraft?: CompetitiveDraftContext;
}

interface PiAgentEnhanceRequest {
  requestId: string;
  text: string;
  expectedTarget: AiExecutionTarget;
  runtimeModelRef: string;
  systemPrompt: string;
  model?: string | null;
  thinkingLevel?: string | null;
  sourceProvenance?: PiExecutionProvenance | null;
}

/** Closed Codex Enhance mirror; intentionally independent from Pi protocol types. */
interface CodexAgentEnhanceRequest {
  requestId: string;
  text: string;
  expectedTarget: AiExecutionTarget;
  systemPrompt: string;
  sourceProvenance?: TurnExecutionProvenance | null;
}

interface ClaudeAgentEnhanceRequest {
  requestId: string;
  text: string;
  expectedTarget: AiExecutionTarget;
  systemPrompt: string;
  sourceProvenance?: TurnExecutionProvenance | null;
}

type PiExecutionProvenance = TurnExecutionProvenance;

interface PiAgentCollaborateRequest {
  requestId: string;
  text: string;
  expectedTarget: AiExecutionTarget;
  runtimeModelRef: string;
  capabilityProfile?: 'collaboration' | null;
  collaborationProfile?: CollaborationProfile | null;
  companyId: string;
  collaborationThreadId: string;
  employeeId?: string | null;
  model?: string | null;
  thinkingLevel?: string | null;
  mcpTools?: unknown;
  systemPromptAppend?: string | null;
}

interface PiAgentModelSummary {
  provider?: string;
  id?: string;
  catalogId?: string;
  name?: string;
  api?: string;
  reasoning?: boolean;
  contextWindow?: number;
  maxTokens?: number;
  input?: string[];
}

interface PiAgentHostResponse {
  text: string;
  reasoning?: string;
  sessionId?: string;
  sessionFile?: string;
  model?: PiAgentModelSummary;
  provenance?: PiExecutionProvenance;
  usage?: AgentRunUsage;
  budgetUsage?: AgentRunUsage;
}

type PiAgentHostEvent =
  | {
      kind: 'executionPrepared';
      prepareId: string;
      runId: string;
      identity: TurnExecutionProvenance;
      targetDigest: string;
      adapter: { id: string; version: string };
    }
  | {
      kind: 'started';
      sessionId?: string;
      sessionFile?: string;
      model?: PiAgentModelSummary;
      modelFallbackMessage?: string;
    }
  | ({ kind: 'workspaceBound' } & TaskWorkspaceBindingClaim)
  | {
      kind: 'workspaceUnavailable';
      projectId: string;
      threadId: string;
      turnId: string;
      requestId: string;
      source: WorkspaceUnavailableProvenance['source'];
      reasonCode: WorkspaceUnavailableProvenance['reasonCode'];
    }
  | { kind: 'messageDelta'; delta: string; channel?: 'content' | 'reasoning' }
  | { kind: 'messageEnd'; text: string; stopReason?: string; errorMessage?: string }
  | {
      kind: 'tool';
      status: 'started' | 'running' | 'completed' | 'failed';
      toolCallId: string;
      toolName: string;
      detail?: string;
      durationMs?: number;
    }
  | {
      kind: 'uiRequest';
      id: string;
      method: string;
      title: string;
      message?: string;
      options?: string[];
      placeholder?: string;
      prefill?: string;
      params?: unknown;
    }
  | { kind: 'lifecycle'; event: string; payload: unknown }
  | {
      kind: 'uiRequestResolved';
      id: string;
      resolution: 'answered' | 'cancelled' | 'timeout' | 'native';
    }
  | {
      kind: 'agentRun';
      threadId: string;
      rootRunId: string;
      runId: string;
      parentRunId?: string;
      employeeId?: string;
      relation?: string;
      workKind?: string;
      runType: string;
      payload: unknown;
    }
  | { kind: 'result'; response: PiAgentHostResponse }
  | { kind: 'error'; code: string; message: string }
  | { kind: 'streamCursor'; cursor: number };

interface PiRunStreamSnapshot {
  requestId: string;
  running: boolean;
  cursor: number;
  buffered: number;
  terminal?: {
    status: string;
    message?: string;
  };
}

interface PiAgentProviderAuthStatus {
  configured: boolean;
  source?: string;
  label?: string;
}

interface PiAgentProviderStatus {
  provider: string;
  displayName: string;
  auth: PiAgentProviderAuthStatus;
}

export interface PiAgentProviderModelConfig {
  id: string;
  name?: string;
  api?: string;
  contextWindow?: number;
  maxTokens?: number;
}

export interface PiAgentProviderConfigStatus {
  provider: string;
  displayName: string;
  name?: string;
  baseUrl?: string;
  api?: string;
  hasApiKey: boolean;
  authSource?: string;
  models: PiAgentProviderModelConfig[];
}

export interface PiAgentProviderTemplate {
  provider: string;
  displayName: string;
  baseUrl?: string;
  api?: string;
  configured: boolean;
  models: PiAgentProviderModelConfig[];
}

export interface PiAgentProviderConfigInput {
  providerId: string;
  displayName?: string | null;
  baseUrl: string;
  api: string;
  apiKey?: string | null;
  keepExistingApiKey?: boolean;
  models: PiAgentProviderModelConfig[];
}

interface PiAgentStatusResponse {
  ok: boolean;
  authProviders: string[];
  providerStatus: PiAgentProviderStatus[];
  configuredProviderStatus: PiAgentProviderStatus[];
  providerConfigs: PiAgentProviderConfigStatus[];
  providerTemplates: PiAgentProviderTemplate[];
  availableModels: PiAgentModelSummary[];
  allModelCount: number;
  paths?: {
    agentDir?: string;
    authPath?: string;
    modelsPath?: string;
  };
  modelsConfig?: {
    path?: string;
    exists: boolean;
    providerCount: number;
    modelCount: number;
    overrideCount: number;
    providers: string[];
    parseError?: string;
  };
  checkedAt?: string;
}

interface ComputerDriverStatus {
  installed: boolean;
  binaryPath?: string | null;
  version?: string | null;
  daemonRunning: boolean;
}

interface GitExecResult {
  ok: boolean;
  stdout: string;
  stderr: string;
}

interface GhExecResult {
  ok: boolean;
  stdout: string;
  stderr: string;
}

interface RuntimeVaultStatus {
  path: string;
  displayPath: string;
  employees: number;
  files: number;
  sizeBytes: number;
  size: string;
  available: boolean;
}

interface RuntimeVaultFileStat {
  mtimeMs: number;
  size: number;
}

interface LocalExportResult {
  path: string;
  displayPath: string;
  fileName: string;
  sizeBytes: number;
  size: string;
}

type McpTransport = 'stdio' | 'sse';

interface RegisteredMcpServerSummary {
  serverId: string;
  name: string;
  transport: McpTransport;
  command?: string | null;
  args: string[];
  url?: string | null;
  source?: string | null;
  sourcePackageId?: string | null;
  sourcePackageVersion?: string | null;
  sourceManifestHash?: string | null;
  requestSurface?: string | null;
  approvalId?: string | null;
  category?: string | null;
  riskClass?: string | null;
  commandFingerprint?: string | null;
  requestedTools: string[];
}

interface McpServerRegistrationInput {
  name: string;
  transport: McpTransport;
  command?: string | null;
  args?: string[];
  url?: string | null;
  source?: string | null;
  sourcePackageId?: string | null;
  sourcePackageVersion?: string | null;
  sourceManifestHash?: string | null;
  approvalId?: string | null;
  category?: string | null;
  riskClass?: string | null;
  requestedTools?: string[];
  requestSurface?: string | null;
}

interface McpConnectRequest {
  serverId: string;
  approvalId: string;
  commandFingerprint: string;
  projectId?: string | null;
  requestSurface: string;
  sourcePackageId?: string | null;
  sourcePackageVersion?: string | null;
  sourceManifestHash?: string | null;
}

interface McpToolAnnotations {
  title?: string;
  readOnlyHint?: boolean;
  destructiveHint?: boolean;
  idempotentHint?: boolean;
  openWorldHint?: boolean;
}

interface McpToolInfo {
  name: string;
  description: string;
  category?: 'computer-use';
  inputSchema: unknown;
  annotations?: McpToolAnnotations | null;
}

interface McpSpawnResult {
  serverName: string;
  tools: McpToolInfo[];
  state: string;
}

interface McpToolCallResult {
  content: unknown;
  isError: boolean;
}

interface McpServerStatus {
  name: string;
  state: string;
  toolCount: number;
  tools: McpToolInfo[];
  consecutiveFailures: number;
  pid?: number | null;
}

type ProjectPathArgs = {
  path: string;
  cwd?: string | null;
  projectId?: string | null;
  bindingClaim?: TaskWorkspaceBindingClaim | null;
  evaluationLease?: TaskWorkspaceEvaluationLeaseClaim | null;
};

type AgentRuntimeArgs<TRequest> = {
  req: TRequest;
  onEvent: Channel<PiAgentHostEvent>;
};

type AgentUiResponseArgs = {
  requestId: string;
  id: string;
  confirmed?: boolean | null;
  value?: string | null;
  cancelled?: boolean | null;
};

export interface WorkspaceLeaseLifecycleRow {
  leaseId: string;
  projectId: string;
  threadId: string | null;
  activeRootRunId: string | null;
  createdRootRunId: string;
  registeredRunId: string;
  workspaceRoot: string | null;
  cwd: string;
  branch: string;
  createdAt: string;
  updatedAt: string;
  status: 'active' | 'released' | 'discarded' | 'invalid';
  ownerBindingStatus:
    | 'active'
    | 'completed'
    | 'failed'
    | 'aborted'
    | 'expired'
    | 'app_restart'
    | null;
}

export interface WorkspaceCheckpointRow {
  checkpointId: string;
  leaseId: string;
  projectId: string;
  runId: string;
  threadId: string | null;
  rootRunId: string;
  workspaceRoot: string;
  cwd: string;
  branch: string;
  step: number;
  ref: string;
  triggerTool: string;
  triggerToolCallId: string | null;
  createdAt: string;
  changedPaths: string[];
}

export interface WorkspaceCheckpointRollbackRow {
  rollbackId: string;
  leaseId: string;
  projectId: string;
  checkpointId: string;
  targetStep: number;
  targetRef: string;
  actor: string;
  rolledBackAt: string;
  changedPaths: string[];
}

interface WorkspaceCheckpointTimeline {
  checkpoints: WorkspaceCheckpointRow[];
  rollbacks: WorkspaceCheckpointRollbackRow[];
}

type CommandSpec<TArgs, TResult> = {
  args: TArgs;
  result: TResult;
};

export interface CommandMap {
  local_db_execute: CommandSpec<{ sql: string; params: unknown[] }, number>;
  local_db_select: CommandSpec<{ sql: string; params: unknown[] }, unknown[]>;
  local_db_execute_transaction: CommandSpec<{ statements: LocalDbTransactionStatement[] }, void>;
  global_search: CommandSpec<{ query: string }, GlobalSearchResult[]>;
  project_workspace_select: CommandSpec<
    { title?: string | null },
    ProjectWorkspaceSelectionClaim | null
  >;
  project_create: CommandSpec<{ input: ProjectCreateCommandInput }, void>;
  project_update: CommandSpec<{ input: ProjectUpdateCommandInput }, void>;
  project_update_status: CommandSpec<
    {
      projectId: string;
      status: 'planning' | 'active' | 'paused' | 'completed' | 'archived';
    },
    void
  >;
  project_read_file: CommandSpec<ProjectPathArgs, string>;
  project_read_file_lines: CommandSpec<
    ProjectPathArgs & { offset: number; limit?: number | null },
    string
  >;
  project_read_file_preview: CommandSpec<
    ProjectPathArgs & { maxBytes: number },
    ProjectFilePreview
  >;
  project_preview_meta: CommandSpec<ProjectPathArgs, ProjectPreviewMeta>;
  project_read_file_bytes: CommandSpec<
    ProjectPathArgs & { maxBytes?: number },
    ArrayBuffer | Uint8Array | number[]
  >;
  codex_pets_list: CommandSpec<undefined, CodexPetCatalog>;
  codex_pet_load: CommandSpec<
    { petId: string; expectedVersion: string },
    ArrayBuffer | Uint8Array | number[]
  >;
  project_exists: CommandSpec<ProjectPathArgs, boolean>;
  project_list_dir: CommandSpec<ProjectPathArgs, ProjectDirEntry[]>;
  project_write_file: CommandSpec<ProjectPathArgs & { content: string }, void>;
  bash_execute: CommandSpec<
    {
      cwd?: string | null;
      cmd: string;
      timeoutMs: number;
      maxOutputBytes?: number | null;
      projectId?: string | null;
      approvalId?: string | null;
      employeeId?: string | null;
      networkPolicy?: string | null;
      evaluationLease?: TaskWorkspaceEvaluationLeaseClaim | null;
      verificationOnly?: boolean | null;
    },
    BashExecuteResult
  >;
  terminal_session_create: CommandSpec<
    { sessionId: string; scope: NativeStageSessionScope; cols: number; rows: number },
    TerminalSessionSnapshot
  >;
  terminal_session_write: CommandSpec<
    { sessionId: string; scope: NativeStageSessionScope; dataBase64: string },
    void
  >;
  terminal_session_resize: CommandSpec<
    { sessionId: string; scope: NativeStageSessionScope; cols: number; rows: number },
    void
  >;
  terminal_session_snapshot: CommandSpec<
    { sessionId: string; scope: NativeStageSessionScope; afterCursor?: number | null },
    TerminalSessionSnapshot
  >;
  terminal_session_list_scoped: CommandSpec<
    { scope: NativeStageSessionScope },
    TerminalSessionSnapshot[]
  >;
  terminal_session_close: CommandSpec<
    { sessionId: string; scope: NativeStageSessionScope },
    TerminalSessionSnapshot | null
  >;
  browser_session_create: CommandSpec<
    {
      sessionId: string;
      scope: NativeStageSessionScope;
      url: string;
      bounds: BrowserSessionBounds;
    },
    BrowserSessionSnapshot
  >;
  browser_session_navigate: CommandSpec<
    { sessionId: string; scope: NativeStageSessionScope; url: string },
    BrowserSessionSnapshot
  >;
  browser_session_back: CommandSpec<
    { sessionId: string; scope: NativeStageSessionScope },
    BrowserSessionSnapshot
  >;
  browser_session_forward: CommandSpec<
    { sessionId: string; scope: NativeStageSessionScope },
    BrowserSessionSnapshot
  >;
  browser_session_reload: CommandSpec<
    { sessionId: string; scope: NativeStageSessionScope },
    BrowserSessionSnapshot
  >;
  browser_session_set_bounds: CommandSpec<
    { sessionId: string; scope: NativeStageSessionScope; bounds: BrowserSessionBounds },
    BrowserSessionSnapshot
  >;
  browser_session_set_visible: CommandSpec<
    { sessionId: string; scope: NativeStageSessionScope; visible: boolean },
    BrowserSessionSnapshot
  >;
  browser_session_snapshot: CommandSpec<
    { sessionId: string; scope: NativeStageSessionScope },
    BrowserSessionSnapshot
  >;
  browser_session_list_scoped: CommandSpec<
    { scope: NativeStageSessionScope },
    BrowserSessionSnapshot[]
  >;
  browser_session_close: CommandSpec<
    { sessionId: string; scope: NativeStageSessionScope },
    BrowserSessionSnapshot
  >;
  pi_agent_open_config_folder: CommandSpec<undefined, void>;
  pi_agent_status: CommandSpec<undefined, PiAgentStatusResponse>;
  pi_agent_save_provider: CommandSpec<
    { config: PiAgentProviderConfigInput },
    PiAgentStatusResponse
  >;
  agent_runtime_execute: CommandSpec<AgentRuntimeArgs<PiAgentExecuteRequest>, PiAgentHostResponse>;
  agent_runtime_enhance: CommandSpec<AgentRuntimeArgs<PiAgentEnhanceRequest>, PiAgentHostResponse>;
  agent_runtime_collaborate: CommandSpec<
    AgentRuntimeArgs<PiAgentCollaborateRequest>,
    PiAgentHostResponse
  >;
  agent_runtime_resume: CommandSpec<AgentRuntimeArgs<PiAgentExecuteRequest>, PiAgentHostResponse>;
  agent_runtime_abort: CommandSpec<{ requestId: string }, void>;
  agent_runtime_control: CommandSpec<
    {
      requestId: string;
      action: 'stopChild' | 'steer' | 'followUp' | 'reattach';
      controlId?: string | null;
      runId?: string | null;
      text?: string | null;
      images?: Array<{ data: string; mimeType: string }> | null;
    },
    void
  >;
  agent_runtime_confirm_execution: CommandSpec<
    { requestId: string; prepareId: string; targetDigest: string },
    void
  >;
  agent_runtime_answer: CommandSpec<AgentUiResponseArgs, void>;
  agent_runtime_stream_snapshot: CommandSpec<{ requestId: string }, PiRunStreamSnapshot | null>;
  agent_runtime_release_stream: CommandSpec<{ requestId: string }, void>;
  agent_runtime_reattach: CommandSpec<
    { requestId: string; afterCursor?: number | null; onEvent: Channel<PiAgentHostEvent> },
    PiRunStreamSnapshot
  >;
  codex_agent_execute: CommandSpec<AgentRuntimeArgs<CodexAgentExecuteRequest>, PiAgentHostResponse>;
  codex_agent_enhance: CommandSpec<AgentRuntimeArgs<CodexAgentEnhanceRequest>, PiAgentHostResponse>;
  codex_agent_resume: CommandSpec<AgentRuntimeArgs<CodexAgentExecuteRequest>, PiAgentHostResponse>;
  codex_agent_abort: CommandSpec<{ requestId: string }, void>;
  codex_agent_answer: CommandSpec<AgentUiResponseArgs, void>;
  codex_agent_stream_snapshot: CommandSpec<{ requestId: string }, PiRunStreamSnapshot | null>;
  codex_agent_release_stream: CommandSpec<{ requestId: string }, void>;
  codex_agent_reattach: CommandSpec<
    { requestId: string; afterCursor?: number | null; onEvent: Channel<PiAgentHostEvent> },
    PiRunStreamSnapshot
  >;
  codex_agent_status: CommandSpec<undefined, AiRuntimeStatus>;
  claude_agent_execute: CommandSpec<
    AgentRuntimeArgs<ClaudeAgentExecuteRequest>,
    PiAgentHostResponse
  >;
  claude_agent_enhance: CommandSpec<
    AgentRuntimeArgs<ClaudeAgentEnhanceRequest>,
    PiAgentHostResponse
  >;
  claude_agent_resume: CommandSpec<
    AgentRuntimeArgs<ClaudeAgentExecuteRequest>,
    PiAgentHostResponse
  >;
  claude_agent_abort: CommandSpec<{ requestId: string }, void>;
  claude_agent_answer: CommandSpec<AgentUiResponseArgs, void>;
  claude_agent_stream_snapshot: CommandSpec<{ requestId: string }, PiRunStreamSnapshot | null>;
  claude_agent_release_stream: CommandSpec<{ requestId: string }, void>;
  claude_agent_reattach: CommandSpec<
    { requestId: string; afterCursor?: number | null; onEvent: Channel<PiAgentHostEvent> },
    PiRunStreamSnapshot
  >;
  claude_agent_status: CommandSpec<undefined, AiRuntimeStatus>;
  agent_runtime_status: CommandSpec<{ includeUsage?: boolean }, AiRuntimeStatus>;
  computer_driver_status: CommandSpec<undefined, ComputerDriverStatus>;
  task_workspace_evaluation_lease_acquire: CommandSpec<
    {
      bindingClaim: TaskWorkspaceBindingClaim;
      missionId: string;
      attemptId: string;
    },
    TaskWorkspaceEvaluationLeaseClaim
  >;
  task_workspace_evaluation_lease_release: CommandSpec<
    { evaluationLease: TaskWorkspaceEvaluationLeaseClaim },
    void
  >;
  task_workspace_resume_compatibility: CommandSpec<
    TaskWorkspaceResumeCompatibilityArgs,
    TaskWorkspaceResumeCompatibility
  >;
  task_workspace_interrupted_run_cancel: CommandSpec<
    Omit<TaskWorkspaceResumeCompatibilityArgs, 'access' | 'historyId'> & {
      historyId?: string | null;
    },
    void
  >;
  task_workspace_deletion_preflight: CommandSpec<
    {
      scope: 'conversation' | 'project' | 'company';
      companyId: string;
      projectId?: string | null;
      threadId?: string | null;
    },
    TaskWorkspaceDeletionPreflight
  >;
  git_exec: CommandSpec<
    {
      args: string[];
      projectId: string;
      cwd?: string | null;
      bindingClaim?: TaskWorkspaceBindingClaim | null;
      evaluationLease?: TaskWorkspaceEvaluationLeaseClaim | null;
    },
    GitExecResult
  >;
  gh_exec: CommandSpec<{ args: string[]; projectId: string }, GhExecResult>;
  workspace_lease_list: CommandSpec<{ projectId: string }, WorkspaceLeaseLifecycleRow[]>;
  workspace_lease_changed: CommandSpec<
    { projectId: string; leaseId: string; path: string },
    boolean
  >;
  workspace_lease_apply_patch: CommandSpec<
    { projectId: string; leaseId: string; path: string; patch: string; reverse: true },
    void
  >;
  workspace_lease_release: CommandSpec<{ projectId: string; leaseId: string; path: string }, void>;
  workspace_lease_discard: CommandSpec<{ projectId: string; leaseId: string; path: string }, void>;
  workspace_checkpoint_timeline: CommandSpec<{ projectId: string }, WorkspaceCheckpointTimeline>;
  workspace_checkpoint_rollback: CommandSpec<
    {
      projectId: string;
      leaseId: string;
      path: string;
      checkpointId: string;
      actor: string;
    },
    WorkspaceCheckpointRollbackRow
  >;
  open_local_path: CommandSpec<{ projectId: string | null; path: string }, void>;
  reveal_local_path: CommandSpec<{ projectId: string | null; path: string }, void>;
  delete_company_workspace: CommandSpec<{ companyId: string }, void>;
  runtime_vault_status: CommandSpec<undefined, RuntimeVaultStatus>;
  open_runtime_vault_folder: CommandSpec<undefined, void>;
  runtime_vault_read_file: CommandSpec<{ path: string }, string>;
  runtime_vault_write_file: CommandSpec<{ path: string; content: string }, void>;
  runtime_vault_list_dir: CommandSpec<{ path: string }, string[]>;
  runtime_vault_stat: CommandSpec<{ path: string }, RuntimeVaultFileStat | null>;
  runtime_vault_remove: CommandSpec<{ path: string }, void>;
  runtime_vault_mkdir: CommandSpec<{ path: string }, void>;
  export_runtime_vault_zip: CommandSpec<undefined, LocalExportResult>;
  export_computer_run_trace: CommandSpec<
    { threadId: string; runId: string; traceJson: string },
    LocalExportResult
  >;
  export_scene_drop_diagnostic: CommandSpec<{ diagnosticsJson: string }, LocalExportResult>;
  save_deliverable_to_local: CommandSpec<
    { projectId: string; fileName: string; content: string },
    string
  >;
  mcp_list_registered_servers: CommandSpec<undefined, RegisteredMcpServerSummary[]>;
  mcp_register_server: CommandSpec<
    { input: McpServerRegistrationInput },
    RegisteredMcpServerSummary
  >;
  mcp_unregister_server: CommandSpec<{ serverId: string }, void>;
  mcp_connect_registered: CommandSpec<{ request: McpConnectRequest }, McpSpawnResult>;
  mcp_call_tool: CommandSpec<
    { server: string; tool: string; arguments?: unknown | null },
    McpToolCallResult
  >;
  mcp_kill: CommandSpec<{ server: string }, void>;
  mcp_list_servers: CommandSpec<undefined, McpServerStatus[]>;
  attachment_write: CommandSpec<{ meta: AttachmentMeta; bytes: number[] }, string>;
  attachment_read: CommandSpec<
    { vaultRef: string; maxBytes?: number | null },
    { meta: AttachmentMeta; bytes: number[] }
  >;
  attachment_list: CommandSpec<{ companyId: string; threadId: string }, AttachmentMeta[]>;
  attachment_list_all: CommandSpec<undefined, AttachmentMeta[]>;
  attachment_delete: CommandSpec<{ vaultRef: string }, void>;
  attachment_delete_company: CommandSpec<{ companyId: string }, void>;
  secret_encrypt: CommandSpec<{ plaintext: string }, string>;
  secret_decrypt: CommandSpec<{ envelope: string }, string>;
}

type CommandName = keyof CommandMap;
export type CommandArgs<K extends CommandName> = CommandMap[K]['args'];
export type CommandResult<K extends CommandName> = CommandMap[K]['result'];

export type CommandWithoutArgs = {
  [K in CommandName]: CommandArgs<K> extends undefined ? K : never;
}[CommandName];

export type CommandWithArgs = Exclude<CommandName, CommandWithoutArgs>;

type TauriInvoke = typeof import('@tauri-apps/api/core')['invoke'];
let invokePromise: Promise<TauriInvoke> | undefined;

async function loadInvoke(): Promise<TauriInvoke> {
  invokePromise ??= import('@tauri-apps/api/core').then(({ invoke }) => invoke);
  return invokePromise;
}

export function invokeCommand<K extends CommandWithoutArgs>(command: K): Promise<CommandResult<K>>;
export function invokeCommand<K extends CommandWithArgs>(
  command: K,
  args: CommandArgs<K>,
): Promise<CommandResult<K>>;
export async function invokeCommand<K extends keyof CommandMap>(
  command: K,
  args?: CommandArgs<K>,
): Promise<CommandResult<K>> {
  const invoke = await loadInvoke();
  return args === undefined
    ? invoke<CommandResult<K>>(command)
    : invoke<CommandResult<K>>(command, args as Record<string, unknown>);
}
