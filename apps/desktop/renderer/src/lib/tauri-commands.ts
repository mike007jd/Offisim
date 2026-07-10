import type { AgentRunUsage, AttachmentMeta, CollaborationProfile } from '@offisim/shared-types';
import type { Channel } from '@tauri-apps/api/core';

interface LocalDbTransactionStatement {
  sql: string;
  params?: readonly unknown[];
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

interface PiAgentExecuteRequest {
  requestId: string;
  text: string;
  companyId: string;
  threadId: string;
  cwd?: string | null;
  projectId?: string | null;
  employeeId?: string | null;
  model?: string | null;
  permissionMode?: string | null;
  thinkingLevel?: string | null;
  systemPromptAppend?: string | null;
  rootRunId?: string | null;
  roster?: unknown;
  missionContextJson?: string | null;
  mcpTools?: unknown;
}

interface PiAgentEnhanceRequest {
  requestId: string;
  text: string;
  systemPrompt: string;
  model?: string | null;
  thinkingLevel?: string | null;
}

interface PiAgentCollaborateRequest {
  requestId: string;
  text: string;
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
  usage?: AgentRunUsage;
}

type PiAgentHostEvent =
  | {
      kind: 'started';
      sessionId?: string;
      sessionFile?: string;
      model?: PiAgentModelSummary;
      modelFallbackMessage?: string;
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

interface PiAgentProviderModelConfig {
  id: string;
  name?: string;
  api?: string;
  contextWindow?: number;
  maxTokens?: number;
}

interface PiAgentProviderConfigStatus {
  provider: string;
  displayName: string;
  name?: string;
  baseUrl?: string;
  api?: string;
  hasApiKey: boolean;
  authSource?: string;
  models: PiAgentProviderModelConfig[];
}

interface PiAgentProviderTemplate {
  provider: string;
  displayName: string;
  baseUrl?: string;
  api?: string;
  configured: boolean;
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

interface PiAgentProviderModelInput {
  id: string;
  name?: string | null;
  api?: string | null;
  contextWindow?: number | null;
  maxTokens?: number | null;
}

interface PiAgentProviderConfigInput {
  providerId: string;
  displayName?: string | null;
  baseUrl: string;
  api: string;
  apiKey?: string | null;
  keepExistingApiKey?: boolean;
  models?: PiAgentProviderModelInput[];
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

type CommandSpec<TArgs, TResult> = {
  args: TArgs;
  result: TResult;
};

export interface CommandMap {
  local_db_url: CommandSpec<undefined, string>;
  local_db_execute_transaction: CommandSpec<{ statements: LocalDbTransactionStatement[] }, void>;
  project_read_file: CommandSpec<ProjectPathArgs, string>;
  project_read_file_lines: CommandSpec<
    ProjectPathArgs & { offset: number; limit?: number | null },
    string
  >;
  project_read_file_preview: CommandSpec<
    ProjectPathArgs & { maxBytes: number },
    ProjectFilePreview
  >;
  project_preview_meta: CommandSpec<
    { path: string; projectId?: string | null },
    ProjectPreviewMeta
  >;
  project_read_file_bytes: CommandSpec<
    { path: string; projectId?: string | null; maxBytes?: number },
    ArrayBuffer | Uint8Array | number[]
  >;
  project_exists: CommandSpec<ProjectPathArgs, boolean>;
  project_list_dir: CommandSpec<ProjectPathArgs, ProjectDirEntry[]>;
  project_write_file: CommandSpec<ProjectPathArgs & { content: string }, void>;
  bash_execute: CommandSpec<
    {
      cwd: string;
      cmd: string;
      timeoutMs: number;
      maxOutputBytes?: number | null;
      projectId?: string | null;
      approvalId?: string | null;
      employeeId?: string | null;
      networkPolicy?: string | null;
    },
    BashExecuteResult
  >;
  pi_agent_execute: CommandSpec<AgentRuntimeArgs<PiAgentExecuteRequest>, PiAgentHostResponse>;
  pi_agent_abort: CommandSpec<{ requestId: string }, void>;
  pi_agent_ui_response: CommandSpec<AgentUiResponseArgs, void>;
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
  agent_runtime_answer: CommandSpec<AgentUiResponseArgs, void>;
  agent_runtime_stream_snapshot: CommandSpec<{ requestId: string }, PiRunStreamSnapshot | null>;
  agent_runtime_release_stream: CommandSpec<{ requestId: string }, void>;
  agent_runtime_reattach: CommandSpec<
    { requestId: string; afterCursor?: number | null; onEvent: Channel<PiAgentHostEvent> },
    PiRunStreamSnapshot
  >;
  agent_runtime_status: CommandSpec<undefined, PiAgentStatusResponse>;
  computer_driver_status: CommandSpec<undefined, ComputerDriverStatus>;
  git_exec: CommandSpec<{ args: string[]; projectId: string; cwd?: string | null }, GitExecResult>;
  open_local_path: CommandSpec<{ projectId: string | null; path: string }, void>;
  reveal_local_path: CommandSpec<{ projectId: string | null; path: string }, void>;
  ensure_company_workspace: CommandSpec<{ companyId: string }, string>;
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
