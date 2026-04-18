# settings-controller-boundaries

## Purpose

`packages/ui-office/src/components/settings/SettingsWorkspaceSurface.tsx` owns the Settings workspace controller — the React hook `useSettingsWorkspaceController` that glues provider presets, runtime-policy state, save/load/reinit lifecycle, and dirty-tracking into a single ~50-field return consumed by `SettingsPage` / `SettingsContentArea` / `SettingsProviderTab` / `SettingsRuntimeTab` / `SettingsTabNav` — plus the `SettingsWorkspaceSurface` JSX component used by overlay mode. Pre-refactor (Round 2, 2026-04-18) it was a 624-NBNC double-export file that stacked 24 `useState` hooks, a 140-line `isActive`-driven load effect, a 120-line async `handleSave`, two independent reinit effects, plus three formatter helpers and three parser helpers into a single function scope. This spec locks the post-refactor decomposition so future provider-preset or runtime-policy edits touch one sibling hook, not the 600-line monolith, and prevents the two reinit effects from being merged again.

## Requirements

### Requirement: SettingsWorkspaceSurface barrel is thin

`packages/ui-office/src/components/settings/SettingsWorkspaceSurface.tsx` SHALL contain no more than 180 non-blank, non-comment lines. The barrel SHALL retain its existing public exports:

- `export type SettingsTab = 'provider' | 'runtime' | 'mcp';`
- `export function useSettingsWorkspaceController(options: SettingsWorkspaceControllerOptions): ReturnType<...>`
- `export function SettingsWorkspaceSurface(props: SettingsWorkspaceSurfaceProps): JSX.Element`

The barrel body SHALL NOT contain inline `useState<...>` declarations (except state local to the JSX component if any), inline `loadProviderConfig()` / `saveProviderConfig()` / `setRuntimeSecret()` / `clearRuntimeSecret()` / `getRuntimeSecretStatus()` calls, inline `JSON.parse` / `JSON.stringify` for the snapshot or save path, or inline `Number.parseInt` / `Number.parseFloat` parser helpers.

#### Scenario: Barrel file size gate
- **WHEN** `grep -cvE '^\s*(//|$|/\*|\*)' packages/ui-office/src/components/settings/SettingsWorkspaceSurface.tsx` is run after refactor
- **THEN** the non-blank, non-comment line count is at most 180

#### Scenario: Public exports preserved
- **WHEN** grepping for `^export (type SettingsTab|function useSettingsWorkspaceController|function SettingsWorkspaceSurface)` in `SettingsWorkspaceSurface.tsx`
- **THEN** all three export statements are present

#### Scenario: No inline state or runtime side effects in barrel
- **WHEN** grepping the barrel for `useState<`, `loadProviderConfig\(`, `saveProviderConfig\(`, `setRuntimeSecret\(`, `clearRuntimeSecret\(`, `getRuntimeSecretStatus\(`, `Number\.parseInt\(`, `Number\.parseFloat\(`
- **THEN** there are no matches (the JSX component may read from the `controller` prop only)

### Requirement: Controller sibling hooks are one-responsibility-per-file

The 4 controller sibling hooks SHALL live in `packages/ui-office/src/components/settings/controller/`:

- `useSettingsProviderState.ts` — owns the 7 provider state values (`preset`, `apiKey`, `baseURL`, `model`, `defaultHeaders`, `acpCommand`, `hasStoredSecret`) and their setters, `handlePresetChange`, and `applyFromSaved(saved)` / `applyDefaults(presetKey)` helpers. Exposes a `snapshot` object used by dirty tracking.
- `useSettingsRuntimePolicy.ts` — owns the 13 runtime-policy state values (`executionMode`, `summarizationEnabled`, `summarizationTriggerTokens`, `summarizationKeepRecentMessages`, `memoryEnabled`, `memoryInjectionEnabled`, `memoryMaxFacts`, `memoryConfidenceThreshold`, `toolSearchEnabled`, `gitAutoCommit`, `toolPermissions`, `runtimeModelDefault`, `runtimeModelOverrides`) and their setters, `applyFromSaved(policy)` / `applyDefaults()` helpers, and `buildRuntimePolicy(providerPreset, isSubscription, model)` used by save. Exposes a `snapshot` object used by dirty tracking.
- `useSettingsSaveOrchestrator.ts` — owns `isSaving`, `isReinitializing`, `saveError` state, `savingRef`, `reinitBaseVersionRef`, the `isActive`-driven load `useEffect`, the async `handleSave` function, and **two independent** reinit `useEffect`s (runtime-version detector + 5-second timeout). Depends on `useOffisimRuntimeStatus()` for `runtimeVersion`.
- `useSettingsDirtyTracking.ts` — owns `loadedSnapshotRef`, `pendingSnapshotCaptureRef`, exposes `hasUnsavedChanges: boolean`, `requestDismiss: () => void`, `queueCapture: () => void`, and `resetLoadedSnapshot: (snapshot: string) => void`. Accepts `isActive`, the externally-computed `snapshotJson` string, and `onDismiss` callback.

