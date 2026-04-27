import {
  llmCallCompleted,
  llmCallStarted,
  llmStreamChunk,
  llmUsageRecorded,
} from '../events/event-factories.js';
import type { LlmCallContext, LlmCallMeta } from '../middleware/types.js';
import type { RuntimeContext } from '../runtime/runtime-context.js';
import { Logger } from '../services/logger.js';
import { canonicalJson } from '../testing/canonical-json.js';
import { sha256Text } from '../testing/hash.js';
import { replayRequestHashes } from '../testing/replay-gateway.js';

const logger = new Logger('llm');
import type { LlmRequest, LlmResponse, LlmStreamChunk, ToolDef } from './gateway.js';
import { pruneLlmMessages } from './prune-messages.js';
import type { TeeResult } from './stream-tee.js';
import { teeStream } from './stream-tee.js';

const EMPTY_REPLAY_FIELDS = {
  usage_raw_json: null,
  request_json: null,
  response_json: null,
  tool_calls_json: null,
  prompt_hash: null,
  tools_hash: null,
  response_hash: null,
} as const;

const EMPTY_REPLAY_VALUES = {
  requestJson: null,
  responseJson: null,
  toolCallsJson: null,
  promptHash: null,
  toolsHash: null,
  responseHash: null,
} as const;

/**
 * Build an `onChunk` callback for `recordedLlmStream` that forwards reasoning and/or
 * content deltas onto the runtime eventBus as `llm.stream.chunk` events. Set
 * `content: false` for JSON-routing calls whose partial content would corrupt the UI.
 */
export function forwardStreamChunks(
  ctx: RuntimeContext,
  threadId: string,
  nodeName: string,
  options: { reasoning?: boolean; content?: boolean } = {},
): (chunk: LlmStreamChunk) => void {
  const fwdReasoning = options.reasoning !== false;
  const fwdContent = options.content !== false;
  return (chunk) => {
    if (fwdReasoning && chunk.reasoning) {
      ctx.eventBus.emit(
        llmStreamChunk(ctx.companyId, threadId, nodeName, chunk.reasoning, 'reasoning'),
      );
    }
    if (fwdContent && chunk.content) {
      ctx.eventBus.emit(llmStreamChunk(ctx.companyId, threadId, nodeName, chunk.content));
    }
  };
}

export async function recordedLlmCall(
  ctx: RuntimeContext,
  request: LlmRequest,
  meta: LlmCallMeta,
): Promise<LlmResponse> {
  const llmCallId = ctx.determinism.id('lc');
  const startedAt = ctx.determinism.nowMs();

  ctx.eventBus.emit(
    llmCallStarted(
      ctx.companyId,
      llmCallId,
      meta.nodeName,
      meta.provider,
      meta.model,
      ctx.threadId,
    ),
  );

  try {
    // --- Middleware: before ---
    let callCtx: LlmCallContext = { request, runtimeCtx: ctx, meta, extras: {} };
    if (ctx.middlewareChain) {
      callCtx = await ctx.middlewareChain.runBefore(callCtx);
    }

    // When a middleware chain is configured, trust its output — SummarizationMiddleware
    // (or whatever pruning middleware is registered) has already applied the runtime
    // policy's keepRecentMessages / triggerTokens settings.
    // Only apply a basic prune fallback when NO middleware chain exists at all
    // (e.g., in tests or minimal runtime setups).
    const effectiveRequest = ctx.middlewareChain
      ? callCtx.request
      : { ...callCtx.request, messages: pruneLlmMessages(callCtx.request.messages) };

    // Resolve gateway: prefer modelRegistry if the meta.model has a dedicated gateway
    const gateway = ctx.modelRegistry?.getGateway(meta.model) ?? ctx.llmGateway;
    let response = await gateway.chat(effectiveRequest);
    const latencyMs = ctx.determinism.nowMs() - startedAt;

    // --- Middleware: after ---
    if (ctx.middlewareChain) {
      response = await ctx.middlewareChain.runAfter(callCtx, response);
    }
    const replayFields = await buildReplayFields(ctx, effectiveRequest, response);

    try {
      await ctx.repos.llmCalls.create({
        llm_call_id: llmCallId,
        thread_id: ctx.threadId,
        task_run_id: meta.taskRunId ?? null,
        node_name: meta.nodeName,
        provider: meta.provider,
        model: meta.model,
        input_tokens: response.usage.inputTokens,
        output_tokens: response.usage.outputTokens,
        usage_raw_json: JSON.stringify(response.usage),
        request_json: replayFields.requestJson,
        response_json: replayFields.responseJson,
        tool_calls_json: replayFields.toolCallsJson,
        prompt_hash: replayFields.promptHash,
        tools_hash: replayFields.toolsHash,
        response_hash: replayFields.responseHash,
        recording_mode: replayFields.recordingMode,
        latency_ms: latencyMs,
        error_code: null,
        created_at: ctx.determinism.nowIso(),
      });
    } catch (dbError) {
      logger.error('Failed to record successful LLM call to DB', dbError, { llmCallId });
    }

    ctx.eventBus.emit(
      llmCallCompleted(
        ctx.companyId,
        llmCallId,
        meta.nodeName,
        latencyMs,
        response.usage.inputTokens,
        response.usage.outputTokens,
      ),
    );
    ctx.eventBus.emit(
      llmUsageRecorded(
        ctx.companyId,
        llmCallId,
        ctx.threadId,
        meta.taskRunId ?? null,
        meta.provider,
        meta.model,
        meta.nodeName,
        response.usage.inputTokens,
        response.usage.outputTokens,
        latencyMs,
      ),
    );

    return response;
  } catch (error) {
    const latencyMs = ctx.determinism.nowMs() - startedAt;
    const errorCode = error instanceof Error ? error.message : 'unknown';

    try {
      await ctx.repos.llmCalls.create({
        llm_call_id: llmCallId,
        thread_id: ctx.threadId,
        task_run_id: meta.taskRunId ?? null,
        node_name: meta.nodeName,
        provider: meta.provider,
        model: meta.model,
        input_tokens: 0,
        output_tokens: 0,
        ...EMPTY_REPLAY_FIELDS,
        recording_mode: recordingMode(ctx),
        latency_ms: latencyMs,
        error_code: errorCode,
        created_at: ctx.determinism.nowIso(),
      });
    } catch (dbError) {
      logger.error('Failed to record LLM error to DB', dbError, { llmCallId });
    }

    throw error;
  }
}

