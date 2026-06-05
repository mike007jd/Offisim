/**
 * Shared llm_calls row-build + completion/usage event emission.
 *
 * Both the full runtime caller (`recordedLlmCall` / `recordedLlmStream` in
 * recorded-call.ts) and the lightweight system caller (RecordedSystemLlmCaller)
 * persist an `llm_calls` row with the identical column set and emit the same
 * `llm.call.completed` + `llm.usage.recorded` pair. Keeping the column mapping
 * and the emit ordering in one place stops the metadata caller from silently
 * falling behind the full caller when a column or usage field is added.
 */
import type { EventBus } from '../events/event-bus.js';
import { llmCallCompleted, llmUsageRecorded } from '../events/event-factories.js';
import type { NewLlmCall } from '../runtime/repositories.js';

export interface LlmCallUsageFields {
  inputTokens: number;
  outputTokens: number;
  cacheReadInputTokens: number;
  cacheCreationInputTokens: number;
  usageRawJson: string | null;
}

export interface LlmCallReplayFields {
  requestJson: string | null;
  responseJson: string | null;
  toolCallsJson: string | null;
  promptHash: string | null;
  toolsHash: string | null;
  responseHash: string | null;
}

/** Replay payload for metadata-only / error rows: counts persisted, bodies not. */
export const EMPTY_LLM_CALL_REPLAY: LlmCallReplayFields = {
  requestJson: null,
  responseJson: null,
  toolCallsJson: null,
  promptHash: null,
  toolsHash: null,
  responseHash: null,
};

/** Zeroed usage for error rows (no tokens consumed, no raw usage captured). */
export const EMPTY_LLM_CALL_USAGE: LlmCallUsageFields = {
  inputTokens: 0,
  outputTokens: 0,
  cacheReadInputTokens: 0,
  cacheCreationInputTokens: 0,
  usageRawJson: null,
};

export function buildLlmCallRow(params: {
  llmCallId: string;
  threadId: string | null;
  taskRunId: string | null;
  nodeName: string;
  provider: string;
  model: string;
  usage: LlmCallUsageFields;
  replay: LlmCallReplayFields;
  recordingMode: string;
  latencyMs: number;
  errorCode: string | null;
  createdAt: string;
}): NewLlmCall {
  return {
    llm_call_id: params.llmCallId,
    thread_id: params.threadId,
    task_run_id: params.taskRunId,
    node_name: params.nodeName,
    provider: params.provider,
    model: params.model,
    input_tokens: params.usage.inputTokens,
    output_tokens: params.usage.outputTokens,
    cache_read_input_tokens: params.usage.cacheReadInputTokens,
    cache_creation_input_tokens: params.usage.cacheCreationInputTokens,
    usage_raw_json: params.usage.usageRawJson,
    request_json: params.replay.requestJson,
    response_json: params.replay.responseJson,
    tool_calls_json: params.replay.toolCallsJson,
    prompt_hash: params.replay.promptHash,
    tools_hash: params.replay.toolsHash,
    response_hash: params.replay.responseHash,
    recording_mode: params.recordingMode,
    latency_ms: params.latencyMs,
    error_code: params.errorCode,
    created_at: params.createdAt,
  };
}

/**
 * Emit the completion pair in the canonical order: `llm.call.completed` first,
 * then `llm.usage.recorded`. Both factories take the resolved (already
 * `?? 0`-defaulted) token counts.
 */
export function emitLlmCallCompletedAndUsage(
  eventBus: EventBus,
  params: {
    companyId: string;
    llmCallId: string;
    nodeName: string;
    threadId: string;
    taskRunId: string | null;
    provider: string;
    model: string;
    latencyMs: number;
    inputTokens: number;
    outputTokens: number;
    cacheReadInputTokens: number;
    cacheCreationInputTokens: number;
  },
): void {
  eventBus.emit(
    llmCallCompleted(
      params.companyId,
      params.llmCallId,
      params.nodeName,
      params.latencyMs,
      params.inputTokens,
      params.outputTokens,
      params.cacheReadInputTokens,
      params.cacheCreationInputTokens,
    ),
  );
  eventBus.emit(
    llmUsageRecorded(
      params.companyId,
      params.llmCallId,
      params.threadId,
      params.taskRunId,
      params.provider,
      params.model,
      params.nodeName,
      params.inputTokens,
      params.outputTokens,
      params.latencyMs,
      params.cacheReadInputTokens,
      params.cacheCreationInputTokens,
    ),
  );
}
