// @aics/core — Phase 6 Install Pipeline

// --- Types ---
export type {
  RuntimeContext,
  MeetingInterruptBox,
  DisposableRuntime,
} from './runtime/runtime-context.js';
export type {
  RuntimeRepositories,
  CompanyRow,
  EmployeeRow,
  TaskRunRow,
  GraphThreadRow,
  ToolCallRow,
  HandoffEventRow,
  MeetingSessionRow,
  GraphCheckpointRow,
  RuntimeEventRow,
  LlmCallRow,
  NewGraphThread,
  NewTaskRun,
  NewToolCall,
  NewHandoffEvent,
  NewMeetingSession,
  NewGraphCheckpoint,
  NewRuntimeEvent,
  NewLlmCall,
  LlmCallRepository,
  CheckpointRepository,
  CompanyRepository,
  EmployeeRepository,
  EmployeeUpdate,
  ThreadRepository,
  TaskRunRepository,
  ToolCallRepository,
  HandoffRepository,
  MeetingRepository,
  EventRepository,
  McpAuditRepository,
  McpAuditRow,
  NewMcpAudit,
  MemoryEntryRow,
  MemoryEntryCreate,
  MemoryRepository,
  EmployeeVersionRow,
  EmployeeVersionChangeType,
  NewEmployeeVersion,
  EmployeeVersionRepository,
  ModelCostRateRow,
  NewModelCostRate,
  ModelCostRateRepository,
  SopTemplateRow,
  NewSopTemplate,
  SopTemplateRepository,
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
  UserPreferenceRow,
  UserPreferenceCreate,
  UserPreferenceCategory,
  UserPreferenceRepository,
} from './runtime/repositories.js';
export type { InstallTransactionRepository } from './repos/install-transaction-repository.js';
export type { InstalledPackageRepository } from './repos/installed-package-repository.js';
export type { InstalledAssetRepository } from './repos/installed-asset-repository.js';
export type { AssetBindingRepository } from './repos/asset-binding-repository.js';
export type { PrefabInstanceRepository } from './repos/prefab-instance-repository.js';
export { createMemoryPrefabRepository } from './runtime/memory-prefab-repository.js';
export { PrefabService } from './services/prefab-service.js';
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
export { WORKSTATION_ACCESS_DENIED } from './runtime/tool-executor.js';
export type {
  AicsGraphState,
  PendingAssignment,
  TaskPlan,
  PlanStep,
  PlanTask,
  ManagerDirective,
  StepTaskOutput,
  StepResult,
  CitationRef,
} from './graph/state.js';
export type { BuildGraphOptions } from './graph/main-graph.js';
export type { RetryConfig } from './llm/retry.js';
export type { TeeResult } from './llm/stream-tee.js';
export type { ExecutionTrace, ExecutionTraceService } from './services/execution-trace-service.js';
export type { ThreadForkService } from './services/thread-fork-service.js';

// --- Factories ---
export { buildAicsGraph } from './graph/main-graph.js';
export { createRuntimeContext, disposeRuntime } from './runtime/runtime-context.js';
export { createCheckpointSaver, createMemoryCheckpointSaver } from './graph/checkpoint-saver.js';
export {
  createMemoryRepositories,
  MemoryMcpAuditRepository,
  MemoryEmployeeVersionRepository,
  MemoryModelCostRateRepository,
  MemorySopTemplateRepository,
  MemoryRackRepository,
  MemorySlotRepository,
  MemoryWorkstationRackRepository,
  MemoryLibraryDocumentRepository,
  MemoryOfficeLayoutRepository,
} from './runtime/memory-repositories.js';
// Drizzle repositories: import from '@aics/core/drizzle'
export { createMemoryInstallRepositories } from './runtime/memory-install-repos.js';
export {
  MemoryInstallTransactionRepository,
  MemoryInstalledPackageRepository,
  MemoryInstalledAssetRepository,
  MemoryAssetBindingRepository,
} from './runtime/memory-install-repos.js';

// --- LLM ---
export { AnthropicAdapter } from './llm/anthropic-adapter.js';
export type { AnthropicAdapterOptions } from './llm/anthropic-adapter.js';
export { OpenAiAdapter } from './llm/openai-adapter.js';
export type { OpenAiAdapterOptions } from './llm/openai-adapter.js';
export { SubscriptionAdapter } from './llm/subscription-adapter.js';
export type { SubscriptionAdapterOptions } from './llm/subscription-adapter.js';
export { createGateway } from './llm/gateway-factory.js';
export type { GatewayConfig } from './llm/gateway-factory.js';
export { ModelResolver } from './llm/model-resolver.js';
export { ModelRegistry } from './llm/model-registry.js';
export type { ModelRegistryConfig, ModelRegistryEntry } from './llm/model-registry.js';
export { DEFAULT_RETRY_CONFIG, withRetry } from './llm/retry.js';
export { teeStream } from './llm/stream-tee.js';
export { recordedLlmCall, recordedLlmStream } from './llm/recorded-call.js';
export type { RecordedCallMeta } from './llm/recorded-call.js';

// --- Middleware ---
export { LlmMiddlewareChain } from './middleware/chain.js';
export type { LlmMiddleware, LlmCallContext, LlmCallMeta } from './middleware/types.js';
export { UserPreferenceMiddleware } from './middleware/builtin/user-preference-middleware.js';
export { SummarizationMiddleware } from './middleware/builtin/summarization-middleware.js';

