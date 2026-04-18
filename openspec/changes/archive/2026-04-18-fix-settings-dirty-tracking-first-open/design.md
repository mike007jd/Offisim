## Context

`useSettingsDirtyTracking` is responsible for telling the Settings UI "does the current form state differ from the loaded/saved baseline" so the Save button can enable/disable and Escape can show the Discard confirm. The original design tried to capture the baseline lazily using two refs + a `useEffect[snapshotJson]`:

```ts
const loadedSnapshotRef = useRef('');
const pendingSnapshotCaptureRef = useRef(false);

useEffect(() => {
  if (pendingSnapshotCaptureRef.current) {
    loadedSnapshotRef.current = snapshotJson;
    pendingSnapshotCaptureRef.current = false;
  }
}, [snapshotJson]);
```

And the save orchestrator's load effect called `queueCapture()` (sets `pending=true`) at the tail of `loadState()`.

The intent: "applyFromSaved queues multiple setState; queueCapture flips the flag; React commits the state batch; next render has LOADED snapshot; the capture effect fires on the snapshotJson change and captures LOADED".

The actual behavior in React 18 StrictMode dev mode (confirmed via console trace): effects are double-invoked on mount (setup → cleanup → setup). Between the two invocations of the load effect (which sets `pending=true`) and the second invocation of the capture effect (which runs before state has committed), the capture fires with `pending=true` but `snapshotJson` still equal to DEFAULTS — so `loadedSnapshotRef` gets written with DEFAULTS. The subsequent Render 2 fires the capture again and overwrites with LOADED, but the render that commits to the DOM evaluates `hasUnsavedChanges` with the DEFAULTS value still in the ref → DOM shows dirty → Save button highlighted. No further render fires to correct it.

The fundamental issue: **capturing via a flag-checked effect assumes a specific render/effect ordering that React StrictMode deliberately jitters**. The fix must not depend on ordering.

## Goals / Non-Goals

**Goals:**

- `hasUnsavedChanges` is `false` on initial open (env-backed or saved-config-backed) before the user edits.
- Edit → `hasUnsavedChanges` flips to `true`.
- Save success → `hasUnsavedChanges` flips back to `false`.
- Escape → no-edit direct close; with-edit confirm dialog.
- StrictMode-safe: effect double-invocation cannot produce a dirty-true initial state.
- No API change to consumers of `useSettingsWorkspaceController`.

**Non-Goals:**

