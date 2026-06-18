import type { RunScope } from '@offisim/shared-types';
import { isCapacityError, isContextOverflowError } from '../errors.js';
import { llmCallStarted, llmStreamChunk } from '../events/event-factories.js';
import type { LlmCallContext, LlmCallMeta } from '../middleware/types.js';
import type { RuntimeContext } from '../runtime/runtime-context.js';
import { Logger } from '../services/logger.js';
import { canonicalJson } from '../utils/canonical-json.js';
import { sha256Text } from '../utils/hash.js';
import {
  EMPTY_LLM_CALL_REPLAY,
  EMPTY_LLM_CALL_USAGE,
  buildLlmCallRow,
  emitLlmCallCompletedAndUsage,
} from './llm-call-record.js';
import { replayRequestHashes } from './replay-request-hashes.js';

const logger = new Logger('llm');
import type { LlmRequest, LlmResponse, LlmStreamChunk, ToolDef } from './gateway.js';
import { pruneLlmMessages } from './prune-messages.js';
import type { TeeResult } from './stream-tee.js';
import { teeStream } from './stream-tee.js';

async function withExecutionContext(
  ctx: RuntimeContext,
  request: LlmRequest,
  meta: LlmCallMeta,
): Promise<LlmRequest> {
  const existing = request.executionContext ?? {};
  let projectId = existing.projectId ?? meta.projectId ?? null;
  if (!projectId) {
    try {
      const thread = await ctx.repos.threads.findById(ctx.threadId);
      projectId = thread?.project_id ?? null;
    } catch {
      projectId = null;
    }
  }
  return {
    ...request,
    executionContext: {
      ...existing,
      projectId,
      threadId: existing.threadId ?? ctx.threadId,
      employeeId: existing.employeeId ?? meta.employeeId ?? null,
    },
  };
}

type CapacityAwareRegistry = {
  getGateway?: (modelId: string) => import('./gateway.js').LlmGateway | null;
  recordCapacityError?: (modelId: string) => { id?: string; model: string } | null;
  recordSuccess?: (modelId: string) => void;
};

async function callWithCapacityFallback<T>(
  ctx: RuntimeContext,
  request: LlmRequest,
  execute: (effectiveRequest: LlmRequest) => Promise<T>,
): Promise<{ request: LlmRequest; result: T }> {
  const registry = ctx.modelRegistry as CapacityAwareRegistry | undefined;
  try {
    const result = await execute(request);
    registry?.recordSuccess?.(request.model);
    return { request, result };
  } catch (error) {
    if (!isCapacityError(error)) throw error;
    const fallback = registry?.recordCapacityError?.(request.model);
    if (!fallback || fallback.model === request.model) throw error;
    const fallbackRequest = { ...request, model: fallback.model };
    const result = await execute(fallbackRequest);
    registry?.recordSuccess?.(request.model);
    registry?.recordSuccess?.(fallback.id ?? fallback.model);
    return { request: fallbackRequest, result };
  }
}

// INVARIANT: this is legacy model-registry fallback infrastructure, not the
// active desktop runtime. The desktop product now delegates provider auth/model
// execution to the official Pi Agent Host. If a compatibility caller still
// populates `ctx.modelRegistry`, every gateway must come from a registry
// constructed with credential-isolated `transportFetch`; `ModelRegistry`
// enforces this by failing closed when that transport is absent.
function gatewayForRequest(ctx: RuntimeContext, request: LlmRequest) {
  return ctx.modelRegistry?.getGateway?.(request.model) ?? ctx.llmGateway;
}

function hasVisibleStreamChunk(chunk: LlmStreamChunk): boolean {
  return Boolean(chunk.content || chunk.reasoning || (chunk.toolCalls?.length ?? 0) > 0);
}

async function callStreamWithCapacityFallback(
  ctx: RuntimeContext,
  request: LlmRequest,
  onChunk: (chunk: LlmStreamChunk) => void,
): Promise<{ request: LlmRequest; result: TeeResult }> {
  const registry = ctx.modelRegistry as CapacityAwareRegistry | undefined;
  let emittedVisibleChunk = false;

  try {
    const result = await teeStream(gatewayForRequest(ctx, request).chatStream(request), (chunk) => {
      if (hasVisibleStreamChunk(chunk)) emittedVisibleChunk = true;
      onChunk(chunk);
    });
    registry?.recordSuccess?.(request.model);
    return { request, result };
  } catch (error) {
    if (!isCapacityError(error)) throw error;
    const fallback = registry?.recordCapacityError?.(request.model);
    if (!fallback || fallback.model === request.model || emittedVisibleChunk) throw error;
    const fallbackRequest = { ...request, model: fallback.model };
    const result = await teeStream(
      gatewayForRequest(ctx, fallbackRequest).chatStream(fallbackRequest),
      onChunk,
    );
    registry?.recordSuccess?.(request.model);
    registry?.recordSuccess?.(fallback.id ?? fallback.model);
    return { request: fallbackRequest, result };
  }
}

