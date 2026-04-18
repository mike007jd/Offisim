## Why

Live-reproducible bug: every time a user opens the Settings workspace on web with no saved `localStorage["offisim-provider-config"]` (the env-backed MiniMax default path), the `Save settings` button is **already enabled** before the user has touched any field — `hasUnsavedChanges` is `true` from first render. The Escape key also triggers the "Discard unsaved changes?" confirm even though the user has edited nothing. Confirmed with `git stash` on the pre-`refactor-settings-workspace-surface` file: same symptom, so this is a **pre-existing** dirty-tracking bug, not a refactor regression.

**RCA (console-traced 2026-04-18)**:

- `useSettingsDirtyTracking` captures a "loaded" snapshot via an indirect flag:
  ```ts
  useEffect(() => {
    if (pendingSnapshotCaptureRef.current) {
      loadedSnapshotRef.current = snapshotJson;
      pendingSnapshotCaptureRef.current = false;
    }
  }, [snapshotJson]);
  ```
- `useSettingsSaveOrchestrator`'s load effect calls `queueCapture()` **at the end of `loadState()`**, which sets `pendingSnapshotCaptureRef.current = true`. The intent: "on the next render where `snapshotJson` changes, capture it as the loaded baseline".
- In React 18 StrictMode dev mode, effects are double-invoked on initial mount (`setup → cleanup → setup`). The sequence of our two effects on Render 1 produces:
  1. Capture effect setup #1: `pending=false`, skip.
  2. Capture effect cleanup #1, setup #2: still `pending=false`, skip.
  3. Load effect setup #1: runs `loadState`, queues `applyFromSaved` setters, sets `pending=true`.
  4. Load effect cleanup #1, setup #2: runs `loadState` again, `pending=true` (already was).
  5. **Between the two load invocations, React re-runs the capture effect's cleanup + setup cycle, and the second capture setup fires with `pending=true` but with the Render-1 closure — snapshot is still DEFAULTS**. So `loadedSnapshotRef` captures **DEFAULTS**, not the loaded values.
  6. React then commits the batched state updates → Render 2 with LOADED state. Capture effect fires again (snapshotJson changed), overwrites `loadedSnapshotRef` with LOADED.
- BUT `hasUnsavedChanges` is computed in the render body, which reads `loadedSnapshotRef.current` at the render time. Between the DEFAULTS capture and the LOADED re-capture, there is a render whose `hasUnsavedChanges` evaluation reads `loadedSnapshotRef=DEFAULTS` while `snapshotJson=LOADED` → returns `true` → DOM commits that render → `bg-cyan-500` Save button → visible bug.
- Even after the final correct capture, a stale render's DOM state persists until something re-renders, which it does not at steady state.

The mechanism is fundamentally fragile because it relies on effect ordering relative to React's commit phase, which StrictMode deliberately jitters to catch bugs like this.

## What Changes

- **Replace the `pendingSnapshotCaptureRef` flag-based capture with a `captureVersion` counter**. The counter lives internally in `useSettingsDirtyTracking` as a `useState`, with a public `markLoaded: () => void` that bumps it. The save orchestrator receives `markLoaded` (via the barrel) instead of `queueCapture` and calls it at the end of `loadState()`. This batches the captureVersion bump with the `applyFromSaved` setState calls, so Render 2 has **both** the loaded state AND the incremented captureVersion.
- **The dirty hook's capture effect keys on `[captureVersion]`, not `[snapshotJson]`**. Inside the effect body, it reads the current render's `snapshotJson` from closure — which is guaranteed to be the post-state-update LOADED snapshot, because state and captureVersion increment together in the same React batch. No transient-render race.
- **Use `null` sentinel for "not yet loaded"**. `loadedSnapshotRef = useRef<string | null>(null)`. `hasUnsavedChanges = isActive && loadedSnapshotRef.current !== null && snapshotJson !== loadedSnapshotRef.current`. Before the first capture (Render 1, Render 2 pre-capture-effect), `hasUnsavedChanges` is unambiguously `false`.
- **Save-success reset stays direct**: `handleSave` on success calls `resetLoadedSnapshot(snapshotJson)` — already works, keep as-is.
- **Skip the initial-render capture**: the capture effect early-returns when `captureVersion === 0`. This prevents writing the DEFAULTS snapshot into `loadedSnapshotRef` on initial mount.

## Capabilities

### Modified Capabilities

- `settings-controller-boundaries` — add one requirement covering the first-open-no-dirty guarantee + tighten the existing "Saving clears dirty" requirement to use `null` sentinel wording; remove the `pendingSnapshotCaptureRef` + `queueCapture` mechanism reference.

## Impact

- **Files changed**:
  - `packages/ui-office/src/components/settings/controller/useSettingsDirtyTracking.ts` — 52 NBNC → ~55 NBNC. Swap flag mechanism for version-keyed effect. Null sentinel.
  - `packages/ui-office/src/components/settings/controller/useSettingsSaveOrchestrator.ts` — replace `queueCapture: () => void` input with `markLoaded: () => void`. Last line of `loadState()` changes from `queueCapture()` to `markLoaded()`.
  - `packages/ui-office/src/components/settings/SettingsWorkspaceSurface.tsx` — barrel just passes `markLoaded: dirty.markLoaded` to the orchestrator (no new state owned by the barrel).
- **No consumer changes**: public `useSettingsWorkspaceController` return shape unchanged. `hasUnsavedChanges`, `requestDismiss`, `handleSave`, `saveError`, etc. unchanged.
- **Observable behavior changes**: on first open with no saved config (env-backed path), `hasUnsavedChanges` is now `false` until user edits — matching the intended behavior all along. All other paths unchanged.
- **No DB / API / dependency changes**.
- **Validation**: serial build + typecheck + live web verification (open Settings with no localStorage → Save button grey-disabled; edit apiKey → blue-enabled; Save → grey again; Escape no-edit → direct close; Escape with edit → confirm).
