## Why

2D office canvas (`Office2DCanvasView` + the 7 `canvas-layers/*` modules + 3 shared helpers) is rendered with file-level `// raw-hex-allowed-file:` exemptions and dozens of dark-mode hex literals (`#020617`, `#1e293b`, `#6366f1`, `rgba(0,0,0,…)`, `rgba(255,255,255,…)`, `#a855f7`, …). When the user switches the app to light theme, the 2D scene background, grid, employee desks, name pills, drag ghost, manager marker, meeting bubble, selection ring, and degraded prefab silhouettes all stay dark — the 2D mode "missing light theme" bug from the 2026-05-02 release `.app` live verify (issue #14, bucket 2a in the 9-bucket queue).

Every other surface in the codebase has been migrated to the `@offisim/ui-core/tokens` SSOT and consumes `useSceneColors()` for theme-aware values. The 2D canvas has been the last hold-out, governed only by a vague "asset renderer palette" comment that does not reflect any product intent. Removing that exemption now closes the design-token contract loop and unblocks any downstream "follow the system theme" UX work.

## What Changes

- New capability `scene-2d-theme-tokens` defining the 2D canvas color SSOT contract: every color literal in `Office2DCanvasView` + `canvas-layers/*` + the three shared 2D helpers (`canvas-primitives.ts`, `office-2d-canvas-renderer.ts`, `office-2d-render-registry.ts`) is sourced from `useSceneColors()` (or, for non-React-context utilities, from a `SceneCanvasPalette` parameter populated by the React caller).
- Extend `Scene3DColors` (`packages/ui-core/src/tokens/colors-3d.ts`) with the 2D-canvas-only fields needed to express the existing visual language in both themes: `canvasBackground`, `canvasGrid`, `deskSurface`, `deskScreen`, `deskBezel`, `pillBg`, `pillBgStroke`, `pillText`, `dotRing`, `nameLabelMuted`, `meetingBubbleBg`, `meetingBubbleStroke`, `meetingBubbleTitle`, `meetingBubbleParticipantText`, `meetingBubbleWaitingText`, `meetingBubbleExtraText`, `managerMarkerFill`, `managerMarkerStroke`, `managerMarkerLabel`, `selectionRing2D`, `dragGhostShadow`, `prefabSilhouetteDegraded`, `stateBadgeBg`, `stateBadgeStroke`, `stateBadgeText`, `stateBadgeBgBlocked`, `stateBadgeStrokeBlocked`, `stateBadgeTextBlocked`, `stateBadgeBgSuccess`, `stateBadgeStrokeSuccess`, `stateBadgeTextSuccess`. Both `LIGHT_SCENE_3D` and `DARK_SCENE_3D` get full values.
- `useSceneColors()` consumers in 2D files render real-time on theme change (existing `useTheme()` reactivity is sufficient — the 2D canvas already redraws on every `needsRedrawRef.current = true`; we add a redraw trigger when the resolved theme flips).
- Remove the `// raw-hex-allowed-file:` exemption header from these 11 files: `Office2DCanvasView.tsx`, `office-2d-canvas-renderer.ts`, `office-2d-render-registry.ts`, `canvas-primitives.ts`, `canvas-layers/draw-background.ts`, `canvas-layers/draw-employees.ts`, `canvas-layers/draw-ceremony.ts`, `canvas-layers/draw-interactions.ts`, `canvas-layers/draw-drag-overlay.ts`, `canvas-layers/draw-prefabs.ts`, `canvas-layers/draw-zones.ts`. The `pnpm tokens:lint-hex` gate must pass on this set without exemptions.
- The shared canvas helpers (`canvas-primitives.ts` + `office-2d-canvas-renderer.ts` + `office-2d-render-registry.ts`) are not React components, so they accept a `palette: SceneCanvasPalette` parameter (a plain `Pick<Scene3DColors, …>` view) supplied by the React caller. No global state, no module-level color reads.
- The Studio canvas, ZoneCanvas, PrefabThumbnail, company-creation-wizard-preview, 3D-side `office3d-*` files, and `onboarding/*` are out of scope (they have their own exemption story, separate scope from the 2D office canvas).

## Capabilities

### New Capabilities
- `scene-2d-theme-tokens`: The 2D office canvas color SSOT contract — every color in the 2D render pipeline comes from `Scene3DColors` via `useSceneColors()`, light + dark + system real-time.

### Modified Capabilities
- `design-token-foundation`: extend `Scene3DColors` with the 2D-canvas-only fields listed above (both `LIGHT_SCENE_3D` and `DARK_SCENE_3D` get complete values); shrink the `raw-hex-allowed-file` allow-list so the 11 2D-canvas files no longer carry a file-level exemption.

## Impact

- Affected code: `packages/ui-core/src/tokens/colors-3d.ts` (token interface + light/dark records), `packages/ui-office/src/components/scene/Office2DCanvasView.tsx`, `packages/ui-office/src/components/scene/office-2d-canvas-renderer.ts`, `packages/ui-office/src/components/scene/office-2d-render-registry.ts`, `packages/ui-office/src/components/scene/canvas-primitives.ts`, `packages/ui-office/src/components/scene/canvas-layers/*.ts` (7 files), `packages/ui-office/src/components/scene/hooks/useCanvasRedrawLoop.ts` (theme-change redraw trigger).
- Affected gates: `pnpm tokens:lint-hex` must pass cleanly on the 11 files listed above without their `raw-hex-allowed-file` headers.
- No DB / schema / migration impact (cosmetic-only).
- No runtime / agent / LLM contract impact.
- No backwards-compat surface — purely internal rendering, no public API consumers.
- Live verify: real Tauri release `.app` light + dark + system theme — 2D scene every visual element follows theme; switch theme mid-session reflects within one rAF frame.
