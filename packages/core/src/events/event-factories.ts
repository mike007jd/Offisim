/**
 * Event factory barrel — re-exports all domain event factories.
 *
 * Import sites throughout the codebase use this file. Domain-specific
 * factories now live in separate files grouped by concern:
 *
 *   employee-events.ts   — employee state, CRUD, workstation, directChat, memoryAccessed
 *   task-events.ts       — task state, assignment, dispatch, subtask, deliverable
 *   orchestration-events.ts — meeting, graph node, plan lifecycle
 *   llm-events.ts        — LLM call, completion, usage, streaming
 *   mcp-events.ts        — MCP server, tool call, tool result
 *   install-events.ts    — install state, binding state
 *   operational-events.ts — error, handoff, memory, rack/slot, HR, notification
 *
 * To add a new event: create the factory in the appropriate domain file,
 * then add a re-export line below.
 */

export {
  employeeStateChanged,
  employeeCreated,
  employeeUpdated,
  employeeDeleted,
  employeeInstalled,
  employeeWorkstationChanged,
  employeeVersionCreated,
  directChatStarted,
  directChatCompleted,
  memoryAccessed,
} from './employee-events.js';

export {
  taskStateChanged,
  taskAssignmentChanged,
  taskAssignmentDispatched,
  taskSubtaskProgress,
  deliverableCreated,
} from './task-events.js';

export {
  meetingStateChanged,
  meetingActionCreated,
  graphNodeEntered,
  graphNodeExited,
  workspaceStalenessDetected,
  executionResumed,
  executionAborted,
  planCreated,
  planStepStarted,
  planStepCompleted,
  planCompleted,
} from './orchestration-events.js';

export {
  conversationCompactCompleted,
  conversationSynopsisUpdated,
  llmCallStarted,
  llmCallCompleted,
  llmUsageRecorded,
  llmStreamChunk,
  costSessionUpdated,
  toolExecutionTelemetry,
} from './llm-events.js';

export {
  mcpServerConnected,
  mcpToolCalled,
  mcpToolResult,
} from './mcp-events.js';

export {
  installStateChanged,
  bindingStateChanged,
} from './install-events.js';

export {
  errorOccurred,
  handoffInitiated,
  handoffCompleted,
  memoryCreated,
  rackBound,
  rackUnbound,
  slotAssigned,
  slotRemoved,
  hrAssessmentStarted,
  hrAssessmentCompleted,
  hrRecommendation,
  notificationCreated,
  notificationDismissed,
  interactionRequested,
  interactionRestored,
  interactionResolved,
  interactionModeChanged,
} from './operational-events.js';
