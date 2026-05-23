## MODIFIED Requirements

### Requirement: 2D canvas re-renders within one rAF frame on theme switch

The V3 app is light-only; `useTheme().resolvedTheme` is pinned to `'light'` and never flips at runtime, so there is no user-driven or system-driven theme switch for the 2D canvas to react to. The 2D canvas SHALL paint with the `LIGHT_SCENE_3D` palette unconditionally.

The redraw machinery (`useCanvasRedrawLoop` / `needsRedrawRef`) is RETAINED for its other triggers (snapshot changes, selection, drag), but it no longer needs to react to a theme flip because the resolved theme is constant. Were the theme machinery ever re-enabled, a flip SHALL still set `needsRedrawRef.current = true` and repaint within a single rAF tick (≤ `MOTION_DURATION.normal === 250 ms`); under light-only this branch is unreachable.

#### Scenario: Canvas paints with the light palette

- **WHEN** the 2D canvas is the visible viewMode in the light-only app
- **THEN** the background, grid, zones, prefabs, employees, ceremony bubble, drag ghost (if any), selection ring, and degraded prefab silhouettes all read from `LIGHT_SCENE_3D` values — no element resolves to a dark-scene value

#### Scenario: No runtime theme flip occurs

- **WHEN** the app runs in the light-only configuration
- **THEN** `useTheme().resolvedTheme` stays `'light'` for the lifetime of the canvas — the redraw loop is never asked to repaint for a light↔dark transition

### Requirement: 2D canvas color choices preserve product visual semantics across themes

The V3 app is light-only. Every 2D canvas visual element (background, floor grid, zone rugs and labels, prefab silhouettes, employee desk surface, employee avatar circle, employee name pill, employee state badges, manager marker, meeting bubble, drag ghost, selection ring, hover ring, degraded-mode silhouettes, drop-target hint text) SHALL render with sufficient contrast and product-appropriate values using the `LIGHT_SCENE_3D` palette. No element SHALL be invisible (alpha 0 against same-color background) or low-contrast (text contrast ratio below WCAG AA 4.5:1 against its background) in the light theme.

The `DARK_SCENE_3D` 2D-canvas-only field values are RETAINED in the token SSOT for intentional-dark consumers and for a possible future re-enable, but the 2D office canvas does not paint with them under light-only.

#### Scenario: Light-mode legibility

- **WHEN** a ceremony is in progress in the light-only app
- **THEN** the meeting bubble title text reads against the bubble background with WCAG AA contrast (≥ 4.5:1), and every state badge variant (default, blocked, success) renders with visible distinction using `LIGHT_SCENE_3D` values

#### Scenario: Dark scene tokens retained but unused by the 2D canvas

- **WHEN** inspecting the token SSOT
- **THEN** the `DARK_SCENE_3D` 2D-canvas-only fields still exist (retained for intentional-dark continuity), but the light-only 2D office canvas never reads them
