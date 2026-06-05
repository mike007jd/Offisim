import {
  type LlmTransportEvent,
  abortLlmFetch,
  endpointKindFor,
} from './llm-transport-protocol.js';
import {
  type RuntimeProviderProfile,
  isDesktopProviderBridgeAvailable,
} from './provider-bridge.js';

/**
 * Credential-isolated `fetch` shim for the desktop LLM gateway lane.
 *
 * The Offisim core gateway (`createGateway`) builds an Anthropic/OpenAI SDK
 * client and lets us override its transport via `GatewayConfig.fetch`. On the
 * Tauri WebView we cannot let the SDK make a raw HTTPS call — the provider
 * secret must never cross the Rust→JS boundary. Instead every outbound request
 * is tunneled through the Rust-side `llm_fetch` command, which resolves the
 * canonical endpoint from the provider profile, injects the secret, strips any
 * SDK-side auth header, and streams the response back over a `Channel`.
 *
 * This shim bridges that `Channel<LlmTransportEvent>` to a real streaming
 * `ReadableStream` so the SDK sees a normal `Response` and can parse streaming
 * (SSE) or buffered bodies exactly as it would over the network. A buffered
 * accumulate-then-emit shim would break SSE parsing; this preserves chunk
 * boundaries.
 *
 * Mirrors the Channel protocol of `sendProviderTextDetailed` in
 * `provider-bridge.ts`, including the abort handling that pokes
 * `llm_fetch_abort` so the Rust side drops the in-flight request.
 */

function bodyToString(body: BodyInit | null | undefined): string | undefined {
  if (body == null) return undefined;
  if (typeof body === 'string') return body;
  // The Anthropic/OpenAI SDKs serialize their request bodies to JSON strings
  // before calling fetch, so the string branch is the live path. Guard the rest
  // defensively rather than silently dropping a non-string body.
  if (body instanceof URLSearchParams) return body.toString();
  if (body instanceof ArrayBuffer) return new TextDecoder().decode(body);
  if (ArrayBuffer.isView(body)) {
    return new TextDecoder().decode(
      body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength),
    );
  }
  throw new Error(
    'tauri-llm-fetch: unsupported request body type for credential-isolated transport.',
  );
}

function headerPairs(headers: HeadersInit | undefined): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  if (!headers) return out;
  // Rust strips any authorization / x-api-key header and injects the real
  // secret, so forwarding the SDK's sentinel auth header is harmless. We keep
  // content-type and any provider version header the SDK set.
  new Headers(headers).forEach((value, key) => {
    out.push([key, value]);
  });
  if (!out.some(([key]) => key.toLowerCase() === 'content-type')) {
    out.push(['content-type', 'application/json']);
  }
  return out;
}

/**
 * Build a credential-isolated `fetch` bound to a provider profile. The returned
 * function ignores the request URL (Rust resolves the canonical endpoint from
 * the profile + endpoint kind) and forwards method/headers/body verbatim.
 */
export function createTauriLlmFetch(profile: RuntimeProviderProfile): typeof fetch {
  if (!isDesktopProviderBridgeAvailable()) {
    throw new Error('createTauriLlmFetch requires the Tauri desktop provider bridge.');
  }

  const tauriFetch: typeof fetch = async (_input, init) => {
    const { Channel, invoke } = await import('@tauri-apps/api/core');
    const requestId = crypto.randomUUID();
    const method = init?.method ?? 'POST';
    const signal = init?.signal ?? undefined;

    if (signal?.aborted) {
      throw new DOMException('Aborted', 'AbortError');
    }

    let controllerRef: ReadableStreamDefaultController<Uint8Array> | null = null;
    let aborted = false;
    let onAbort: (() => void) | null = null;
    let settled = false;

    const cleanupAbort = () => {
      if (onAbort && signal) {
        signal.removeEventListener('abort', onAbort);
        onAbort = null;
      }
    };

    return await new Promise<Response>((resolveResponse, rejectResponse) => {
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          controllerRef = controller;
        },
        cancel() {
          // The consumer (SDK) gave up on the body — drop the Rust request.
          if (!settled) {
            abortLlmFetch(requestId);
          }
          cleanupAbort();
        },
      });

      const onEvent = new Channel<LlmTransportEvent>((event) => {
        if (event.kind === 'headers') {
          // 4xx/5xx still resolve with a Response so the SDK can parse the
          // provider's error body; only a transport-level error rejects.
          resolveResponse(
            new Response(stream, {
              status: event.status,
              headers: new Headers(event.headers),
            }),
          );
          return;
        }
        if (event.kind === 'chunk') {
          controllerRef?.enqueue(new Uint8Array(event.bytes));
          return;
        }
        if (event.kind === 'error') {
          settled = true;
          cleanupAbort();
          const err = new Error(event.message || event.code || 'provider transport error');
          // If headers never arrived the fetch() promise is still pending —
          // reject it. If the stream is already live, surface the error there.
          if (controllerRef) controllerRef.error(err);
          rejectResponse(err);
          return;
        }
        // done
        settled = true;
        cleanupAbort();
        controllerRef?.close();
      });

      if (signal) {
        onAbort = () => {
          aborted = true;
          settled = true;
          abortLlmFetch(requestId);
          const err = new DOMException('Aborted', 'AbortError');
          if (controllerRef) {
            controllerRef.error(err);
          }
          rejectResponse(err);
          cleanupAbort();
        };
        signal.addEventListener('abort', onAbort, { once: true });
      }

      let bodyString: string | undefined;
      try {
        bodyString = bodyToString(init?.body);
      } catch (err) {
        rejectResponse(err instanceof Error ? err : new Error(String(err)));
        cleanupAbort();
        return;
      }

      void invoke('llm_fetch', {
        req: {
          requestId,
          providerProfileId: profile.id,
          endpointKind: endpointKindFor(profile),
          method,
          headers: headerPairs(init?.headers),
          body: bodyString,
        },
        onEvent,
      }).catch((err: unknown) => {
        // The command itself failed to dispatch (or rejected before emitting a
        // terminal event). Surface it unless an abort already settled the call.
        if (aborted || settled) return;
        settled = true;
        cleanupAbort();
        const error = err instanceof Error ? err : new Error(String(err));
        if (controllerRef) controllerRef.error(error);
        rejectResponse(error);
      });
    });
  };

  return tauriFetch;
}
