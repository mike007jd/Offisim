# Offisim Studio Editor Design Rules

> **When to use:** Any work touching Studio editor components (`packages/ui-office/src/components/studio/`), 3D scene editing, prefab placement, selection systems, or editor UI panels.

This skill codifies game engine editor conventions. Every rule comes from established patterns in Unity, Godot, Blender, Cities: Skylines, Factorio, and similar tools. **Do not deviate from these rules without explicit user approval.**

---

## 1. Placement System

### Ghost Preview
- Ghost follows mouse cursor via floor-plane raycast
- **Opacity: 0.4** — clone materials on mount, don't modify originals
- **Green tint** (`#22c55e`) for valid placement
- **Red tint** (`#ef4444`) for invalid/overlapping placement
- Material tint applied via cloned material color, not per-frame traversal
- Ghost disappears on right-click or Escape

### Ground Footprint
- **MUST be larger than the 3D mesh** — standard: 10-20% larger
- Scale: `gridSize * 2.5` 3D units per grid unit (derived from workstation: desk=3.2u, gridSize=2)
- Rendered as **filled plane** (opacity 0.15) + **wireframe border** (opacity 0.8)
- Both positioned at **y=0.02** (just above ground, never intersecting the mesh)
- Color matches ghost tint (green valid / red blocked)
- Wireframe rotation: `-Math.PI/2` on X to lay flat on XZ plane (PlaneGeometry defaults to XY)

### Collision Detection
- **AABB overlap** on XZ plane, using `gridSize` as collision bounds
- Each grid unit = 1 collision unit, collision half-size = `gridSize * 0.9` (slight margin for edge-touching)
- For rotated prefabs (90/270): swap width/depth before AABB test
- **Block placement** if overlap detected — click does nothing, footprint stays red
- Future: Grid Occupancy Map (`Map<"x,z", instanceId>`) for O(1) lookup

### Snap
- Grid snap size: **0.5 units** (configurable via toggle)
- Snap function: `Math.round(v / snapSize) * snapSize`
- Position clamped to plot boundary: `Math.max(-halfW, Math.min(halfW, x))`
- Rotation snap: **90 degrees** only (0/90/180/270)

### Placement Success Feedback
- Brief scale animation: 1.0 → 1.05 → 1.0, 200ms ease-out
- Stay in placement mode after placing (quick multi-place)
- Right-click or Escape to exit placement mode

---

## 2. Selection System

### Click Selection
- `e.stopPropagation()` on every clickable 3D group — prevents event pass-through to objects behind
- `onPointerMissed` on Canvas — deselect all (click empty space)
- Only allow selection when tool is 'select', 'move', or 'rotate'

### Visual Feedback
- **Selection ring**: flat on ground (y=0.02), indigo color (`#6366f1`), opacity 0.6-0.7, pulsing
- **Hover**: cursor changes to 'pointer' (via `document.body.style.cursor`)
- **Size label**: HTML overlay showing `NxN` grid size on every placed object

