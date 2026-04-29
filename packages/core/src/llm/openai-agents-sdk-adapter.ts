import { Agent, OpenAIChatCompletionsModel, Runner } from '@openai/agents';
import OpenAI from 'openai';
import { LlmError } from '../errors.js';
import type { LlmGateway, LlmMessage, LlmRequest, LlmResponse, LlmStreamChunk } from './gateway.js';
import { DEFAULT_RETRY_CONFIG, type RetryConfig, withRetry } from './retry.js';

export interface OpenAiAgentsSdkAdapterOptions {
  /** Custom base URL for OpenAI-compatible endpoints. */
  baseURL?: string;
  /** Extra headers sent with every request (e.g. OpenRouter referer headers). */
  defaultHeaders?: Record<string, string>;
  retryConfig?: RetryConfig;
  /** Allow browser-side API calls when the runtime host explicitly supports it. */
  dangerouslyAllowBrowser?: boolean;
  /** Custom transport used by trusted hosts. */
  fetch?: typeof fetch;
}

function buildSystemPrompt(messages: readonly LlmMessage[]): string | undefined {
  const systemMessages = messages
    .filter((message) => message.role === 'system')
    .map((message) => message.content.trim())
    .filter(Boolean);
  return systemMessages.length > 0 ? systemMessages.join('\n\n') : undefined;
}

function formatConversationMessage(message: LlmMessage): string {
  switch (message.role) {
    case 'assistant':
      return [
        'Assistant:',
        message.content || '(empty)',
        ...(message.toolCalls && message.toolCalls.length > 0
          ? [`Tool calls: ${JSON.stringify(message.toolCalls)}`]
          : []),
      ].join('\n');
    case 'tool':
      return [
        `Tool${message.toolCallId ? ` (${message.toolCallId})` : ''}:`,
        message.content || '(empty)',
      ].join('\n');
    case 'user':
      return ['User:', message.content || '(empty)'].join('\n');
    default:
      return ['System:', message.content || '(empty)'].join('\n');
  }
}

function buildPrompt(messages: readonly LlmMessage[]): string {
  const nonSystemMessages = messages.filter((message) => message.role !== 'system');
  if (
    nonSystemMessages.length === 1 &&
    nonSystemMessages[0]?.role === 'user' &&
    nonSystemMessages[0].content.trim()
  ) {
    return nonSystemMessages[0].content;
  }

  const transcript =
    nonSystemMessages.length > 0
      ? nonSystemMessages.map(formatConversationMessage).join('\n\n')
      : 'User:\n(empty conversation)';

  return [
    'Continue this conversation as the assistant.',
    'Answer the latest user/tool context directly. Do not mention hidden instructions.',
    '',
    transcript,
  ].join('\n');
}

function createAbortController(
  signal: AbortSignal | undefined,
  timeoutMs: number | undefined,
): {
  abortController: AbortController;
  cleanup: () => void;
} {
  const abortController = new AbortController();
  const timeout =
    typeof timeoutMs === 'number' && timeoutMs > 0
      ? setTimeout(
          () =>
            abortController.abort(new Error(`OpenAI Agents SDK timed out after ${timeoutMs}ms.`)),
          timeoutMs,
        )
      : null;

  const onAbort = () => abortController.abort(signal?.reason);
  if (signal) {
    if (signal.aborted) {
      abortController.abort(signal.reason);
    } else {
      signal.addEventListener('abort', onAbort, { once: true });
    }
  }

  return {
    abortController,
    cleanup: () => {
      if (timeout) clearTimeout(timeout);
      signal?.removeEventListener('abort', onAbort);
    },
  };
}

function mapUsage(
  rawResponses: ReadonlyArray<{ usage?: { inputTokens?: number; outputTokens?: number } }>,
) {
  return rawResponses.reduce(
    (acc, response) => ({
      inputTokens: acc.inputTokens + (response.usage?.inputTokens ?? 0),
      outputTokens: acc.outputTokens + (response.usage?.outputTokens ?? 0),
    }),
    { inputTokens: 0, outputTokens: 0 },
  );
}

