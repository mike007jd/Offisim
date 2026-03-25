import type { LlmGateway, LlmRequest, LlmResponse, LlmStreamChunk } from '@aics/core/browser';
import { isTauri } from './env';
import type { ProviderConfig } from './provider-config';

export interface ProviderSecretStatus {
  hasApiKey: boolean;
}

async function invokeDesktop<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke<T>(command, args);
}

export async function getProviderSecretStatus(): Promise<ProviderSecretStatus> {
  if (!isTauri()) return { hasApiKey: false };
  return invokeDesktop<ProviderSecretStatus>('provider_secret_status');
}

export async function setProviderSecret(apiKey: string): Promise<void> {
  if (!isTauri()) return;
  await invokeDesktop('provider_secret_set', { apiKey });
}

export async function clearProviderSecret(): Promise<void> {
  if (!isTauri()) return;
  await invokeDesktop('provider_secret_clear');
}

interface DesktopProviderChatRequest {
  provider: ProviderConfig['provider'];
  baseURL?: string;
  defaultHeaders?: Record<string, string>;
  llmRequest: LlmRequest;
}

export function createDesktopProviderGateway(config: ProviderConfig): LlmGateway {
  const chat = async (request: LlmRequest): Promise<LlmResponse> => {
    if (!isTauri()) {
      throw new Error('Desktop provider gateway requires a Tauri runtime.');
    }

    return invokeDesktop<LlmResponse>('provider_chat', {
      request: {
        provider: config.provider,
        baseURL: config.baseURL,
        defaultHeaders: config.defaultHeaders,
        llmRequest: request,
      } satisfies DesktopProviderChatRequest,
    });
  };

  return {
    chat,
    async *chatStream(request: LlmRequest): AsyncIterable<LlmStreamChunk> {
      const response = await chat(request);
      if (response.content) {
        yield { content: response.content, done: false };
      }
      yield {
        toolCalls: response.toolCalls,
        usage: response.usage,
        done: true,
      };
    },
    dispose() {
      // Stateless desktop provider bridge.
    },
  };
}
