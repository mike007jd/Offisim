import { Channel, invoke } from '@tauri-apps/api/core';

/**
 * Custom `fetch` hook for Tauri desktop LLM adapters.
 *
 * All HTTP traffic is dispatched on the Rust side (`llm_fetch` command), which
 * reads the provider credential from Keychain per-request and injects it per
 * the declared `AuthScheme`. The webview never sees the credential. Streamed
 * response bytes are piped back through a Tauri `Channel<TransportEvent>`
 * into a standard `ReadableStream`, so the SDK's SSE parser is oblivious to
 * the alternate transport.
 */

export type AuthScheme = 'bearer' | 'x-api-key' | 'none';

export interface TauriLlmFetchOptions {
  /** Override the header name when scheme === 'x-api-key'. */
  headerName?: string;
  /** Named Rust-side credential slot. The secret value never crosses IPC. */
  secretRef?: string;
}

type TransportEvent =
  | { kind: 'headers'; status: number; headers: Array<[string, string]> }
  | { kind: 'chunk'; bytes: number[] }
  | { kind: 'done' }
  | { kind: 'error'; code: string; message: string };

/**
 * Error thrown by the Tauri LLM transport. The `code` mirrors the Rust
 * `TransportEvent::Error.code` and lets upstream layers translate
 * transport-level failures into user-visible copy without parsing strings.
 */
export class TauriLlmFetchError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'TauriLlmFetchError';
    this.code = code;
  }
}

/**
 * True when the error (or any of its wrapped causes) originated as the Rust
 * `no-credential` variant. SDKs like `@anthropic-ai/sdk` and `openai` wrap
 * fetch errors inside APIConnectionError-style classes, so we walk the
 * `cause` chain before falling back to message-pattern matching (the Rust
 * command also surfaces the code as a `"no-credential: ..."` string prefix
 * in case the Channel error raced against IPC rejection).
 */
export function isNoCredentialError(err: unknown): boolean {
  let current: unknown = err;
  for (let i = 0; i < 5 && current; i += 1) {
    if (current instanceof TauriLlmFetchError && current.code === 'no-credential') return true;
    if (typeof current === 'object' && current !== null) {
      const code = (current as { code?: unknown }).code;
      if (code === 'no-credential') return true;
    }
    current = (current as { cause?: unknown })?.cause;
  }
  const msg = err instanceof Error ? err.message : String(err ?? '');
  return /\bno-credential\b/.test(msg);
}

let requestCounter = 0;
function nextRequestId(): string {
  requestCounter = (requestCounter + 1) >>> 0;
  return `llm-${Date.now().toString(36)}-${requestCounter.toString(36)}`;
}

async function extractBody(
  request: Request,
  init: RequestInit | undefined,
): Promise<string | null> {
  const raw = init?.body ?? null;
  if (raw == null) {
    // Body may have come in via the Request object (common when SDKs pass
    // `new Request(url, { body, ... })`). Clone so the caller's Request is
    // not consumed.
    if (request.body) return request.clone().text();
    return null;
  }
  if (typeof raw === 'string') return raw;
  if (raw instanceof URLSearchParams) return raw.toString();
  if (raw instanceof ArrayBuffer) return new TextDecoder().decode(raw);
  if (ArrayBuffer.isView(raw)) {
    return new TextDecoder().decode(raw as ArrayBufferView);
  }
  if (raw instanceof Blob) return raw.text();
  // ReadableStream or FormData — fall back to cloning the Request which knows
  // how to materialise its own body.
  if (request.body) return request.clone().text();
  return null;
}

export function createTauriLlmFetch(
  scheme: AuthScheme,
  opts: TauriLlmFetchOptions = {},
): typeof fetch {
  const headerName = opts.headerName;
  const tauriFetch: typeof fetch = async (input, init) => {
    const request = input instanceof Request ? input : new Request(input, init);
    const url = request.url;
    const method = (init?.method ?? request.method ?? 'GET').toUpperCase();

    const headerMap = new Headers(request.headers);
    if (init?.headers) {
      const extra = new Headers(init.headers as HeadersInit);
      extra.forEach((value, key) => headerMap.set(key, value));
    }
    const headers: Array<[string, string]> = [];
    headerMap.forEach((value, key) => {
      headers.push([key, value]);
    });

    const body = await extractBody(request, init);

    const requestId = nextRequestId();
    const channel = new Channel<TransportEvent>();

    let resolveResponse!: (response: Response) => void;
    let rejectResponse!: (error: Error) => void;
    const responsePromise = new Promise<Response>((resolve, reject) => {
      resolveResponse = resolve;
      rejectResponse = reject;
    });

    let streamController: ReadableStreamDefaultController<Uint8Array> | null = null;
    let finished = false;
    const finish = (err?: Error) => {
      if (finished) return;
      finished = true;
      if (err) {
        try {
          streamController?.error(err);
        } catch {
          /* controller may already be closed */
        }
      } else {
        try {
          streamController?.close();
        } catch {
          /* controller may already be closed */
        }
      }
      streamController = null;
    };

    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        streamController = controller;
      },
      cancel() {
        void invoke('llm_fetch_abort', { requestId }).catch(() => {});
        finished = true;
      },
    });

    channel.onmessage = (event) => {
      switch (event.kind) {
        case 'headers': {
          const responseHeaders = new Headers();
          for (const [k, v] of event.headers) {
            try {
              responseHeaders.append(k, v);
            } catch {
              // Webview forbids synthesising some headers (e.g. transfer-encoding).
            }
          }
          resolveResponse(
            new Response(stream, {
              status: event.status,
              headers: responseHeaders,
            }),
          );
          break;
        }
        case 'chunk': {
          if (!streamController) break;
          streamController.enqueue(Uint8Array.from(event.bytes));
          break;
        }
        case 'done': {
          finish();
          break;
        }
        case 'error': {
          const err = new TauriLlmFetchError(
            event.code || 'unknown',
            event.message || 'llm_fetch failed',
          );
          rejectResponse(err);
          finish(err);
          break;
        }
      }
    };

    const signal = init?.signal ?? request.signal;
    const onAbort = () => {
      const err =
        signal?.reason instanceof Error
          ? signal.reason
          : new DOMException('Request aborted', 'AbortError');
      rejectResponse(err);
      finish(err);
      void invoke('llm_fetch_abort', { requestId }).catch(() => {});
    };
    if (signal) {
      if (signal.aborted) {
        onAbort();
        return responsePromise;
      }
      signal.addEventListener('abort', onAbort, { once: true });
    }

    void invoke('llm_fetch', {
      req: {
        requestId,
        url,
        method,
        headers,
        body,
        auth: {
          scheme,
          ...(headerName ? { headerName } : {}),
          ...(opts.secretRef ? { secretRef: opts.secretRef } : {}),
        },
      },
      onEvent: channel,
    }).catch((err: unknown) => {
      const error = err instanceof Error ? err : new Error(String(err));
      rejectResponse(error);
      finish(error);
    });

    return responsePromise;
  };
  return tauriFetch;
}
