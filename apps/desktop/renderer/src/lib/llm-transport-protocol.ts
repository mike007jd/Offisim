// Shared wire contract for the credential-isolated LLM gateway transport.
// MUST stay in sync with the Rust `llm_transport::TransportEvent` enum
// (apps/desktop/src-tauri/src/llm_transport.rs). Both sendProviderTextDetailed
// (provider-bridge.ts) and createTauriLlmFetch (tauri-llm-fetch.ts) speak this
// protocol — defined once here so a Rust enum change is caught in one place.

/** Wire shape emitted by the Rust `llm_transport::TransportEvent` enum. */
export type LlmTransportEvent =
  | { kind: 'headers'; status: number; headers: Array<[string, string]> }
  | { kind: 'chunk'; bytes: number[] }
  | { kind: 'done' }
  | { kind: 'error'; code: string; message: string };

/** Endpoint kind the Rust transport uses to resolve the canonical provider URL. */
export function endpointKindFor(profile: { provider: string }): string {
  return profile.provider === 'anthropic' ? 'anthropic-messages' : 'open-ai-chat-completions';
}

/**
 * Fire-and-forget the Rust-side in-flight request cancellation. Best-effort: a
 * failed abort dispatch is swallowed (the request will time out on its own).
 * The `@tauri-apps/api/core` module is already loaded on every call path, so the
 * dynamic import resolves from cache.
 */
export function abortLlmFetch(requestId: string): void {
  void import('@tauri-apps/api/core')
    .then(({ invoke }) => invoke('llm_fetch_abort', { requestId }))
    .catch(() => undefined);
}
