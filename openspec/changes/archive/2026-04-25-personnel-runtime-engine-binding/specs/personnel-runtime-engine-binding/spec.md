## ADDED Requirements

### Requirement: Personnel Runtime tab renders the binding control

When the user activates the Runtime tab inside Personnel for an internal employee (`is_external === 0`), the tab content SHALL render a binding control that displays the resolved binding (effective mode + source) and allows the user to choose between four options: `Inherit company default`, `Provider gateway`, `Claude engine`, `Codex engine`. The tab SHALL NOT render the legacy `PlaceholderTab` shell.

#### Scenario: Internal employee Runtime tab shows the four-way picker
- **WHEN** an internal employee with no `runtimeBinding` in `config_json` is selected and the Runtime tab activates
- **THEN** the picker SHALL render with `Inherit company default` selected
- **AND** the resolved-binding line SHALL display `Provider gateway (from company default)`
- **AND** the four options SHALL be visible

#### Scenario: Picker reflects employee override
- **WHEN** the same employee's `config_json.runtimeBinding` is `{ mode: 'engine', engineId: 'claude-engine' }`
- **THEN** the picker SHALL render with `Claude engine` selected
- **AND** the resolved-binding line SHALL display `Claude engine (override)`

#### Scenario: Picker reflects provider override distinct from inherit
- **WHEN** the employee's `config_json.runtimeBinding` is `{ mode: 'provider' }`
- **AND** the company default is `{ mode: 'engine', engineId: 'codex-engine' }`
- **THEN** the picker SHALL render with `Provider gateway` selected
- **AND** the resolved-binding line SHALL display `Provider gateway (override)`

### Requirement: Saving the picker writes through the existing form path

The Runtime tab SHALL persist changes through the same `useEmployeeEditor` form data and `buildConfigJson` path used by the Profile tab. Choosing `Inherit company default` SHALL set `formData.runtimeBinding = null`, which `buildConfigJson` SHALL serialize by omitting the `runtimeBinding` field entirely. Choosing any other option SHALL set `formData.runtimeBinding` to a concrete `EmployeeRuntimeBinding` and trigger the standard sticky save bar.

#### Scenario: Choosing Provider gateway sets concrete binding
- **WHEN** the user picks `Provider gateway` from `Inherit`
- **THEN** `formData.runtimeBinding` SHALL equal `{ mode: 'provider' }`
- **AND** the dirty save bar SHALL appear

#### Scenario: Choosing Inherit clears the binding to null
- **WHEN** the user picks `Inherit company default` from any non-inherit option
- **THEN** `formData.runtimeBinding` SHALL equal `null`
- **AND** the dirty save bar SHALL appear

#### Scenario: Saved record omits runtimeBinding when inherit
- **WHEN** the user saves the form with `formData.runtimeBinding = null`
- **THEN** `config_json` written to the employee row SHALL NOT contain a `runtimeBinding` key

### Requirement: Engine choices reflect runtime adapter availability

The picker SHALL render `Claude engine` and `Codex engine` options as enabled if and only if the corresponding `EngineId` is present in `availableEngineAdapters` from `OffisimRuntimeContext`. When an engine option is disabled, the option SHALL display the helper copy "Available on trusted desktop runtime" via tooltip or inline hint. The two non-engine options (`Inherit`, `Provider gateway`) SHALL always be enabled.

#### Scenario: Browser runtime disables both engine options
- **WHEN** `availableEngineAdapters` is empty
- **THEN** both `Claude engine` and `Codex engine` SHALL render with the disabled state and the helper copy
- **AND** `Inherit` and `Provider gateway` SHALL remain enabled

#### Scenario: Trusted desktop runtime enables both engine options
- **WHEN** `availableEngineAdapters` contains both `claude-engine` and `codex-engine`
- **THEN** both engine options SHALL render enabled and selectable

#### Scenario: Partial adapter availability reflects per-engine truth
- **WHEN** `availableEngineAdapters` contains only `claude-engine`
- **THEN** `Claude engine` SHALL be enabled and `Codex engine` SHALL be disabled with the helper copy

### Requirement: Engine mode shows a preview disclosure

When the resolved binding is engine mode (either via direct override or inheritance), the binding card SHALL display a preview disclosure line stating that the engine runtime is preview with limited tool telemetry. The disclosure SHALL be present regardless of which engine is selected.

#### Scenario: Claude engine selection shows preview disclosure
- **WHEN** the picker is on `Claude engine`
- **THEN** the binding card SHALL render a "Preview · limited tool telemetry" line under the resolved-binding text

#### Scenario: Inherit resolving to engine shows preview disclosure
- **WHEN** the picker is on `Inherit company default` and the company default is `{ mode: 'engine', engineId: 'codex-engine' }`
- **THEN** the binding card SHALL render the preview disclosure line

#### Scenario: Provider mode does not show preview disclosure
- **WHEN** the resolved binding is `{ mode: 'provider' }` regardless of source
- **THEN** the binding card SHALL NOT render the preview disclosure line

### Requirement: External employee Runtime tab is a read-only lock card

When the selected employee has `is_external === 1`, the Runtime tab SHALL render a single read-only lock card stating that engine binding does not apply for A2A external peers. The card SHALL NOT render the picker, the save bar, or the preview disclosure.

#### Scenario: External employee renders lock card
- **WHEN** the user selects an external employee and activates the Runtime tab
- **THEN** the tab SHALL render a card with copy stating "External A2A peer — engine binding does not apply. Routing is handled by the brand's A2A endpoint."
- **AND** no picker control SHALL be rendered
- **AND** no save bar SHALL appear

#### Scenario: External lock card is independent of company default
- **WHEN** the company default is `{ mode: 'engine', engineId: 'claude-engine' }`
- **AND** an external employee is selected
- **THEN** the Runtime tab SHALL still render the lock card and SHALL NOT show the company default