export async function recordedLlmStream(
  ctx: RuntimeContext,
  request: LlmRequest,
  meta: LlmCallMeta,
  onChunk: (chunk: LlmStreamChunk) => void,
): Promise<TeeResult> {
  const llmCallId = ctx.determinism.id('lc');
  const startedAt = ctx.determinism.nowMs();

  ctx.eventBus.emit(
    llmCallStarted(
      ctx.companyId,
      llmCallId,
      meta.nodeName,
      meta.provider,
      meta.model,
      ctx.threadId,
    ),
  );

  try {
    // --- Middleware: before ---
    let callCtx: LlmCallContext = { request, runtimeCtx: ctx, meta, extras: {} };
    if (ctx.middlewareChain) {
      callCtx = await ctx.middlewareChain.runBefore(callCtx);
    }

    // Same logic as recordedLlmCall: trust middleware chain, fallback basic prune.
    const effectiveRequest = ctx.middlewareChain
      ? callCtx.request
      : { ...callCtx.request, messages: pruneLlmMessages(callCtx.request.messages) };

    // Resolve gateway: prefer modelRegistry if the meta.model has a dedicated gateway
    const gateway = ctx.modelRegistry?.getGateway(meta.model) ?? ctx.llmGateway;
    const stream = gateway.chatStream(effectiveRequest);
    const result = await teeStream(stream, onChunk);
    const latencyMs = ctx.determinism.nowMs() - startedAt;

    // --- Middleware: after (stream) ---
    // Run after hooks with the accumulated stream result so middleware can observe/log.
    // Note: after hooks cannot alter already-streamed chunks — they see the final content.
    let finalResponse: LlmResponse = {
      content: result.fullContent,
      ...(result.fullReasoning ? { reasoningContent: result.fullReasoning } : {}),
      toolCalls: result.toolCalls,
      usage: result.usage,
    };
    if (ctx.middlewareChain) {
      finalResponse = await ctx.middlewareChain.runAfter(callCtx, finalResponse);
    }
    const finalResult: TeeResult = {
      ...result,
      fullContent: finalResponse.content,
      fullReasoning: finalResponse.reasoningContent ?? result.fullReasoning,
      toolCalls: [...finalResponse.toolCalls],
      usage: finalResponse.usage,
    };
    const replayFields = await buildReplayFields(ctx, effectiveRequest, finalResponse);

    try {
      await ctx.repos.llmCalls.create({
        llm_call_id: llmCallId,
        thread_id: ctx.threadId,
        task_run_id: meta.taskRunId ?? null,
        node_name: meta.nodeName,
        provider: meta.provider,
        model: meta.model,
        input_tokens: finalResult.usage.inputTokens,
        output_tokens: finalResult.usage.outputTokens,
        usage_raw_json: JSON.stringify(finalResult.usage),
        request_json: replayFields.requestJson,
        response_json: replayFields.responseJson,
        tool_calls_json: replayFields.toolCallsJson,
        prompt_hash: replayFields.promptHash,
        tools_hash: replayFields.toolsHash,
        response_hash: replayFields.responseHash,
        recording_mode: replayFields.recordingMode,
        latency_ms: latencyMs,
        error_code: null,
        created_at: ctx.determinism.nowIso(),
      });
    } catch (dbError) {
      logger.error('Failed to record successful LLM stream to DB', dbError, { llmCallId });
    }

    ctx.eventBus.emit(
      llmCallCompleted(
        ctx.companyId,
        llmCallId,
        meta.nodeName,
        latencyMs,
        finalResult.usage.inputTokens,
        finalResult.usage.outputTokens,
      ),
    );
    ctx.eventBus.emit(
      llmUsageRecorded(
        ctx.companyId,
        llmCallId,
        ctx.threadId,
        meta.taskRunId ?? null,
        meta.provider,
        meta.model,
        meta.nodeName,
        finalResult.usage.inputTokens,
        finalResult.usage.outputTokens,
        latencyMs,
      ),
    );

    return finalResult;
  } catch (error) {
    const latencyMs = ctx.determinism.nowMs() - startedAt;
    const errorCode = error instanceof Error ? error.message : 'unknown';

    try {
      await ctx.repos.llmCalls.create({
        llm_call_id: llmCallId,
        thread_id: ctx.threadId,
        task_run_id: meta.taskRunId ?? null,
        node_name: meta.nodeName,
        provider: meta.provider,
        model: meta.model,
        input_tokens: 0,
        output_tokens: 0,
        ...EMPTY_REPLAY_FIELDS,
        recording_mode: recordingMode(ctx),
        latency_ms: latencyMs,
        error_code: errorCode,
        created_at: ctx.determinism.nowIso(),
      });
    } catch (dbError) {
      logger.error('Failed to record LLM error to DB', dbError, { llmCallId });
    }

    throw error;
  }
}

