## MODIFIED Requirements

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

Each `RuntimeContext` SHALL hold a single active model execution binding constructed once during runtime init from the selected product config after resolution into a concrete transport profile and execution lane.

The active binding MAY be:

- a `gateway` lane backed by `createGateway(...)`, or
- an agent SDK lane backed by a single Offisim-owned execution adapter (`claude-agent-sdk` or `openai-agents-sdk`)

All LLM-calling nodes and services SHALL reach the active binding through one Offisim-owned execution abstraction. Product identity is resolved before adapter construction; nodes and services SHALL NOT branch on product IDs directly.

#### Scenario: Product selection resolves before gateway creation

- **WHEN** a runtime loads a saved `qwen-model-studio` product config
- **THEN** runtime init first resolves it to a concrete transport profile and execution lane
- **AND** only then creates the single active gateway/execution adapter for that runtime

#### Scenario: Codex product does not create multiple bindings

- **WHEN** a trusted runtime selects `productId = "codex"`
- **THEN** runtime init resolves either one usable active binding or one structured unavailable state
- **AND** it does not create parallel fallback bindings for both subscription and API-key paths
