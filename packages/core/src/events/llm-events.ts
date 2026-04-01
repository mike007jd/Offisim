/**
 * LLM event factories — call lifecycle, usage tracking, and streaming chunk events.
 */
import type {
  LlmCallCompletedPayload,
  LlmCallStartedPayload,
  LlmStreamChunkPayload,
  LlmUsageRecordedPayload,
  RuntimeEvent,
  SessionCostUpdatedPayload,
  ToolExecutionTelemetryPayload,
} from '@offisim/shared-types';

export function llmCallStarted(
  companyId: string,
  llmCallId: string,
  nodeName: string,
  provider: string,
  model: string,
  threadId: string,
): RuntimeEvent<LlmCallStartedPayload> {
  return {
    type: 'llm.call.started',
    entityId: llmCallId,
    entityType: 'llm',
    companyId,
    threadId,
    timestamp: Date.now(),
    payload: { llmCallId, nodeName, provider, model, threadId },
  };
}

export function llmCallCompleted(
  companyId: string,
  llmCallId: string,
  nodeName: string,
  latencyMs: number,
  inputTokens: number,
  outputTokens: number,
): RuntimeEvent<LlmCallCompletedPayload> {
  return {
    type: 'llm.call.completed',
    entityId: llmCallId,
    entityType: 'llm',
    companyId,
    timestamp: Date.now(),
    payload: { llmCallId, nodeName, latencyMs, inputTokens, outputTokens },
  };
}

export function llmUsageRecorded(
  companyId: string,
  llmCallId: string,
  threadId: string,
  taskRunId: string | null,
  provider: string,
  model: string,
  nodeName: string,
  inputTokens: number,
  outputTokens: number,
  latencyMs: number,
): RuntimeEvent<LlmUsageRecordedPayload> {
  return {
    type: 'llm.usage.recorded',
    entityId: llmCallId,
    entityType: 'llm',
    companyId,
    threadId,
    timestamp: Date.now(),
    payload: {
      llmCallId,
      threadId,
      taskRunId,
      provider,
      model,
      nodeName,
      inputTokens,
      outputTokens,
      latencyMs,
    },
  };
}

export function llmStreamChunk(
  companyId: string,
  threadId: string,
  nodeName: string,
  content: string,
): RuntimeEvent<LlmStreamChunkPayload> {
  return {
    type: 'llm.stream.chunk',
    entityId: nodeName,
    entityType: 'llm',
    companyId,
    threadId,
    timestamp: Date.now(),
    payload: { nodeName, content },
  };
}

export function costSessionUpdated(
  companyId: string,
  threadId: string,
  payload: SessionCostUpdatedPayload,
): RuntimeEvent<SessionCostUpdatedPayload> {
  return {
    type: 'cost.session.updated',
    entityId: payload.sessionId,
    entityType: 'runtime',
    companyId,
    threadId,
    timestamp: Date.now(),
    payload,
  };
}

export function toolExecutionTelemetry(
  companyId: string,
  threadId: string,
  payload: ToolExecutionTelemetryPayload,
): RuntimeEvent<ToolExecutionTelemetryPayload> {
  return {
    type: 'tool.execution.telemetry',
    entityId: payload.toolCallId,
    entityType: 'runtime',
    companyId,
    threadId,
    timestamp: Date.now(),
    payload,
  };
}
