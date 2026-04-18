# Live verify notes — refactor-settings-workspace-surface

Date: 2026-04-18
Mode: web (http://localhost:5176, non-Tauri), MiniMax env-backed provider config.

## Gate checklist

| Task | Result | Detail |
| --- | --- | --- |
| 4.1 barrel NBNC ≤ 180 | ✅ | 159 |
| 4.2 barrel banned patterns grep | ✅ | zero matches for `useState<|loadProviderConfig(|saveProviderConfig(|setRuntimeSecret(|clearRuntimeSecret(|getRuntimeSecretStatus(|Number.parseInt(|Number.parseFloat(` |
| 4.3 three exports present | ✅ | `export type SettingsTab` / `export function useSettingsWorkspaceController` / `export function SettingsWorkspaceSurface` |
| 5.1 serial build | ✅ | `shared-types → ui-core → core → ui-office → web` all green |
| 5.2 `pnpm typecheck` | ✅ | 26 tasks successful (21 cache + 5 fresh) |
| 5.3 provider setters single-owner | ✅ | `setApiKey|setBaseURL|setDefaultHeaders|setAcpCommand|handlePresetChange` declared only in `controller/useSettingsProviderState.ts` |
| 5.4 runtime policy setters + `buildRuntimePolicy` | ✅ | declared only in `controller/useSettingsRuntimePolicy.ts` |
| 5.5 save single-owner | ✅ | `loadProviderConfig(|saveProviderConfig(|setRuntimeSecret(|clearRuntimeSecret(|getRuntimeSecretStatus(|savingRef|reinitBaseVersionRef|5000` only in `controller/useSettingsSaveOrchestrator.ts` |
| 5.6 dirty single-owner | ✅ | `loadedSnapshotRef|pendingSnapshotCaptureRef` declared only in `controller/useSettingsDirtyTracking.ts` (consumers read `hasUnsavedChanges` through the controller prop, unchanged) |
| 5.7 two reinit effects independent | ✅ | `useEffect` #1 deps `[runtimeVersion, isReinitializing]`; #2 deps `[isReinitializing]` with `window.setTimeout(..., 5000)` |

## Snapshot parity

Pre-refactor `currentSnapshot` key order (lines 185–208 of original file):
`preset, apiKey, baseURL, model, defaultHeaders, acpCommand, executionMode, summarizationEnabled, summarizationTriggerTokens, summarizationKeepRecentMessages, memoryEnabled, memoryInjectionEnabled, memoryMaxFacts, memoryConfidenceThreshold, toolSearchEnabled, gitAutoCommit, toolPermissions, runtimeModelDefault, runtimeModelOverrides, density`

Post-refactor `snapshotJson` = `JSON.stringify({ ...provider.snapshot, ...runtimePolicy.snapshot, density })` where:
- `provider.snapshot` key order: `preset, apiKey, baseURL, model, defaultHeaders, acpCommand`
- `runtimePolicy.snapshot` key order: `executionMode, summarizationEnabled, summarizationTriggerTokens, summarizationKeepRecentMessages, memoryEnabled, memoryInjectionEnabled, memoryMaxFacts, memoryConfidenceThreshold, toolSearchEnabled, gitAutoCommit, toolPermissions, runtimeModelDefault, runtimeModelOverrides`

Spread preserves source order; final keys identical to pre-refactor, byte-for-byte. `hasStoredSecret` not included in either (matching pre-refactor). ✅

Runtime debug sample from live page (web, env-backed MiniMax):
```
snapshotJson = {"preset":"minimax-intl-anthropic-coding","apiKey":"sk-cp-…","baseURL":"https://api.minimax.io/anthropic","model":"MiniMax-M2.7-highspeed","defaultHeaders":"","acpCommand":"claude","executionMode":"auto","summarizationEnabled":true,"summarizationTriggerTokens":"60000","summarizationKeepRecentMessages":"30","memoryEnabled":true,"memoryInjectionEnabled":true,"memoryMaxFacts":"50","memoryConfidenceThreshold":"0.7","toolSearchEnabled":true,"gitAutoCommit":true,"toolPermissions":{"enabled":true,"defaultBehavior":"allow","rules":[]},"runtimeModelDefault":{"profileName":"runtime-default","provider":"anthropic","model":"MiniMax-M2.7-highspeed"},"density":"normal"}
```
Keys match the spec requirement order exactly.

## Live runtime

Web dev server on :5176 already up. Playwright MCP browser.

| Scenario | Result |
| --- | --- |
| 7.1–7.2 open Settings → Provider tab renders 4 MetricCards (Official compatibility / Models & Access / Save provider workspace) | ✅ |
| 7.4 edit `apiKey` one char → Save button flips to dirty-enabled (`bg-cyan-500`, `disabled=false`) | ✅ |
| 7.5 switch to Runtime tab → renders `Runtime orchestration`, `Runtime controls`, `Summarization`, `Memory`, `Tool search`, `Git auto-commit`, `Display density` sections | ✅ |
| 7.6–7.7 press Save → `saveError` stays empty, reinit completes, Save button returns to disabled + `opacity-50 cursor-not-allowed bg-white/10 text-slate-500` (hasUnsavedChanges=false after save captures snapshot) | ✅ |
| post-save `ProviderConfig` written to `localStorage["offisim-provider-config"]` with expected fields (provider / providerVariantId / vendor / region / compatibility / surface / capabilities / apiKey / baseURL / model / runtimePolicy{executionMode,modelPolicy,summarization,memory,toolSearch,toolPermissions}) | ✅ |
| 7.8 Escape with no changes → Settings closes directly, no confirm | ✅ |
| 7.9 Escape with edit (dirty=true) → `window.confirm('Discard unsaved changes in Settings?')` fires | ✅ (dialog captured with exact text) |
| 7.10 MCP tab → renders `McpConfigPanel` with "Add MCP Server" form + empty state text | ✅ |
| 7.11 dev console | ✅ 0 error / 0 warn across full flow |

## Notes / pre-existing behavior observed during verification

**Env-backed config edge case**: when web loads via `loadEnvBackedProviderConfig()` (no localStorage save yet), the initial render cycle results in `loadedSnapshotRef` stabilising to the INITIAL defaults snapshot, so `hasUnsavedChanges` returns `true` immediately even without any user edit. This behavior was verified to exist in the PRE-REFACTOR file as well (stashed original still shows Save button enabled on first open). **Not a refactor regression.** Recorded for future follow-up but out of scope for this change.

After first Save, localStorage is populated, subsequent loads from stored config work as expected (dirty tracking correct; Save disabled on load).
