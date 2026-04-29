## Why

The 3D office scene renders but does not look like a 3D office — the
production lighting rig is one directional light + ambient + two cool
point lights with `Environment preset='city'` only switched on outside
dev. There is no hemisphere fill, no bounce light, no IBL probe in dev,
and no PCF on the shadow map. Backlit faces and the non-meeting side of
the room read as flat dark silhouettes under a single direction. The
shadow buffer is 1024×1024 in prod over a 40×30 unit room and 512×512
in dev with shadows disabled entirely; aliasing along desk and chair
edges is visible at the default camera distance and dev iteration
happens against a different lighting rig than what ships.

Materials compound the problem. Every prefab uses `meshStandardMaterial`
with a flat hex tone and a single hand-picked roughness (0.2 / 0.3 /
0.8 with no semantic logic), so wood, metal, fabric, leather, and
plastic all share the same micro-surface response. Glass dividers and
the vending product window are textbook `meshPhysicalMaterial`
(`transmission=0.9`, `roughness=0.1`) — physically pure transmission
that reads as missing geometry rather than glass. `ServerRackMesh3D`
hardcodes `#0c4a6e` for floor cable channels and renders 8 LED rows
× 5 LEDs × 4 racks = 160 individual `circleGeometry` meshes plus 18
ventilation slats per rack at all viewing distances. `useSceneColors`
exposes a `DARK_SCENE` token map, but `RestAreaMesh3D`, `BookshelfMesh3D`,
`WhiteboardMesh3D`, and `ServerRackMesh3D` write hex strings (`#d97706`,
`#f8fafc`, `#06b6d4`, `#f97316`, `#0c4a6e`, `#064e3b`, plus a 5-color
book spine palette) inline anyway, so the token system is only a
suggestion.

Performance fallback is a binary toggle — `SceneCanvas` keeps a
`crashCountRef` and demotes to 2D after two thrown errors, with no
intermediate FPS-driven softer fallback (turn shadows off, drop
shadow map size, kill post, downgrade `ServerRackMesh3D` to a baked
billboard at distance). Operators with mid-tier hardware see either
"3D works smoothly" or "scene crashed twice, locked to 2D" with
nothing in between. Fog (`[#020617, 40, 100]`) starts at 40 units —
roughly the long axis of the room — so atmospheric depth never
engages on near geometry, the room reads visually flat, and the
unified Environment preset choice was never re-evaluated for an
indoor office (city HDR is sky-dominant, not interior-dominant).

This is the production lighting and materials pass that takes the
scene from "geometry placed correctly" to "looks like the inside of
an office." Pre-launch — no back-compat shims, single complete
delivery.

## What Changes

- **Add `scene-lighting-rig.tsx` SSOT** at
  `packages/ui-office/src/components/scene/scene-lighting-rig.tsx`
  exporting `SceneLightingRig` (the React component group: hemisphere
  + ambient state + key directional + side fill + back rim + bounce
  spotlights + Environment) and the lighting tier preset table
  consumed by both the production rig and the dev quick-toggle panel.
  Dev and prod render the same rig at the same intensities; only the
  shadow map size, Environment HDRI presence, and post-processing
  level change between tiers.
- **Replace the inline Office3DView light tree** (lines 488–502 of
  `Office3DView.tsx`) with `<SceneLightingRig tier={tier}
  agents={agents} />`. `AmbientStateLight` integrates as a child of
  the rig so ceremony-driven ambient color does not override
  hemisphere fill — the hemisphere supplies sky/ground tone and
  `AmbientStateLight` modulates only the additional ambient layer.
- **Switch Environment preset to `apartment`** for indoor
  warm-interior IBL (per drei preset catalog), enabled at all tiers
  (dev included) so iteration matches ship. Removed: the dev-vs-prod
  preset divergence in `scene-performance-config.ts`. Added: an
  optional `tier='disabled'` for the FPS-fallback path that strips
  the IBL probe.
- **Adopt PCF soft shadows + tier-driven shadow map** — set
  `gl.shadowMap.type = THREE.PCFSoftShadowMap` on the canvas;
  shadow map resolution becomes `2048` on `tier='high'`, `1024` on
  `tier='medium'`, `512` on `tier='low'`, no shadows on `tier='off'`.
  `shadow-bias` is computed from light range + object scale via a
  helper (`computeShadowBias({ lightDistance, sceneScale })`), not
  hardcoded.
- **Pull fog near/far back** to `near=20, far=120` so the meeting
  zone (≈10–14 units from camera) starts engaging fog gently,
  zone labels at the room far edge soften, and depth perception
  reads as a 3D room rather than a flat painting.
