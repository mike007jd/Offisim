import type { ResolvedModel } from '@offisim/shared-types';
import { llmCallCompleted, llmCallStarted } from '../events/event-factories.js';
import type { RunScope } from '../graph/state.js';
import type { LlmMessage, LlmResponse, LlmToolChoice, ToolDef } from '../llm/gateway.js';
import { forwardStreamChunks, recordedLlmCall, recordedLlmStream } from '../llm/recorded-call.js';
import type { RuntimeContext } from '../runtime/runtime-context.js';
import { generateId } from '../utils/generate-id.js';
import { SKILL_INSTALL_TOOL_NAMES } from './skill-install-tools.js';

function emitSyntheticLlmCallPair(args: {
  runtimeCtx: RuntimeContext;
  nodeName: string;
  provider: string;
  model: string;
  threadId: string;
}): void {
  const { runtimeCtx, nodeName, provider, model, threadId } = args;
  const llmCallId = runtimeCtx.determinism.id('lc-synth');
  runtimeCtx.eventBus.emit(
    llmCallStarted(runtimeCtx.companyId, llmCallId, nodeName, provider, model, threadId),
  );
  runtimeCtx.eventBus.emit(
    llmCallCompleted(runtimeCtx.companyId, llmCallId, nodeName, 0, 0, 0, 0, 0),
  );
}

const OUTPUT_TRUNCATED_NOTICE =
  '[OUTPUT_TRUNCATED] Model stopped at max output tokens; response may be incomplete.';

export type TurnRunner = (
  messages: LlmMessage[],
  meta: { taskRunId?: string },
) => Promise<LlmResponse>;

export interface TurnRunnerDeps {
  readonly runtimeCtx: RuntimeContext;
  readonly threadId: string;
  readonly projectId?: string | null;
  readonly employeeId?: string | null;
  readonly resolved: ResolvedModel;
  readonly allTools: ToolDef[];
  readonly streamEnabled: boolean;
  readonly signal: AbortSignal | undefined;
  readonly runScope?: RunScope | null;
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

function resolveForcedSkillToolChoice(messages: readonly LlmMessage[]): LlmToolChoice | undefined {
  let lastUserIndex = -1;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index]?.role === 'user') {
      lastUserIndex = index;
      break;
    }
  }
  if (lastUserIndex < 0) return undefined;
  if (messages.slice(lastUserIndex + 1).some((message) => message.role === 'tool')) {
    return undefined;
  }

  const lastUserMessage = messages[lastUserIndex];
  const userText = lastUserMessage?.content ?? '';
  if (!userText) return undefined;

  const requestedToolName = SKILL_INSTALL_TOOL_NAMES.find((toolName) =>
    userText.includes(toolName),
  );

  return requestedToolName ? { type: 'tool', name: requestedToolName } : undefined;
}

function lastUserText(messages: readonly LlmMessage[]): string {
  return [...messages].reverse().find((message) => message.role === 'user')?.content ?? '';
}

