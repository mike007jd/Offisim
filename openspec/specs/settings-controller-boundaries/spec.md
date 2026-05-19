# settings-controller-boundaries

## Purpose

`packages/ui-office/src/components/settings/SettingsWorkspaceSurface.tsx` owns the Settings workspace controller — the React hook `useSettingsWorkspaceController` that glues provider-product selection, access mode, advanced routing, runtime-policy state, save/load/reinit lifecycle, and dirty-tracking into a single controller surface consumed by `SettingsPage` / `SettingsContentArea` / `SettingsProviderTab` / `SettingsRuntimeTab` / `SettingsTabNav` — plus the `SettingsWorkspaceSurface` JSX component used by overlay mode. Pre-refactor (Round 2, 2026-04-18) it was a 624-NBNC double-export file that stacked 24 `useState` hooks, a 140-line `isActive`-driven load effect, a 120-line async `handleSave`, two independent reinit effects, plus three formatter helpers and three parser helpers into a single function scope. This spec locks the post-refactor decomposition so future provider-product or runtime-policy edits touch one sibling hook, not the 600-line monolith, and prevents the two reinit effects from being merged again.
## Requirements
### Requirement: SettingsWorkspaceSurface barrel is thin

`packages/ui-office/src/components/settings/SettingsWorkspaceSurface.tsx` SHALL contain no more than 180 non-blank, non-comment lines. The barrel SHALL retain its existing public exports:

- `export type SettingsTab = 'provider' | 'runtime' | 'mcp' | 'external';`
- `export function useSettingsWorkspaceController(options: SettingsWorkspaceControllerOptions): ReturnType<...>`

The previously exported `SettingsWorkspaceSurface` React component (overlay-mode JSX) has been removed because the live Settings path is `SettingsPage` → `SettingsTabNav` + `SettingsContentArea` and the JSX component had no consumers. The file SHALL only export the `SettingsTab` type and the `useSettingsWorkspaceController` hook.

The barrel body SHALL NOT contain inline `useState<...>` declarations, inline `loadProviderConfig()` / `saveProviderConfig()` / `setRuntimeSecret()` / `clearRuntimeSecret()` / `getRuntimeSecretStatus()` calls, inline `JSON.parse` / `JSON.stringify` for the snapshot or save path, or inline `Number.parseInt` / `Number.parseFloat` parser helpers.

#### Scenario: Barrel file size gate
- **WHEN** `grep -cvE '^\s*(//|$|/\*|\*)' packages/ui-office/src/components/settings/SettingsWorkspaceSurface.tsx` is run after refactor
- **THEN** the non-blank, non-comment line count is at most 180

#### Scenario: Public exports preserved
- **WHEN** grepping for `^export (type SettingsTab|function useSettingsWorkspaceController)` in `SettingsWorkspaceSurface.tsx`
- **THEN** both export statements are present
- **AND** no `^export function SettingsWorkspaceSurface` declaration is present (the JSX component has been deleted)

#### Scenario: No inline state or runtime side effects in barrel
- **WHEN** grepping the barrel for `useState<`, `loadProviderConfig\(`, `saveProviderConfig\(`, `setRuntimeSecret\(`, `clearRuntimeSecret\(`, `getRuntimeSecretStatus\(`, `Number\.parseInt\(`, `Number\.parseFloat\(`
- **THEN** there are no matches (the JSX component may read from the `controller` prop only)

### Requirement: Controller sibling hooks are one-responsibility-per-file

The 4 controller sibling hooks SHALL continue to live in `packages/ui-office/src/components/settings/controller/`, but provider-state ownership SHALL become product-centric:

- `useSettingsProviderState.ts` — owns the primary provider/product state values (`productId`, `accessMode`, `apiKey`, `model`, `endpointOverride`, `defaultHeaders`, `executionLane`, `hasStoredSecret`, and any derived advanced-routing toggles) plus their setters, `handleProductChange`, and `applyFromSaved(saved)` / `applyDefaults(productId)` helpers. It exposes a `snapshot` object used by dirty tracking.
- `useSettingsRuntimePolicy.ts` — continues to own runtime-policy state and helpers.
- `useSettingsSaveOrchestrator.ts` — continues to own load/save/reinit orchestration and trusted-host secret interactions.
- `useSettingsDirtyTracking.ts` — continues to own the loaded snapshot reference and dirty-tracking lifecycle.

Compatibility/vendor/surface labels SHALL NOT remain the primary owner fields of the provider-state hook. They MAY still exist as derived metadata for display or migration purposes, but product identity is the primary state.

