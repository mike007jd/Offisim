import { llmCallCompleted, llmCallStarted, llmUsageRecorded } from '../events/event-factories.js';
import type { RuntimeContext } from '../runtime/runtime-context.js';
import { Logger } from '../services/logger.js';

const logger = new Logger('llm');
import { generateId } from '../utils/generate-id.js';
import type { LlmRequest, LlmResponse, LlmStreamChunk } from './gateway.js';
import { pruneLlmMessages } from './prune-messages.js';
import type { TeeResult } from './stream-tee.js';
import { teeStream } from './stream-tee.js';

interface RecordedCallMeta {
  nodeName: string;
  provider: string;
  model: string;
  taskRunId?: string;
}

export async function recordedLlmCall(
  ctx: RuntimeContext,
  request: LlmRequest,
  meta: RecordedCallMeta,
): Promise<LlmResponse> {
  const llmCallId = generateId('lc');
  const startedAt = Date.now();

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
    const prunedRequest = { ...request, messages: pruneLlmMessages(request.messages) };
    const response = await ctx.llmGateway.chat(prunedRequest);
    const latencyMs = Date.now() - startedAt;

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
        response_json: null,
        latency_ms: latencyMs,
        error_code: null,
        created_at: new Date().toISOString(),
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
        response.usage.inputTokens,
        response.usage.outputTokens,
      ),
    );

    return response;
  } catch (error) {
    const latencyMs = Date.now() - startedAt;
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
        usage_raw_json: null,
        response_json: null,
        latency_ms: latencyMs,
        error_code: errorCode,
        created_at: new Date().toISOString(),
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
  meta: RecordedCallMeta,
  onChunk: (chunk: LlmStreamChunk) => void,
): Promise<TeeResult> {
  const llmCallId = generateId('lc');
  const startedAt = Date.now();

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
    const prunedRequest = { ...request, messages: pruneLlmMessages(request.messages) };
    const stream = ctx.llmGateway.chatStream(prunedRequest);
    const result = await teeStream(stream, onChunk);
    const latencyMs = Date.now() - startedAt;

    try {
      await ctx.repos.llmCalls.create({
        llm_call_id: llmCallId,
        thread_id: ctx.threadId,
        task_run_id: meta.taskRunId ?? null,
        node_name: meta.nodeName,
        provider: meta.provider,
        model: meta.model,
        input_tokens: result.usage.inputTokens,
        output_tokens: result.usage.outputTokens,
        usage_raw_json: JSON.stringify(result.usage),
        response_json: null,
        latency_ms: latencyMs,
        error_code: null,
        created_at: new Date().toISOString(),
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
        result.usage.inputTokens,
        result.usage.outputTokens,
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
        result.usage.inputTokens,
        result.usage.outputTokens,
      ),
    );

    return result;
  } catch (error) {
    const latencyMs = Date.now() - startedAt;
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
        usage_raw_json: null,
        response_json: null,
        latency_ms: latencyMs,
        error_code: errorCode,
        created_at: new Date().toISOString(),
      });
    } catch (dbError) {
      logger.error('Failed to record LLM error to DB', dbError, { llmCallId });
    }

    throw error;
  }
}
