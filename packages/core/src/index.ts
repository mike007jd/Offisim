// @aics/core — Phase 2.4 Production Hardening

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
} from './runtime/repositories.js';
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
export type { AicsGraphState, PendingAssignment } from './graph/state.js';
export type { BuildGraphOptions } from './graph/main-graph.js';
export type { RetryConfig } from './llm/retry.js';
export type { TeeResult } from './llm/stream-tee.js';
export type { ExecutionTrace, ExecutionTraceService } from './services/execution-trace-service.js';
export type { ThreadForkService } from './services/thread-fork-service.js';

// --- Factories ---
export { buildAicsGraph } from './graph/main-graph.js';
export { createRuntimeContext } from './runtime/runtime-context.js';
export { createCheckpointSaver, createMemoryCheckpointSaver } from './graph/checkpoint-saver.js';
export { createMemoryRepositories } from './runtime/memory-repositories.js';
export { createDrizzleRepositories } from './runtime/drizzle-repositories.js';

// --- LLM ---
export { AnthropicAdapter } from './llm/anthropic-adapter.js';
export { OpenAiAdapter } from './llm/openai-adapter.js';
export type { OpenAiAdapterOptions } from './llm/openai-adapter.js';
export { createGateway } from './llm/gateway-factory.js';
export type { GatewayConfig } from './llm/gateway-factory.js';
export { ModelResolver } from './llm/model-resolver.js';
export { DEFAULT_RETRY_CONFIG, withRetry } from './llm/retry.js';
export { teeStream } from './llm/stream-tee.js';
export { recordedLlmCall, recordedLlmStream } from './llm/recorded-call.js';

// --- Events ---
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
} from './events/event-factories.js';

// --- Services ---
export { ExecutionTraceServiceImpl } from './services/execution-trace-service.js';
export { ThreadForkServiceStub } from './services/thread-fork-service.js';
export { OrchestrationService } from './services/orchestration-service.js';

// --- Runtime ---
export { MockToolExecutor } from './runtime/tool-executor.js';

// --- Agent Nodes ---
export { bossNode } from './agents/boss-node.js';
export { managerNode } from './agents/manager-node.js';
export { employeeNode } from './agents/employee-node.js';
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
