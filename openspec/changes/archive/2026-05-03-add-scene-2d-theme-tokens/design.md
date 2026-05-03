## Context

The 2D office canvas pipeline lives in `packages/ui-office/src/components/scene/`:

- `Office2DCanvasView.tsx` — barrel composition (≤ 250 LOC per `office-2d-canvas-viewport` spec)
- `office-2d-canvas-renderer.ts` — thin orchestrator (≤ 200 non-comment LOC) calling 7 layer fns in back-to-front order; also re-exports `STATUS_COLORS`
- `canvas-layers/draw-{background,zones,prefabs,employees,ceremony,interactions,drag-overlay}.ts` — one per layer, no cross-imports
- `canvas-primitives.ts` — pure ctx draw helpers shared by layers (`drawRoundedRect`, `drawAvatarCircle`, `drawNamePill`)
- `office-2d-render-registry.ts` — prefab category → draw-fn map
- `hooks/useCanvasRedrawLoop.ts` — single rAF loop, redraws when `needsRedrawRef.current === true`

All 11 files currently carry a `// raw-hex-allowed-file: asset renderer palette; non-design-token content colors.` header that opts them out of `pnpm tokens:lint-hex`. They contain ~30 hex / rgba literals between them, all dark-tuned. Theme switch flips `useTheme().resolvedTheme` and the React tree re-renders, but the canvas paint loop never sees the change because:

1. The 7 layer fns + the 3 helpers do not consume `useSceneColors()` — they have hard-coded hex literals.
2. The barrel `Office2DCanvasView.tsx` does subscribe to scene snapshot but not to theme.

3D scene tokens are already plumbed through `useSceneColors()` → `Scene3DColors` → `LIGHT_SCENE_3D` / `DARK_SCENE_3D`, governed by `design-token-foundation` capability. `Scene3DColors` is named for legacy reasons; the spec already states it covers "3D scene colors" but in practice it is the canonical scene-rendering palette regardless of dimensionality. We extend it rather than introduce a parallel `SceneCanvas2DColors` interface to avoid splintering the SSOT.

The 2D canvas redraws only when `needsRedrawRef.current === true`. We need theme flips to dirty that ref so the next rAF frame uses the new palette.

## Goals / Non-Goals

**Goals:**
- Every color literal in the 11 listed 2D canvas files is sourced from `Scene3DColors` (via `useSceneColors()` for React-mounted code, via a `palette` parameter for pure helpers).
- `LIGHT_SCENE_3D` and `DARK_SCENE_3D` are byte-equivalent on existing fields; new 2D-canvas-only fields are added with both light and dark values.
- `pnpm tokens:lint-hex` exits 0 on the 11 files **without** `raw-hex-allowed-file` exemption headers.
- Switching theme (`light` ↔ `dark` ↔ `system`) reflects in the 2D canvas within one rAF frame (≤ 16 ms typical, ≤ 50 ms worst-case under `MOTION_DURATION.instant`).
- Live verify on Tauri release `.app`: 2D scene background, grid, employee desks/avatars/labels, manager marker, meeting bubble, drag ghost, selection ring, prefab silhouettes, state badges all read correctly in light + dark + system themes.

**Non-Goals:**
- Re-skin the 2D canvas with a fundamentally new visual language. Light values match the existing 3D light palette spirit (`floor`, `floorTile`, `wallPanel`, `text` already light-tuned); dark values stay byte-equivalent to today's hard-coded hex.
- Migrate Studio canvas, ZoneCanvas, PrefabThumbnail, company-creation-wizard-preview (separate `raw-hex-allowed-file` files outside the 2D office scope).
- Migrate 3D scene files (`office3d-*.tsx`) — they already consume `useSceneColors()`; their `raw-hex-allowed-file` header covers prefab-mesh detail palettes that are a separate concern.
- Migrate `STATE_COLORS_LIGHT` / `STATE_COLORS_DARK` consumption changes in 2D — the existing `STATUS_COLORS: Record<string, string>` map in `office-2d-canvas-renderer.ts` (used by `getStatusColor`) is a separate `EmployeeState` color mapping and stays in scope of this change but is sourced from existing `STATE_COLORS_LIGHT/DARK` (numeric) re-projected to hex strings.
- Add new test surfaces. Validation = live verify per project Validation Policy.

## Decisions

### Decision 1: Extend `Scene3DColors` rather than create `Scene2DColors`

Adding 2D-only fields to `Scene3DColors` keeps token plumbing single-rooted. The interface name is mildly misleading but renaming would touch ~80 call sites for cosmetic reasons. We prefer interface extension + comment grouping (a `// 2D canvas-only fields` block).

**Alternatives considered:**
- Create `colors-scene-2d.ts` leaf module with `Scene2DColors` interface. Rejected: the design-token-foundation spec lists 11 token files exactly; adding a 12th requires modifying that spec further and adds a parallel `useScene2DColors()` hook that consumers would have to wire next to `useSceneColors()`.
- Rename `Scene3DColors` to `SceneColors`. Rejected: ~80 import-site rename surface for zero behavior change.

### Decision 2: Pure helpers take a `palette` parameter; React-mounted code uses `useSceneColors()`

`canvas-primitives.ts` (`drawRoundedRect` / `drawAvatarCircle` / `drawNamePill`), `office-2d-canvas-renderer.ts` (the orchestrator + `STATUS_COLORS`-equivalent helpers), and the 7 layer fns are pure (`(ctx, snapshot, frame) => void`). They cannot call hooks. We extend the `FrameContext` interface (already exists, carries `interaction` / `animationTime` / `canvasSize` / `transform`) with `palette: SceneCanvasPalette` and the React caller (the canvas redraw loop) supplies it from `useSceneColors()`.

