# desktop-llm-credential-isolation

## Purpose

Defines the Tauri desktop credential-isolation contract for outbound LLM traffic. The webview must never receive provider secret bytes; Rust alone stores and reads the credential, injects it immediately before dispatch, and exposes only opaque status/set/clear commands to TypeScript. This spec also locks the Rust-side transport bridge shapes (`llm_fetch` for HTTP gateway traffic and `claude_agent_execute` for the trusted Claude lane) so desktop LLM behavior stays aligned with Offisim's runtime boundary while preserving the prompt-injection threat model.

## Requirements

### Requirement: Provider credential never crosses the Rust→JS boundary on Tauri

On Tauri desktop, the provider credential is stored in a Rust-only plaintext file at `<app_local_data_dir>/runtime_secret.txt` (Unix mode `0600`, atomic tmp-file + rename on write). The threat model here is webview prompt-injection, not local-disk exfiltration — process-level file isolation is sufficient.

The secret SHALL NOT be readable from the webview. The desktop secret storage command surface SHALL expose only `runtime_secret_status` / `runtime_secret_set` / `runtime_secret_clear`. No `_get` / `_read` / `_peek` variant may be added. The only Rust code that dereferences the file contents SHALL be trusted transport bridges (`apps/desktop/src-tauri/src/llm_transport.rs` and `apps/desktop/src-tauri/src/claude_agent_host.rs`) immediately before dispatching outbound work — after injection the credential SHALL be dropped (no storage on per-connection state, no logging).

#### Scenario: Grep for forbidden get-command
- **WHEN** grepping `apps/desktop/src-tauri/src/` for `runtime_secret_get` / `runtime_secret_read` / `runtime_secret_peek`
- **THEN** zero matches exist

#### Scenario: Secret never in IPC response
- **WHEN** capturing Tauri IPC frames (webview DevTools → Tauri IPC, or Rust-side `log::trace!` on serialized payloads) during a team chat turn
- **THEN** no IPC message body contains the substring of the stored secret
- **AND** TS-side `config.apiKey` passed to `createGateway` on Tauri SHALL be the sentinel string `'ignored'` (or equivalent non-credential placeholder), never a real key

#### Scenario: Secret never in log output
- **WHEN** `log::debug!` / `log::info!` / `log::warn!` / `log::error!` calls in `llm_transport.rs` execute during request lifetime
- **THEN** no log format string interpolates the read secret value
- **AND** authScheme (`bearer` / `x-api-key` / `none`) MAY be logged; credential bytes MAY NOT

### Requirement: Tauri LLM execution SHALL stay behind Rust-owned credential-isolated bridges

All Tauri-mode outbound LLM work SHALL route through a Rust-owned bridge selected by the active execution lane:

- `gateway` lane: any request made by `AnthropicAdapter` / `OpenAiAdapter` (both the `openai` and `openai-compat` branches) SHALL route through the Rust `llm_fetch` Tauri command via a custom `fetch` injected into SDK client options at `createTauriRuntime` time.
- `claude-agent-sdk` lane: any request made by the trusted Claude execution adapter SHALL route through the Rust `claude_agent_execute` / `claude_agent_abort` commands, which spawn the local trusted host sidecar and inject the provider secret through process environment variables.

Direct `globalThis.fetch(<provider-endpoint>)` / `new XMLHttpRequest()` / any other transport from webview to provider endpoints SHALL NOT occur in the Tauri code path.

#### Scenario: Single transport hook in Tauri factory
- **WHEN** auditing `apps/web/src/lib/tauri-runtime.ts`'s `createGateway({...})` call
- **THEN** `fetch: createTauriLlmFetch(...)` is passed in every branch
- **AND** `apiKey` is a non-credential placeholder

#### Scenario: Claude lane routes through trusted host command
- **WHEN** a Tauri runtime selects `executionLane = "claude-agent-sdk"`
- **THEN** `apps/web/src/lib/tauri-runtime.ts` binds a `TauriClaudeAgentSdkGateway`, not a browser-direct SDK client
- **AND** each request invokes `claude_agent_execute`
- **AND** the provider secret is injected only inside `claude_agent_host.rs`, not in webview JavaScript