interface ReplayFields {
  requestJson: string | null;
  responseJson: string | null;
  toolCallsJson: string | null;
  promptHash: string | null;
  toolsHash: string | null;
  responseHash: string | null;
  recordingMode: string;
}

async function buildReplayFields(
  ctx: RuntimeContext,
  request: LlmRequest,
  response: LlmResponse,
): Promise<ReplayFields> {
  const mode = recordingMode(ctx);
  if (mode === 'metadata') {
    return { ...EMPTY_REPLAY_VALUES, recordingMode: mode };
  }
  const redactedRequest = redactLlmRequest(request);
  const redactedResponse = redactLlmResponse(response);
  const { promptHash, toolsHash } = await replayRequestHashes(request);
  const responseHash = await sha256Text(canonicalJson(redactedResponse));
  return {
    requestJson: JSON.stringify(redactedRequest),
    responseJson: JSON.stringify(redactedResponse),
    toolCallsJson: JSON.stringify(response.toolCalls),
    promptHash,
    toolsHash,
    responseHash,
    recordingMode: mode,
  };
}

function redactLlmRequest(request: LlmRequest): {
  model: string;
  temperature?: number;
  maxTokens?: number;
  toolChoice?: LlmRequest['toolChoice'];
  messages: LlmRequest['messages'];
  tools?: readonly ToolDef[];
  timeoutMs?: number;
} {
  return {
    model: request.model,
    ...(request.temperature !== undefined ? { temperature: request.temperature } : {}),
    ...(request.maxTokens !== undefined ? { maxTokens: request.maxTokens } : {}),
    ...(request.toolChoice !== undefined ? { toolChoice: request.toolChoice } : {}),
    messages: request.messages,
    ...(request.tools !== undefined ? { tools: request.tools } : {}),
    ...(request.timeoutMs !== undefined ? { timeoutMs: request.timeoutMs } : {}),
  };
}

function redactLlmResponse(response: LlmResponse): LlmResponse {
  return {
    content: response.content,
    ...(response.reasoningContent ? { reasoningContent: response.reasoningContent } : {}),
    toolCalls: response.toolCalls,
    usage: response.usage,
  };
}

function recordingMode(ctx: RuntimeContext): string {
  const policy = ctx.runtimePolicy as { recording?: { mode?: string } } | undefined;
  return policy?.recording?.mode ?? 'replay';
}