- **Materialize a 6-class material token system** in
  `packages/ui-office/src/theme/scene-materials.ts`. Each prefab
  surface declares a `materialClass: 'wood' | 'metal' | 'glass' |
  'leather' | 'fabric' | 'plastic'` and the SSOT returns the PBR
  parameter set (roughness, metalness, transmission/opacity for
  glass, clearcoat for leather, normalScale, optional environment
  map intensity). Every prefab consumes this — no inline
  `roughness=0.2` / `metalness=0.6` / hex literals. Color comes from
  `useSceneColors()` SSOT only (no inline hex anywhere under
  `prefabs/`).
- **Tighten glass material** — transmission drops from `0.9` to
  `0.78`, roughness rises from `0.1` to `0.18`, add tint pulled from
  the `partition` token, add `attenuationColor` + `attenuationDistance`
  for subtle blue-grey absorption, and add a procedural
  micro-normal-perturbation for dust scatter (no texture asset
  required — generated at material init via a small `DataTexture`).
- **PBR strategy decision: shader-only roughness/metalness layering,
  no texture asset pipeline.** Deferred-asset path (poly haven HDR
  textures) is rejected for 1.0 — bundle bloat (≥40 MB for a
  meaningful set) and HDR loader complexity outweigh the gain at
  the camera distances we render. Procedurally generated low-
  resolution noise normal maps (256×256, `DataTexture` from a
  hashed gradient) are used selectively for glass and the desk
  surface to break PBR uniformity. See design Decision 6.
- **Color tokens centralized.** `useSceneColors` adds the missing
  tokens (`bookSpine[0..4]`, `cableChannel`, `vendingScreen`,
  `tableReading`, `whiteboardSurface`, `whiteboardMarker[0..2]`).
  Every `prefabs/*.tsx` file SHALL reference colors only via
  `sc.X`. Inline hex strings under `prefabs/` are forbidden. Lint
  rule (regex grep) added to spec gate.
- **Server rack LOD.** `ServerRackMesh3D` switches to a distance-
  driven LOD via `useFrame` reading camera position — at distance
  `> 18` units the LED grid + ventilation slats are replaced with
  a single baked emissive `Texture` rendered onto the front panel,
  computed once at component mount via `OffscreenCanvas` (or fallback
  `HTMLCanvasElement`). At distance `≤ 18` the live mesh grid
  renders. Threshold uses hysteresis (16/20) to avoid flicker at
  the boundary.
- **FPS-driven graceful degradation.** Replace `SceneCanvas`'s binary
  `force2D` switch with a tier-aware policy. New
  `useScenePerformanceTier()` hook samples FPS in a 60-frame moving
  window (using `useFrame` callback frequency) and downgrades:
  - 60-frame avg ≥ 50 fps → `tier='high'`
  - 30–49 fps → `tier='medium'` (shadow map 1024, post off)
  - 15–29 fps → `tier='low'` (shadow map 512, no hemisphere, no post)
  - < 15 fps for 3 consecutive seconds → `force2D=true`
  Two-error catch path stays as a hard floor.
- **Optional post-processing pipeline** (`@react-three/postprocessing`).
  `tier='high'` enables `Vignette` (subtle, opacity 0.35) and a
  one-pass `DepthOfField` with `focusDistance` keyed to the camera
  target (`[0, 0, 2]`) and a small bokeh; `tier='medium'` keeps
  Vignette only; `tier='low'` and below disable post entirely.
- **Dev hot-toggle panel.** New `<DevLightingPanel />` mounts under
  `Office3DView` only when `import.meta.env.DEV`. Keyboard
  shortcuts: `L` cycles through tier presets (high/medium/low/off),
  `E` toggles Environment HDRI on/off, `S` toggles shadows on/off,
  `B` cycles through hemisphere intensity presets (0.4 / 0.6 /
  0.8 / 1.0), `P` toggles post-processing. State is persisted to
  `localStorage` under `offisim.scene.devOverride.*` and overrides
  the FPS-driven tier when set. Production builds tree-shake the
  panel via `import.meta.env.DEV` guard.
- **`AmbientStateLight` integration.** The component (currently
  rendering its own root `ambientLight`) becomes a pure controller
  that lerps a state-tracked target into `gl.scene.userData.stateAmbient`
  and the rig reads that value to drive a subordinate ambient
  layer (intensity ≤ 0.25). Hemisphere is the dominant fill;
  ceremony-state ambient becomes a tint accent rather than the
  primary fill.

## Capabilities

### New Capabilities

