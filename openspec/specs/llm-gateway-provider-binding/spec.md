# llm-gateway-provider-binding Specification

## Purpose
TBD - created by archiving change fix-boss-scope-openai-hardcode-leak. Update Purpose after archive.
## Requirements
### Requirement: ProviderConfig load rejects unusable half-records

`normalizeProviderConfig(parsed)` in `packages/ui-office/src/lib/provider-config.ts` SHALL return `null` when the parsed record carries neither an `apiKey` string nor a `baseURL` string. Legacy short-format records (e.g. `{"provider":"openai","model":"gpt-4o-mini"}` written by an earlier ProviderConfig schema) and manually-seeded half records from DevTools SHALL fall through to `null`, letting `loadProviderConfig()` cascade to env fallback and ultimately to the `*RuntimeReposOnly` empty-state branch instead of silently synthesizing an OpenAI gateway against `api.openai.com` with an empty credential.

#### Scenario: Stale {provider:'openai',model:'gpt-4o-mini'} record rejected

- **WHEN** localStorage holds a legacy record `{"provider":"openai","model":"gpt-4o-mini"}` with no `apiKey` and no `baseURL`
- **THEN** `loadProviderConfig()` returns `null`, not the half-record
- **AND** `buildRuntimeBundle(null, ...)` routes to `createTauriRuntimeReposOnly` / `createBrowserRuntimeReposOnly` with no LLM gateway
- **AND** no outbound HTTP request to `api.openai.com` occurs

#### Scenario: Valid third-party config with baseURL still loads

- **WHEN** localStorage holds `{"provider":"anthropic","vendor":"minimax","baseURL":"https://api.minimax.io/anthropic","model":"MiniMax-M2.7-highspeed",...}` (Tauri-persisted form, `apiKey` stripped by `toPersistedConfig`)
- **THEN** `normalizeProviderConfig` accepts it because `baseURL` is present
- **AND** `loadProviderConfig()` returns the normalized config for the runtime to consume

#### Scenario: Stale retired ACP record is rejected

- **WHEN** localStorage still carries a retired record `{"provider":"subscription","model":"default",...}` with neither `apiKey` nor `baseURL`
- **THEN** `normalizeProviderConfig()` returns `null`
- **AND** `loadProviderConfig()` falls back to env-backed config or `null`

### Requirement: A runtime has exactly one active model execution binding bound to its ProviderConfig

Each `RuntimeContext` SHALL hold a single active model execution binding constructed once during runtime init from the active `ProviderConfig`, including its selected execution lane. The active binding MAY be:

- a `gateway` lane backed by `createGateway(...)`, or
- an agent SDK lane backed by a single Offisim-owned execution adapter (`claude-agent-sdk` or `openai-agents-sdk`)

All LLM-calling nodes and services — `boss-node`, `manager-node`, `hr-node`, `pm-planner-node`, `employee-node` (direct + team chat paths), `RecordedSystemLlmCaller`, and middleware — SHALL reach the active binding through one Offisim-owned execution abstraction. Per-scope execution-binding rebuilding is forbidden.

#### Scenario: Gateway lane creates one gateway per runtime init

- **WHEN** a runtime selects `executionLane = "gateway"`
- **THEN** exactly one `createGateway(...)` invocation per runtime-bundle-init exists
- **AND** no node / service / middleware file directly instantiates provider SDK clients outside the active Offisim execution binding

#### Scenario: Agent SDK lane creates one execution adapter per runtime init

- **WHEN** a runtime selects `executionLane = "claude-agent-sdk"` or `executionLane = "openai-agents-sdk"`
- **THEN** runtime init creates exactly one active execution adapter for that lane
- **AND** no node / service / middleware file instantiates a second vendor runtime for the same thread

#### Scenario: Boss, manager, employee all hit the same active binding

- **WHEN** a chat turn triggers `boss-node` → `manager-node` → `employee-node`
- **THEN** all three nodes' model calls go through the same active execution binding instance within that runtime
- **AND** switching provider or lane requires a full runtime reinit before subsequent turns use the new binding

### Requirement: Adapter constructors must receive explicit baseURL when ProviderConfig specifies one

When `createGateway({ provider, baseURL, ... })` receives a non-empty `baseURL`, the returned adapter SHALL send requests to exactly that `baseURL`; it SHALL NOT fall back to the adapter SDK's hardcoded default (e.g. `new OpenAI({ apiKey })` without `baseURL` defaults to `https://api.openai.com/v1`, which is forbidden when config specified a different host). The `createGateway` `'openai'` branch (SDK default) is only acceptable when the ProviderConfig explicitly selected `provider: 'openai'` AND provided a live OpenAI `apiKey`; in every other scenario the adapter MUST be constructed with an explicit `baseURL` matching `config.baseURL`.

#### Scenario: MiniMax ProviderConfig never produces a request to api.openai.com