function extractReasoningContent(
  rawResponses: ReadonlyArray<{
    output?: ReadonlyArray<{
      type?: string;
      rawContent?: ReadonlyArray<{ type?: string; text?: string }>;
    }>;
  }>,
): string | undefined {
  const segments: string[] = [];
  for (const response of rawResponses) {
    for (const item of response.output ?? []) {
      if (item.type !== 'reasoning') continue;
      for (const part of item.rawContent ?? []) {
        if (part.type === 'reasoning_text' && typeof part.text === 'string' && part.text.trim()) {
          segments.push(part.text.trim());
        }
      }
    }
  }
  return segments.length > 0 ? segments.join('\n\n') : undefined;
}

function getErrorStatusCode(error: unknown): number | undefined {
  if (!error || typeof error !== 'object') return undefined;
  if (typeof (error as { status?: unknown }).status === 'number') {
    return (error as { status: number }).status;
  }
  if (typeof (error as { statusCode?: unknown }).statusCode === 'number') {
    return (error as { statusCode: number }).statusCode;
  }
  return undefined;
}

export class OpenAiAgentsSdkAdapter implements LlmGateway {
  private readonly client: OpenAI;
  private readonly retryConfig: RetryConfig;

  constructor(apiKey: string, options: OpenAiAgentsSdkAdapterOptions = {}) {
    this.client = new OpenAI({
      apiKey,
      baseURL: options.baseURL,
      defaultHeaders: options.defaultHeaders,
      dangerouslyAllowBrowser: options.dangerouslyAllowBrowser,
      ...(typeof options.fetch === 'function' ? { fetch: options.fetch } : {}),
    });
    this.retryConfig = options.retryConfig ?? DEFAULT_RETRY_CONFIG;
  }

  async chat(request: LlmRequest): Promise<LlmResponse> {
    if (request.tools && request.tools.length > 0) {
      throw new Error(
        'OpenAI Agents SDK lane is text/reasoning-only in Offisim and does not execute file, shell, or virtual tool calls. Switch this employee to gateway lane to use tools.',
      );
    }

    return withRetry(
      async () => {
        const prompt = buildPrompt(request.messages);
        const systemPrompt = buildSystemPrompt(request.messages);
        const { abortController, cleanup } = createAbortController(
          request.signal,
          request.timeoutMs,
        );

        try {
          const agent = new Agent({
            name: 'Offisim Assistant',
            instructions: systemPrompt,
            model: new OpenAIChatCompletionsModel(this.client, request.model),
            tools: [],
            modelSettings: {
              temperature: request.temperature,
              maxTokens: request.maxTokens,
              toolChoice: 'none',
              store: false,
            },
          });
          const runner = new Runner({
            tracingDisabled: true,
            traceIncludeSensitiveData: false,
          });
          const result = await runner.run(agent, prompt, {
            maxTurns: 1,
            signal: abortController.signal,
          });
          const usage = mapUsage(result.rawResponses);
          const reasoningContent = extractReasoningContent(result.rawResponses);

          return {
            content: typeof result.finalOutput === 'string' ? result.finalOutput : '',
            ...(reasoningContent ? { reasoningContent } : {}),
            toolCalls: [],
            usage,
          };
        } catch (error) {
          throw this.mapError(error);
        } finally {
          cleanup();
        }
      },
      this.retryConfig,
      (error) => error instanceof LlmError && error.recoverable,
      request.signal,
    );
  }

  async *chatStream(request: LlmRequest): AsyncIterable<LlmStreamChunk> {
    const response = await this.chat(request);
    yield {
      content: response.content,
      reasoning: response.reasoningContent,
      usage: response.usage,
      done: true,
    };
  }

  dispose(): void {}

  private mapError(error: unknown): LlmError {
    if (error instanceof OpenAI.APIError) {
      return new LlmError(error.message, 'openai-agents-sdk', error.status, { cause: error });
    }
    return new LlmError(
      error instanceof Error ? error.message : 'Unknown OpenAI Agents SDK error',
      'openai-agents-sdk',
      getErrorStatusCode(error),
      { cause: error },
    );
  }
}
