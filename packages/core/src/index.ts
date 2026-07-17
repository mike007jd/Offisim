// @offisim/core — Phase 6 Install Pipeline

// --- Types ---
export type {
  RuntimeContext,
  InteractionBox,
  DisposableRuntime,
} from './runtime/runtime-context.js';
export type { HookEvent, HookDefinition } from './runtime/hook-registry.js';
export type { ScratchpadEntry } from './runtime/scratchpad.js';
export type {
  RuntimeRepositories,
  CompanyRow,
  EmployeeRow,
  TaskRunRow,
  GraphThreadRow,
  ToolCallRow,
  HandoffEventRow,
  MeetingSessionRow,
  RuntimeEventRow,
  LlmCallRow,
  NewGraphThread,
  NewTaskRun,
  NewToolCall,
  NewHandoffEvent,
  NewMeetingSession,
  NewRuntimeEvent,
  NewLlmCall,
  LlmCallRepository,
  CompanyRepository,
  EmployeeRepository,
  EmployeeCreate,
  EmployeeUpdate,
  ThreadRepository,
  TaskRunRepository,
  ToolCallRepository,
  HandoffRepository,
  MeetingRepository,
  EventRepository,
  McpAuditRepository,
  McpAuditRow,
  FileHistoryRepository,
  FileHistoryRow,
  CompactSummaryRepository,
  CompactSummaryRow,
  NewMcpAudit,
  NewToolPermissionApproval,
  ToolPermissionApprovalRepository,
  ToolPermissionApprovalRow,
  NewFileHistory,
  NewCompactSummary,
  NewNodeSummary,
  AgentEventRepository,
  AgentEventRow,
  NewAgentEvent,
  RecoveryKnowledgeRepository,
  RecoveryKnowledgeRow,
  NewRecoveryKnowledge,
  MemoryEntryRow,
  MemoryEntryCreate,
  MemoryRepository,
  EmployeeProjectMemoryType,
  EmployeeProjectMemoryRow,
  NewEmployeeProjectMemory,
  EmployeeProjectMemoryPatch,
  EmployeeProjectMemoryRepository,
  NodeSummaryRepository,
  NodeSummaryRow,
  EmployeeVersionRow,
  EmployeeVersionChangeType,
  NewEmployeeVersion,
  EmployeeVersionRepository,
  ModelCostRateRow,
  NewModelCostRate,
  ModelCostRateRepository,
  RackRow,
  NewRack,
  RackRepository,
  SlotRow,
  NewSlot,
  SlotRepository,
  WorkstationRackRow,
  NewWorkstationRack,
  WorkstationRackRepository,
  LibraryDocumentRow,
  NewLibraryDocument,
  LibraryDocumentRepository,
  OfficeLayoutRow,
  NewOfficeLayout,
  OfficeLayoutRepository,
} from './runtime/repositories.js';
export type { InstallTransactionRepository } from './repos/install-transaction-repository.js';
export type { InstalledPackageRepository } from './repos/installed-package-repository.js';
export type { InstalledAssetRepository } from './repos/installed-asset-repository.js';
export type { AssetBindingRepository } from './repos/asset-binding-repository.js';
export type { PrefabInstanceRepository } from './repos/prefab-instance-repository.js';
export type { ZoneRepository, NewZone } from './repos/zone-repository.js';
export { createMemoryPrefabRepository } from './runtime/repos/workspace/memory.js';
export { PrefabService } from './services/prefab-service.js';
export { ZoneService, hydrateZone, dehydrateZone } from './services/zone-service.js';
export type {
  LlmGateway,
  LlmRequest,
  LlmResponse,
  LlmMessage,
  ToolDef,
  ToolCallResult,
  LlmUsage,
  LlmStreamChunk,
} from './llm/gateway.js';
export type { EventBus, EventHandler } from './events/event-bus.js';
export type { ToolExecutor, ToolCallRequest, ToolCallResponse } from './runtime/tool-executor.js';
export {
  WORKSTATION_ACCESS_DENIED,
  TOOL_PERMISSION_DENIED,
  TOOL_PERMISSION_REQUIRED,
} from './runtime/tool-executor.js';
export type { RetryConfig } from './llm/retry.js';
export type { TeeResult } from './llm/stream-tee.js';

