// @aics/core — Phase 6 Install Pipeline

// --- Types ---
export type { RuntimeContext } from './runtime/runtime-context.js';
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
  NewEmployeeVersion,
  EmployeeVersionRepository,
  ModelCostRateRow,
  NewModelCostRate,
  ModelCostRateRepository,
} from './runtime/repositories.js';
export type { InstallTransactionRepository } from './repos/install-transaction-repository.js';
export type { InstalledPackageRepository } from './repos/installed-package-repository.js';
export type { InstalledAssetRepository } from './repos/installed-asset-repository.js';
export type { AssetBindingRepository } from './repos/asset-binding-repository.js';
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
export type {
  AicsGraphState,
  PendingAssignment,
  TaskPlan,
  PlanStep,
  PlanTask,
  ManagerDirective,
  StepTaskOutput,
  StepResult,
} from './graph/state.js';
export type { BuildGraphOptions } from './graph/main-graph.js';
export type { RetryConfig } from './llm/retry.js';
export type { TeeResult } from './llm/stream-tee.js';
export type { ExecutionTrace, ExecutionTraceService } from './services/execution-trace-service.js';
export type { ThreadForkService } from './services/thread-fork-service.js';

// --- Factories ---
export { buildAicsGraph } from './graph/main-graph.js';
export { createRuntimeContext } from './runtime/runtime-context.js';
export { createCheckpointSaver, createMemoryCheckpointSaver } from './graph/checkpoint-saver.js';
export {
  createMemoryRepositories,
  MemoryMcpAuditRepository,
  MemoryEmployeeVersionRepository,
  MemoryModelCostRateRepository,
} from './runtime/memory-repositories.js';
export { createDrizzleRepositories } from './runtime/drizzle-repositories.js';
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
export { createGateway } from './llm/gateway-factory.js';
export type { GatewayConfig } from './llm/gateway-factory.js';
export { ModelResolver } from './llm/model-resolver.js';
export { DEFAULT_RETRY_CONFIG, withRetry } from './llm/retry.js';
export { teeStream } from './llm/stream-tee.js';
export { recordedLlmCall, recordedLlmStream } from './llm/recorded-call.js';

// --- Utilities ---
export { extractJsonFromLlm } from './utils/extract-json.js';
export { generateId } from './utils/generate-id.js';

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
} from './events/event-factories.js';

// --- Services ---
export { ExecutionTraceServiceImpl } from './services/execution-trace-service.js';
export { ThreadForkServiceStub } from './services/thread-fork-service.js';
export { OrchestrationService } from './services/orchestration-service.js';
export { EmployeeVersionService } from './runtime/employee-version-service.js';
export type { VersionDiff } from './runtime/employee-version-service.js';
export { CostCalculationService } from './runtime/cost-calculation-service.js';
export type { CostAggregate } from './runtime/cost-calculation-service.js';
export { DEFAULT_COST_RATES } from './runtime/default-cost-rates.js';

// --- Runtime ---
export { MockToolExecutor } from './runtime/tool-executor.js';
export { WorkstationAssignmentService } from './runtime/workstation-assignment-service.js';

// --- MCP ---
export { McpToolExecutor } from './mcp/mcp-tool-executor.js';
export { AuditingToolExecutor } from './mcp/auditing-tool-executor.js';
// NOTE: SdkClientFactory intentionally NOT in barrel — imports node:stream/child_process
// which breaks browser builds. Use direct import in Node.js/Tauri environments:
//   import { SdkClientFactory } from '@aics/core/dist/mcp/sdk-client-factory.js';
export type { McpServerConfig, McpConnection, McpClientFactory, McpToolDef, ToolApprovalMode, ToolPermissionPolicy } from './mcp/types.js';

// --- Agent Nodes ---
export { bossNode } from './agents/boss-node.js';
export { managerNode } from './agents/manager-node.js';
export { employeeNode } from './agents/employee-node.js';
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
} from './graph/meeting-subgraph.js';

// --- Errors ---
export { AicsError, LlmError, GraphError, DataError } from './errors.js';
