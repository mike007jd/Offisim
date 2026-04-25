## ADDED Requirements

### Requirement: Settings → Runtime tab SHALL expose employeeRuntimeDefault

`SettingsRuntimeTab` SHALL render a control that reads and writes `runtimePolicy.employeeRuntimeDefault`. The control SHALL allow the user to choose between `Provider gateway`, `Claude engine`, and `Codex engine`. The control SHALL persist the chosen value through the existing `useSettingsRuntimePolicy.setEmployeeRuntimeDefault` setter and the existing `buildRuntimePolicy` save orchestration; no new field on `RuntimePolicyConfig` is introduced.

The control SHALL NOT expose an `Inherit` option; the company default has no parent scope to inherit from.

The control SHALL respect `availableEngineAdapters` from `OffisimRuntimeContext`: engine choices SHALL be disabled and accompanied by helper copy "Available on trusted desktop runtime" when the corresponding adapter is not registered.

#### Scenario: Default control reads existing company default
- **WHEN** `runtimePolicy.employeeRuntimeDefault` is `{ mode: 'engine', engineId: 'claude-engine' }`
- **THEN** the control SHALL render with `Claude engine` selected

#### Scenario: Saving the default writes through runtime policy save
- **WHEN** the user changes the control from `Provider gateway` to `Codex engine` and clicks Save
- **THEN** the saved `RuntimePolicyConfig` SHALL contain `employeeRuntimeDefault: { mode: 'engine', engineId: 'codex-engine' }`

#### Scenario: Browser runtime disables engine choices
- **WHEN** `availableEngineAdapters` is empty
- **THEN** `Claude engine` and `Codex engine` SHALL render disabled with the helper copy
- **AND** `Provider gateway` SHALL remain enabled

#### Scenario: Default control omits Inherit option
- **WHEN** the control renders for any policy state
- **THEN** the control SHALL NOT offer an `Inherit` option
