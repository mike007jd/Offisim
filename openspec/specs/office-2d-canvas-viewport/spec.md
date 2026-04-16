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