- **WHEN** `ProviderConfig = { provider: 'anthropic', baseURL: 'https://api.minimax.io/anthropic', model: 'MiniMax-M2.7-highspeed', apiKey: '<minimax-key>' }`
- **THEN** no HTTP request from any chat scope (direct / team / boss / manager / employee / system service) SHALL hit `api.openai.com`
- **AND** every outbound LLM request URL SHALL start with `https://api.minimax.io/anthropic`

#### Scenario: Unset baseURL on non-OpenAI provider rejects

- **WHEN** `createGateway({ provider: 'openai-compat', baseURL: undefined, ... })` is attempted
- **THEN** `createGateway` SHALL throw `'openai-compat' provider requires a baseURL` (already enforced at `gateway-factory.ts:53`)
- **AND** this contract SHALL extend: `provider: 'openai'` with a ProviderConfig-carried `baseURL` that is non-empty SHALL forward it to `OpenAiAdapter` rather than ignore it

### Requirement: ProviderConfig change is propagated by runtime reinit, not by per-scope override

Changing the ProviderConfig (via Settings UI save / env reload / live verify fill-in) SHALL trigger a full runtime reinit (`reinit()` bumping `version` in `useRuntimeInit`), which disposes the old `ctx.llmGateway` and creates a new one. No node or service SHALL hold a cached/captured alternate gateway that survives ProviderConfig change. Dead code paths (currently `modelRegistry` has no initializer in apps/web or ui-office, so `ctx.modelRegistry` is always undefined) SHALL be either fully wired or removed — the ambiguity of a "half-registered model registry" is forbidden.

#### Scenario: Settings UI save rebuilds gateway

- **WHEN** a user changes ProviderConfig in Settings and clicks Save
- **THEN** `saveProviderConfig(config)` persists to localStorage and triggers `runtime.reinit()`
- **AND** after reinit, `ctx.llmGateway` is a new instance matching the new config; the previous instance is disposed
- **AND** subsequent chat turns (any scope) route to the new baseURL

#### Scenario: modelRegistry is either fully wired or absent

- **WHEN** auditing `ModelRegistry` usage across apps/web + ui-office
- **THEN** EITHER a caller initializes + loads it with a real model list (and wires `ctx.modelRegistry` in runtime factory), OR the field is dropped from `RuntimeContext` and the `ctx.modelRegistry?.getGateway(...)` short-circuit is removed
- **AND** a half-configured state where the type allows it but no caller uses it SHALL NOT persist (current state is an invitation for future bugs)

### Requirement: Adapter constructors accept a `fetch` override for credential-isolated transports

`AnthropicAdapterOptions` and `OpenAiAdapterOptions` SHALL each expose an optional `fetch?: typeof fetch` field. `GatewayConfig` SHALL expose the same field and transparently forward it to whichever adapter branch (`'anthropic'` / `'openai'` / `'openai-compat'`) `createGateway` selects. When `options.fetch` is provided, the adapter's SDK client SHALL be constructed with that function as its transport (`new Anthropic({ fetch })` / `new OpenAI({ fetch })`); SDK-internal default fetch SHALL NOT be used. When `options.fetch` is absent, existing behavior is preserved (Anthropic third-party compat still uses `createCorsCleanFetch`; SDK defaults apply elsewhere).

This contract is the hook by which Tauri desktop routes all outbound LLM HTTP to a Rust-side credential-isolated transport without forcing the SDK to be replaced. It is the sole supported mechanism — adapters SHALL NOT reach for `globalThis.fetch`, assemble their own `XMLHttpRequest`, or bypass the SDK's own fetch plumbing.

#### Scenario: Adapter honors injected fetch

- **WHEN** `createGateway({ provider: 'anthropic', baseURL: 'https://api.minimax.io/anthropic', apiKey: 'ignored', fetch: customFetch })` is called
- **THEN** `AnthropicAdapter` is constructed with SDK `{ fetch: customFetch }`
- **AND** every outbound request the SDK makes (streaming or not) invokes `customFetch`
- **AND** the adapter's legacy `createCorsCleanFetch` branch is not used (the injected fetch takes precedence)

#### Scenario: No injected fetch preserves legacy behavior

- **WHEN** `createGateway({ provider: 'anthropic', baseURL: 'https://api.minimax.io/anthropic', apiKey: '<key>' })` is called in web mode (no `fetch` option)
- **THEN** `AnthropicAdapter` constructs SDK with `createCorsCleanFetch()` (third-party CORS path) plus Bearer compat headers
- **AND** web-mode behavior is byte-identical to pre-change

#### Scenario: GatewayConfig forwards fetch to both adapter families

- **WHEN** `createGateway({ provider: 'openai-compat', baseURL: '...', apiKey: 'ignored', fetch: customFetch })` is called
- **THEN** `OpenAiAdapter` is constructed with `new OpenAI({ fetch: customFetch, baseURL, apiKey })`
- **AND** SDK streaming / non-streaming calls route through `customFetch`
