## 1. Pre-work audit

- [x] 1.1 Re-verify bug: clear localStorage, open Settings with `VITE_MINIMAX_API_KEY` env set, confirm Save button shows blue/enabled before any edit (bug reproduces)
- [x] 1.2 Confirm baseline behavior post-fix expected: Save button grey/disabled on first open; blue after 1-char edit; grey again after save; Escape no-edit closes directly; Escape with edit shows confirm

## 2. Dirty tracking hook rewrite

- [x] 2.1 `useSettingsDirtyTracking.ts`: own `captureVersion` internally via `useState(0)`; expose `markLoaded: () => void` that bumps it
- [x] 2.2 Change `loadedSnapshotRef` to `useRef<string | null>(null)`
- [x] 2.3 Replace `[snapshotJson]`-keyed capture effect with `[captureVersion]`-keyed effect; early-return when `captureVersion === 0`
- [x] 2.4 `hasUnsavedChanges = isActive && loadedSnapshotRef.current !== null && snapshotJson !== loadedSnapshotRef.current`
- [x] 2.5 Return shape `{ hasUnsavedChanges, requestDismiss, markLoaded, resetLoadedSnapshot }` — no `queueCapture`, no exposed `captureVersion`
- [x] 2.6 Remove `pendingSnapshotCaptureRef`

## 3. Save orchestrator wiring

- [x] 3.1 `useSettingsSaveOrchestrator.ts`: replace `queueCapture: () => void` in `SaveOrchestratorOptions` with `markLoaded: () => void`
- [x] 3.2 In `loadState()` tail: replace `queueCapture()` call with `markLoaded()`
- [x] 3.3 Update the biome-ignore rationale on the load effect to reference `markLoaded` instead of `queueCapture`

## 4. Barrel wiring

- [x] 4.1 `SettingsWorkspaceSurface.tsx`: barrel owns no dirty-tracking state — `captureVersion` lives inside `useSettingsDirtyTracking`
- [x] 4.2 Wire orchestrator via `markLoaded: dirty.markLoaded` (replaces `queueCapture` wiring)
- [x] 4.3 Call `useSettingsDirtyTracking({ isActive, snapshotJson, onDismiss })` — no external counter argument
- [x] 4.4 Barrel does not import `useState` / `useCallback` (only `useMemo` remains)
- [x] 4.5 Barrel NBNC stays ≤ 180

## 5. Build + typecheck + lint

- [x] 5.1 Serial build `shared-types → ui-core → core → ui-office → web`
- [x] 5.2 `pnpm typecheck` green
- [x] 5.3 `pnpm biome check packages/ui-office/src/components/settings/controller/` clean on our files

## 6. Single-owner grep gate

- [x] 6.1 No `queueCapture` / `pendingSnapshotCaptureRef` / `bumpLoadCaptureVersion` references anywhere in `packages/ui-office/src/components/settings/`
- [x] 6.2 `captureVersion` declared only inside `useSettingsDirtyTracking`; `markLoaded` declared only inside `useSettingsDirtyTracking` and passed through the barrel

## 7. Live runtime verification (web dev server 5176)

- [x] 7.1 Clear localStorage, reload. Enter company. Open Settings (Provider tab).
- [x] 7.2 Save button is GREY / disabled with class `opacity-50 cursor-not-allowed bg-white/10 text-slate-500` — `hasUnsavedChanges=false` on first open
- [x] 7.3 Type one char into apiKey → Save button flips to BLUE / enabled `bg-cyan-500 hover:bg-cyan-400 text-white`
- [x] 7.4 Click Save → button goes through saving → reinit cycle → returns to GREY / disabled
- [x] 7.5 Escape with no further edits → Settings closes directly (no confirm)
- [x] 7.6 Re-open Settings, edit apiKey one char → Escape → confirm dialog "Discard unsaved changes in Settings?" fires
- [x] 7.7 Reload page (localStorage now has saved config). Open Settings. Save button GREY — saved-config path still correctly captures
- [x] 7.8 Switch to Runtime tab; toggle memoryEnabled; Save button BLUE; save; GREY again
- [x] 7.9 Switch to MCP tab; panel renders normally
- [x] 7.10 Dev console 0 error / 0 warn across full flow
- [x] 7.11 Record observations to `verify-notes.md`

## 8. Final gate

- [x] 8.1 `openspec validate fix-settings-dirty-tracking-first-open --strict` green
- [x] 8.2 Notify user for `/opsx:archive`
