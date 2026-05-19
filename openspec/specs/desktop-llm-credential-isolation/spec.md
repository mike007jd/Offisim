# desktop-llm-credential-isolation

## Purpose

Defines the Tauri desktop credential-isolation contract for outbound LLM traffic. The webview must never receive provider secret bytes; Rust alone stores and reads the credential, injects it immediately before dispatch, and exposes only opaque status/set/clear commands to TypeScript. This spec also locks the Rust-side transport bridge shapes (`llm_fetch` for HTTP gateway traffic, `codex_agent_execute` for trusted Codex sidecars, and `claude_agent_execute` for trusted Claude sidecars) so desktop LLM behavior stays aligned with Offisim's runtime boundary while preserving the prompt-injection threat model.
## Requirements
### Requirement: Trusted hosts SHALL resolve credential strategy from product access mode

On Tauri desktop, the trusted host SHALL resolve credential strategy from the selected product's `accessMode`.

- `api-key` products SHALL continue to use the Rust-owned secret file and per-request header injection
- `local-auth` / `subscription` products SHALL use a Rust-owned resolver that reads approved local auth sources without exposing raw credential material to the webview

The webview SHALL only receive opaque availability/status results. It SHALL NOT receive raw tokens, refresh tokens, session cookies, or provider secret bytes.

#### Scenario: OpenAI API product uses the secret file path
- **WHEN** the selected product is `openai-api` with `accessMode = "api-key"`
- **THEN** Tauri injects the credential through the existing Rust-owned secret-file bridge
- **AND** the webview still sees only placeholder credential values

#### Scenario: Codex product uses a trusted local-auth resolver
- **WHEN** the selected product is `codex` with `accessMode = "local-auth"`
- **THEN** the trusted host resolves availability and auth from approved local auth sources
- **AND** no raw auth token is returned to TypeScript

### Requirement: Unsupported local-auth products SHALL fail closed on unsupported hosts

If a selected product requires trusted-host local auth and the current host cannot supply a verified resolver, runtime init SHALL fail closed with a structured unavailable state.

Offisim SHALL NOT silently rewrite such a product into an API-key product or browser-direct route.

#### Scenario: Codex is unavailable on webview-only host
- **WHEN** the selected product is `codex` and the active host is `desktop-trusted`
- **THEN** runtime init reports `product unavailable on current host`
- **AND** no outbound request is attempted

#### Scenario: Claude local-auth resolver missing on desktop
- **WHEN** the selected product is `claude`, the host is `desktop-trusted`, and no verified Claude auth resolver is available
- **THEN** runtime init reports a structured unavailable state
- **AND** Offisim does not silently fall back to an Anthropic API-key route

### Requirement: Provider credential SHALL never cross the Rust→JS boundary on Tauri

On Tauri desktop, the provider credential SHALL be stored in a Rust-only plaintext file at `<app_local_data_dir>/runtime_secret.txt` (Unix mode `0600`, atomic tmp-file + rename on write). The threat model here is webview prompt-injection, not local-disk exfiltration — process-level file isolation is sufficient.

The secret SHALL NOT be readable from the webview. The desktop secret storage command surface SHALL expose only `runtime_secret_status` / `runtime_secret_set` / `runtime_secret_clear`. No `_get` / `_read` / `_peek` variant may be added. The only Rust code that dereferences the file contents SHALL be trusted transport bridges (`apps/desktop/src-tauri/src/llm_transport.rs`, `apps/desktop/src-tauri/src/codex_agent_host.rs`, and `apps/desktop/src-tauri/src/claude_agent_host.rs`) immediately before dispatching outbound work — after injection the credential SHALL be dropped (no storage on per-connection state, no logging).

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
- `codex-agent-sdk` lane and `codex-engine` mode: any request made by the trusted Codex adapter SHALL route through the Rust `codex_agent_execute` / `codex_agent_abort` commands, which spawn the local trusted host sidecar and resolve approved local auth without returning credential material to the webview.
- `claude-agent-sdk` lane and `claude-engine` mode: any request made by the trusted Claude adapter SHALL route through the Rust `claude_agent_execute` / `claude_agent_abort` commands, which spawn the local trusted host sidecar and inject the provider secret through process environment variables.

Direct `globalThis.fetch(<provider-endpoint>)` / `new XMLHttpRequest()` / any other transport from webview to provider endpoints SHALL NOT occur in the Tauri code path.

#### Scenario: Single transport hook in Tauri factory
- **WHEN** auditing `apps/desktop/renderer/src/lib/tauri-runtime.ts`'s `createGateway({...})` call
- **THEN** `fetch: createTauriLlmFetch(...)` is passed in every branch
- **AND** `apiKey` is a non-credential placeholder

#### Scenario: Claude lane routes through trusted host command
- **WHEN** a Tauri runtime selects `executionLane = "claude-agent-sdk"`
- **THEN** `apps/desktop/renderer/src/lib/tauri-runtime.ts` binds a `TauriClaudeAgentSdkGateway`, not a browser-direct SDK client
- **AND** each request invokes `claude_agent_execute`
- **AND** the provider secret is injected only inside `claude_agent_host.rs`, not in webview JavaScript

