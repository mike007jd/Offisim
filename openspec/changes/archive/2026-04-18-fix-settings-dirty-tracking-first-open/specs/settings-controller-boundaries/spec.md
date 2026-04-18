## MODIFIED Requirements

### Requirement: Controller sibling hooks are one-responsibility-per-file

The 4 controller sibling hooks SHALL live in `packages/ui-office/src/components/settings/controller/`:

- `useSettingsProviderState.ts` — owns the 7 provider state values (`preset`, `apiKey`, `baseURL`, `model`, `defaultHeaders`, `acpCommand`, `hasStoredSecret`) and their setters, `handlePresetChange`, and `applyFromSaved(saved)` / `applyDefaults(presetKey)` helpers. Exposes a `snapshot` object used by dirty tracking.
- `useSettingsRuntimePolicy.ts` — owns the 13 runtime-policy state values (`executionMode`, `summarizationEnabled`, `summarizationTriggerTokens`, `summarizationKeepRecentMessages`, `memoryEnabled`, `memoryInjectionEnabled`, `memoryMaxFacts`, `memoryConfidenceThreshold`, `toolSearchEnabled`, `gitAutoCommit`, `toolPermissions`, `runtimeModelDefault`, `runtimeModelOverrides`) and their setters, `applyFromSaved(policy)` / `applyDefaults()` helpers, and `buildRuntimePolicy(providerPreset, isSubscription, model)` used by save. Exposes a `snapshot` object used by dirty tracking.
- `useSettingsSaveOrchestrator.ts` — owns `isSaving`, `isReinitializing`, `saveError` state, `savingRef`, `reinitBaseVersionRef`, the `isActive`-driven load `useEffect`, the async `handleSave` function, and **two independent** reinit `useEffect`s (runtime-version detector + 5-second timeout). Depends on `useOffisimRuntimeStatus()` for `runtimeVersion`. Receives `markLoaded: () => void` from the dirty-tracking hook (via the barrel) and calls it at the tail of `loadState()` so the dirty-tracking hook captures the loaded snapshot in the same React batch as the `applyFromSaved` state updates.
- `useSettingsDirtyTracking.ts` — owns `loadedSnapshotRef` (typed `string | null`, initial `null`) and the internal `captureVersion` counter, exposes `hasUnsavedChanges: boolean`, `requestDismiss: () => void`, `markLoaded: () => void`, and `resetLoadedSnapshot: (snapshot: string) => void`. Accepts `isActive`, the externally-computed `snapshotJson` string, and `onDismiss` callback.

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
- **WHEN** grepping `components/settings/**/*.{ts,tsx}` for `loadedSnapshotRef` declarations
- **THEN** every declaration match is inside `controller/useSettingsDirtyTracking.ts`
- **AND** grepping for `pendingSnapshotCaptureRef` or `queueCapture` yields no matches anywhere (removed by this change)

### Requirement: Snapshot bytes are equivalent to pre-refactor

The dirty-tracking snapshot string used to compute `hasUnsavedChanges` SHALL be byte-identical to pre-refactor for identical state values. Specifically the snapshot object SHALL contain, in this order, the keys: `preset`, `apiKey`, `baseURL`, `model`, `defaultHeaders`, `acpCommand`, `executionMode`, `summarizationEnabled`, `summarizationTriggerTokens`, `summarizationKeepRecentMessages`, `memoryEnabled`, `memoryInjectionEnabled`, `memoryMaxFacts`, `memoryConfidenceThreshold`, `toolSearchEnabled`, `gitAutoCommit`, `toolPermissions`, `runtimeModelDefault`, `runtimeModelOverrides`, `density`. `hasStoredSecret` SHALL NOT appear in the snapshot (matching pre-refactor behavior).

The capture mechanism that writes `loadedSnapshotRef` SHALL be driven by a `captureVersion: number` counter owned internally by `useSettingsDirtyTracking`, not by a flag ref. The hook SHALL expose a `markLoaded: () => void` callback that increments the counter. The `useSettingsSaveOrchestrator`'s `loadState()` SHALL call `markLoaded()` at its tail, batching the counter increment with the `applyFromSaved` state updates so the post-commit capture effect reads the post-load `snapshotJson`. The capture effect SHALL early-return when `captureVersion === 0` so the initial render does not capture the defaults snapshot.

#### Scenario: Snapshot key set parity
- **WHEN** comparing `JSON.parse(snapshotJson)` key list pre-refactor vs post-refactor for the same state values
- **THEN** the key list and order are identical and `hasStoredSecret` is absent from both

#### Scenario: Initial open with no saved config does not mark dirty
- **WHEN** the user opens Settings for the first time with no `localStorage["offisim-provider-config"]` entry (env-backed path loads MiniMax defaults)
- **THEN** `hasUnsavedChanges` is `false` after load completes and before any user edit
- **AND** the `Save settings` button is rendered with disabled styling (`opacity-50 cursor-not-allowed bg-white/10 text-slate-500`) and `disabled=true`

#### Scenario: Initial open with saved config does not mark dirty
- **WHEN** the user opens Settings with an existing `localStorage["offisim-provider-config"]` saved config
- **THEN** `hasUnsavedChanges` is `false` after load completes and before any user edit
- **AND** the `Save settings` button is disabled

#### Scenario: Toggling a provider field flips dirty
- **WHEN** the surface is active, load has completed, and `apiKey` is edited by one character
- **THEN** `hasUnsavedChanges` transitions from `false` to `true`

#### Scenario: Toggling a runtime-policy field flips dirty
- **WHEN** the surface is active, load has completed, and `memoryEnabled` is toggled
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
