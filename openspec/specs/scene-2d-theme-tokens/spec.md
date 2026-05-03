# scene-2d-theme-tokens Specification

## Purpose

Defines the 2D office canvas theming contract: every color literal painted by the 2D canvas pipeline (background, grid, zones, prefabs, employees, ceremony, interactions, drag overlay) is sourced from the `Scene3DColors` SSOT via `useSceneColors()` (in React-mounted code) or via an explicit `palette` parameter (in pure helpers and the orchestrator), so theme switches re-render the 2D canvas within one rAF tick while preserving dark-mode visual continuity.

## Requirements
### Requirement: 2D office canvas color SSOT is `Scene3DColors` via `useSceneColors()`

Every color literal painted by the 2D office canvas pipeline (background, grid, zones, prefabs, employees, ceremony, interactions, drag-overlay) SHALL be sourced from a `Scene3DColors`-typed palette obtained via `useSceneColors()` (in React-mounted code) or via an explicit `palette: SceneCanvasPalette` parameter (in pure helpers and the orchestrator). No hex literal, `rgba(...)` literal, or `hsl(...)` literal SHALL appear inside the 2D canvas pipeline source files.

The 2D canvas pipeline files governed by this requirement are:

- `packages/ui-office/src/components/scene/Office2DCanvasView.tsx`
- `packages/ui-office/src/components/scene/office-2d-canvas-renderer.ts`
- `packages/ui-office/src/components/scene/office-2d-render-registry.ts`
- `packages/ui-office/src/components/scene/canvas-primitives.ts`
- `packages/ui-office/src/components/scene/canvas-layers/draw-background.ts`
- `packages/ui-office/src/components/scene/canvas-layers/draw-zones.ts`
- `packages/ui-office/src/components/scene/canvas-layers/draw-prefabs.ts`
- `packages/ui-office/src/components/scene/canvas-layers/draw-employees.ts`
- `packages/ui-office/src/components/scene/canvas-layers/draw-ceremony.ts`
- `packages/ui-office/src/components/scene/canvas-layers/draw-interactions.ts`
- `packages/ui-office/src/components/scene/canvas-layers/draw-drag-overlay.ts`

These files SHALL NOT carry the `// raw-hex-allowed-file:` exemption header. Snapshot data fields populated by upstream code (e.g., `ZoneRenderData.accentColor` produced from agent zone metadata, `EmployeeRenderData.statusColor` produced from `STATE_COLORS_*` token map) are exempt because they are token-derived data flowing through the snapshot, not literals in this file.

#### Scenario: All 11 files are exemption-free

- **WHEN** grepping the 11 listed files for the literal regex `^// raw-hex-allowed-file:`
- **THEN** zero matches exist

#### Scenario: Lint gate is clean without exemptions

- **WHEN** running `pnpm tokens:lint-hex`
- **THEN** the gate exits with code 0 and reports no violations from the 11 listed files

#### Scenario: Pure helpers receive palette by parameter

- **WHEN** reading the type signature of any function exported from `canvas-primitives.ts` or any layer fn signature in `canvas-layers/*.ts` that paints color
- **THEN** the function reads its colors from `frame.palette: SceneCanvasPalette` (layer fns) or from a `palette: SceneCanvasPalette` parameter (helpers) — not from a module-level constant or a hook

### Requirement: 2D canvas re-renders within one rAF frame on theme switch

When `useTheme().resolvedTheme` flips between `'light'` and `'dark'` (either via user action in the Settings tab or via system preference change while `theme === 'system'`), `useCanvasRedrawLoop` SHALL set `needsRedrawRef.current = true` so that the next animation frame paints the canvas with the updated palette. The redraw SHALL occur within a single rAF tick (typically ≤ 16 ms on a 60 Hz display, never more than `MOTION_DURATION.normal === 250 ms`).

#### Scenario: Theme flip triggers redraw

- **WHEN** the user changes the runtime theme from dark to light while the 2D canvas is the visible viewMode
- **THEN** within one animation frame the 2D canvas background, grid, zones, prefabs, employees, ceremony bubble, drag ghost (if any), selection ring, and degraded prefab silhouettes all read using `LIGHT_SCENE_3D` values; no element retains the previous dark color

#### Scenario: System theme change

- **WHEN** the OS-level color scheme changes from light to dark while `theme === 'system'`
- **THEN** the 2D canvas reflects the new resolved theme on the next rAF tick using `DARK_SCENE_3D` values

### Requirement: 2D canvas color choices preserve product visual semantics across themes

Every 2D canvas visual element (background, floor grid, zone rugs and labels, prefab silhouettes, employee desk surface, employee avatar circle, employee name pill, employee state badges, manager marker, meeting bubble, drag ghost, selection ring, hover ring, degraded-mode silhouettes, drop-target hint text) SHALL render with sufficient contrast and theme-appropriate values in both `LIGHT_SCENE_3D` and `DARK_SCENE_3D`. No element SHALL be invisible (alpha 0 against same-color background) or low-contrast (text contrast ratio below WCAG AA 4.5:1 against its background).

#### Scenario: Light-mode legibility

- **WHEN** the runtime theme is `'light'` and a ceremony is in progress
- **THEN** the meeting bubble title text reads against the bubble background with WCAG AA contrast (≥ 4.5:1), and every state badge variant (default, blocked, success) renders with visible distinction

#### Scenario: Dark-mode parity

- **WHEN** the runtime theme is `'dark'`
- **THEN** the canvas paints byte-equivalent to today's pre-tokenization rendering for legacy elements (background `#020617`, employee dot ring stroke `#1e293b`, name pill bg `#1e293b`, name pill text `#f8fafc`, manager marker stroke `#a855f7`, etc.), preserving visual continuity for users on dark theme