#### Scenario: Third-party compat streaming
- **WHEN** a MiniMax / OpenRouter / Kimi / Gemini-compat / Zai / other third-party compat config is active
- **THEN** SDK's streaming client calls the custom fetch
- **AND** the custom fetch invokes `llm_fetch`, which reads the secret-file credential per-request and injects the declared header
- **AND** streamed SSE chunks reach the SDK's parser byte-identical to the web-mode direct-fetch path (`tool_calls`, `reasoning_delta`, `content`, `usage` all round-trip)

#### Scenario: Non-streaming requests go through same transport
- **WHEN** a non-streaming `AnthropicAdapter.chat()` or `OpenAiAdapter.chat()` fires
- **THEN** the SDK still calls the custom fetch; `llm_fetch` delivers a single Headers + Chunk(full body) + Done sequence; the SDK sees a standard `Response`

### Requirement: AuthScheme declared per-gateway, credential opaque to TS

The TS side SHALL pass an `auth: { scheme: 'bearer' | 'x-api-key' | 'none', headerName?: string }` discriminator to `llm_fetch`, describing how to inject the credential. The TS side SHALL NEVER pass credential bytes themselves in the invoke payload. The Rust side resolves the credential from the secret file per-request and honors the declared scheme. The scheme is decided once per gateway construction (in `createTauriLlmFetch(scheme)`) and reused for every request the adapter sends; it does not change per-request within a single gateway's lifetime.

#### Scenario: Bearer scheme for OpenAI-compat
- **WHEN** `createTauriLlmFetch('bearer')` handles a request
- **THEN** the invoke payload's `auth` field is `{ scheme: 'bearer' }` (no `key` / `secret` / `token` subfield)
- **AND** Rust `llm_fetch` sets `Authorization: Bearer <secret-file-credential>` before dispatching

#### Scenario: x-api-key scheme for Anthropic native
- **WHEN** `createTauriLlmFetch('x-api-key')` handles a request whose URL targets `api.anthropic.com`
- **THEN** Rust sets `x-api-key: <secret-file-credential>` before dispatching

#### Scenario: None scheme skips injection
- **WHEN** `scheme === 'none'` (future OAuth / IAM / Bedrock sigv4 slot)
- **THEN** Rust sends the request with only TS-provided headers; no secret-file read occurs

#### Scenario: Gateway reinit re-reads the secret file
- **WHEN** Settings saves a new provider (`setRuntimeSecret` overwrites the secret file) and runtime reinits
- **THEN** the new gateway's `createTauriLlmFetch(scheme)` handler uses the new file value on its first request
- **AND** no in-memory cache in `llm_transport.rs` holds a stale credential

### Requirement: AbortSignal propagates to the active Rust-side bridge

When the SDK's request is aborted (user cancels / orchestrator tears down / timeout fires), the active TS-side bridge SHALL trigger the matching Rust abort command:

- `gateway` lane → `invoke('llm_fetch_abort', { requestId })`
- `claude-agent-sdk` lane → `invoke('claude_agent_abort', { requestId })`

The Rust side SHALL cancel the in-flight request via a per-request `tokio_util::sync::CancellationToken`, closing the Channel with no further emissions. Abort SHALL be idempotent — aborting a completed / not-yet-started / already-aborted request SHALL return Ok without error.

#### Scenario: User cancels mid-stream
- **WHEN** a stream is in flight and the caller aborts
- **THEN** Rust receives `llm_fetch_abort`, cancels the `reqwest` body stream
- **AND** the Channel emits no further `Chunk` / `Done` events after the abort
- **AND** the TS-side `ReadableStream` reader receives `AbortError` (or equivalent fetch-shaped abort)

#### Scenario: Abort after completion is no-op
- **WHEN** a request completes (`Done` fired) and the caller then aborts the already-resolved signal
- **THEN** `llm_fetch_abort` returns Ok; no panic, no log spam

#### Scenario: Claude lane abort kills the trusted host child process
- **WHEN** a `claude-agent-sdk` request is in flight and the caller aborts
- **THEN** Rust receives `claude_agent_abort`, cancels the request token, and terminates the trusted host child process
- **AND** the Channel emits no further `result` event after the abort
