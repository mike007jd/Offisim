# llm-gateway-provider-binding Specification

## Purpose
Defines how one saved provider config resolves into exactly one active runtime binding and rejects unusable half-records before LLM execution starts.
## Requirements
### Requirement: ProviderConfig load rejects unusable half-records

`normalizeProviderConfig(parsed)` in `packages/ui-office/src/lib/provider-config.ts` SHALL normalize either:

- a valid product-centric provider record, or
- a legacy provider record that can be safely migrated into a product-centric record

It SHALL return `null` when the parsed data can do neither.

A valid product-centric record SHALL be allowed to omit `apiKey` and `baseURL` when its selected `accessMode` is host-resolved (for example trusted-host local auth). API-key products and compat products SHALL still require the transport information their access mode needs.

Legacy short-format records (for example `{"provider":"openai","model":"gpt-4o-mini"}` with no credential and no base URL) SHALL continue to resolve to `null`, letting `loadProviderConfig()` fall back to env/default empty-state behavior instead of synthesizing a guessed provider route.

#### Scenario: Product-centric local-auth record loads without apiKey

- **WHEN** local storage holds a product-centric record such as `{"productId":"codex","accessMode":"local-auth","model":"gpt-5.4",...}`
- **THEN** `normalizeProviderConfig()` accepts it even though no `apiKey` or `baseURL` is present
- **AND** runtime init proceeds to host-availability resolution rather than rejecting it as a half-record

#### Scenario: Legacy OpenAI half-record is still rejected

- **WHEN** local storage holds a legacy record `{"provider":"openai","model":"gpt-4o-mini"}` with no `apiKey` and no `baseURL`
- **THEN** `loadProviderConfig()` returns `null`
- **AND** no outbound HTTP request is synthesized from that stale record

#### Scenario: Legacy compat record migrates to a product

- **WHEN** local storage holds a legacy record that clearly matches a curated product such as OpenRouter, MiniMax, or Qwen / Model Studio
- **THEN** normalization returns the corresponding product-centric config
- **AND** the migrated product identity becomes the runtime's primary provider selection

### Requirement: A runtime has exactly one LlmGateway bound to its active execution lane

Each `RuntimeContext` SHALL hold a single active model execution binding constructed once during runtime init from the selected product config after resolution into a concrete provider variant, transport profile, and execution lane. The active binding MAY be:

- a `gateway` lane backed by `createGateway(...)`, or
- an agent SDK lane backed by a single Offisim-owned execution adapter (`claude-agent-sdk` or `openai-agents-sdk`)

All LLM-calling nodes and services SHALL reach the active binding through one Offisim-owned execution abstraction. Product identity is resolved before adapter construction; nodes and services SHALL NOT branch on product IDs directly.

#### Scenario: Product selection resolves before gateway creation

- **WHEN** a runtime loads a saved `qwen-model-studio` product config
- **THEN** runtime init first resolves it to a concrete provider variant, transport profile, and execution lane
- **AND** only then creates the single active gateway/execution adapter for that runtime

#### Scenario: Gateway lane creates one gateway per runtime init

- **WHEN** a runtime selects `executionLane = "gateway"`
- **THEN** exactly one `createGateway(...)` invocation per runtime-bundle-init exists
- **AND** no node / service / middleware file directly instantiates provider SDK clients outside the active Offisim execution binding

#### Scenario: Agent SDK lane creates one execution adapter per runtime init

- **WHEN** a runtime selects `executionLane = "claude-agent-sdk"` or `executionLane = "openai-agents-sdk"`
- **THEN** runtime init creates exactly one active execution adapter for that lane
- **AND** no node / service / middleware file instantiates a second vendor runtime for the same thread

#### Scenario: Codex product does not create multiple bindings

- **WHEN** a trusted runtime selects `productId = "codex"`
- **THEN** runtime init resolves either one usable active binding or one structured unavailable state
- **AND** it does not create parallel fallback bindings for both subscription and API-key paths

### Requirement: Adapter constructors must receive explicit baseURL when ProviderConfig specifies one

When `createGateway({ provider, baseURL, ... })` receives a non-empty `baseURL`, the returned adapter SHALL send requests to exactly that `baseURL`; it SHALL NOT fall back to the adapter SDK's hardcoded default (e.g. `new OpenAI({ apiKey })` without `baseURL` defaults to `https://api.openai.com/v1`, which is forbidden when config specified a different host). The `createGateway` `'openai'` branch (SDK default) is only acceptable when the ProviderConfig explicitly selected `provider: 'openai'` AND provided a live OpenAI `apiKey`; in every other scenario the adapter MUST be constructed with an explicit `baseURL` matching `config.baseURL`.

#### Scenario: MiniMax ProviderConfig never produces a request to api.openai.com

- **WHEN** `ProviderConfig = { provider: 'anthropic', baseURL: 'https://api.minimax.io/anthropic', model: 'MiniMax-M2.7', apiKey: '<minimax-key>' }`
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
