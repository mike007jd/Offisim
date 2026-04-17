import type { ResolvedModel } from '@offisim/shared-types';
import type { LlmMessage, LlmResponse, ToolDef } from '../llm/gateway.js';
import {
  forwardStreamChunks,
  recordedLlmCall,
  recordedLlmStream,
} from '../llm/recorded-call.js';
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
 * Build the per-turn LLM caller used by the employee node. Stream branch forwards
 * both reasoning and content deltas onto the event bus; non-stream branch skips
 * chunk events entirely.
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
      forwardStreamChunks(runtimeCtx, threadId, 'employee'),
    );

    return {
      content: streamResult.fullContent,
      reasoningContent: streamResult.fullReasoning || undefined,
      toolCalls: streamResult.toolCalls,
      usage: streamResult.usage,
    };
  };
}