// --- Factories ---
export { createRuntimeContext, disposeRuntime } from './runtime/runtime-context.js';
export { RunConversationState } from './runtime/run-conversation-state.js';
export type {
  RunActiveContextSnapshot,
  RunBudgetSnapshot,
  RunCancellationSnapshot,
  RunConversationStateSnapshot,
  RunDiscoveredToolRecord,
  RunDiscoveredToolSnapshot,
  RunPermissionDenialRecord,
  RunRetrySnapshot,
  RunToolResultRecord,
} from './runtime/run-conversation-state.js';
export { HookRegistry } from './runtime/hook-registry.js';
export { Scratchpad } from './runtime/scratchpad.js';
export {
  createMemoryRepositories,
  MemoryCompactSummaryRepository,
  MemoryMcpAuditRepository,
  MemoryNodeSummaryRepository,
  MemoryEmployeeVersionRepository,
  MemoryModelCostRateRepository,
  MemoryRackRepository,
  MemorySlotRepository,
  MemoryWorkstationRackRepository,
  MemoryLibraryDocumentRepository,
  MemoryOfficeLayoutRepository,
} from './runtime/memory-repositories.js';
export type { MemoryRepositoriesSnapshot } from './runtime/memory-repositories.js';
// Drizzle repositories: import from '@offisim/core/drizzle'
export { createMemoryInstallRepositories } from './runtime/repos/install/memory.js';
export type { MemoryInstallRepositoriesSnapshot } from './runtime/repos/install/memory.js';
export {
  MemoryInstallTransactionRepository,
  MemoryInstalledPackageRepository,
  MemoryInstalledAssetRepository,
  MemoryAssetBindingRepository,
} from './runtime/repos/install/memory.js';

// --- LLM-shaped support types/utilities ---
// Offisim no longer exposes provider SDK adapters or a model catalog. Pi Agent
// owns auth, model resolution, session lifecycle, and provider transport.
export { teeStream } from './llm/stream-tee.js';
export { recordedLlmCall, recordedLlmStream } from './llm/recorded-call.js';
export { replayRequestHashes } from './llm/replay-request-hashes.js';
export type { ReplayRequestHashes } from './llm/replay-request-hashes.js';
export { RecordedSystemLlmCaller } from './llm/recorded-system-caller.js';
export type { SystemLlmCallerDeps } from './llm/recorded-system-caller.js';
export { microCompactMessages } from './services/conversation-budget/micro-compact.js';
export type {
  MicroCompactOptions,
  MicroCompactResult,
} from './services/conversation-budget/micro-compact.js';
export type { RecentToolResult } from './runtime/completion-verifier.js';

// --- Middleware ---
export { LlmMiddlewareChain } from './middleware/chain.js';
export type { LlmMiddleware, LlmCallContext, LlmCallMeta } from './middleware/types.js';
export { SummarizationMiddleware } from './middleware/builtin/summarization-middleware.js';
export { NodeContextMiddleware } from './middleware/builtin/node-context-middleware.js';

// --- Utilities ---
export { extractJsonFromLlm } from './utils/extract-json.js';
export { generateId } from './utils/generate-id.js';
export { globToRegex, matchCostRate } from './utils/glob-match.js';

// --- Events ---
export { InMemoryEventBus } from './events/event-bus.js';
export { InMemoryMemoryRepository } from './runtime/repos/memory-system/memory.js';
export {
  employeeStateChanged,
  companyStartupRequested,
  companyStartupStarted,
  companyStartupCompleted,
  companyStartupSkipped,
  companyStartupFailed,
  taskStateChanged,
  taskAssignmentChanged,
  taskAssignmentRerouted,
  meetingStateChanged,
  llmCallStarted,
  llmCallCompleted,
  llmUsageRecorded,
  costSessionUpdated,
  bossRouteDecided,
  graphNodeEntered,
  graphNodeExited,
  llmStreamChunk,
  toolExecutionTelemetry,
  installStateChanged,
  bindingStateChanged,
  marketListingInstalled,
  planCreated,
  planStepStarted,
  planStepCompleted,
  planCompleted,
  workspaceBindingUnavailable,
  mcpServerConnected,
  mcpToolCalled,
  mcpToolResult,
  employeeCreated,
  employeeUpdated,
  employeeDeleted,
  employeeInstalled,
  engineActivity,
  engineProposalCreated,
  errorOccurred,
  deliverableCreated,
  directChatStarted,
  directChatCompleted,
  meetingActionCreated,
  handoffInitiated,
  handoffCompleted,
  memoryCreated,
  memoryAccessed,
  employeeWorkstationChanged,
  employeeVersionCreated,
  bossEmployeeContextEmpty,
  bossRosterDivergence,
  rackBound,
  rackUnbound,
  slotAssigned,
  slotRemoved,
  hrAssessmentStarted,
  hrAssessmentCompleted,
  hrRecommendation,
  notificationCreated,
  notificationDismissed,
} from './events/event-factories.js';

