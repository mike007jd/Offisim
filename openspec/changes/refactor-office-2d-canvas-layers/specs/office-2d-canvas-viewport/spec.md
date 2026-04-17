## ADDED Requirements

### Requirement: Canvas rendering is split into ordered layer modules

The 2D canvas draw pipeline SHALL be split into one module per visual layer in `packages/ui-office/src/components/scene/canvas-layers/`:

- `draw-background.ts` — canvas clear + floor grid
- `draw-zones.ts` — zone fill, stroke, and label
- `draw-prefabs.ts` — prefab silhouettes via the render registry
- `draw-employees.ts` — desk backgrounds, avatar circle, status ring, status dot, name label
- `draw-ceremony.ts` — phase color overlay, meeting bubble, waiting relationships
- `draw-interactions.ts` — hover / selection / interaction hold indicators
- `draw-drag-overlay.ts` — drag preview and snap guides

Each layer SHALL export a single top-level draw function with the signature `drawX(ctx: CanvasRenderingContext2D, snapshot: SceneSnapshot, frame: FrameContext): void` where `SceneSnapshot` carries the stable per-scene data (zones / prefabs / employees / ceremony / manager marker / meeting bubble) and `FrameContext` carries per-frame transient data (interaction state, animation time, canvas size, viewport transform). No layer SHALL import another layer.

#### Scenario: One file per layer
- **WHEN** listing `packages/ui-office/src/components/scene/canvas-layers/*.ts`
- **THEN** exactly these 7 files exist: `draw-background.ts`, `draw-zones.ts`, `draw-prefabs.ts`, `draw-employees.ts`, `draw-ceremony.ts`, `draw-interactions.ts`, `draw-drag-overlay.ts`

#### Scenario: No cross-layer imports
- **WHEN** grepping `canvas-layers/*.ts` for `from '\\./draw-`
- **THEN** zero matches exist — layers are peers, not layered

#### Scenario: Renderer orchestrator is thin
- **WHEN** `grep -cvE '^\s*(//|$|/\*|\*)' packages/ui-office/src/components/scene/office-2d-canvas-renderer.ts` is run after refactor
- **THEN** the non-blank, non-comment line count is at most 200, and the `drawScene(ctx, snapshot, frame)` body consists of sequential calls to the 7 layer functions in back-to-front order

### Requirement: 2D canvas view is split into single-responsibility hooks

The `Office2DCanvasView` component SHALL delegate viewport / redraw-loop / pointer-interaction responsibilities to three hooks in `packages/ui-office/src/components/scene/hooks/`:

- `useCanvasViewport.ts` — pan / zoom / transform matrix ownership
- `useCanvasRedrawLoop.ts` — `needsRedraw` ref + single rAF loop + `drawScene` invocation
- `useCanvasInteraction.ts` — pointer events → hit test → select / drag callbacks

`Office2DCanvasView.tsx` SHALL be a thin composition barrel of no more than 250 non-blank, non-comment lines, doing only: scene snapshot construction (via existing context hooks), canvas ref mounting, three view hook calls, `<canvas>` + text overlay JSX. Inline pan / zoom / rAF / pointer logic SHALL NOT live in the barrel.

#### Scenario: Barrel size gate
- **WHEN** `grep -cvE '^\s*(//|$|/\*|\*)' packages/ui-office/src/components/scene/Office2DCanvasView.tsx` is run after refactor
- **THEN** the non-blank, non-comment line count is at most 250

#### Scenario: One file per view hook
- **WHEN** listing `packages/ui-office/src/components/scene/hooks/*.ts`
- **THEN** exactly these 3 files exist: `useCanvasViewport.ts`, `useCanvasRedrawLoop.ts`, `useCanvasInteraction.ts`

#### Scenario: No inline rAF or pointer logic in barrel
- **WHEN** grepping `Office2DCanvasView.tsx` for `requestAnimationFrame\(` or `\baddEventListener\(['"](pointer|mouse|wheel)`
- **THEN** zero matches exist — all rAF and pointer wiring live in the view hooks

### Requirement: 2D canvas observable rendering is unchanged after layer refactor

For identical scene snapshot input (same zones, prefabs, employees, ceremony phase, transform), the resulting canvas pixel output SHALL be byte-identical before and after the layer refactor. Pan / zoom / pointer interaction behavior SHALL remain identical.

#### Scenario: Ceremony phase visual fidelity
- **WHEN** a ceremony runs through `gathering → analyzing → planning → dispatching → working → reporting → dismissing` with the same agents and zones
- **THEN** the 2D canvas renders each phase with the same colors, bubble positions, and employee positions as pre-refactor

#### Scenario: Pan / zoom interaction parity
- **WHEN** the user pans or zooms the canvas via wheel / drag
- **THEN** the viewport transform updates at the same rate and reaches the same end state as pre-refactor

#### Scenario: Employee click hit test parity
- **WHEN** the user clicks on an employee node at canvas coordinates that previously selected that employee
- **THEN** the same employee is selected post-refactor
