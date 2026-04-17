# Live verify notes — refactor-office-2d-canvas-layers

Date: 2026-04-17
Env: `pnpm dev` (web only) on `localhost:5176`, dpr=2 (CSS 1920×838 → backing 3840×1676)

## 8.1 Dev server / default company 2D view

- Landed on `http://localhost:5176/`, workspace = office, clicked "Switch to 2D office map"
- SR-only tree reveals `image "2D office layout"` + 8 employee buttons + "Deselect office scene" button. Canvas accessible role wired.
- Screenshot: `/tmp/2d-canvas-post-refactor-idle.png` — full office visible, zones (LOUNGE, dept cells), prefabs, 8 idle employees at rest+desks.
- `canvas.getContext('2d').getImageData(center)` → `[21, 19, 28, 255]` (expected dark zone fill). Canvas not blank.

## 8.2 Ceremony phase visuals

- Dismissed first-run tooltip, sent `"Write a one-sentence tagline for a coffee shop"`.
- Pipeline stage advanced: `ANALYZING` (observed via status bar). Boss reasoned 5s. Screenshot `/tmp/2d-canvas-ceremony-analyzing.png` — active employees show outer colored status-ring glow (purple / green tint around Alex / Kai / Sophie etc), zone layout preserved.
- Boss decided `direct_reply` → Jamie Reeves produced deliverable `"Where every cup sparks your best morning."` → ceremony naturally returned to idle. `LAT: 15.0s`, `$0.0057`.
- No UI glitch between phases. Meeting bubble + manager marker draw paths exercised via ceremony-active → idle transition (no inline state leak).

## 8.3 Pan / zoom

- Wheel zoom-in ×2 (deltaY=-150 at center) — zone labels get larger; `/tmp/2d-canvas-zoomed-in.png` shows LOUNGE label visibly larger than baseline.
- Drag pan 150/100 px from inner area (non-employee) — scene translates as expected. `/tmp/2d-canvas-panned.png`. No cursor state leak (cursor flips to default after pointerup).
- No `requestAnimationFrame`/pointer listeners registered from barrel (grep zero matches), all wired via `useCanvasViewport` + `useCanvasInteraction` hooks.

## 8.4 Employee select / hover

- Clicked `[aria-label="Alex Chen employee node"]` (sr-only button) → `aria-pressed` flipped `false → true`, BUDDY IMPACT card appeared, right rail switched to "Chat with Alex Chen" direct thread. `/tmp/2d-canvas-selected.png`.
- Confirms: `scene.employee.selected` event emitted through eventBus, `onSelectEmployee` prop → parent state → `externalSelectedId` prop → `interactionRef.current.selectedEmployeeId` → next redraw via `draw-interactions.ts` draws halo ring.

## 8.5 Runtime health

- Console `error` filter across the whole run: empty.
- Only `warn` message during session: unrelated `MemoryDeliverableRepository contentLoader unavailable` (pre-existing seed-data noise, not scene-related).
- Static gates confirmed outside browser:
  - `canvas-layers/*.ts` count = 7 (exact)
  - `hooks/*.ts` count = 3 (exact)
  - `office-2d-canvas-renderer.ts` NBNC = 132 ≤ 200
  - `Office2DCanvasView.tsx` NBNC = 173 ≤ 250
  - `grep 'from .\\/draw-' canvas-layers/*.ts` = 0 (no cross-layer import)
  - `grep 'requestAnimationFrame|addEventListener(['\"](pointer|mouse|wheel)' Office2DCanvasView.tsx` = 0

## Observed visual diff vs baseline

- None detected in manual inspection. The selection halo / hover rings now draw in a dedicated `draw-interactions.ts` pass after `draw-employees` instead of inline-per-node, so in the extreme case of two employees' circles overlapping with a halo the pixel order shifts. Not observed with 8 well-spaced employees.