#### Scenario: Exactly 4 controller hook files exist
- **WHEN** listing `packages/ui-office/src/components/settings/controller/*.ts`
- **THEN** exactly these 4 files exist: `useSettingsProviderState.ts`, `useSettingsRuntimePolicy.ts`, `useSettingsSaveOrchestrator.ts`, `useSettingsDirtyTracking.ts`

#### Scenario: Product state is single-owner
- **WHEN** grepping `packages/ui-office/src/components/settings/**/*.{ts,tsx}` for provider-state declarations such as `productId`, `accessMode`, `endpointOverride`, `executionLane`, or `handleProductChange`
- **THEN** their owning state declarations are inside `controller/useSettingsProviderState.ts`

#### Scenario: Provider hook no longer centers raw compat fields
- **WHEN** inspecting `useSettingsProviderState.ts`
- **THEN** the hook treats product identity as the primary selection model
- **AND** raw compatibility/vendor/surface fields, if still present, are derived metadata rather than the main user-selection state

#### Scenario: Runtime policy state is single-owner
- **WHEN** grepping for `setExecutionMode`, `setSummarizationEnabled`, `setMemoryMaxFacts`, `setToolPermissions`, `setRuntimeModelDefault`, `buildRuntimePolicy` declarations in `components/settings/**/*.{ts,tsx}`
- **THEN** every declaration match is inside `controller/useSettingsRuntimePolicy.ts`

#### Scenario: Save orchestration is single-owner
- **WHEN** grepping `components/settings/**/*.{ts,tsx}` for `loadProviderConfig\(`, `saveProviderConfig\(`, `setRuntimeSecret\(`, `getRuntimeSecretStatus\(`, `savingRef`, `reinitBaseVersionRef`, or `window\.setTimeout\(.*5000` usage
- **THEN** every match is inside `controller/useSettingsSaveOrchestrator.ts`

#### Scenario: Dirty-tracking state is single-owner
- **WHEN** grepping `components/settings/**/*.{ts,tsx}` for `loadedSnapshotRef` declarations
- **THEN** every declaration match is inside `controller/useSettingsDirtyTracking.ts`
- **AND** grepping for `pendingSnapshotCaptureRef` or `queueCapture` yields no matches anywhere (removed by this change)

### Requirement: Reinit effects stay independent

The `useSettingsSaveOrchestrator.ts` hook SHALL declare **two** separate `useEffect` blocks for the reinit lifecycle — one depending on `[runtimeVersion, isReinitializing]` for version-bump detection, one depending on `[isReinitializing]` alone for the 5-second fallback timeout. These two effects SHALL NOT be merged. If a future refactor tries to collapse them, tests / spec MUST re-separate them.

#### Scenario: Two reinit effects exist
- **WHEN** grepping `controller/useSettingsSaveOrchestrator.ts` for `useEffect\(` blocks inside the hook body
- **THEN** at least two `useEffect` declarations exist where:
  - One block references `runtimeVersion` and `reinitBaseVersionRef.current` to compare and clear `isReinitializing`
  - A separate block uses `window.setTimeout(..., 5000)` gated by `isReinitializing` alone and sets `saveError` on timeout

#### Scenario: Deps sets remain distinct
- **WHEN** inspecting the deps arrays of the two reinit effects
- **THEN** one effect deps equals `[runtimeVersion, isReinitializing]` (or equivalent ordered set containing both) and the other equals `[isReinitializing]` (only); no effect uses `[runtimeVersion]` alone or an empty `[]`

### Requirement: Snapshot bytes are deterministic for the lane-aware settings model

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

The capture mechanism that writes `loadedSnapshotRef` SHALL be driven by a `captureVersion: number` counter owned internally by `useSettingsDirtyTracking`, not by a flag ref. The hook SHALL expose a `markLoaded: () => void` callback that increments the counter. The `useSettingsSaveOrchestrator`'s `loadState()` SHALL call `markLoaded()` at its tail, batching the counter increment with the `applyFromSaved` state updates so the post-commit capture effect reads the post-load `snapshotJson`. The capture effect SHALL early-return when `captureVersion === 0` so the initial render does not capture the defaults snapshot.

#### Scenario: Snapshot key set is stable
- **WHEN** serializing `snapshotJson` twice for the same controller state
- **THEN** the parsed key list and order are identical both times
- **AND** `hasStoredSecret` is absent