- Not touching save / reinit / load path logic. Only the dirty-tracking capture mechanism.
- Not changing the snapshot key order (byte-identical snapshot hasn't changed).
- Not adding tests (repo has no auto-test policy).

## Decisions

### D1. Capture key changes from `snapshotJson` to `captureVersion` counter

**Choice**: The dirty hook's capture effect uses `[captureVersion]` as its single dep, not `[snapshotJson]`. The counter is owned internally by `useSettingsDirtyTracking` as `useState`; the hook exposes `markLoaded: () => void` (wrapping `setCaptureVersion(v => v + 1)`). The save orchestrator receives `markLoaded` through the barrel and invokes it at the end of `loadState()`.

**Why**:

- `setCaptureVersion(v => v + 1)` batches with the `applyFromSaved` setState calls because it happens inside the load effect's synchronous tail. React commits them together → Render 2 has BOTH loaded state AND incremented captureVersion.
- The capture effect's body reads `snapshotJson` from closure. That closure captures the render-time `snapshotJson`. When the effect fires due to captureVersion change, it's firing in the Render-2 effect phase where `snapshotJson` is the LOADED value (from the useMemo over LOADED state).
- StrictMode double-invoke of effects doesn't matter: even if the effect runs twice, both runs write the same LOADED snapshot to `loadedSnapshotRef`. Idempotent.
- The effect is **not** triggered by the initial render's `snapshotJson === DEFAULTS`. The initial captureVersion=0 means no write happens on the initial mount's effect run (see D2).

**Rejected alternatives**:

- Write `loadedSnapshotRef` from `loadState` directly using `saved` config inlined: would duplicate the snapshot-construction logic that lives across provider / runtimePolicy / density. Maintenance burden when snapshot keys evolve.
- Use `flushSync`: allows synchronous state commits but is discouraged by React docs, pulls a heavier escape hatch than needed.
- Use `useLayoutEffect`: fires before browser paint but still after commit, same timing constraints as `useEffect` for the capture path.

### D2. Guard against writing on initial mount

**Choice**: The capture effect early-returns when `captureVersion === 0`:

```ts
useEffect(() => {
  if (captureVersion === 0) return;
  loadedSnapshotRef.current = snapshotJson;
}, [captureVersion]);
```

**Why**:

- React mounts the effect on initial render (captureVersion=0). Without the guard, this would write the DEFAULTS snapshot to `loadedSnapshotRef`, then hasUnsavedChanges at Render 2 would evaluate `snapshot=LOADED !== loaded=DEFAULTS` = true. Same bug, different mechanism.
- With the guard, `loadedSnapshotRef` stays `null` until the first real capture. `hasUnsavedChanges = null !== null` logic short-circuits to `false` until the first capture completes.
- StrictMode double-invoke of the effect on mount: both runs early-return because captureVersion=0 still.

### D3. Use `null` sentinel for unloaded state

**Choice**: `loadedSnapshotRef = useRef<string | null>(null)`. `hasUnsavedChanges = isActive && loadedSnapshotRef.current !== null && snapshotJson !== loadedSnapshotRef.current`.

**Why**:

- Clearer intent than empty string `''`. The old `''` sentinel was indistinguishable from an actual (but implausible) empty snapshot string.
- Short-circuits correctly when capture hasn't happened yet: `null !== null` is false → not dirty.

### D4. Save-success capture stays direct

**Choice**: `handleSave` on success continues to call `resetLoadedSnapshot(snapshotJson)` directly (synchronous ref write). No captureVersion bump needed because save-success already has the correct `snapshotJson` in closure — `handleSave` receives it from the barrel.

**Why**: Save success runs inside an event handler (user click). No render race. Direct ref write is safe and clearer than going through the counter path.

### D5. `queueCapture` and `pendingSnapshotCaptureRef` are deleted

**Choice**: Remove both the `queueCapture` API and the `pendingSnapshotCaptureRef`. Also remove the `[snapshotJson]`-keyed capture effect.

**Why**: The counter-based mechanism fully replaces them. Leaving the old API would encourage future hands to re-introduce the race.

## Risks / Trade-offs

- **Risk: captureVersion counter grows unbounded**. `useState<number>` with `setState(v => v + 1)`. Grows by 1 per load (typically only on Settings open). Overflow after ~2^53 loads. Non-issue.
- **Risk: consumer reads `captureVersion` from the hook's return**. Mitigation: `useSettingsDirtyTracking` does not expose `captureVersion`; it stays an internal state variable.
- **Risk: `markLoaded` needs stable identity across renders**. The `markLoaded` closure captures `setCaptureVersion` which is a stable React setter, and is wrapped in `useCallback([], [])` to keep its own identity stable.
- **Trade-off: one extra render after load completes** (to apply the captureVersion increment). Previously: queueCapture was an immediate ref write, the render happened anyway for state updates, so "one extra render" is actually zero — captureVersion bumps in the SAME batch as state updates.
- **Trade-off: effect depends on captureVersion, so if the user manually forces a re-capture (future feature), we need a new public method**. Save orchestrator owns the only caller (loadState). If that ever needs to split, add an explicit re-capture API then.

## Open Questions

- **Does `handleSave` on success need to bump captureVersion too, or is `resetLoadedSnapshot` enough?** — Decision: `resetLoadedSnapshot` is enough. Save-success runs in an event handler with stable closure over `snapshotJson`, no render race. Verified live.
- **Is the React Fast Refresh / HMR edge case covered?** — When HMR reloads the sub-hook files, state IS preserved (React Fast Refresh preserves `useState`), refs persist. `loadedSnapshotRef` retains its null/LOADED value across HMR. Not a regression vector.
