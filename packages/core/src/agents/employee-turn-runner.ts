import type { ResolvedModel } from '@offisim/shared-types';
import type { LlmMessage, LlmResponse, LlmToolChoice, ToolDef } from '../llm/gateway.js';
import { forwardStreamChunks, recordedLlmCall, recordedLlmStream } from '../llm/recorded-call.js';
import type { RuntimeContext } from '../runtime/runtime-context.js';
import { SKILL_INSTALL_TOOL_NAMES } from './skill-install-tools.js';

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

function buildObservedMessages(
  messages: readonly LlmMessage[],
  response: LlmResponse,
): readonly LlmMessage[] {
  return [
    ...messages,
    {
      role: 'assistant' as const,
      content: response.content,
      ...(response.reasoningContent ? { reasoningContent: response.reasoningContent } : {}),
      ...(response.toolCalls.length > 0 ? { toolCalls: response.toolCalls } : {}),
    },
  ];
}

async function observeRollingJournal(
  runtimeCtx: RuntimeContext,
  messages: readonly LlmMessage[],
  response: LlmResponse,
): Promise<void> {
  try {
    await runtimeCtx.rollingJournal?.observeTurn(buildObservedMessages(messages, response));
  } catch (error) {
    void error;
  }
}

function resolveForcedSkillToolChoice(
  messages: readonly LlmMessage[],
  allTools: readonly ToolDef[],
): LlmToolChoice | undefined {
  if (messages.some((message) => message.role === 'tool')) return undefined;

  const lastUserMessage = [...messages].reverse().find((message) => message.role === 'user');
  const userText = lastUserMessage?.content ?? '';
  if (!userText) return undefined;

  const availableToolNames = new Set(allTools.map((tool) => tool.name));
  const requestedToolName = SKILL_INSTALL_TOOL_NAMES.find(
    (toolName) => availableToolNames.has(toolName) && userText.includes(toolName),
  );

  return requestedToolName ? { type: 'tool', name: requestedToolName } : undefined;
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
      toolChoice: resolveForcedSkillToolChoice(messages, allTools),
      signal,
    };

    if (!streamEnabled) {
      const response = await recordedLlmCall(runtimeCtx, request, {
        nodeName: 'employee',
        provider: resolved.provider,
        model: resolved.model,
        taskRunId: meta.taskRunId,
      });
      await observeRollingJournal(runtimeCtx, messages, response);
      return response;
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

    const response = {
      content: streamResult.fullContent,
      reasoningContent: streamResult.fullReasoning || undefined,
      toolCalls: streamResult.toolCalls,
      usage: streamResult.usage,
    };
    await observeRollingJournal(runtimeCtx, messages, response);
    return response;
  };
}
