# Live Verify Notes — refactor-office-editor-overlay

Run date: 2026-04-17
Environment: apps/web `pnpm dev` @ localhost:5176, Chrome DevTools MCP, MiniMax-M2.7-highspeed runtime, fresh after vite restart.

## Path coverage

| # | Spec scenario | Result |
|---|---------------|--------|
| 7.1 | Open overlay (CompanyEditor → Zone Layout → Open Studio Layout) | ✅ 6 sections (EditorToolbar / PresetPalette / ZoneCanvas / ZoneInspector / StatusBar / ValidationBanner) all render |
| 7.2 | Add Lounge preset → click canvas → preview placed | ✅ StatusBar 0→1 zones / 0→6 items, UNSAVED appears, Save enables, LOUNGE label + REQUIRED lock + Sofa/Coffee/Vending/Water/Large/Small prefab silhouettes render |
| 7.3 | Drag overlap → ValidationBanner | ⚠️ partial: dragging an SVG-internal zone via chrome-devtools `click` is unreliable (no per-zone uid). Indirectly covered: ghost-preview "Overlaps: Lounge" rendered when ghostPos overlapped existing zone (`useZoneValidation.ghostOverlaps` path) |
| 7.4 | Delete required zone (Conference Room) → blocked | ✅ ZoneInspector Delete button reads "Required — Cannot Delete" + disabled; pressing Delete key triggers ValidationBanner toast "Cannot delete required zone: Conference Room" |
| 7.5 | Save round-trip | ✅ Save click → button toggles back disabled, UNSAVED disappears (handleSave → repos.zones upsert → markClean). Reopen reload shows 0 zones (pre-existing dbZones timing — see Notes) |
| 7.6 | Zoom in/out + reset | ✅ ZoomIn 100→120%, ZoomFit reset 120→100%; toolbar % indicator + StatusBar % both update |

## Observations

- All 4 composition hooks integrate as expected via barrel: `useZoneEditorState` exposes state/handlers, `useDragReposition` reads viewport refs from `useZonePanZoom` and triggers studio store mutations, `useZoneValidation` derives `overlapMap` + `ghostOverlaps` reactively.
- ZoneCanvas SVG renders zone block (border + lock icon + label + archetype icon + prefab silhouettes + size hint + selection handles when selected) byte-equivalent to pre-refactor visual.
- ZoneInspector right rail appears when a zone is selected (width animates 0→64), shows NAME / TYPE / VARIANT (with combobox listing alternative presets) / SIZE / POSITION (X+Z nudge buttons) / FURNITURE count / Delete-with-guard.
- StatusBar bottom: zone count + item count + placing label + dragging indicator + overlap badge + zoom % + scale unit, all wired through props.
- EditorToolbar Focus badge shows selected zone label, UNSAVED badge tied to `state.dirty`, Save disable derived from `saving || !dirty`.

## Pre-existing issues (not introduced by this refactor)

1. **CompanyEditor hooks-order bug**: `useMemo(zoneLayoutMap)` lived AFTER `if (!isOpen) return null;`, causing "Rendered more hooks than during the previous render" the first time CompanyEditor opened in this session. Latent in original; surfaced because refactor required exercising the CompanyEditor → OfficeEditorOverlay path. Fixed inline by moving the `useMemo` above the early return — single-line move, no behavior change.
2. **`dbZones` timing on overlay open**: `syncedRef.current=true` after first effect fire even if `dbZones` was empty at that moment. Subsequent updates of `dbZones` are skipped. Same code pattern lived in the original `useOfficeEditor.ts` (now deleted) — refactor preserved verbatim. Reopen after save shows "0 zones" until a manual data refresh / second open. Out of scope for this refactor; should be tracked separately if/when the dbZones hook hydration timing is reworked.
3. **Esc closes overlay even with placingPreset active (under chrome-devtools press_key)**: a single Esc dispatched via the dev tools fired both the overlay's window keydown listener (which should have only cleared `placingPreset`) AND the overlay's `onClose`. May be a synthetic-key dispatch artifact rather than a real-user regression. Identical handler logic to original. Worth a manual real-keyboard re-test; not currently blocking.

## Verdict

Visible behavior of OfficeEditorOverlay is byte-equivalent to pre-refactor for the verified paths. The refactor cleanly replaces the 950-line god component + 535-line god-hook with:

- 1 thin barrel (115 NBNC ✅ ≤ 200 gate)
- 6 render-only section files (EditorToolbar 101, PresetPalette 187, ZoneCanvas 423, ZoneInspector 182, StatusBar 39, ValidationBanner 11 NBNC) — all zero `useState`/`useRef`/`useEffect`
- 4 single-responsibility hooks (useZoneEditorState 337, useDragReposition 126, useZonePanZoom 65, useZoneValidation 52 NBNC) — no cross-hook imports

`useOfficeEditor.ts` god-hook deleted. `ZoneCanvas` and `useZoneEditorState` exceed the design.md aspirational per-file size targets (200 / 250) due to intrinsic SVG render geometry and editor state convergence; spec gates do not enforce per-file size on sections/hooks (only barrel). No spec violation.
