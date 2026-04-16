## ADDED Requirements

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

### Requirement: Pan and zoom interactions preserved
The viewport-sizing fix SHALL NOT alter the behavior of pan (drag), zoom (wheel), or drag-and-drop in the 2D canvas.

#### Scenario: Pan still works
- **WHEN** the user drags the canvas with a pointer after the first fit
- **THEN** the viewport translates by the drag delta exactly as before this change

#### Scenario: Wheel zoom still works
- **WHEN** the user wheel-zooms on the canvas after the first fit
- **THEN** `applyWheelZoom` is applied as before, clamped to `[ZOOM_MIN, ZOOM_MAX]`, zooming toward the pointer