function actualCallIdentity(
  ctx: RuntimeContext,
  request: LlmRequest,
  meta: LlmCallMeta,
): { provider: string; model: string } {
  const entry = ctx.modelRegistry?.findById(request.model);
  return {
    provider: entry?.provider ?? meta.provider,
    model: request.model,
  };
}

/**
 * Build an `onChunk` callback for `recordedLlmStream` that forwards reasoning and/or
 * content deltas onto the runtime eventBus as `llm.stream.chunk` events. Set
 * `content: false` for JSON-routing calls whose partial content would corrupt the UI.
 */
export function forwardStreamChunks(
  ctx: RuntimeContext,
  threadId: string,
  nodeName: string,
  options: { reasoning?: boolean; content?: boolean; runScope?: RunScope | null } = {},
): (chunk: LlmStreamChunk) => void {
  const fwdReasoning = options.reasoning !== false;
  const fwdContent = options.content !== false;
  const runScope = options.runScope ?? null;
  return (chunk) => {
    if (fwdReasoning && chunk.reasoning) {
      ctx.eventBus.emit(
        llmStreamChunk(ctx.companyId, threadId, nodeName, chunk.reasoning, 'reasoning', runScope),
      );
    }
    if (fwdContent && chunk.content) {
      ctx.eventBus.emit(
        llmStreamChunk(ctx.companyId, threadId, nodeName, chunk.content, 'content', runScope),
      );
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
    const preparedRequest = ctx.middlewareChain
      ? callCtx.request
      : { ...callCtx.request, messages: pruneLlmMessages(callCtx.request.messages) };
    let effectiveRequest = await withExecutionContext(ctx, preparedRequest, meta);

    let response: LlmResponse;
    try {
      const attempt = await callWithCapacityFallback(ctx, effectiveRequest, (attemptRequest) =>
        gatewayForRequest(ctx, attemptRequest).chat(attemptRequest),
      );
      effectiveRequest = attempt.request;
      response = attempt.result;
    } catch (error) {
      if (!ctx.middlewareChain || !isContextOverflowError(error)) throw error;
      callCtx = await ctx.middlewareChain.runBefore({
        request: callCtx.request,
        runtimeCtx: ctx,
        meta,
        extras: { ...callCtx.extras, forceFullCompact: true, contextOverflowRecovery: true },
      });
      effectiveRequest = await withExecutionContext(ctx, callCtx.request, meta);
      const attempt = await callWithCapacityFallback(ctx, effectiveRequest, (attemptRequest) =>
        gatewayForRequest(ctx, attemptRequest).chat(attemptRequest),
      );
      effectiveRequest = attempt.request;
      response = attempt.result;
    }
    const latencyMs = ctx.determinism.nowMs() - startedAt;
    const actual = actualCallIdentity(ctx, effectiveRequest, meta);

    // --- Middleware: after ---
    if (ctx.middlewareChain) {
      response = await ctx.middlewareChain.runAfter(callCtx, response);
    }
    const replayFields = await buildReplayFields(ctx, effectiveRequest, response);

    try {
      await ctx.repos.llmCalls.create(
        buildLlmCallRow({
          llmCallId,
          threadId: ctx.threadId,
          taskRunId: meta.taskRunId ?? null,
          nodeName: meta.nodeName,
          provider: actual.provider,
          model: actual.model,
          usage: {
            inputTokens: response.usage.inputTokens,
            outputTokens: response.usage.outputTokens,
            cacheReadInputTokens: response.usage.cacheReadInputTokens ?? 0,
            cacheCreationInputTokens: response.usage.cacheCreationInputTokens ?? 0,
            usageRawJson: JSON.stringify(response.usage),
          },
          replay: replayFields,
          recordingMode: replayFields.recordingMode,
          latencyMs,
          errorCode: null,
          createdAt: ctx.determinism.nowIso(),
        }),
      );
    } catch (dbError) {
      logger.error('Failed to record successful LLM call to DB', dbError, { llmCallId });
    }

    emitLlmCallCompletedAndUsage(ctx.eventBus, {
      companyId: ctx.companyId,
      llmCallId,
      nodeName: meta.nodeName,
      threadId: ctx.threadId,
      taskRunId: meta.taskRunId ?? null,
      provider: actual.provider,
      model: actual.model,
      latencyMs,
      inputTokens: response.usage.inputTokens,
      outputTokens: response.usage.outputTokens,
      cacheReadInputTokens: response.usage.cacheReadInputTokens ?? 0,
      cacheCreationInputTokens: response.usage.cacheCreationInputTokens ?? 0,
    });

    return response;
  } catch (error) {
    const latencyMs = ctx.determinism.nowMs() - startedAt;
    const errorCode = error instanceof Error ? error.message : 'unknown';

    try {
      await ctx.repos.llmCalls.create(
        buildLlmCallRow({
          llmCallId,
          threadId: ctx.threadId,
          taskRunId: meta.taskRunId ?? null,
          nodeName: meta.nodeName,
          provider: meta.provider,
          model: meta.model,
          usage: EMPTY_LLM_CALL_USAGE,
          replay: EMPTY_LLM_CALL_REPLAY,
          recordingMode: recordingMode(ctx),
          latencyMs,
          errorCode,
          createdAt: ctx.determinism.nowIso(),
        }),
      );
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
    const preparedRequest = ctx.middlewareChain
      ? callCtx.request
      : { ...callCtx.request, messages: pruneLlmMessages(callCtx.request.messages) };
    let effectiveRequest = await withExecutionContext(ctx, preparedRequest, meta);

    let result: TeeResult;
    try {
      const attempt = await callStreamWithCapacityFallback(ctx, effectiveRequest, onChunk);
      effectiveRequest = attempt.request;
      result = attempt.result;
    } catch (error) {
      if (!ctx.middlewareChain || !isContextOverflowError(error)) throw error;
      callCtx = await ctx.middlewareChain.runBefore({
        request: callCtx.request,
        runtimeCtx: ctx,
        meta,
        extras: { ...callCtx.extras, forceFullCompact: true, contextOverflowRecovery: true },
      });
      effectiveRequest = await withExecutionContext(ctx, callCtx.request, meta);
      const attempt = await callStreamWithCapacityFallback(ctx, effectiveRequest, onChunk);
      effectiveRequest = attempt.request;
      result = attempt.result;
    }
    const latencyMs = ctx.determinism.nowMs() - startedAt;
    const actual = actualCallIdentity(ctx, effectiveRequest, meta);

    // --- Middleware: after (stream) ---
    // Run after hooks with the accumulated stream result so middleware can observe/log.
    // Note: after hooks cannot alter already-streamed chunks — they see the final content.
    let finalResponse: LlmResponse = {
      content: result.fullContent,
      ...(result.fullReasoning ? { reasoningContent: result.fullReasoning } : {}),
      toolCalls: result.toolCalls,
      usage: result.usage,
      ...(result.stopReason ? { stopReason: result.stopReason } : {}),
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
      stopReason: finalResponse.stopReason,
    };
    const replayFields = await buildReplayFields(ctx, effectiveRequest, finalResponse);

    try {
      await ctx.repos.llmCalls.create(
        buildLlmCallRow({
          llmCallId,
          threadId: ctx.threadId,
          taskRunId: meta.taskRunId ?? null,
          nodeName: meta.nodeName,
          provider: actual.provider,
          model: actual.model,
          usage: {
            inputTokens: finalResult.usage.inputTokens,
            outputTokens: finalResult.usage.outputTokens,
            cacheReadInputTokens: finalResult.usage.cacheReadInputTokens ?? 0,
            cacheCreationInputTokens: finalResult.usage.cacheCreationInputTokens ?? 0,
            usageRawJson: JSON.stringify(finalResult.usage),
          },
          replay: replayFields,
          recordingMode: replayFields.recordingMode,
          latencyMs,
          errorCode: null,
          createdAt: ctx.determinism.nowIso(),
        }),
      );
    } catch (dbError) {
      logger.error('Failed to record successful LLM stream to DB', dbError, { llmCallId });
    }

    emitLlmCallCompletedAndUsage(ctx.eventBus, {
      companyId: ctx.companyId,
      llmCallId,
      nodeName: meta.nodeName,
      threadId: ctx.threadId,
      taskRunId: meta.taskRunId ?? null,
      provider: actual.provider,
      model: actual.model,
      latencyMs,
      inputTokens: finalResult.usage.inputTokens,
      outputTokens: finalResult.usage.outputTokens,
      cacheReadInputTokens: finalResult.usage.cacheReadInputTokens ?? 0,
      cacheCreationInputTokens: finalResult.usage.cacheCreationInputTokens ?? 0,
    });

    return finalResult;
  } catch (error) {
    const latencyMs = ctx.determinism.nowMs() - startedAt;
    const errorCode = error instanceof Error ? error.message : 'unknown';

    try {
      await ctx.repos.llmCalls.create(
        buildLlmCallRow({
          llmCallId,
          threadId: ctx.threadId,
          taskRunId: meta.taskRunId ?? null,
          nodeName: meta.nodeName,
          provider: meta.provider,
          model: meta.model,
          usage: EMPTY_LLM_CALL_USAGE,
          replay: EMPTY_LLM_CALL_REPLAY,
          recordingMode: recordingMode(ctx),
          latencyMs,
          errorCode,
          createdAt: ctx.determinism.nowIso(),
        }),
      );
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
    return { ...EMPTY_LLM_CALL_REPLAY, recordingMode: mode };
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
    ...(response.stopReason ? { stopReason: response.stopReason } : {}),
  };
}

function recordingMode(ctx: RuntimeContext): string {
  return ctx.runtimePolicy?.recording?.mode ?? 'metadata';
}