- `scene-3d-lighting`: SSOT for the production lighting rig. Owns
  the contract that dev and prod render the same light tree at the
  same intensities, that `AmbientStateLight` is subordinate to
  hemisphere fill (not a parallel root light), that the canvas uses
  PCF soft shadows with tier-driven shadow map size, and that fog
  near/far engage at `[20, 120]`. Owns the lighting tier preset
  table (`high` / `medium` / `low` / `off`) that downstream tiers
  consume.
- `scene-3d-materials`: SSOT for the 6-class material token system
  (wood / metal / glass / leather / fabric / plastic) with explicit
  PBR parameter ranges per class. Owns the contract that prefab
  surfaces declare `materialClass` and consume the SSOT for PBR
  parameters; no inline `roughness=` / `metalness=` numeric literals
  under `prefabs/`. Owns the contract that color comes from
  `useSceneColors()` only — no inline hex strings under `prefabs/`.
  Owns the glass tightening, the procedural micro-normal generator,
  and the LOD threshold for emissive grid prefabs.
- `scene-3d-performance-fallback`: SSOT for the tiered scene
  performance policy. Owns the FPS sampling window (60 frames),
  the tier transition thresholds (50 / 30 / 15 fps), the
  `tier='off'` 2D-fallback rule (< 15 fps for 3 s), and the
  hysteresis on the LOD distance threshold (16 / 20 units). Owns
  the `useScenePerformanceTier()` hook contract and its outputs.

### Modified Capabilities

(None — no existing 3D scene capability exists in
`openspec/specs/`. `office-2d-canvas-viewport` is the 2D-only
sister and is untouched.)

## Impact

- **Code (new)**:
  `packages/ui-office/src/components/scene/scene-lighting-rig.tsx`,
  `packages/ui-office/src/theme/scene-materials.ts`,
  `packages/ui-office/src/components/scene/scene-performance-tier.ts`,
  `packages/ui-office/src/components/scene/useScenePerformanceTier.ts`,
  `packages/ui-office/src/components/scene/DevLightingPanel.tsx`,
  `packages/ui-office/src/components/scene/server-rack-lod-texture.ts`,
  `packages/ui-office/src/lib/shadow-bias.ts`,
  `packages/ui-office/src/lib/scene-procedural-textures.ts`.
- **Code (edits)**:
  `Office3DView.tsx` (replace inline lights, wire tier prop),
  `scene-performance-config.ts` (collapse into `scene-performance-tier.ts`,
  remove dev/prod preset divergence),
  `SceneCanvas.tsx` (replace binary fallback with tier-aware,
  set `gl.shadowMap.type` on Canvas),
  `scene-render-policy.ts` (no change unless tier feeds in),
  every prefab in
  `packages/ui-office/src/components/scene/prefabs/`
  (`WorkstationMesh3D` / `MeetingTableMesh3D` / `ServerRackMesh3D` /
  `BookshelfMesh3D` / `WhiteboardMesh3D` / `RestAreaMesh3D` /
  `DecorativeMesh3D` / `InfrastructureMesh3D`) — switch to
  `materialClass` declaration, drop inline hex / roughness /
  metalness literals,
  `office3d-scene-primitives.tsx` (`AmbientStateLight` becomes
  controller, `RoomShell` floor / wall colors token-ize the
  inline `#020617` / `#1e293b`, also adopt `materialClass='plastic'`
  for walls and `materialClass='wood'` or floor-specific token for
  the floor),
  `use-scene-colors.ts` (add the missing tokens listed above).
- **Dependencies**: add `@react-three/postprocessing`. No new
  binary asset bundle; procedural textures generated at runtime.
- **No back-compat**: pre-launch — `getOffice3DPerformanceConfig`
  is deleted (replaced by tier hook), inline light tree in
  `Office3DView.tsx` is deleted, and inline material literals are
  deleted across `prefabs/`. No alias re-exports.
- **Live verification**: Tauri release `.app` + `pnpm build`.
  Open Office workspace at default camera; inspect ambient
  illumination on backlit employee faces (must be readable, not
  silhouetted), shadow edges on desks (no aliasing at the close
  pose, soft falloff at meeting zone), glass divider readability
  (visible as glass, not transparent absence), Server rack at
  default camera distance (LED grid live) vs. orbit pulled back
  beyond 18 units (LED grid replaced with baked texture, no
  flicker). Press F2 to enable PerformanceHUD, observe fps stable
  ≥ 50 on Apple Silicon, ≥ 30 on Intel iGPU. Press L in dev to
  cycle tiers; tier changes visible without reload. Press F12
  Performance tab; trace one second of scene render and verify
  shadow map count and post passes match tier.
