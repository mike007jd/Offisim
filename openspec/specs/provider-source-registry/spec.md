# provider-source-registry Specification

## Purpose
TBD - created by archiving change add-provider-source-registry. Update Purpose after archive.
## Requirements
### Requirement: Offisim SHALL maintain an explicit provider source registry

Offisim SHALL maintain a source registry for provider/model metadata. Each source entry SHALL declare a stable `sourceId`, a `sourceKind`, a `trustTier`, a `refreshMode`, and the set of metadata fields that source is allowed to own or propose.

#### Scenario: LiteLLM is registered as a community source

- **WHEN** Offisim seeds the initial provider source registry
- **THEN** LiteLLM SHALL appear as a distinct source entry with `sourceKind=community-aggregator`
- **AND** the entry SHALL declare a lower `trustTier` than official provider sources
- **AND** the entry SHALL declare which fields it may contribute

### Requirement: Generated catalog fields SHALL carry provenance

The normalized provider/model catalog generated from the source registry SHALL record provenance for each merged field, including at minimum the winning `sourceId` and trust tier used to resolve that field.

#### Scenario: Official endpoint and LiteLLM context window coexist

- **WHEN** an official source provides a provider `baseURL` and LiteLLM provides a model `contextWindow`
- **THEN** the merged catalog SHALL retain the official source as provenance for `baseURL`
- **AND** the merged catalog SHALL retain LiteLLM as provenance for `contextWindow`
- **AND** both provenance records SHALL be inspectable in generated artifacts

### Requirement: Lower-trust sources SHALL NOT silently override protected product fields

Community or lower-trust sources SHALL NOT automatically override protected fields such as `endpoint`, `authMode`, `region`, `productName`, or other fields designated as official-only or override-only by the registry policy.

#### Scenario: LiteLLM disagrees with an official endpoint

- **WHEN** LiteLLM reports a provider endpoint that conflicts with an existing official provider source
- **THEN** the merged catalog SHALL keep the higher-trust official endpoint
- **AND** the conflict SHALL be surfaced in refresh output as a reviewable diff or conflict record
- **AND** no user-facing provider catalog update SHALL be produced solely from the lower-trust value

### Requirement: Refresh output SHALL be reviewable before product exposure changes

A provider source registry refresh SHALL produce diffable artifacts for raw source data, normalized merged output, and newly detected providers/models or conflicts. User-facing provider catalogs or presets SHALL only change after the merged output has been reviewed and committed into the repo-owned catalog.

#### Scenario: New model appears in LiteLLM

- **WHEN** a refresh detects a new model from a community source such as LiteLLM
- **THEN** Offisim SHALL emit a reviewable diff or snapshot entry for that new model
- **AND** the new model SHALL NOT automatically appear in user-facing provider selection until the curated catalog is updated

### Requirement: Offisim SHALL support curated manual overrides with explicit provenance

Offisim SHALL support a manual curated override layer that can narrow or replace upstream metadata for specific providers, products, models, or fields. Manual overrides SHALL be explicit and SHALL appear in provenance as a separate winning source.

#### Scenario: Offisim temporarily suppresses a provider field

- **WHEN** Offisim applies a curated override to replace an upstream field for a specific provider
- **THEN** the merged catalog SHALL use the curated override as the winning value
- **AND** provenance SHALL identify the override source explicitly
- **AND** the overridden upstream value SHALL remain visible in raw or intermediate refresh artifacts