#### Scenario: Engine mode routes through trusted host command
- **WHEN** a Tauri employee runtime binding selects `codex-engine` or `claude-engine`
- **THEN** TypeScript binds an `EngineAdapter`, not an `LlmGateway`
- **AND** each run invokes the matching trusted host command
- **AND** raw credential material remains behind the Rust trusted-host boundary

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
- `codex-agent-sdk` lane / `codex-engine` mode → `invoke('codex_agent_abort', { requestId })`
- `claude-agent-sdk` lane / `claude-engine` mode → `invoke('claude_agent_abort', { requestId })`

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

### Requirement: Tauri release `.app` CSP SHALL allow platform endpoint origins

The Tauri release `.app` Content-Security-Policy and the `apps/platform` CORS allowlist SHALL maintain a two-way coupling so the desktop webview can reach platform endpoints in both directions of the security policy. The coupling has two named invariants:

**Invariant A — CSP `connect-src` covers platform listen origins.** The Tauri release `.app` CSP `connect-src` directive SHALL include every origin the desktop webview is expected to call against `apps/platform`. Today this set is:
- `http://localhost:4100` (default platform dev API endpoint)
- `https://localhost:4100` (TLS variant if enabled)
- `tauri://localhost` (Tauri webview self-origin, for same-origin asset loads)

**Invariant B — Platform CORS allowlist covers the desktop webview origin.** `apps/platform/src/startup.ts` `DEV_DEFAULT_ORIGINS` (or the equivalent production CORS allowlist) SHALL include `tauri://localhost` so the platform server's `Access-Control-Allow-Origin` accepts cross-origin requests originating from the desktop webview.

Release-mode CSP SHALL NOT be stricter than dev-mode for the Invariant A origins. Adding a new platform listen port to dev SHALL trigger a matching addition to release CSP, and adding a new client origin to platform CORS SHALL trigger a matching review of CSP `connect-src` if the desktop webview is the new client.

If the user runs the desktop `.app` against a production platform endpoint (future), the CSP SHALL accept that origin via build-time env injection, not by relaxing the local-development allowlist.

The two invariants SHALL be enforced by an automated build-time check (`scripts/check-platform-tauri-origin-sync.mjs` or equivalent), wired into `apps/desktop` and `apps/platform` build chains so a drift on either side fails the build with a clear error, rather than silently waiting for runtime CSP/CORS rejection.

#### Scenario: Release `.app` reaches platform endpoint at localhost:4100

- **WHEN** the user launches the release `.app` while `pnpm --filter @offisim/platform dev` is running on port 4100
- **THEN** Market / Settings / external-employee install paths that fetch from `http://localhost:4100` succeed without CSP violation, matching dev `pnpm --filter @offisim/desktop dev` behavior

#### Scenario: Non-allowlisted port is blocked

- **WHEN** the release `.app` attempts to fetch from a non-allowlisted local port (e.g., `127.0.0.1:43177`)
- **THEN** the request is blocked by CSP and the failure surfaces as a typed network error in the UI (not a silent stall)

#### Scenario: Platform CORS accepts the Tauri webview origin

- **WHEN** the desktop release `.app` (origin `tauri://localhost`) issues a fetch to `http://localhost:4100/...`
- **THEN** the platform server's `Access-Control-Allow-Origin` response header SHALL include `tauri://localhost`
- **AND** the browser SHALL allow the response to reach the desktop webview JS

#### Scenario: Build-time check fails when CSP omits the platform listen origin

- **WHEN** a developer removes `http://localhost:4100` from `apps/desktop/src-tauri/tauri.conf.json` CSP `connect-src` and runs `pnpm --filter @offisim/desktop build` (or `pnpm --filter @offisim/platform build`)
- **THEN** the prebuild origin-sync check SHALL fail with a non-zero exit code
- **AND** the error message SHALL identify which invariant failed (Invariant A — CSP `connect-src` is missing platform listen origin) and which file to edit

#### Scenario: Build-time check fails when platform CORS omits the Tauri origin

- **WHEN** a developer removes `tauri://localhost` from `apps/platform/src/startup.ts` `DEV_DEFAULT_ORIGINS` and runs `pnpm --filter @offisim/platform build` (or `pnpm --filter @offisim/desktop build`)
- **THEN** the prebuild origin-sync check SHALL fail with a non-zero exit code
- **AND** the error message SHALL identify which invariant failed (Invariant B — platform CORS allowlist is missing `tauri://localhost`) and which file to edit

#### Scenario: Build-time check passes on the in-tree configuration

- **WHEN** a developer runs `pnpm --filter @offisim/desktop build` or `pnpm --filter @offisim/platform build` against the in-tree, unmodified `tauri.conf.json` and `startup.ts`
- **THEN** the prebuild origin-sync check SHALL exit 0
- **AND** SHALL print a single confirmation line listing which origins were checked under each invariant

