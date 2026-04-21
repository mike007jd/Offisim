## ADDED Requirements

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
- **AND** SDK streaming / non-streaming calls route through customFetch