### TransformControls
- **Conditional mount**: only render `<TransformControls>` when a target object exists (drei crashes on null object ref)
- `<OrbitControls makeDefault />` — drei auto-disables orbit during TC drag
- **Translate mode**: `translationSnap={0.5}`, `showY={false}` (lock Y axis)
- **Rotate mode**: `rotationSnap={Math.PI / 2}` (90 degree steps)
- On transform change: read world position, update Zustand store, call `invalidate()`
- Wrap TC target in `React.memo` to prevent flicker (drei #2226)

---

## 3. Keyboard Shortcuts

Industry standard (matches Unity/Unreal/Godot):

| Key | Action | Notes |
|-----|--------|-------|
| Q | Select tool | |
| W | Move tool | Guard: `!e.metaKey && !e.ctrlKey` |
| E | Rotate tool | |
| P | Place tool | (not R — R is rotate selected) |
| R | Rotate selected +90 | |
| F | Focus on selected | Smooth camera animation to selected object |
| Delete / Backspace | Delete selected | |
| Escape | Cancel placement / deselect | Placement first, then deselect |
| Ctrl+S / Cmd+S | Save | `e.preventDefault()` to block browser save |
| Ctrl+Z | Undo | (when implemented) |
| Ctrl+Shift+Z / Ctrl+Y | Redo | (when implemented) |
| Ctrl+D | Duplicate selected | (when implemented) |
| G | Toggle grid snap | |

**Guard**: skip all shortcuts if `e.target instanceof HTMLInputElement || HTMLTextAreaElement`

---

## 4. Camera

- **OrbitControls** with `makeDefault`
- `maxPolarAngle={Math.PI / 2.1}` — prevent looking from below ground
- `minDistance={5}`, `maxDistance={plotSize * 2}`
- **F key (Focus)**: animate camera to look at selected object's position
- **Home**: reset to default perspective view `[20, 20, 20]`
- Target constant: use `const ORIGIN = [0,0,0] as const` (avoid re-creating array)

---

## 5. Grid & Plot

### Grid
- Use drei `<Grid infiniteGrid />` — not manual GridHelper
- `cellSize={0.5}` (matches snap), `sectionSize={2}` (major grid every 2 units)
- `fadeDistance` scales with plot size: `max(plotSize.width, plotSize.depth) * 1.5`
- Grid at `y=-0.01` (slightly below ground to avoid z-fighting)

### Plot Boundary
- Wireframe box using `EdgesGeometry` + `BoxGeometry`
- `useMemo` on geometry — **never create THREE objects inline in JSX**
- Color: indigo (`#6366f1`), opacity 0.6
- Position at `y=0.01`

### Plot Sizes
| Name | Width x Depth | Capacity |
|------|--------------|----------|
| Small Studio | 20 x 15 | 1-4 |
| Standard Office | 40 x 30 | 5-15 |
| Large Office | 60 x 45 | 16-40 |
| Campus | 80 x 60 | 40-100 |

---

## 6. Coordinate System

- **Three.js**: Y-up. XZ is ground plane. Y=0 is floor level.
- **DB**: `position_x` = Three.js X, `position_y` = Three.js Z (only 2 columns)
- **Load**: `[row.position_x, 0, row.position_y]`
- **Save**: `position_x = pos[0], position_y = pos[2]`
- Precision: `parseFloat(value.toFixed(4))` when saving

---

## 7. Performance Rules

### Critical
- **Never `setState` in `useFrame`** — causes TransformControls flicker (drei #2226)
- **Never create `new Vector3/Matrix4/Color` in `useFrame`** — pre-allocate at module scope
- **Never conditionally render `<TransformControls>`** based on React state changes inside Canvas — mount once, toggle via `enabled` prop. Exception: mount/unmount based on whether any object is selected is OK.
- Ghost position update via `ref.current.position.copy()`, not React state

### Rendering
- `frameloop="demand"` for static editor scenes
- `InvalidateBridge` component subscribes to Zustand store and calls `invalidate()` on any change
- Use `visible` prop to hide/show 3D elements (not conditional rendering — avoids material recompilation)

### Materials
- Clone materials for ghost/preview — never modify shared material instances
- Clone on mount in `useEffect`, dispose in cleanup return
- Share geometry instances across same-type prefabs (`useMemo` or module-level constants)

---

## 8. UI Layout

```
+--------------------------------------------------+
|  Toolbar (44px, top)                              |
+--------+----------------------------+------------+
| Palette | Canvas (center, flex)     | Properties |
| (240px) | R3F scene                 | (240px)    |
| left    |                           | right      |
+--------+----------------------------+------------+
|  Bottom Bar (40px, plot selector)                 |
+--------------------------------------------------+
```

### Panel Rules
- Background: `rgba(15, 15, 26, 0.97)` (surface0 from studio-tokens)
- Border: `1px solid #2a2a3d`
- All colors from `studio-tokens.ts` — zero hardcoded values in components
- 4px grid spacing: 4, 8, 12, 16, 20, 24, 32
- Font: Inter for UI, JetBrains Mono for numbers/coordinates
- Font sizes: xs=9, sm=10, base=11, md=12, lg=13, xl=14

### Toolbar
- Icon-only buttons with `<kbd>` shortcut badges
- Lucide React icons (16-20px)
- Active state: indigo muted background
- All buttons need `aria-label`

### Asset Browser (Palette)
- 2-column grid of SVG thumbnail cards
- Each card: `PrefabThumbnail` (32px SVG plan view) + name (8px, 2-line wrap)
- Categories: collapsible sections with Lucide category icons
- Category colors from tokens (`catWorkspace`, `catCompute`, etc.)

### Properties Panel
- Always rendered (empty state when nothing selected: icon + "Select an object" message)
- Label/value layout: labels uppercase 9px, values 12px monospace
- Position shows X (red) and Z (blue)
- Rotation: icon button with `RotateCw`
- Delete: red button with `Trash2`

---

## 9. Save System

### Create Mode (new company)
- Modal dialog for company name (not `window.prompt()`)
- Generate `company_id` via `crypto.randomUUID()`
- Create company row, office layout row, batch prefab instances
- Coordinate mapping: Three.js X → `position_x`, Three.js Z → `position_y`

### Edit Mode (existing company)
- `deleteByCompany()` then batch create (full replace)
- Show save toast (green flash, 2s timeout)
- Stay on page after save (don't navigate away)

### Unsaved Changes
- `dirty` flag in Zustand store
- Save button disabled when not dirty
- Confirm dialog on back/exit if dirty (future)

---

## 10. Hover Feedback

- `onPointerOver`: set mesh `emissive` to `#ffffff`, `emissiveIntensity: 0.08`
- `onPointerOut`: reset `emissiveIntensity` to `0`
- Cursor: `'pointer'` via `gl.domElement.style.cursor`
- No delay — instant response
- Only when tool is 'select', 'move', or 'rotate' (not during placement)

---

## 11. Ghost Material Strategy

**Do NOT clone original materials and modify opacity.** Use a fresh simple material:

```
MeshStandardMaterial({
  color: isValid ? '#00ff88' : '#ff4444',
  emissive: isValid ? '#00ff88' : '#ff4444',
  emissiveIntensity: 0.6,
  transparent: true,
  opacity: isValid ? 0.4 : 0.35,
  depthWrite: false,
  side: DoubleSide,
})
```

Apply on mount via `useEffect` — traverse children, replace each mesh's material with the ghost material. Dispose in cleanup.

---

## 12. Raycaster & Layers

| Layer | Purpose |
|-------|---------|
| 0 | Selectable prefab meshes |
| 1 | Ghost / footprint (not pickable) |
| 2 | Gizmo (not pickable) |
| 3 | Grid / helpers (not pickable) |

- Ground plane raycast: `new THREE.Plane(new Vector3(0, 1, 0), 0)`
- Object picking: `raycaster.intersectObjects(selectableGroup.children, true)`
- Always take `intersects[0]`, walk up `.parent` to find the top-level prefab group

---

## 13. Status Bar

- Height: 28px, bottom of editor
- Content: left = selection info ("3 objects selected"), center = mouse coordinates ("X: 12.0  Z: 8.5"), right = grid/snap status
- Font: 11px monospace
- Background: `rgba(15, 23, 42, 0.9)`

---

## 14. Animation Timings

| Action | Animation | Duration | Easing |
|--------|-----------|----------|--------|
| Place success | scale 1.0→1.08→1.0, opacity 0.5→1.0 | 250ms | easeOutBack |
| Delete | scale 1.0→1.05→0.0, opacity→0 | 200ms | easeInBack |
| Focus (F key) | camera smooth fly to target | 500ms | easeInOutCubic |
| Camera reset (Home) | camera fly to default | 400ms | easeInOutCubic |
| Save toast enter | slide from right | 200ms | easeOut |
| Save toast exit | fade right | 150ms | easeIn |
| Button hover | background transition | 100ms | ease-out |
| Panel expand/collapse | height transition | 150ms | ease-out |

---

## 15. Unsaved Changes

- Dirty indicator: amber dot (6px, `#f59e0b`) on Save button
- `dirty = true` after any prefab add/delete/move/rotate
- `dirty = false` after save
- `beforeunload` event warns user if dirty

---

## 16. Anti-Patterns (Do NOT Do)

| Anti-Pattern | Why | Do Instead |
|-------------|-----|-----------|
| Emoji in UI | Unprofessional, inconsistent rendering | Lucide icons or SVG |
| `window.prompt()` | Breaks visual flow, can't style | Inline modal dialog |
| Hardcoded hex colors in components | Can't theme, hard to maintain | Import from `studio-tokens.ts` |
| `new THREE.Geometry()` in JSX args | Memory leak on re-render | `useMemo` |
| Footprint smaller than mesh | Looks broken, user can't see it | Footprint = mesh bounds * 1.2 |
| Footprint intersecting mesh | Looks like a bug | `y=0.02` (above ground, below mesh) |
| `setState` in `useFrame` | React re-render every frame = flicker | Use refs or Zustand `getState()` |
| Conditional `<TransformControls>` mount/unmount | Material recompilation cost | Use `enabled` prop (exception: mount/unmount based on selection existence is OK) |
| Opacity 0.08 for visual indicators | Invisible to users | Minimum 0.15 for fills, 0.6 for lines |
| Cloning original materials for ghost | Texture/normal map interference | Use fresh simple MeshStandardMaterial |
| Free rotation (arbitrary degrees) | Breaks grid alignment and collision | 90-degree steps only (0/90/180/270) |
| Scale tool on prefabs | Breaks footprint and collision detection | Disable scale — different sizes = different prefabs |
| No hover feedback | User doesn't know what's interactive | emissive highlight + cursor pointer |
| Lerp/smooth ghost movement | Placement must feel precise and instant | Direct position.copy() with snap |