function parseJsonObjectFromText(text: string): Record<string, unknown> | null {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    const parsed = JSON.parse(text.slice(start, end + 1));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function stripArgValue(value: string): string {
  return value
    .trim()
    .replace(/^["'`]+|["'`]+$/gu, '')
    .trim();
}

function parseKeyValueArgsFromText(text: string): Record<string, unknown> {
  const args: Record<string, unknown> = {};
  const keyNames = 'url|subpath|ref|scope|targetEmployeeId|fileRef|filter';
  const pattern = new RegExp(
    `\\b(${keyNames})\\s*[:=]\\s*([\\s\\S]*?)(?=(?:[，,。\\n]|\\s+(?:${keyNames})\\s*[:=])|$)`,
    'gu',
  );
  for (const match of text.matchAll(pattern)) {
    const key = match[1];
    const rawValue = match[2];
    if (!key || !rawValue) continue;
    args[key] = stripArgValue(rawValue);
  }
  return args;
}

function parseExplicitSkillToolArgs(userText: string): Record<string, unknown> | null {
  const jsonArgs = parseJsonObjectFromText(userText);
  if (jsonArgs) return jsonArgs;

  const kvArgs = parseKeyValueArgsFromText(userText);
  return Object.keys(kvArgs).length > 0 ? kvArgs : null;
}

function coerceExplicitSkillToolCall(
  messages: readonly LlmMessage[],
  response: LlmResponse,
  forcedChoice: LlmToolChoice | undefined,
): LlmResponse {
  if (!forcedChoice || typeof forcedChoice === 'string') return response;
  if (response.toolCalls.some((toolCall) => toolCall.name === forcedChoice.name)) return response;

  const userText = lastUserText(messages);
  const args = parseExplicitSkillToolArgs(userText);
  if (!args) return response;

  return {
    ...response,
    content: '',
    toolCalls: [{ id: generateId('forced-tool'), name: forcedChoice.name, arguments: args }],
  };
}

function surfaceOutputTruncation(response: LlmResponse): LlmResponse {
  if (response.stopReason !== 'max_tokens' || response.toolCalls.length > 0) return response;
  if (response.content.includes(OUTPUT_TRUNCATED_NOTICE)) return response;
  return {
    ...response,
    content: response.content
      ? `${response.content}\n\n${OUTPUT_TRUNCATED_NOTICE}`
      : OUTPUT_TRUNCATED_NOTICE,
  };
}

/**
 * Build the per-turn LLM caller used by the employee node. Stream branch forwards
 * both reasoning and content deltas onto the event bus; non-stream branch skips
 * chunk events entirely.
 */
export function buildTurnRunner(deps: TurnRunnerDeps): TurnRunner {
  const { runtimeCtx, threadId, projectId, employeeId, resolved, allTools, streamEnabled, signal } =
    deps;
  const runScope = deps.runScope ?? null;

  return async (messages, meta) => {
    const forcedSkillToolChoice = resolveForcedSkillToolChoice(messages);
    if (forcedSkillToolChoice && typeof forcedSkillToolChoice !== 'string') {
      const args = parseExplicitSkillToolArgs(lastUserText(messages));
      if (args) {
        const response: LlmResponse = {
          content: '',
          toolCalls: [
            { id: generateId('forced-tool'), name: forcedSkillToolChoice.name, arguments: args },
          ],
          usage: { inputTokens: 0, outputTokens: 0 },
        };
        // Synthetic llm-call audit pair so the activity feed / replay can see
        // that an employee turn occurred, even though we bypassed the real
        // gateway. Without this, skill-install turns vanish from the audit
        // trail (B/F4 — turn appears in transcript but llm_calls table is
        // missing the row).
        emitSyntheticLlmCallPair({
          runtimeCtx,
          nodeName: 'employee',
          provider: resolved.provider,
          model: '__skill_install_bypass__',
          threadId,
        });
        await observeRollingJournal(runtimeCtx, messages, response);
        return response;
      }
    }
    const request = {
      messages,
      model: resolved.model,
      temperature: resolved.temperature,
      maxTokens: resolved.maxTokens,
      tools: allTools.length > 0 ? allTools : undefined,
      toolChoice: forcedSkillToolChoice,
      signal,
    };

    if (!streamEnabled) {
      const response = await recordedLlmCall(runtimeCtx, request, {
        nodeName: 'employee',
        provider: resolved.provider,
        model: resolved.model,
        taskRunId: meta.taskRunId,
        projectId,
        employeeId,
      });
      const coerced = surfaceOutputTruncation(
        coerceExplicitSkillToolCall(messages, response, forcedSkillToolChoice),
      );
      await observeRollingJournal(runtimeCtx, messages, coerced);
      return coerced;
    }

    const streamResult = await recordedLlmStream(
      runtimeCtx,
      request,
      {
        nodeName: 'employee',
        provider: resolved.provider,
        model: resolved.model,
        taskRunId: meta.taskRunId,
        projectId,
        employeeId,
      },
      forwardStreamChunks(runtimeCtx, threadId, 'employee', { runScope }),
    );

    const response = {
      content: streamResult.fullContent,
      reasoningContent: streamResult.fullReasoning || undefined,
      toolCalls: streamResult.toolCalls,
      usage: streamResult.usage,
      stopReason: streamResult.stopReason,
    };
    const coerced = surfaceOutputTruncation(
      coerceExplicitSkillToolCall(messages, response, forcedSkillToolChoice),
    );
    await observeRollingJournal(runtimeCtx, messages, coerced);
    return coerced;
  };
}
