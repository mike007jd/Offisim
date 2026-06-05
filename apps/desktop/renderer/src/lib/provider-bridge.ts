import {
  type LlmTransportEvent,
  abortLlmFetch,
  endpointKindFor,
} from './llm-transport-protocol.js';

export interface RuntimeProviderProfile {
  id: string;
  displayName: string;
  provider: 'anthropic' | 'openai' | 'openai-compat' | string;
  model: string;
  baseUrl: string;
  secretRef: string;
  localEndpoint: boolean;
  hasCredential: boolean;
}

export interface ProviderUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadInputTokens: number;
  cacheCreationInputTokens: number;
  raw: unknown;
}

export interface ProviderSendResult {
  text: string;
  raw: string;
  status: number;
  usage: ProviderUsage | null;
}

export function isDesktopProviderBridgeAvailable(): boolean {
  return (
    typeof window !== 'undefined' &&
    ('__TAURI_INTERNALS__' in window || window.location.protocol === 'tauri:')
  );
}

export async function loadRuntimeProviderProfiles(): Promise<RuntimeProviderProfile[]> {
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke<RuntimeProviderProfile[]>('runtime_provider_profiles');
}

export function findDefaultChatProviderProfile(
  profiles: readonly RuntimeProviderProfile[],
): RuntimeProviderProfile | null {
  return (
    profiles.find((candidate) => candidate.hasCredential && candidate.localEndpoint) ??
    profiles.find((candidate) => candidate.hasCredential && candidate.id === 'minimax') ??
    profiles.find(
      (candidate) =>
        candidate.hasCredential && candidate.displayName.toLowerCase().includes('minimax'),
    ) ??
    profiles.find((candidate) => candidate.hasCredential) ??
    null
  );
}

function headersFor(profile: RuntimeProviderProfile): Array<[string, string]> {
  const headers: Array<[string, string]> = [['content-type', 'application/json']];
  if (profile.provider === 'anthropic') {
    headers.push(['anthropic-version', '2023-06-01']);
  }
  return headers;
}

function requestBodyFor(profile: RuntimeProviderProfile, text: string, maxOutputTokens: number) {
  // Anthropic Messages and OpenAI-compatible chat bodies share this shape.
  return {
    model: profile.model,
    max_tokens: maxOutputTokens,
    messages: [{ role: 'user', content: text }],
  };
}

export function extractProviderText(raw: string): string {
  let parsed: {
    content?: Array<{ type?: string; text?: string }>;
    choices?: Array<{ message?: { content?: string }; text?: string }>;
    output_text?: string;
  };
  try {
    parsed = JSON.parse(raw);
  } catch {
    return 'Provider returned a malformed response.';
  }
  if (typeof parsed.output_text === 'string' && parsed.output_text.trim()) {
    return parsed.output_text.trim();
  }
  const anthropicText =
    parsed.content
      ?.map((part) => (part.type === 'text' || part.text ? (part.text ?? '') : ''))
      .join('')
      .trim() ?? '';
  if (anthropicText) return anthropicText;
  const chatText =
    parsed.choices
      ?.map((choice) => choice.message?.content ?? choice.text ?? '')
      .join('')
      .trim() ?? '';
  if (chatText) return chatText;
  return 'Provider returned an empty response.';
}

function numberField(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
}

export function extractProviderUsage(raw: string): ProviderUsage | null {
  let parsed: { usage?: Record<string, unknown> };
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  const usage = parsed.usage;
  if (!usage || typeof usage !== 'object') return null;

  if ('prompt_tokens' in usage || 'completion_tokens' in usage) {
    const promptTokens = numberField(usage.prompt_tokens);
    const completionTokens = numberField(usage.completion_tokens);
    const promptDetails = usage.prompt_tokens_details as Record<string, unknown> | undefined;
    const cachedTokens = numberField(promptDetails?.cached_tokens);
    return {
      inputTokens: Math.max(0, promptTokens - cachedTokens),
      outputTokens: completionTokens,
      cacheReadInputTokens: cachedTokens,
      cacheCreationInputTokens: 0,
      raw: usage,
    };
  }

  if ('input_tokens' in usage || 'output_tokens' in usage) {
    return {
      inputTokens: numberField(usage.input_tokens),
      outputTokens: numberField(usage.output_tokens),
      cacheReadInputTokens: numberField(usage.cache_read_input_tokens),
      cacheCreationInputTokens: numberField(usage.cache_creation_input_tokens),
      raw: usage,
    };
  }

  return {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadInputTokens: 0,
    cacheCreationInputTokens: 0,
    raw: usage,
  };
}

export function safeErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  return 'Unknown provider error';
}

export async function sendProviderText({
  profile,
  text,
  requestId,
  maxOutputTokens,
  signal,
}: {
  profile: RuntimeProviderProfile;
  text: string;
  requestId: string;
  maxOutputTokens: number;
  signal?: AbortSignal;
}): Promise<string> {
  const result = await sendProviderTextDetailed({
    profile,
    text,
    requestId,
    maxOutputTokens,
    signal,
  });
  return result.text;
}

export async function sendProviderTextDetailed({
  profile,
  text,
  requestId,
  maxOutputTokens,
  signal,
}: {
  profile: RuntimeProviderProfile;
  text: string;
  requestId: string;
  maxOutputTokens: number;
  signal?: AbortSignal;
}): Promise<ProviderSendResult> {
  if (!profile.hasCredential) {
    throw new Error('No provider credential stored on this device.');
  }
  if (signal?.aborted) {
    throw new DOMException('Aborted', 'AbortError');
  }

  const { Channel, invoke } = await import('@tauri-apps/api/core');
  if (signal?.aborted) {
    throw new DOMException('Aborted', 'AbortError');
  }
  let status = 0;
  let raw = '';
  const decoder = new TextDecoder();

  const channelDone = new Promise<void>((resolve, reject) => {
    let onAbort: (() => void) | null = null;
    const cleanup = () => {
      if (onAbort && signal) {
        signal.removeEventListener('abort', onAbort);
        onAbort = null;
      }
    };

    const onEvent = new Channel<LlmTransportEvent>((event) => {
      if (event.kind === 'headers') {
        status = event.status;
        return;
      }
      if (event.kind === 'chunk') {
        raw += decoder.decode(new Uint8Array(event.bytes), { stream: true });
        return;
      }
      if (event.kind === 'error') {
        cleanup();
        reject(new Error(event.message));
        return;
      }
      raw += decoder.decode();
      cleanup();
      resolve();
    });

    if (signal) {
      // Without this, an abort via llm_fetch_abort can stop the Rust side from
      // emitting any terminal event, leaving channelDone (and the caller) hung.
      onAbort = () => {
        abortLlmFetch(requestId);
        cleanup();
        reject(new DOMException('Aborted', 'AbortError'));
      };
      signal.addEventListener('abort', onAbort, { once: true });
      if (signal.aborted) {
        onAbort();
        return;
      }
    }

    void invoke('llm_fetch', {
      req: {
        requestId,
        providerProfileId: profile.id,
        endpointKind: endpointKindFor(profile),
        method: 'POST',
        headers: headersFor(profile),
        body: JSON.stringify(requestBodyFor(profile, text, maxOutputTokens)),
      },
      onEvent,
    }).catch((error) => {
      cleanup();
      reject(new Error(safeErrorMessage(error)));
    });
  });

  await channelDone;
  if (status >= 400) {
    throw new Error(`Provider request failed with HTTP ${status}.`);
  }
  return {
    text: extractProviderText(raw),
    raw,
    status,
    usage: extractProviderUsage(raw),
  };
}
