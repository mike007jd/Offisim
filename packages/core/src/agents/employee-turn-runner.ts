import type { ResolvedModel } from '@offisim/shared-types';
import { llmStreamChunk } from '../events/event-factories.js';
import type { LlmMessage, LlmResponse, ToolDef } from '../llm/gateway.js';
import { recordedLlmCall, recordedLlmStream } from '../llm/recorded-call.js';
import type { RuntimeContext } from '../runtime/runtime-context.js';

export type TurnRunner = (
  messages: LlmMessage[],
  meta: { taskRunId?: string },
) => Promise<LlmResponse>;

export interface TurnRunnerDeps {
  readonly runtimeCtx: RuntimeContext;
  readonly threadId: string;
  readonly resolved: ResolvedModel;
  readonly allTools: ToolDef[];
  readonly streamEnabled: boolean;
  readonly signal: AbortSignal | undefined;
}

/**
 * Build the per-turn LLM caller used by the employee node.
 *
 * Stream branch: emits `llm.stream.chunk` per chunk — `kind: 'reasoning'` first
 *   when `chunk.reasoning` present, then default kind when `chunk.content`
 *   present (independent if-statements, NOT if-else, so a single chunk carrying
 *   both reasoning + content emits two separate events in that order).
 *
 * Non-stream branch: delegates to `recordedLlmCall` and returns its result
 *   without any chunk events.
 */
export function buildTurnRunner(deps: TurnRunnerDeps): TurnRunner {
  const { runtimeCtx, threadId, resolved, allTools, streamEnabled, signal } = deps;

  return async (messages, meta) => {
    const request = {
      messages,
      model: resolved.model,
      temperature: resolved.temperature,
      maxTokens: resolved.maxTokens,
      tools: allTools.length > 0 ? allTools : undefined,
      signal,
    };

    if (!streamEnabled) {
      return recordedLlmCall(runtimeCtx, request, {
        nodeName: 'employee',
        provider: resolved.provider,
        model: resolved.model,
        taskRunId: meta.taskRunId,
      });
    }

    const streamResult = await recordedLlmStream(
      runtimeCtx,
      request,
      {
        nodeName: 'employee',
        provider: resolved.provider,
        model: resolved.model,
        taskRunId: meta.taskRunId,
      },
      (chunk) => {
        if (chunk.reasoning) {
          runtimeCtx.eventBus.emit(
            llmStreamChunk(
              runtimeCtx.companyId,
              threadId,
              'employee',
              chunk.reasoning,
              'reasoning',
            ),
          );
        }
        if (chunk.content) {
          runtimeCtx.eventBus.emit(
            llmStreamChunk(runtimeCtx.companyId, threadId, 'employee', chunk.content),
          );
        }
      },
    );

    return {
      content: streamResult.fullContent,
      reasoningContent: streamResult.fullReasoning || undefined,
      toolCalls: streamResult.toolCalls,
      usage: streamResult.usage,
    };
  };
}