// --- Logger ---
export { Logger, setLogHandler, resetLogHandler } from './services/logger.js';
export type { LogLevel, LogEntry } from './services/logger.js';

export { EmployeeVersionService } from './runtime/employee-version-service.js';
export type { VersionDiff } from './runtime/employee-version-service.js';
export { RackSlotService } from './services/rack-slot-service.js';
export type { RackWithSlots } from './services/rack-slot-service.js';
export { WorkstationToolResolver } from './services/workstation-tool-resolver.js';
export type { WorkstationToolResolverDeps } from './services/workstation-tool-resolver.js';
export { CompanyTemplateService } from './services/company-template-service.js';
export type {
  CompanyTemplateDefinition,
  TemplateEmployeeDefinition,
  TemplateEmployeePersona,
  TemplatePersonaProfile,
  TemplatePresentation,
  TemplateZoneBlueprint,
} from './templates/index.js';
export {
  listTemplates,
  getTemplate,
  serializeTemplatePersona,
} from './templates/index.js';

// --- Runtime ---
export { UnconfiguredToolExecutor } from './runtime/tool-executor.js';
export { WorkstationAssignmentService } from './runtime/workstation-assignment-service.js';

// --- MCP ---
export { McpToolExecutor } from './mcp/mcp-tool-executor.js';
export { McpConfigLoader } from './mcp/mcp-config-loader.js';
export type {
  McpConfigFile,
  McpServerConfigEntry,
  McpConfigLoaderOptions,
  McpExecutorLike,
} from './mcp/mcp-config-loader.js';
// Core exposes MCP executor/config/types only; browser and desktop runtimes own
// their environment-specific MCP client factories.
export type {
  McpServerConfig,
  McpConnection,
  McpClientFactory,
  McpToolDef,
  McpResourceDef,
  McpPromptDef,
  McpServerCapabilities,
  McpOperationOptions,
  ToolApprovalMode,
  ToolPermissionPolicy,
} from './mcp/types.js';

// --- A2A (Agent-to-Agent Protocol) ---
export { A2AClient } from './a2a/index.js';
export { A2ARequestHandler } from './a2a/index.js';
export type {
  A2AHttpRequest,
  A2AHttpResponse,
  A2AServerConfig,
  A2ATaskHandler,
  A2AAgentCapabilities,
  A2AAgentCard,
  A2AAgentInterface,
  A2AArtifact,
  A2AConfig,
  A2AMessage,
  A2APart,
  A2APeer,
  A2ASendMessageResult,
  A2ASkill,
  A2ATask,
  A2ATaskState,
  A2ATaskStatus,
} from './a2a/index.js';

// --- Built-in Tools ---
export {
  createBuiltinTools,
  createBashTool,
  createFileReadTool,
  createFileWriteTool,
  createWebSearchTool,
} from './tools/builtin/index.js';
export type {
  BuiltinTool,
  BuiltinToolConfig,
  ShellExec,
  ShellExecResult,
  ShellExecOptions,
  FsAdapter,
} from './tools/builtin/index.js';
export { CompositeToolExecutor } from './tools/composite-tool-executor.js';
export type {
  RegisteredTool,
  RuntimeToolSource,
  RuntimeToolType,
  ToolRegistrySurface,
} from './tools/tool-registry.js';

// --- Skills (two-tier: company-global + employee-specific) ---
export { scanSkillDir } from './skills/skill-scanner.js';
export { resolveUploadSource } from './skills/skill-source-resolvers/upload.js';
export { resolveGitSource } from './skills/skill-source-resolvers/git.js';
export { isResolverError } from './skills/skill-source-resolvers/types.js';
export type {
  ScannedSkill,
  SkillResolverError,
  SkillResolverErrorKind,
  VirtualFile,
  VirtualTree,
} from './skills/skill-source-resolvers/types.js';
export type {
  GitCloneAdapter,
  GitHttpFetch,
  GitLocalFsAdapter,
} from './skills/skill-source-resolvers/git.js';
export type {
  SkillRepository,
  SkillUpdate,
  NewSkill,
} from './runtime/repositories.js';

// --- Errors ---
export { OffisimError, LlmError, GraphError, DataError, toErrorMessage } from './errors.js';