// --- User Memory ---
export { UserMemoryService } from './services/user-memory-service.js';
export { MemoryUserPreferenceRepository } from './repositories/memory-user-preference-repository.js';

// --- Utilities ---
export { extractJsonFromLlm } from './utils/extract-json.js';
export { generateId } from './utils/generate-id.js';
export { globToRegex, matchCostRate } from './utils/glob-match.js';

// --- Events ---
export { InMemoryEventBus } from './events/event-bus.js';
export { InMemoryMemoryRepository } from './repositories/memory-memory-repository.js';
export {
  employeeStateChanged,
  taskStateChanged,
  taskAssignmentChanged,
  meetingStateChanged,
  llmCallStarted,
  llmCallCompleted,
  llmUsageRecorded,
  graphNodeEntered,
  graphNodeExited,
  llmStreamChunk,
  installStateChanged,
  bindingStateChanged,
  planCreated,
  planStepStarted,
  planStepCompleted,
  planCompleted,
  mcpServerConnected,
  mcpToolCalled,
  mcpToolResult,
  employeeCreated,
  employeeUpdated,
  employeeDeleted,
  employeeInstalled,
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

// --- Services ---
export { ExecutionTraceServiceImpl } from './services/execution-trace-service.js';
export { ThreadForkServiceStub } from './services/thread-fork-service.js';
export { OrchestrationService } from './services/orchestration-service.js';
export { EmployeeVersionService } from './runtime/employee-version-service.js';
export type { VersionDiff } from './runtime/employee-version-service.js';
export { CostCalculationService } from './runtime/cost-calculation-service.js';
export { SopService } from './services/sop-service.js';
export { RackSlotService } from './services/rack-slot-service.js';
export type { RackWithSlots } from './services/rack-slot-service.js';
export { WorkstationToolResolver } from './services/workstation-tool-resolver.js';
export type { WorkstationToolResolverDeps } from './services/workstation-tool-resolver.js';
export { LibraryService } from './services/library-service.js';
export type { CitationEntry } from './services/library-service.js';
export { NotificationBridge } from './services/notification-bridge.js';
export { CompanyTemplateService } from './services/company-template-service.js';
export type { CompanyTemplate, CompanyTemplateEmployee } from './templates/index.js';
export { listTemplates, getTemplate } from './templates/index.js';
export type { CostAggregate, DashboardSummary } from './runtime/cost-calculation-service.js';
export { DEFAULT_COST_RATES } from './runtime/default-cost-rates.js';

// --- Runtime ---
export { MockToolExecutor } from './runtime/tool-executor.js';
export { WorkstationAssignmentService } from './runtime/workstation-assignment-service.js';

// --- MCP ---
export { McpToolExecutor } from './mcp/mcp-tool-executor.js';
export { AuditingToolExecutor } from './mcp/auditing-tool-executor.js';
export { McpConfigLoader } from './mcp/mcp-config-loader.js';
export type {
  McpConfigFile,
  McpServerConfigEntry,
  McpConfigLoaderOptions,
  McpExecutorLike,
} from './mcp/mcp-config-loader.js';
// NOTE: SdkClientFactory intentionally NOT in barrel — imports node:stream/child_process
// which breaks browser builds. Use direct import in Node.js/Tauri environments:
//   import { SdkClientFactory } from '@aics/core/dist/mcp/sdk-client-factory.js';
export type {
  McpServerConfig,
  McpConnection,
  McpClientFactory,
  McpToolDef,
  ToolApprovalMode,
  ToolPermissionPolicy,
} from './mcp/types.js';

// --- Agent Nodes ---
export { bossNode } from './agents/boss-node.js';
export { managerNode } from './agents/manager-node.js';
export { employeeNode, extractUsedCitations } from './agents/employee-node.js';
export { employeeDirectSetupNode } from './agents/employee-direct-setup-node.js';
export { errorHandlerNode } from './agents/error-handler-node.js';
export { bossSummaryNode } from './agents/boss-summary-node.js';
export { buildEmployeePrompt } from './agents/employee-builder.js';

// --- Meeting ---
export {
  meetingStartNode,
  participantTurnNode,
  meetingTurnCheck,
  meetingEndNode,
  meetingPausedNode,
  meetingResumeNode,
  meetingResumeCheck,
  meetingInjectNode,
} from './graph/meeting-subgraph.js';
export type { MeetingInterrupt, MeetingInterruptType } from './graph/state.js';

// --- A2A (Agent-to-Agent Protocol) ---
export { A2AClient } from './a2a/index.js';
export { A2ARequestHandler } from './a2a/index.js';
export type {
  A2AHttpRequest,
  A2AHttpResponse,
  A2AServerConfig,
  A2ATaskHandler,
  A2AAgentCard,
  A2AArtifact,
  A2AConfig,
  A2AMessage,
  A2APart,
  A2APeer,
  A2ASkill,
  A2ATask,
  A2ATaskState,
  A2ATaskStatus,
  A2ATextPart,
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

// --- Errors ---
export { AicsError, LlmError, GraphError, DataError } from './errors.js';