#### Scenario: Exactly 4 controller hook files exist
- **WHEN** listing `packages/ui-office/src/components/settings/controller/*.ts`
- **THEN** exactly these 4 files exist: `useSettingsProviderState.ts`, `useSettingsRuntimePolicy.ts`, `useSettingsSaveOrchestrator.ts`, `useSettingsDirtyTracking.ts`

#### Scenario: Provider state is single-owner
- **WHEN** grepping `packages/ui-office/src/components/settings/**/*.{ts,tsx}` for `useState<string>\(DEFAULT_PRESET_KEY\)` or any of the literal identifiers `setApiKey`, `setBaseURL`, `setDefaultHeaders`, `setAcpCommand`, `handlePresetChange` defined at module scope
- **THEN** each declaration match is inside `controller/useSettingsProviderState.ts`

#### Scenario: Runtime policy state is single-owner
- **WHEN** grepping for `setExecutionMode`, `setSummarizationEnabled`, `setMemoryMaxFacts`, `setToolPermissions`, `setRuntimeModelDefault`, `buildRuntimePolicy` declarations in `components/settings/**/*.{ts,tsx}`
- **THEN** every declaration match is inside `controller/useSettingsRuntimePolicy.ts`

#### Scenario: Save orchestration is single-owner
- **WHEN** grepping `components/settings/**/*.{ts,tsx}` for `loadProviderConfig\(`, `saveProviderConfig\(`, `setRuntimeSecret\(`, `clearRuntimeSecret\(`, `getRuntimeSecretStatus\(`, `savingRef`, `reinitBaseVersionRef`, or `window\.setTimeout\(.*5000` usage
- **THEN** every match is inside `controller/useSettingsSaveOrchestrator.ts`

#### Scenario: Dirty-tracking state is single-owner
- **WHEN** grepping `components/settings/**/*.{ts,tsx}` for `loadedSnapshotRef`, `pendingSnapshotCaptureRef`, or `hasUnsavedChanges` declarations
- **THEN** every declaration match is inside `controller/useSettingsDirtyTracking.ts`

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

### Requirement: Snapshot bytes are equivalent to pre-refactor

The dirty-tracking snapshot string used to compute `hasUnsavedChanges` SHALL be byte-identical to pre-refactor for identical state values. Specifically the snapshot object SHALL contain, in this order, the keys: `preset`, `apiKey`, `baseURL`, `model`, `defaultHeaders`, `acpCommand`, `executionMode`, `summarizationEnabled`, `summarizationTriggerTokens`, `summarizationKeepRecentMessages`, `memoryEnabled`, `memoryInjectionEnabled`, `memoryMaxFacts`, `memoryConfidenceThreshold`, `toolSearchEnabled`, `gitAutoCommit`, `toolPermissions`, `runtimeModelDefault`, `runtimeModelOverrides`, `density`. `hasStoredSecret` SHALL NOT appear in the snapshot (matching pre-refactor behavior).

#### Scenario: Snapshot key set parity
- **WHEN** comparing `JSON.parse(snapshotJson)` key list pre-refactor vs post-refactor for the same state values
- **THEN** the key list and order are identical and `hasStoredSecret` is absent from both

#### Scenario: Toggling a provider field flips dirty
- **WHEN** the surface is active, a saved config has been loaded, and `apiKey` is edited by one character
- **THEN** `hasUnsavedChanges` transitions from `false` to `true`

#### Scenario: Toggling a runtime-policy field flips dirty
- **WHEN** the surface is active, a saved config has been loaded, and `memoryEnabled` is toggled
- **THEN** `hasUnsavedChanges` transitions from `false` to `true`

#### Scenario: Saving clears dirty
- **WHEN** `handleSave` completes successfully
- **THEN** `loadedSnapshotRef.current` is set to the post-save `snapshotJson` and `hasUnsavedChanges` is `false`

