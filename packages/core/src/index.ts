// @aics/core — Phase 2.0 Core Runtime

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
  NewGraphThread,
  NewTaskRun,
  NewToolCall,
  NewHandoffEvent,
  NewMeetingSession,
  NewGraphCheckpoint,
  NewRuntimeEvent,
} from './runtime/repositories.js';
export type { LlmGateway, LlmRequest, LlmResponse, LlmMessage, ToolDef, ToolCallResult, LlmUsage } from './llm/gateway.js';
export type { EventBus, EventHandler } from './events/event-bus.js';
export type { ToolExecutor, ToolCallRequest, ToolCallResponse } from './runtime/tool-executor.js';
export type { AicsGraphState, PendingAssignment } from './graph/state.js';
export type { BuildGraphOptions } from './graph/main-graph.js';

// --- Factories ---
export { buildAicsGraph } from './graph/main-graph.js';
export { createRuntimeContext } from './runtime/runtime-context.js';
export { createCheckpointSaver } from './graph/checkpoint-saver.js';
export { createMemoryRepositories } from './runtime/memory-repositories.js';
export { createDrizzleRepositories } from './runtime/drizzle-repositories.js';

// --- LLM ---
export { AnthropicAdapter } from './llm/anthropic-adapter.js';
export { OpenAiAdapter } from './llm/openai-adapter.js';
export { ModelResolver } from './llm/model-resolver.js';

// --- Events ---
export { InMemoryEventBus } from './events/event-bus.js';
export {
  employeeStateChanged,
  taskStateChanged,
  taskAssignmentChanged,
  meetingStateChanged,
} from './events/event-factories.js';

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
