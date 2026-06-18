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
  authScheme?: string;
  executionLane?: string;
  authMode?: string;
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
  // Without this guard a non-Tauri caller surfaces the @tauri-apps/api
  // internal TypeError ("reading 'invoke'") instead of an actionable message.
  if (!isDesktopProviderBridgeAvailable()) {
    throw new Error('Desktop runtime required for provider operations.');
  }
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke<RuntimeProviderProfile[]>('runtime_provider_profiles');
}

/** localStorage key for the user's explicitly chosen chat provider profile id. */
const PREFERRED_PROVIDER_STORAGE_KEY = 'offisim:active-provider-id';

/** The provider profile id the user picked in Settings → Providers ("Use for
 *  chat"), or null when they have not chosen one (use the default priority). */
export function getPreferredProviderId(): string | null {
  try {
    if (typeof localStorage === 'undefined') return null;
    return localStorage.getItem(PREFERRED_PROVIDER_STORAGE_KEY)?.trim() || null;
  } catch {
    return null;
  }
}

/** Persist (or clear) the user's chosen chat provider. The desktop runtime is
 *  cached per company, so the caller must dispose it after changing this so the
 *  next chat reassembles against the newly-selected provider. */
export function setPreferredProviderId(id: string | null): void {
  try {
    if (typeof localStorage === 'undefined') return;
    const trimmed = id?.trim();
    if (trimmed) localStorage.setItem(PREFERRED_PROVIDER_STORAGE_KEY, trimmed);
    else localStorage.removeItem(PREFERRED_PROVIDER_STORAGE_KEY);
  } catch {
    /* best-effort: a private-mode storage failure must not break selection */
  }
}

/** Ordered provider profile ids the chat runtime prefers (highest first), once
 *  the user's explicit choice and a local endpoint are exhausted. Shared with
 *  the Settings "In use for chat" badge (resolveEffectiveChatConfigId) so the
 *  two can never silently drift. */
export const CHAT_PROVIDER_ID_PRIORITY = [
  'zai-anthropic',
  'zai',
  'minimax',
  'minimax-openai',
] as const;

interface ChatProviderCandidate {
  id: string;
  displayName: string;
  product?: string;
  provider?: string;
  baseUrl?: string;
  hasCredential?: boolean;
  hasStoredKey?: boolean;
  localEndpoint?: boolean;
  hostResolved?: boolean;
}

function candidateHasCredential(candidate: ChatProviderCandidate): boolean {
  return candidate.hasCredential === true || candidate.hasStoredKey === true;
}

function isOpenRouterCandidate(candidate: ChatProviderCandidate): boolean {
  const host = (() => {
    try {
      return candidate.baseUrl ? new URL(candidate.baseUrl).hostname.toLowerCase() : '';
    } catch {
      return '';
    }
  })();
  return (
    candidate.id.toLowerCase().includes('openrouter') ||
    candidate.displayName.toLowerCase().includes('openrouter') ||
    candidate.product === 'openrouter' ||
    candidate.provider === 'openrouter' ||
    host === 'openrouter.ai' ||
    host.endsWith('.openrouter.ai')
  );
}

function isClaudeLocalAuthProfile(profile: RuntimeProviderProfile): boolean {
  return profile.executionLane === 'claude-agent-sdk' && profile.authMode === 'local-auth';
}

export function selectDefaultChatProvider<T extends ChatProviderCandidate>(
  profiles: readonly T[],
  preferredId: string | null,
): T | null {
  const credentialed = (id: string) =>
    profiles.find((candidate) => candidateHasCredential(candidate) && candidate.id === id);
  const autoEligible = (candidate: T) =>
    candidateHasCredential(candidate) && !isOpenRouterCandidate(candidate);
  return (
    (preferredId ? credentialed(preferredId) : undefined) ??
    profiles.find(
      (candidate) => autoEligible(candidate) && (candidate.localEndpoint || candidate.hostResolved),
    ) ??
    CHAT_PROVIDER_ID_PRIORITY.map(credentialed).find(Boolean) ??
    profiles.find(
      (candidate) =>
        autoEligible(candidate) && candidate.displayName.toLowerCase().includes('minimax'),
    ) ??
    profiles.find(autoEligible) ??
    null
  );
}