`SceneCanvasPalette` is `Pick<Scene3DColors, …>` — only the fields actually used by 2D layers — to make the contract explicit and avoid bloating the helper signatures.

**Alternatives considered:**
- Module-level `let palette: SceneCanvasPalette | null = null` mutated by the React mount. Rejected: violates pure-helper boundary, makes test mocking implicit.
- Each helper imports a `useSceneColors()`-derived module singleton. Rejected: `useSceneColors()` is a hook, not callable outside React.
- Bake light + dark palettes into the helpers and pass `theme: 'light' | 'dark'`. Rejected: the orchestrator already gets `useSceneColors()` once per redraw; passing the resolved palette is one allocation cheaper and avoids two-tier theme branching inside leaf code.

### Decision 3: Redraw on theme change

`useCanvasRedrawLoop` adds a `useEffect` watching `resolvedTheme` (read via `useTheme()` since it is the existing SSOT) — when it changes, set `needsRedrawRef.current = true`. The next rAF tick uses the fresh palette and re-rasters.

**Alternatives considered:**
- Subscribe each layer to its own theme ref. Rejected: layers are leaf, the redraw loop is the choke point.
- Tear down + rebuild the canvas element on theme change. Rejected: heavyweight, loses pan / zoom state.

### Decision 4: New tokens cover today's hex literals 1:1, no new visual semantics

Every hard-coded literal becomes one named field. We do not collapse multiple literals into a single token unless they are visibly identical (e.g., the four `'#1e293b'` occurrences across `drawAvatarCircle.bgFill`, `drawNamePill` background, and `drawEmployeeNode` dot ring stroke all become `pillBg` because they target the same visual concept of a "deep slate base"). Where today's literal is theme-incorrect for light mode (e.g., `'rgba(0, 0, 0, 0.65)'` meeting bubble bg → unreadable on light surface), we pick a light variant that mirrors the dark intent (e.g., `'rgba(248, 250, 252, 0.85)'` zone-label-bg pattern already in `LIGHT_SCENE_3D`).

The exact light values are documented in tasks.md so each one is explicit, not derived.

### Decision 5: Studio / Zone / Wizard canvases are out of scope

`StudioCanvas.tsx`, `StudioZoneGhost.tsx`, `PrefabThumbnail.tsx`, `ZoneCanvas.tsx`, `company-creation-wizard-preview.tsx`, `office3d-*.tsx` keep their `raw-hex-allowed-file` headers in this change. They are separate visual surfaces with their own design rationale and a separate change can re-do them. Bucket 2a is "2D 浅色" — the live-verified gap is the office 2D scene specifically.

`design-token-foundation` spec change leaves these files' `raw-hex-allowed-file` exemption intact; we only narrow the gate for the 11 office-2d files.

## Risks / Trade-offs

- **Risk**: Extending `Scene3DColors` adds ~30 fields, increasing the surface area of the design-token-foundation spec's "byte-equivalence" requirement. **Mitigation**: dark values for the 30 new fields are byte-equivalent to today's hard-coded literals; the spec text says "Legacy `DARK_SCENE_3D` fields that existed before the 3D art-direction pass SHALL remain byte-equivalent" — that legacy clause is preserved verbatim. New fields explicitly do not claim byte-equivalence (they did not exist before).
- **Risk**: The pure-helper `palette` param adds a parameter to functions called many times per frame; theoretical perf impact. **Mitigation**: `palette` is one object reference per `drawScene` call (~60/sec), passed through the existing `FrameContext` struct that already gets allocated per frame. No measurable cost.
- **Risk**: Theme switch happens mid-frame and the canvas paints with stale palette for one frame. **Mitigation**: acceptable — the `useEffect` redraw trigger fires synchronously after React commits the theme change, the next rAF picks it up. Worst-case ~16 ms stale frame on a 60 Hz display, below human perceptual threshold for color flips.
- **Trade-off**: Layer fns now require `frame.palette` to be populated — `FrameContext` becomes non-optional in this slot. **Mitigation**: orchestrator is the only caller; we bind `palette` at the top of `drawScene` and propagate. No new public API.
- **Trade-off**: Light theme values are designer-picked here, not externally validated. **Mitigation**: live verify includes side-by-side dark vs light rendering of all ceremony phases + drag interactions + state badges + selection / hover.

## Migration Plan

Single PR; no migration steps because no DB, no API, no public type surface changes.

1. Land `Scene3DColors` + `LIGHT_SCENE_3D` + `DARK_SCENE_3D` extensions in `packages/ui-core/src/tokens/colors-3d.ts`. Build `@offisim/ui-core` so `@offisim/ui-office` picks up the new types.
2. Land `FrameContext.palette` extension in `office-2d-canvas-renderer.ts`. Update orchestrator `drawScene` to populate it. Update `canvas-primitives.ts` and the 7 layer fns to consume `frame.palette` (or `palette` parameter for primitives) instead of hard-coded literals.
3. Land theme-change redraw trigger in `useCanvasRedrawLoop.ts`.
4. Remove `raw-hex-allowed-file` headers from the 11 files. Re-run `pnpm tokens:lint-hex` — must exit 0.
5. Live verify on Tauri release `.app`: switch theme during a ceremony run; verify all 7 ceremony phases render correctly in both themes; pan / zoom / drag-to-zone / selection / hover all preserve theme correctness.

No rollback strategy required — purely cosmetic, no data side effects. Revert via `git revert` if visual regression is found.

## Open Questions

- None blocking. The exact light-mode values for the 30 new tokens are documented in tasks.md and reviewed at apply time against live verify.
