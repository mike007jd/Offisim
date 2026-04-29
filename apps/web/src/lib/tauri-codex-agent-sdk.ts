import type {
  LlmGateway,
  LlmRequest,
  LlmResponse,
  LlmStreamChunk,
} from '@offisim/core/dist/llm/gateway.js';
import { Channel, invoke } from '@tauri-apps/api/core';

type CodexAgentHostEvent =
  | { kind: 'result'; response: LlmResponse }
  | { kind: 'error'; code: string; message: string };

export class TauriCodexAgentSdkError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'TauriCodexAgentSdkError';
    this.code = code;
  }
}

let requestCounter = 0;

function nextRequestId(): string {
  requestCounter = (requestCounter + 1) >>> 0;
  return `codex-agent-${Date.now().toString(36)}-${requestCounter.toString(36)}`;
}

function serializeRequest(request: LlmRequest): Record<string, unknown> {
  return {
    messages: request.messages,
    model: request.model,
    approvalPolicy: 'on-request',
    sandbox: 'workspace-write',
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

export class TauriCodexAgentSdkGateway implements LlmGateway {
  constructor(
    private readonly options: {
      cwd?: string;
    } = {},
  ) {}

  async chat(request: LlmRequest): Promise<LlmResponse> {
    const requestId = nextRequestId();
    const channel = new Channel<CodexAgentHostEvent>();

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
            new TauriCodexAgentSdkError(
              event.code || 'unknown',
              event.message || 'Trusted Codex lane request failed.',
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
      void invoke('codex_agent_abort', { requestId }).catch(() => {});
    };

    if (signal) {
      if (signal.aborted) {
        onAbort();
        return responsePromise;
      }
      signal.addEventListener('abort', onAbort, { once: true });
    }

    void invoke('codex_agent_execute', {
      req: {
        requestId,
        request: serializeRequest(request),
        ...(this.options.cwd ? { cwd: this.options.cwd } : {}),
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
      reasoning: response.reasoningContent,
      toolCalls: response.toolCalls,
      usage: response.usage,
      done: true,
    };
  }

  dispose(): void {}
}
