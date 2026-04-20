# llm-gateway-provider-binding Specification

## Purpose
TBD - created by archiving change fix-boss-scope-openai-hardcode-leak. Update Purpose after archive.
## Requirements
### Requirement: ProviderConfig load rejects unusable half-records

`normalizeProviderConfig(parsed)` in `packages/ui-office/src/lib/provider-config.ts` SHALL return `null` when the parsed record names a non-`subscription` provider but carries neither an `apiKey` string nor a `baseURL` string. Legacy short-format records (e.g. `{"provider":"openai","model":"gpt-4o-mini"}` written by an earlier ProviderConfig schema) and manually-seeded half records from DevTools SHALL fall through to `null`, letting `loadProviderConfig()` cascade to env fallback and ultimately to the `*RuntimeReposOnly` empty-state branch instead of silently synthesizing an OpenAI gateway against `api.openai.com` with an empty credential.

`subscription` (ACP) is the only exempt provider — it spawns `claude` via `node:child_process` and carries no HTTP credential.

#### Scenario: Stale {provider:'openai',model:'gpt-4o-mini'} record rejected

- **WHEN** localStorage holds a legacy record `{"provider":"openai","model":"gpt-4o-mini"}` with no `apiKey` and no `baseURL`
- **THEN** `loadProviderConfig()` returns `null`, not the half-record
- **AND** `buildRuntimeBundle(null, ...)` routes to `createTauriRuntimeReposOnly` / `createBrowserRuntimeReposOnly` with no LLM gateway
- **AND** no outbound HTTP request to `api.openai.com` occurs

#### Scenario: Valid third-party config with baseURL still loads

- **WHEN** localStorage holds `{"provider":"anthropic","vendor":"minimax","baseURL":"https://api.minimax.io/anthropic","model":"MiniMax-M2.7-highspeed",...}` (Tauri-persisted form, `apiKey` stripped by `toPersistedConfig`)
- **THEN** `normalizeProviderConfig` accepts it because `baseURL` is present
- **AND** `loadProviderConfig()` returns the normalized config for the runtime to consume

#### Scenario: Subscription provider exempt from apiKey/baseURL check

- **WHEN** a record carries `{"provider":"subscription","model":"default",...}` with neither `apiKey` nor `baseURL`
- **THEN** `normalizeProviderConfig` returns the record (not null) because `subscription` is exempt

### Requirement: A runtime has exactly one LlmGateway bound to its ProviderConfig

Each `RuntimeContext` SHALL hold a single `LlmGateway` instance as `ctx.llmGateway`, constructed once during runtime init from the active `ProviderConfig` via `createGateway(...)`. All LLM-calling nodes and services — `boss-node`, `manager-node`, `hr-node`, `pm-planner-node`, `employee-node` (direct + team chat paths), `RecordedSystemLlmCaller`, middleware (`summarization`, `node-context`, `user-preference`, etc.) — SHALL reach the gateway through `ctx.llmGateway` or helpers that fall back to it (`recordedLlmStream` / `recordedLlmCall`'s `ctx.modelRegistry?.getGateway(...) ?? ctx.llmGateway` pattern). Per-scope gateway rebuilding is forbidden.

#### Scenario: Only one createGateway call per runtime init

- **WHEN** auditing `createTauriRuntime` / `createBrowserRuntime` call sites plus all node + service files in `packages/core/src/agents/` and `packages/core/src/services/`
- **THEN** exactly one `createGateway(...)` invocation per runtime-bundle-init SHALL exist (in the runtime factory)
- **AND** no node / service / middleware file SHALL import `createGateway` or directly instantiate `new OpenAiAdapter(...)` / `new AnthropicAdapter(...)` / `new SubscriptionAdapter(...)`

#### Scenario: Boss, manager, employee all hit the same gateway

- **WHEN** a chat turn triggers `boss-node` → `manager-node` → `employee-node` sequence (team chat)
- **THEN** all three nodes' LLM calls SHALL go through the same `ctx.llmGateway` instance (reference-equal across nodes within one runtime)
- **AND** the gateway's `baseURL` SHALL match `config.baseURL` byte-for-byte when the ProviderConfig specifies one (e.g. `https://api.minimax.io/anthropic` for a MiniMax config)

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

