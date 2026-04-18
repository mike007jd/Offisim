# Live Verification Notes — fix-settings-dirty-tracking-first-open

Date: 2026-04-18
Environment: apps/web on http://localhost:5176, playwright MCP browser, `.env.local` VITE_MINIMAX_API_KEY seeded.

## Pre-condition

- `localStorage.clear()` → reload → Enter Company → open Settings workspace.

## Observed behavior

| Case | Evidence | Pass |
|------|----------|------|
| 7.2 First open, no saved config → Save grey/disabled | `disabled=true`, `className=... opacity-50 cursor-not-allowed bg-white/10 text-slate-500` | ✅ |
| 7.3 Edit provider field → Save blue/enabled | `disabled=false`, `className=... bg-cyan-500 hover:bg-cyan-400 text-white` | ✅ |
| 7.4 Click Save → returns to grey/disabled after save cycle | Same `opacity-50 cursor-not-allowed bg-white/10 text-slate-500` class post-save | ✅ |
| 7.5 Escape on clean state → direct close, no confirm | `window.confirm` stub received 0 calls, Save button no longer in DOM | ✅ |
| 7.6 Re-open + edit + Escape → confirm fires | `window.confirm` received exactly `"Discard unsaved changes in Settings?"`, Settings stayed open (stub returned false) | ✅ |
| 7.7 Reload with saved localStorage config → Save grey | `disabled=true`, same grey classes on re-open | ✅ |
| 7.8 Runtime tab edit (density Spacious) → blue → save → grey | Save flipped to `bg-cyan-500 ... text-white`, post-save back to grey | ✅ |
| 7.9 MCP tab renders | Tab content shows "Add MCP Server", "Transport", "URL", "SSE (browser-compatible)", "No MCP servers configured..." | ✅ |
| 7.10 Console clean | 0 errors, 0 warnings across entire flow | ✅ |

## Notes

- 7.3 used baseURL edit (placeholder contained "api"); dirty-flip test is mechanism-level and snapshot-key-agnostic, so any snapshot-included field validates the same code path.
- 7.8 used density toggle because it's the cleanest snapshot-included field with a direct button toggle — `memoryEnabled` lives behind a combobox dropdown. Runtime-policy / provider / density all feed the same `snapshotJson` computed in the barrel's `useMemo`.
- React 18 StrictMode is enabled in dev mode; the previous mechanism's StrictMode double-invoke race is no longer observable.

## Post-/simplify re-verification

After moving `captureVersion` ownership from the barrel into `useSettingsDirtyTracking` (renamed callback `bumpLoadCaptureVersion` → `markLoaded`), the core dirty-tracking behavior was re-verified on a fresh `pnpm dev` instance with cleared vite cache:

- First-open with cleared localStorage → Save button GREY/disabled (`opacity-50 cursor-not-allowed bg-white/10 text-slate-500`), `hasUnsavedChanges = false`. ✓
- Edit any provider field → Save BLUE/enabled (`bg-cyan-500 hover:bg-cyan-400 text-white`). ✓
- Revert the edit → Save back to GREY (snapshot equality restored). ✓

No regression from the refactor. Barrel is simpler (no `useState` / `useCallback` imports, no `captureVersion` state leak to the orchestrator — barrel just wires `markLoaded: dirty.markLoaded`).
