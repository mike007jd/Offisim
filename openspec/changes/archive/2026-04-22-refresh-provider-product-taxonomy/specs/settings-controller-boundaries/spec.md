## MODIFIED Requirements

### Requirement: Controller sibling hooks are one-responsibility-per-file

The 4 controller sibling hooks SHALL continue to live in `packages/ui-office/src/components/settings/controller/`, but provider-state ownership SHALL become product-centric:

- `useSettingsProviderState.ts` — owns the primary provider/product state values (`productId`, `accessMode`, `apiKey`, `model`, `endpointOverride`, `defaultHeaders`, `executionLane`, `hasStoredSecret`, and any derived advanced-routing toggles) plus their setters, `handleProductChange`, and `applyFromSaved(saved)` / `applyDefaults(productId)` helpers. It exposes a `snapshot` object used by dirty tracking.
- `useSettingsRuntimePolicy.ts` — continues to own runtime-policy state and helpers.
- `useSettingsSaveOrchestrator.ts` — continues to own load/save/reinit orchestration and trusted-host secret interactions.
- `useSettingsDirtyTracking.ts` — continues to own the loaded snapshot reference and dirty-tracking lifecycle.

Compatibility/vendor/surface labels SHALL NOT remain the primary owner fields of the provider-state hook. They MAY still exist as derived metadata for display or migration purposes, but product identity is the primary state.

#### Scenario: Product state is single-owner

- **WHEN** grepping `packages/ui-office/src/components/settings/**/*.{ts,tsx}` for provider-state declarations such as `productId`, `accessMode`, `endpointOverride`, `executionLane`, or `handleProductChange`
- **THEN** their owning state declarations are inside `controller/useSettingsProviderState.ts`

#### Scenario: Provider hook no longer centers raw compat fields

- **WHEN** inspecting `useSettingsProviderState.ts`
- **THEN** the hook treats product identity as the primary selection model
- **AND** raw compatibility/vendor/surface fields, if still present, are derived metadata rather than the main user-selection state

### Requirement: Snapshot bytes are equivalent to pre-refactor

The dirty-tracking snapshot string SHALL remain stable and deterministic under the new product-centric schema. The snapshot object SHALL contain the provider-selection keys in product-centric order before runtime-policy fields.

At minimum, the provider portion of the snapshot SHALL be ordered as:

- `productId`
- `accessMode`
- `apiKey`
- `endpointOverride`
- `model`
- `defaultHeaders`
- `executionLane`

`hasStoredSecret` SHALL NOT appear in the snapshot.

The hook SHALL continue to avoid marking Settings dirty immediately after load completes, both for first-open defaults and for migrated legacy configs.

#### Scenario: Initial open with migrated config does not mark dirty

- **WHEN** the user opens Settings and a legacy saved provider record is migrated into the new product-centric schema during load
- **THEN** `hasUnsavedChanges` is `false` after load completes and before any user edit

#### Scenario: Editing the selected product flips dirty

- **WHEN** load has completed and the user changes `productId` from one product to another
- **THEN** `hasUnsavedChanges` transitions from `false` to `true`

### Requirement: Public controller API is unchanged

`useSettingsWorkspaceController(options)` SHALL expose a product-centric public API. The returned controller SHALL surface product-first fields such as `productId`, `accessMode`, `handleProductChange`, and any required advanced-routing controls.

Legacy fields whose primary meaning depended on the old preset/compat model — including `selectedCompatibility`, `selectedVendor`, `selectedSurface`, `isSubscription`, and `acpCommand` — SHALL NOT remain required primary inputs for consumers. If retained during migration, they SHALL be derived/compatibility fields only.

#### Scenario: Provider tab consumes product-first controller fields

- **WHEN** `SettingsProviderTab` renders
- **THEN** its primary selection controls bind to product-centric controller fields
- **AND** the product selection is not reconstructed from compatibility/vendor/surface triage in the component

#### Scenario: Consumers do not need to infer Codex from raw provider fields

- **WHEN** a consumer needs to know the currently selected provider product
- **THEN** it can read the product-centric controller field directly
- **AND** it does not need to infer `Codex` or `Claude` from raw protocol/provider metadata

### Requirement: Observable save and reinit behavior is unchanged

For identical user intent, the Settings surface SHALL preserve the same save/reinit lifecycle semantics as before: save writes config, trusted-host secret actions happen in the orchestrator, successful save triggers runtime reinit, and timeout/version-bump behavior remains stable.

The saved config payload itself SHALL now be product-centric rather than preset/compat-centric.

#### Scenario: Save emits a product-centric provider config

- **WHEN** the user presses Save on the new provider settings flow
- **THEN** `onSave(config)` receives a product-centric config payload
- **AND** the reinit lifecycle proceeds with the same success/timeout behavior as before

#### Scenario: Trusted-host secret handling still stays in the save orchestrator

- **WHEN** the selected access mode requires secret persistence or secret clearing
- **THEN** `useSettingsSaveOrchestrator.ts` remains the only controller hook that performs those side effects
- **AND** the provider tab stays render/controller-only
