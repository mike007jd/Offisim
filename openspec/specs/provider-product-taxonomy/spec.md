# provider-product-taxonomy Specification

## Purpose
Defines the product-centric provider catalog that sits above raw provider variants, access modes, transport profiles, and execution lanes in Settings and runtime.

## Requirements

### Requirement: Provider selection SHALL start from a user-facing product catalog

Offisim SHALL define a first-class provider product catalog and use it as the primary Settings/runtime selection surface. Product entries SHALL use user-understandable product identities rather than raw protocol labels.

For API-key and compat-backed products, the product catalog SHALL consume the reviewed curated provider catalog produced by `provider-source-registry` rather than maintaining an independent duplicate provider-facts table inside Settings/runtime code. The product layer MAY add repo-owned host-gated local-auth products that are not represented as public API provider variants.

The initial curated catalog SHALL include at least:

- `codex`
- `openai-api`
- `claude`
- `anthropic-api`
- `openrouter`
- `kimi`
- `qwen-model-studio`
- `minimax`
- `zai-glm`
- `custom-compatible`

Settings UI SHALL present these product identities as the primary choice before any protocol/base URL/compatibility details.

#### Scenario: User sees Codex and OpenAI as separate choices

- **WHEN** a user opens the provider settings
- **THEN** the primary selection list contains distinct choices for `Codex` and `OpenAI API`
- **AND** the user is not asked to infer this distinction from raw `provider` or `compatibility` fields

#### Scenario: Qwen is shown as a product, not as openai-compat

- **WHEN** a user wants to configure Alibaba Model Studio / Qwen
- **THEN** the product list contains `Qwen / Model Studio`
- **AND** the user is not required to start from `openai-compat` or `anthropic-compatible` terminology

#### Scenario: API product facts come from the curated provider catalog

- **WHEN** Offisim exposes an API-backed product such as `OpenRouter` or `Anthropic API`
- **THEN** its default endpoint, model metadata, and other provider facts are derived from the reviewed curated provider catalog
- **AND** Settings/runtime code does not maintain a second conflicting hard-coded provider facts table for that same product

### Requirement: Product identity SHALL be distinct from provider variant, access mode, transport profile, and execution lane

Each product catalog entry SHALL be able to declare:

- one or more backing provider variants
- one or more `accessMode` values
- a default transport profile
- allowed advanced transport overrides
- supported execution lanes
- host-availability constraints

Offisim SHALL treat these as separate layers. A product selection alone SHALL NOT imply one fixed transport or one fixed lane.

#### Scenario: Same product can expose multiple access modes

- **WHEN** a product supports more than one access path
- **THEN** its catalog metadata can advertise multiple `accessMode` values without creating duplicate product identities
- **AND** the UI presents the access-mode choice underneath the product choice

#### Scenario: Product metadata does not leak raw transport labels as the primary name

- **WHEN** a product ultimately resolves to an OpenAI-compatible or Anthropic-compatible endpoint
- **THEN** the product keeps its own display identity
- **AND** the compat/protocol detail is only shown as derived or advanced information

#### Scenario: Product resolves to one curated provider variant at runtime

- **WHEN** a user selects `Kimi`
- **THEN** Offisim resolves that product into one concrete curated provider variant appropriate for the chosen region, access mode, and surface
- **AND** runtime binding is created from the resolved variant rather than from the product label alone

### Requirement: Subscription and local-auth products SHALL be first-class products

Products backed by trusted-host local auth or subscription auth, including `codex` and `claude`, SHALL be modeled explicitly rather than masquerading as API-key products.

Such products SHALL carry host-availability metadata. Unsupported hosts SHALL fail closed with a structured unavailable state instead of silently falling back to an API-key provider path.

#### Scenario: Codex product is unavailable in desktop-trusted mode

- **WHEN** the active runtime host is `desktop-trusted` and the selected product is `codex`
- **THEN** Offisim reports the product as unavailable on that host
- **AND** the user is guided to switch product or move to a trusted runtime

#### Scenario: Claude product is not stored as anthropic api-key intent

- **WHEN** a user selects `Claude`
- **THEN** the saved config records `productId = "claude"` with its chosen access mode
- **AND** the config is not rewritten into `provider = "anthropic"` as its primary identity

### Requirement: Saved provider config SHALL be product-centric

Persisted provider settings SHALL store a product-centric config shape. The primary persisted identity SHALL be `productId`, not raw provider protocol.

The saved config SHALL be able to carry:

- `productId`
- `accessMode`
- `model`
- `executionLane`
- optional advanced transport overrides
- optional runtime policy
- optional migration metadata for legacy records

#### Scenario: Saving Codex writes a product-centric record

- **WHEN** a user saves a `Codex` configuration
- **THEN** the persisted config contains `productId = "codex"`
- **AND** any protocol/base URL details are stored only as derived or advanced override fields

#### Scenario: Saving Qwen preserves product identity

- **WHEN** a user saves a `Qwen / Model Studio` configuration
- **THEN** the persisted config contains `productId = "qwen-model-studio"`
- **AND** runtime resolution later derives the concrete provider variant and transport profile from that product

### Requirement: Legacy provider records SHALL migrate into product-centric config safely

Offisim SHALL provide a migration path from existing provider/preset records into the new product-centric schema.

Migration SHALL follow these rules:

- unambiguous legacy records map directly to a product
- ambiguous but still viable compat records map to `custom-compatible`
- retired paths map to a target product with `requiresReconfigure`
- unusable half-records still resolve to `null`

#### Scenario: OpenAI default preset maps to openai-api

- **WHEN** a legacy saved record clearly represents the current OpenAI API path
- **THEN** load normalizes it into `productId = "openai-api"`
- **AND** runtime init continues with the equivalent model and lane settings

#### Scenario: Retired subscription record becomes a reconfigure-needed Claude product

- **WHEN** a legacy saved record points at a retired subscription/ACP path
- **THEN** load normalizes it into a `claude` product record marked `requiresReconfigure`
- **AND** Offisim does not silently treat it as a working Anthropic API-key config

#### Scenario: Stale half-record remains rejected

- **WHEN** local storage holds a stale record with insufficient information to resolve either a valid product config or a safe legacy mapping
- **THEN** normalization returns `null`
- **AND** runtime init falls back to env/default empty-state behavior rather than guessing
