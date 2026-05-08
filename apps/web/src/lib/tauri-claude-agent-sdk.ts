import type {
  LlmGateway,
  LlmRequest,
  LlmResponse,
  LlmStreamChunk,
} from '@offisim/core/dist/llm/gateway.js';
import { sdkLaneTextOnlyMessage } from '@offisim/core/dist/llm/sdk-lane-policy.js';
import { Channel, invoke } from '@tauri-apps/api/core';

type ClaudeAgentHostEvent =
  | { kind: 'result'; response: LlmResponse }
  | { kind: 'error'; code: string; message: string };

export class TauriClaudeAgentSdkError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'TauriClaudeAgentSdkError';
    this.code = code;
  }
}

let requestCounter = 0;

function nextRequestId(): string {
  requestCounter = (requestCounter + 1) >>> 0;
  return `claude-agent-${Date.now().toString(36)}-${requestCounter.toString(36)}`;
}

function serializeRequest(request: LlmRequest): Record<string, unknown> {
  return {
    messages: request.messages,
    model: request.model,
    ...(typeof request.temperature === 'number' ? { temperature: request.temperature } : {}),
    ...(typeof request.maxTokens === 'number' ? { maxTokens: request.maxTokens } : {}),
    ...(typeof request.timeoutMs === 'number' ? { timeoutMs: request.timeoutMs } : {}),
    ...(request.tools ? { tools: request.tools } : {}),
  };
}

function normalizeInvokeError(err: unknown): Error {
  if (err instanceof Error) return err;
  return new Error(String(err ?? 'Unknown trusted-host error'));
}

export class TauriClaudeAgentSdkGateway implements LlmGateway {
  constructor(
    private readonly options: {
      providerProfileId?: string;
      cwd?: string;
      resolveProjectId?: () => Promise<string | null | undefined>;
      credentialMode?: 'api-key' | 'local-auth';
    } = {},
  ) {}

  async chat(request: LlmRequest): Promise<LlmResponse> {
    if (request.tools && request.tools.length > 0) {
      throw new Error(sdkLaneTextOnlyMessage('Claude Agent SDK'));
    }

    const requestId = nextRequestId();
    const channel = new Channel<ClaudeAgentHostEvent>();

    let resolveResponse!: (response: LlmResponse) => void;
    let rejectResponse!: (error: Error) => void;
    const responsePromise = new Promise<LlmResponse>((resolve, reject) => {
      resolveResponse = resolve;
      rejectResponse = reject;
    });

    let settled = false;
    const settleError = (error: Error) => {
      if (settled) return;
      settled = true;
      rejectResponse(error);
    };
    const settleSuccess = (response: LlmResponse) => {
      if (settled) return;
      settled = true;
      resolveResponse(response);
    };

    channel.onmessage = (event) => {
      switch (event.kind) {
        case 'result':
          settleSuccess(event.response);
          break;
        case 'error':
          settleError(
            new TauriClaudeAgentSdkError(
              event.code || 'unknown',
              event.message || 'Trusted Claude lane request failed.',
            ),
          );
          break;
      }
    };

    const signal = request.signal;
    const onAbort = () => {
      const error =
        signal?.reason instanceof Error
          ? signal.reason
          : new DOMException('Request aborted', 'AbortError');
      settleError(error);
      void invoke('claude_agent_abort', { requestId }).catch(() => {});
    };

    if (signal) {
      if (signal.aborted) {
        onAbort();
        return responsePromise;
      }
      signal.addEventListener('abort', onAbort, { once: true });
    }

    const resolvedProjectId =
      request.executionContext?.projectId ?? (await this.options.resolveProjectId?.());

    void invoke('claude_agent_execute', {
      req: {
        requestId,
        request: serializeRequest(request),
        ...(this.options.providerProfileId
          ? { providerProfileId: this.options.providerProfileId }
          : {}),
        ...(this.options.cwd ? { cwd: this.options.cwd } : {}),
        ...(resolvedProjectId ? { projectId: resolvedProjectId } : {}),
        ...(request.executionContext?.employeeId
          ? { employeeId: request.executionContext.employeeId }
          : {}),
        ...(this.options.credentialMode ? { credentialMode: this.options.credentialMode } : {}),
      },
      onEvent: channel,
    }).catch((err: unknown) => {
      settleError(normalizeInvokeError(err));
    });

    return responsePromise.finally(() => {
      signal?.removeEventListener('abort', onAbort);
    });
  }

  async *chatStream(request: LlmRequest): AsyncIterable<LlmStreamChunk> {
    const response = await this.chat(request);
    yield {
      content: response.content,
      toolCalls: response.toolCalls,
      usage: response.usage,
      done: true,
    };
  }

  dispose(): void {}
}