/**
 * Pick the chat provider profile. Priority:
 *   1. the user's explicit choice (Settings → "Use for chat"), if it has a key
 *   2. a credentialed local endpoint (ollama-style)
 *   3. CHAT_PROVIDER_ID_PRIORITY by id (z.ai's Anthropic lane first, then MiniMax)
 *   4. MiniMax by display name
 *   5. any non-OpenRouter profile with a stored credential
 */
export function findDefaultChatProviderProfile(
  profiles: readonly RuntimeProviderProfile[],
): RuntimeProviderProfile | null {
  return selectDefaultChatProvider(profiles, getPreferredProviderId());
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

interface ProviderResponsePayload {
  content?: Array<{ type?: string; text?: string }>;
  choices?: Array<{ message?: { content?: string }; text?: string }>;
  output_text?: string;
  usage?: Record<string, unknown>;
}

function parseProviderResponse(raw: string): ProviderResponsePayload | null {
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? (parsed as ProviderResponsePayload) : null;
  } catch {
    return null;
  }
}

function extractProviderTextFromParsed(parsed: ProviderResponsePayload | null): string {
  if (!parsed) return 'Provider returned a malformed response.';
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

export function extractProviderText(raw: string): string {
  return extractProviderTextFromParsed(parseProviderResponse(raw));
}

function numberField(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
}

function extractProviderUsageFromParsed(
  parsed: ProviderResponsePayload | null,
): ProviderUsage | null {
  const usage = parsed?.usage;
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

export function extractProviderUsage(raw: string): ProviderUsage | null {
  return extractProviderUsageFromParsed(parseProviderResponse(raw));
}

export function safeErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  if (error && typeof error === 'object') {
    const record = error as Record<string, unknown>;
    for (const key of ['message', 'error', 'reason', 'detail']) {
      const value = record[key];
      if (typeof value === 'string' && value.trim()) return value;
    }
    try {
      return JSON.stringify(error);
    } catch {
      return String(error);
    }
  }
  return 'Unknown provider error';
}

export async function sendProviderText({
  profile,
  text,
  requestId,
  maxOutputTokens,
  companyId,
  projectId,
  signal,
}: {
  profile: RuntimeProviderProfile;
  text: string;
  requestId: string;
  maxOutputTokens: number;
  companyId?: string | null;
  projectId?: string | null;
  signal?: AbortSignal;
}): Promise<string> {
  const result = await sendProviderTextDetailed({
    profile,
    text,
    requestId,
    maxOutputTokens,
    companyId,
    projectId,
    signal,
  });
  return result.text;
}

type ClaudeAgentHostEvent =
  | { kind: 'result'; response: unknown }
  | { kind: 'error'; code: string; message: string };

function providerUsageFromLlmUsage(rawUsage: unknown): ProviderUsage | null {
  if (!rawUsage || typeof rawUsage !== 'object') return null;
  const usage = rawUsage as Record<string, unknown>;
  return {
    inputTokens: numberField(usage.inputTokens ?? usage.input_tokens),
    outputTokens: numberField(usage.outputTokens ?? usage.output_tokens),
    cacheReadInputTokens: numberField(usage.cacheReadInputTokens ?? usage.cache_read_input_tokens),
    cacheCreationInputTokens: numberField(
      usage.cacheCreationInputTokens ?? usage.cache_creation_input_tokens,
    ),
    raw: rawUsage,
  };
}

function claudeAgentResponseEnvelope(response: unknown): {
  text: string;
  usage: ProviderUsage | null;
  raw: string;
} {
  const raw = JSON.stringify(response);
  if (!response || typeof response !== 'object') {
    throw new Error('Claude Code local account returned an invalid response.');
  }
  const envelope = response as {
    ok?: boolean;
    response?: unknown;
    error?: { message?: string; code?: string };
  };
  if (envelope.ok === false) {
    throw new Error(
      envelope.error?.message || envelope.error?.code || 'Claude Code local account failed.',
    );
  }
  const body = envelope.response ?? response;
  if (!body || typeof body !== 'object') {
    throw new Error('Claude Code local account returned an empty response.');
  }
  const llm = body as { content?: unknown; usage?: unknown };
  const text = typeof llm.content === 'string' ? llm.content.trim() : '';
  return {
    text: text || 'Provider returned an empty response.',
    usage: providerUsageFromLlmUsage(llm.usage),
    raw,
  };
}

async function sendClaudeAgentTextDetailed({
  profile,
  text,
  requestId,
  maxOutputTokens,
  companyId,
  projectId,
  signal,
}: {
  profile: RuntimeProviderProfile;
  text: string;
  requestId: string;
  maxOutputTokens: number;
  companyId?: string | null;
  projectId?: string | null;
  signal?: AbortSignal;
}): Promise<ProviderSendResult> {
  if (!companyId?.trim()) {
    throw new Error('Enter a company workspace before testing Claude Code local account.');
  }
  if (!projectId?.trim()) {
    throw new Error('Enter a company workspace before testing Claude Code local account.');
  }
  if (signal?.aborted) {
    throw new DOMException('Aborted', 'AbortError');
  }

  const { Channel, invoke } = await import('@tauri-apps/api/core');
  const abortClaudeAgent = () => {
    void invoke('claude_agent_abort', { requestId }).catch(() => undefined);
  };

  const response = await new Promise<unknown>((resolve, reject) => {
    let settled = false;
    let onAbort: (() => void) | null = null;
    const cleanup = () => {
      if (onAbort && signal) {
        signal.removeEventListener('abort', onAbort);
        onAbort = null;
      }
    };
    const settle = (fn: () => void) => {
      if (settled) return;
      settled = true;
      cleanup();
      fn();
    };

    const onEvent = new Channel<ClaudeAgentHostEvent>((event) => {
      if (event.kind === 'result') {
        settle(() => resolve(event.response));
        return;
      }
      settle(() => reject(new Error(event.message)));
    });

    if (signal) {
      onAbort = () => {
        abortClaudeAgent();
        settle(() => reject(new DOMException('Aborted', 'AbortError')));
      };
      signal.addEventListener('abort', onAbort, { once: true });
      if (signal.aborted) {
        onAbort();
        return;
      }
    }

    void invoke('claude_agent_execute', {
      req: {
        requestId,
        providerProfileId: profile.id,
        companyId,
        projectId,
        credentialMode: 'local-auth',
        request: {
          messages: [{ role: 'user', content: text }],
          ...(profile.model.trim() ? { model: profile.model.trim() } : {}),
          maxTokens: maxOutputTokens,
          tools: [],
          timeoutMs: 120000,
        },
      },
      onEvent,
    }).catch((error) => {
      settle(() => reject(new Error(safeErrorMessage(error))));
    });
  });

  const parsed = claudeAgentResponseEnvelope(response);
  return {
    text: parsed.text,
    raw: parsed.raw,
    status: 200,
    usage: parsed.usage,
  };
}

export async function sendProviderTextDetailed({
  profile,
  text,
  requestId,
  maxOutputTokens,
  companyId,
  projectId,
  signal,
}: {
  profile: RuntimeProviderProfile;
  text: string;
  requestId: string;
  maxOutputTokens: number;
  companyId?: string | null;
  projectId?: string | null;
  signal?: AbortSignal;
}): Promise<ProviderSendResult> {
  if (isClaudeLocalAuthProfile(profile)) {
    return sendClaudeAgentTextDetailed({
      profile,
      text,
      requestId,
      maxOutputTokens,
      companyId,
      projectId,
      signal,
    });
  }
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
  const parsed = parseProviderResponse(raw);
  return {
    text: extractProviderTextFromParsed(parsed),
    raw,
    status,
    usage: extractProviderUsageFromParsed(parsed),
  };
}
