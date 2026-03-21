/**
 * @aics/core/browser — Browser-safe barrel export.
 *
 * This subpath exports ONLY modules that are safe to import in browser bundles
 * without pulling in heavy server-side dependencies (LangGraph, OpenAI SDK,
 * Anthropic SDK, checkpoint-sqlite, MCP SDK).
 *
 * Use `@aics/core/browser` in UI packages and browser-only code.
 * Use `@aics/core` for the full runtime (graphs, LLM adapters, MCP, etc.).
 */

// --- Types (all type-only, zero runtime cost) ---
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
  CitationRef,
} from './graph/state.js';
export type { RetryConfig } from './llm/retry.js';
export type { TeeResult } from './llm/stream-tee.js';
export type { ExecutionTrace, ExecutionTraceService } from './services/execution-trace-service.js';
export type { ThreadForkService } from './services/thread-fork-service.js';
export type { VersionDiff } from './runtime/employee-version-service.js';
export type { CostAggregate, DashboardSummary } from './runtime/cost-calculation-service.js';
export type { CompanyTemplate, CompanyTemplateEmployee } from './templates/index.js';
export type {
  McpServerConfig,
  McpConnection,
  McpClientFactory,
  McpToolDef,
  ToolApprovalMode,
  ToolPermissionPolicy,
} from './mcp/types.js';
export type { LogLevel, LogEntry } from './services/logger.js';
export type { RackWithSlots } from './services/rack-slot-service.js';
export type { WorkstationToolResolverDeps } from './services/workstation-tool-resolver.js';

// --- Events (lightweight, no heavy deps) ---
export { InMemoryEventBus } from './events/event-bus.js';
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

// --- Memory Repositories (browser-safe, no Drizzle/sqlite) ---
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
export { InMemoryMemoryRepository } from './repositories/memory-memory-repository.js';
export { createMemoryInstallRepositories } from './runtime/memory-install-repos.js';
export {
  MemoryInstallTransactionRepository,
  MemoryInstalledPackageRepository,
  MemoryInstalledAssetRepository,
  MemoryAssetBindingRepository,
} from './runtime/memory-install-repos.js';

// --- Services (browser-safe, no LLM/graph deps) ---
export { EmployeeVersionService } from './runtime/employee-version-service.js';
export { CostCalculationService } from './runtime/cost-calculation-service.js';
export { SopService } from './services/sop-service.js';
export { RackSlotService } from './services/rack-slot-service.js';
export { LibraryService } from './services/library-service.js';
export type { CitationEntry } from './services/library-service.js';
export { CompanyTemplateService } from './services/company-template-service.js';
export { listTemplates, getTemplate } from './templates/index.js';
export { DEFAULT_COST_RATES } from './runtime/default-cost-rates.js';
export { WorkstationAssignmentService } from './runtime/workstation-assignment-service.js';
export { WorkstationToolResolver } from './services/workstation-tool-resolver.js';

// --- Logger ---
export { Logger, setLogHandler, resetLogHandler } from './services/logger.js';

// --- Utilities ---
export { extractJsonFromLlm } from './utils/extract-json.js';
export { generateId } from './utils/generate-id.js';
export { globToRegex, matchCostRate } from './utils/glob-match.js';

// --- Errors ---
export { AicsError, LlmError, GraphError, DataError } from './errors.js';

// --- Runtime (browser-safe parts) ---
export { MockToolExecutor, WORKSTATION_ACCESS_DENIED } from './runtime/tool-executor.js';

// --- OpenClaw Gateway (WebSocket — real-time event streaming) ---
export { OpenClawClient } from './gateway/index.js';
export type {
  OpenClawConfig,
  OpenClawAgent,
  OpenClawChatResponse,
  ConnectionState,
} from './gateway/index.js';

// --- A2A Protocol (HTTP JSON-RPC — preferred cross-agent communication) ---
export { A2AClient } from './a2a/index.js';
export type {
  A2APeer,
  A2ATask,
  A2AAgentCard,
  A2AConfig,
  A2APart,
  A2ATextPart,
  A2ATaskState,
  A2ASkill,
} from './a2a/index.js';