#### Scenario: Initial open with migrated config does not mark dirty
- **WHEN** the user opens Settings and a legacy saved provider record is migrated into the new product-centric schema during load
- **THEN** `hasUnsavedChanges` is `false` after load completes and before any user edit

#### Scenario: Editing the selected product flips dirty
- **WHEN** load has completed and the user changes `productId` from one product to another
- **THEN** `hasUnsavedChanges` transitions from `false` to `true`

#### Scenario: Saving clears dirty
- **WHEN** `handleSave` completes successfully
- **THEN** `resetLoadedSnapshot(snapshotJson)` is called, writing the current `snapshotJson` to `loadedSnapshotRef.current`
- **AND** `hasUnsavedChanges` becomes `false`

#### Scenario: Capture effect is keyed on captureVersion
- **WHEN** inspecting `useSettingsDirtyTracking.ts`
- **THEN** the capture `useEffect` deps array is `[captureVersion]` (not `[snapshotJson]`)
- **AND** the effect body early-returns when `captureVersion === 0`
- **AND** `loadedSnapshotRef` is typed `useRef<string | null>(null)`

### Requirement: Public controller API remains stable for Settings consumers

`useSettingsWorkspaceController(options)` SHALL retain its pre-refactor input and output surface:

- Input `options: SettingsWorkspaceControllerOptions` with fields `isActive: boolean`, `closeOnSave?: boolean`, `onDismiss: () => void`, `onSave: (config: ProviderConfig) => void`, `onSaveSuccess?: () => void`, `onToast?: (message: string, variant?: 'info' | 'success' | 'error') => void`
- Return object SHALL expose a product-centric controller API. The field list includes product-first selection fields such as `productId`, `accessMode`, `handleProductChange`, `handleAccessModeChange`, `providerVariantId`, `showEndpointOverride`, `showVariantSelector`, and the derived compatibility display fields still consumed by Settings UI.

`isSaving` SHALL continue to be `isSaving || isReinitializing` (merged exposed flag). The controller SHALL additionally expose `isReinitializing` as a raw flag so the Settings sticky save bar can render the reinit-phase hint distinctly while keeping the merged `isSaving` for button gating.

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

#### Scenario: Reinit timeout path
- **WHEN** `runtimeVersion` does not bump within 5s of save success
- **THEN** `isReinitializing` becomes `false`, `saveError` is set to `'Runtime failed to reinitialize. Check your provider settings and try again.'`, and `reinitBaseVersionRef.current` is cleared

#### Scenario: Reinit version-bump path
- **WHEN** `runtimeVersion` bumps beyond `reinitBaseVersionRef.current` within 5s
- **THEN** `isReinitializing` becomes `false` and the timeout-branch `saveError` message is NOT set

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

### Requirement: Company-level model defaults SHALL be owned exclusively by Settings → Runtime via runtimePolicy

Company-level defaults for `model`, `temperature`, and `maxTokens` (the values consumed by `ModelResolver` at runtime) SHALL be owned exclusively by `runtimePolicy.modelPolicy`, configured through Settings → Runtime tab. No other UI surface in the application SHALL provide an editor that writes equivalent fields to a parallel store.

In particular, no code SHALL write `defaultModel`, `defaultTemperature`, or `defaultMaxTokens` keys into `officeLayouts.layout_json.policy` or any other location that is not `runtimePolicy.modelPolicy`. Legacy data on disk MAY exist but SHALL NOT be surfaced to users via any editor.

The `personnel-runtime-engine-binding` capability remains the SSOT for company-level employee runtime defaults (provider gateway vs trusted engine), exposed alongside the model defaults inside the same Runtime tab.

#### Scenario: No parallel write path for default model fields
- **WHEN** grepping `packages/ui-office/src/**/*.{ts,tsx}` (excluding `dist/` and tests) for assignments to `defaultModel:`, `defaultTemperature:`, or `defaultMaxTokens:` as part of an object passed to a repository write
- **THEN** zero matches exist outside of `controller/useSettingsRuntimePolicy.ts` or other Settings → Runtime sibling hooks

#### Scenario: ModelResolver consumes runtimePolicy only
- **WHEN** grepping `apps/desktop/renderer/src/lib/tauri-runtime.ts` for `new ModelResolver(`
- **THEN** every call site passes `runtimePolicy` (the `RuntimePolicyConfig` from Settings) as the first argument

#### Scenario: PolicyEditor component does not exist
- **WHEN** running `ls packages/ui-office/src/components/company/PolicyEditor.tsx`
- **THEN** the command exits with a non-zero status (no such file)
