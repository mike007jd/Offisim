# office-2d-canvas-viewport Specification

## Purpose

2D 办公室 canvas 的视口初始化与响应式尺寸管理。保证 fit viewport 用稳定 container 尺寸；保证 `drawScene` pipeline 把 `ROOM_W × ROOM_H` 世界坐标正确映射到 canvas 的完整 backing-store 像素空间，含 dpr 补偿；保留 pan / zoom 交互。
## Requirements
### Requirement: 2D canvas fills its container on first visible frame
When `Office2DCanvasView` becomes visible (its `hasMounted2D` parent state transitions to `true` and the `absolute inset-0` container reaches `opacity-100`), the Canvas element SHALL fill the container's full width and height, and the rendered scene SHALL cover `FIT_MARGIN * min(containerWidth/ROOM_W, containerHeight/ROOM_H)` of that container within the first 500 ms.

#### Scenario: 3D → 2D switch
- **WHEN** the user clicks "2D" while on Office workspace with `viewMode='3D'`
- **THEN** within 500 ms the canvas element fills its container (`canvas.width / devicePixelRatio === container.clientWidth` and `canvas.height / devicePixelRatio === container.clientHeight`)
- **AND** the rendered office scene is framed so that `ROOM_W × ROOM_H` (2000 × 1500 internal units) occupies approximately `FIT_MARGIN` of the available container space, centered

### Requirement: Initial fit happens exactly once per mount
`Office2DCanvasView` SHALL run `computeFitViewport` exactly once per component mount, during the first `ResizeObserver` callback. All subsequent `ResizeObserver` callbacks SHALL run `preserveViewportOnResize` so that user pan / zoom state survives window resizes.

#### Scenario: First observer entry triggers fit
- **WHEN** `ResizeObserver` fires its first callback after `observer.observe(container)`
- **THEN** `viewportRef.current` is computed via `computeFitViewport(contentRect.width, contentRect.height)`

#### Scenario: Later observer entries preserve pan/zoom
- **WHEN** the user pans the 2D canvas, then the window is resized (triggering a subsequent `ResizeObserver` callback)
- **THEN** the new `viewportRef.current` is computed via `preserveViewportOnResize`, retaining the user's zoom level and centering the previously centered world point

### Requirement: No pre-observer sizing read
`Office2DCanvasView` SHALL NOT call `container.getBoundingClientRect()` before `ResizeObserver` has fired its first callback for initial sizing purposes. The two previous independent initial-sizing paths (the standalone `useEffect([])` reading rect, and the ResizeObserver effect's manual rect read after `observer.observe`) SHALL be consolidated into the single observer-callback path.

#### Scenario: No duplicate initial sizing
- **WHEN** `Office2DCanvasView` mounts
- **THEN** a code scan of the component SHALL find zero `getBoundingClientRect()` calls that write `viewportRef` or `canvas.width` / `canvas.height` outside the `ResizeObserver` callback (interaction handlers like pan / wheel / click MAY still call `getBoundingClientRect` — those are for pointer math, not sizing)

### Requirement: 3D ↔ 2D toggle does not regress sizing
Switching between 3D and 2D views multiple times SHALL NOT leave the 2D canvas in a smaller-than-container state.

#### Scenario: Repeated toggle
- **WHEN** the user toggles 3D → 2D → 3D → 2D → 3D → 2D (three round-trips)
- **THEN** every time the 2D view becomes visible, the canvas fills the container (measured as in "2D canvas fills its container on first visible frame")

### Requirement: Scene drawing respects devicePixelRatio
The 2D canvas renderer SHALL scale all drawing transforms by `devicePixelRatio` so that on a dpr=N display (N ≥ 1) the rendered scene covers the full `canvas.width × canvas.height` pixel space allocated by the view layer, not only the CSS-sized upper-left sub-region.

#### Scenario: Background fills entire canvas on Retina
- **WHEN** `drawScene` is called on a canvas whose CSS size is `W × H` and whose backing store is `W·dpr × H·dpr` (dpr=2 on Retina)
- **THEN** the background fill covers the entire `(W·dpr) × (H·dpr)` pixel rectangle (no transparent alpha=0 region in the bottom-right)

#### Scenario: Scene transform accounts for dpr
- **WHEN** the renderer applies the viewport transform for scene drawing after the background fill
- **THEN** the transform used SHALL be equivalent to `setTransform(dpr·viewport.scale, 0, 0, dpr·viewport.scale, dpr·viewport.x, dpr·viewport.y)` so that world coordinates `(0,0)` through `(ROOM_W, ROOM_H)` map onto the full-resolution canvas pixel space

#### Scenario: dpr=1 unchanged
- **WHEN** the renderer runs on a display with `window.devicePixelRatio === 1`
- **THEN** the output is pixel-identical to the pre-change renderer (dpr·x = x when dpr=1), i.e. this requirement MUST NOT regress non-Retina displays

### Requirement: Pan and zoom interactions preserved
The viewport-sizing fix SHALL NOT alter the behavior of pan (drag), zoom (wheel), or drag-and-drop in the 2D canvas.

#### Scenario: Pan still works
- **WHEN** the user drags the canvas with a pointer after the first fit
- **THEN** the viewport translates by the drag delta exactly as before this change

#### Scenario: Wheel zoom still works
- **WHEN** the user wheel-zooms on the canvas after the first fit
- **THEN** `applyWheelZoom` is applied as before, clamped to `[ZOOM_MIN, ZOOM_MAX]`, zooming toward the pointer

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

