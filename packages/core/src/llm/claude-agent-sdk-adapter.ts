import { spawn } from 'node:child_process';
import {
  type Options as ClaudeAgentSdkOptions,
  type SDKAssistantMessageError,
  type SDKResultMessage,
  query,
} from '@anthropic-ai/claude-agent-sdk';
import { LlmError } from '../errors.js';
import type { LlmGateway, LlmMessage, LlmRequest, LlmResponse, LlmStreamChunk } from './gateway.js';
import { DEFAULT_RETRY_CONFIG, type RetryConfig, withRetry } from './retry.js';
import { sdkLaneTextOnlyMessage } from './sdk-lane-policy.js';

const SDK_ERROR_STATUS: Record<SDKAssistantMessageError, number | undefined> = {
  authentication_failed: 401,
  billing_error: 402,
  rate_limit: 429,
  invalid_request: 400,
  server_error: 500,
  unknown: undefined,
  max_output_tokens: 400,
  oauth_org_not_allowed: 403,
};

export interface ClaudeAgentSdkAdapterOptions {
  /** Anthropic Messages-compatible base URL for trusted gateways/providers. */
  baseURL?: string;
  /** Working directory exposed to the SDK process. */
  cwd?: string;
  /** Override the resolved Claude Code executable path when optional deps are unavailable. */
  pathToClaudeCodeExecutable?: string;
  retryConfig?: RetryConfig;
}

function buildSystemPrompt(messages: readonly LlmMessage[]): string[] | undefined {
  const systemMessages = messages
    .filter((message) => message.role === 'system')
    .map((message) => message.content.trim())
    .filter(Boolean);
  return systemMessages.length > 0 ? systemMessages : undefined;
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

function buildSdkEnv(
  apiKey: string | undefined,
  baseURL?: string,
): Record<string, string | undefined> {
  if (!apiKey) {
    return {
      ANTHROPIC_API_KEY: undefined,
      ANTHROPIC_AUTH_TOKEN: undefined,
      ANTHROPIC_BASE_URL: baseURL,
    };
  }

  if (!baseURL) {
    return {
      ANTHROPIC_API_KEY: apiKey,
      ANTHROPIC_AUTH_TOKEN: undefined,
      ANTHROPIC_BASE_URL: undefined,
    };
  }

  return {
    ANTHROPIC_API_KEY: undefined,
    ANTHROPIC_AUTH_TOKEN: apiKey,
    ANTHROPIC_BASE_URL: baseURL,
  };
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
            abortController.abort(new Error(`Claude Agent SDK timed out after ${timeoutMs}ms.`)),
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

function mapUsage(result: SDKResultMessage): { inputTokens: number; outputTokens: number } {
  return {
    inputTokens: result.usage.input_tokens ?? 0,
    outputTokens: result.usage.output_tokens ?? 0,
  };
}

function mapSdkError(
  result: Exclude<SDKResultMessage, { subtype: 'success' }>,
  assistantError: SDKAssistantMessageError | undefined,
): LlmError {
  const message = result.errors.join('; ') || `Claude Agent SDK returned ${result.subtype}`;

  return new LlmError(
    message,
    'claude-agent-sdk',
    assistantError ? SDK_ERROR_STATUS[assistantError] : undefined,
  );
}

async function collectQueryResult(
  prompt: string,
  options: ClaudeAgentSdkOptions,
): Promise<{ result: SDKResultMessage; assistantError?: SDKAssistantMessageError }> {
  let result: SDKResultMessage | null = null;
  let assistantError: SDKAssistantMessageError | undefined;

  for await (const message of query({ prompt, options })) {
    if (message.type === 'assistant' && message.error) {
      assistantError = message.error;
    }
    if (message.type === 'result') {
      result = message;
    }
  }

  if (!result) {
    throw new LlmError(
      'Claude Agent SDK query ended without a final result message.',
      'claude-agent-sdk',
    );
  }

  return { result, assistantError };
}

export class ClaudeAgentSdkAdapter implements LlmGateway {
  private readonly retryConfig: RetryConfig;

  constructor(
    private readonly apiKey: string | undefined,
    private readonly options: ClaudeAgentSdkAdapterOptions = {},
  ) {
    this.retryConfig = options.retryConfig ?? DEFAULT_RETRY_CONFIG;
  }

  async chat(request: LlmRequest): Promise<LlmResponse> {
    if (request.tools && request.tools.length > 0) {
      throw new Error(sdkLaneTextOnlyMessage('Claude Agent SDK'));
    }

    return withRetry(
      async () => {
        const prompt = buildPrompt(request.messages);
        const systemPrompt = buildSystemPrompt(request.messages);
        const { abortController, cleanup } = createAbortController(
          request.signal,
          request.timeoutMs,
        );
        const { result, assistantError } = await collectQueryResult(prompt, {
          abortController,
          cwd: this.options.cwd,
          model: request.model,
          maxTurns: 1,
          persistSession: false,
          permissionMode: 'dontAsk',
          settingSources: [],
          systemPrompt,
          tools: [],
          pathToClaudeCodeExecutable: this.options.pathToClaudeCodeExecutable,
          spawnClaudeCodeProcess: (spawnOptions) =>
            spawn(spawnOptions.command, spawnOptions.args, {
              cwd: spawnOptions.cwd,
              env: {
                ...spawnOptions.env,
                ...buildSdkEnv(this.apiKey, this.options.baseURL),
              },
              signal: spawnOptions.signal,
              stdio: ['pipe', 'pipe', 'pipe'],
            }),
        }).finally(cleanup);

        if (result.subtype !== 'success') {
          throw mapSdkError(result, assistantError);
        }

        return {
          content: result.result,
          toolCalls: [],
          usage: mapUsage(result),
        };
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
      usage: response.usage,
      done: true,
    };
  }

  dispose(): void {}
}