### Requirement: Public controller API is unchanged

`useSettingsWorkspaceController(options)` SHALL retain its pre-refactor input and output surface:

- Input `options: SettingsWorkspaceControllerOptions` with fields `isActive: boolean`, `closeOnSave?: boolean`, `onDismiss: () => void`, `onSave: (config: ProviderConfig) => void`, `onSaveSuccess?: () => void`, `onToast?: (message: string, variant?: 'info' | 'success' | 'error') => void`
- Return object SHALL contain every pre-refactor field name with the same type and semantics. The field list includes (non-exhaustive): `acpCommand`, `apiKey`, `baseURL`, `defaultHeaders`, `density`, `executionMode`, `gitAutoCommit`, `handlePresetChange`, `handleSave`, `hasStoredSecret`, `hasUnsavedChanges`, `isSaveDisabled`, `isSaving`, `isSubscription`, `isThinkingProvider`, `memoryConfidenceThreshold`, `memoryEnabled`, `memoryInjectionEnabled`, `memoryMaxFacts`, `model`, `notify`, `preset`, `requestDismiss`, `saveError`, `selectedCapabilities`, `selectedCompatibility`, `selectedPreset`, `selectedRegion`, `selectedSurface`, `selectedVendor`, `setAcpCommand`, `setApiKey`, `setBaseURL`, `setDensity`, `setExecutionMode`, `setGitAutoCommit`, `setMemoryConfidenceThreshold`, `setMemoryEnabled`, `setMemoryInjectionEnabled`, `setMemoryMaxFacts`, `setModel`, `setRuntimeModelDefault`, `setSummarizationEnabled`, `setSummarizationKeepRecentMessages`, `setSummarizationTriggerTokens`, `setToolSearchEnabled`, `showBaseURL`, `summarizationEnabled`, `summarizationKeepRecentMessages`, `summarizationTriggerTokens`, `toolSearchEnabled`.

`isSaving` SHALL continue to be `isSaving || isReinitializing` (merged exposed flag).

#### Scenario: Return field name parity
- **WHEN** extracting the object keys returned by `useSettingsWorkspaceController` pre- vs post-refactor
- **THEN** the set of top-level keys is identical (order of declaration may differ as long as the set and types are byte-equivalent)

#### Scenario: Consumer files require no edits
- **WHEN** the 4 consumer files (`SettingsPage.tsx`, `SettingsContentArea.tsx`, `SettingsProviderTab.tsx`, `SettingsRuntimeTab.tsx`) are diffed pre- vs post-refactor
- **THEN** no line of logic changes (only sort-order-insensitive import re-ordering permitted if automatic formatter triggers)

### Requirement: Observable save and reinit behavior is unchanged

For identical saved `ProviderConfig` input, identical `isTauri()` result, identical `runtimeVersion` stream, and identical user input, the surface SHALL produce:

1. Byte-identical `ProviderConfig` argument to `onSave(config)` (field names, types, values)
2. Identical sequence of calls to `setRuntimeSecret` / `clearRuntimeSecret` / `saveProviderConfig` / `getRuntimeSecretStatus`
3. Identical reinit lifecycle: `isReinitializing` becomes `true` on save success, becomes `false` on either `runtimeVersion` bump or the 5s timeout (not both — first one wins), and on timeout the `saveError` string becomes `'Runtime failed to reinitialize. Check your provider settings and try again.'`
4. Identical `hasUnsavedChanges` values across the Escape-confirmation prompt path (`window.confirm('Discard unsaved changes in Settings?')`)

#### Scenario: Save emits byte-identical ProviderConfig
- **WHEN** the same saved input is loaded and Save is pressed on both pre- and post-refactor builds
- **THEN** the `onSave(config)` call argument is deep-equal (including field order when `JSON.stringify` is used for comparison)

#### Scenario: Reinit timeout path
- **WHEN** `runtimeVersion` does not bump within 5s of save success
- **THEN** `isReinitializing` becomes `false`, `saveError` is set to `'Runtime failed to reinitialize. Check your provider settings and try again.'`, and `reinitBaseVersionRef.current` is cleared

#### Scenario: Reinit version-bump path
- **WHEN** `runtimeVersion` bumps beyond `reinitBaseVersionRef.current` within 5s
- **THEN** `isReinitializing` becomes `false` and the timeout-branch `saveError` message is NOT set
