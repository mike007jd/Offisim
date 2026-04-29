## 1. Lighting tier preset table + types

- [ ] 1.1 Create `packages/ui-office/src/components/scene/scene-performance-tier.ts` exporting `SceneLightingTier = 'high' | 'medium' | 'low' | 'off'` and `LIGHTING_TIER_PRESETS: Record<SceneLightingTier, LightingTierPreset>` populated with the table from design Decision 2 (shadow map size, env preset key, hemisphere intensity, bounce spotlight count, post-processing flag)
- [ ] 1.2 Export `getLightingTierPreset(tier)` accessor + `getDevTierOverride()` reader (`localStorage.offisim.scene.devOverride.tier`)
- [ ] 1.3 Move `Office3DPerformanceConfig`-equivalent fields (`dpr`) into the same file under a derived `getRendererConfig(tier)` helper; preserve `dpr=[1, 1.5]` on `high`, `[1, 1.25]` on `medium`, `[1, 1]` on `low`/`off`
- [ ] 1.4 Delete `packages/ui-office/src/components/scene/scene-performance-config.ts` (no aliases, pre-launch)
- [ ] 1.5 Verify no consumer imports `getOffice3DPerformanceConfig`: `grep -rn "getOffice3DPerformanceConfig" packages/` returns zero

## 2. FPS sampling hook

- [ ] 2.1 Create `packages/ui-office/src/components/scene/useScenePerformanceTier.ts` exporting `useScenePerformanceTier(): { tier: SceneLightingTier; sampledFps: number; isOverridden: boolean }`
- [ ] 2.2 Implement 60-frame ring-buffer FPS sampler using `useFrame` callback inside the Canvas; initialize `tier='high'`
- [ ] 2.3 Implement transition logic: immediate downgrade on boundary cross; upgrade requires 90 consecutive frames above the next-higher boundary
- [ ] 2.4 Implement `< 15 fps for 3 s → tier='off' for 3 s → emit `force2D` request via callback prop`; component using the hook (`SceneCanvas`) consumes and triggers `setForce2D(true)`
- [ ] 2.5 Read `getDevTierOverride()`; when set, hook returns override unchanged and `isOverridden=true`
- [ ] 2.6 Internal: stash sampled fps + tier on `gl.scene.userData.sceneTierDebug` for `<DevLightingPanel />` badge readout

## 3. Lighting rig SSOT

- [ ] 3.1 Create `packages/ui-office/src/components/scene/scene-lighting-rig.tsx` exporting `<SceneLightingRig tier={tier} agents={agents} />`
- [ ] 3.2 Mount tree: `<hemisphereLight skyColor="#ffe9c8" groundColor="#1a2030" intensity={preset.hemisphereIntensity} />`
- [ ] 3.3 Mount key directional: `<directionalLight castShadow position={[12, 25, 12]} intensity={1.6} color="#fffaf0" shadow-mapSize={[preset.shadowMapSize, preset.shadowMapSize]} shadow-bias={computeShadowBias({ lightDistance: 28, sceneScale: 1 })} shadow-camera-left={-25} shadow-camera-right={25} shadow-camera-top={20} shadow-camera-bottom={-20} />`
- [ ] 3.4 Mount side fill: `<directionalLight position={[-15, 12, -10]} intensity={0.45} color="#9bb4d4" />` (cool low-intensity side fill replacing the old pointLight at the same position)
- [ ] 3.5 Mount back rim: `<directionalLight position={[5, 8, -18]} intensity={0.35} color="#7e90b8" />` (rim from behind to silhouette employees against the back wall)
- [ ] 3.6 Mount bounce spotlights conditionally on `preset.bounceSpotlightCount`: front bounce at `[0, 6, 14]` intensity 0.4, color `#ffe1bf`, decay 1.5; back bounce at `[0, 6, -14]` intensity 0.3, color `#cfd8e8`, decay 1.5 (front-only on medium, both on high, none on low/off)
- [ ] 3.7 Mount Environment when `preset.envMapPreset != null`: `<Environment preset="apartment" />`
- [ ] 3.8 Mount subordinate `<AmbientStateLight agents={agents} maxIntensity={0.25} />`; remove the component's existing root `ambientLight` and replace with a controller hook that lerps a tracked ref consumed by `<ambientLight ref={...} intensity={0.25} />` mounted as a child of the rig
- [ ] 3.9 Apply `<fog attach="fog" args={['#020617', 20, 120]} />` only when this rig is the active scene's primary lighting (not when a custom rig wraps it)

## 4. Office3DView integration

- [ ] 4.1 In `Office3DView.tsx`, replace the inline `<directionalLight>` + `<pointLight>` × 2 + conditional `<Environment>` block (lines 488–502) with `<SceneLightingRig tier={tier} agents={agents} />`
- [ ] 4.2 Read `tier` from `useScenePerformanceTier()`; pass through to rig and downstream prefab `useMaterial` calls (via context — see step 6)
- [ ] 4.3 Remove the `perfConfig` reference for shadow / env preset (now in tier preset)
- [ ] 4.4 Set `gl.shadowMap.type = THREE.PCFSoftShadowMap` via `<Canvas onCreated={({ gl }) => { gl.shadowMap.type = THREE.PCFSoftShadowMap; }}>`
- [ ] 4.5 Adjust `<color attach="background" args={['#020617']} />` to read from `sc.sceneBackground` token (added in step 5)
- [ ] 4.6 Update `Office3DViewInner` Canvas `dpr` prop to consume `getRendererConfig(tier).dpr`

## 5. Color tokens — extend `useSceneColors`

- [ ] 5.1 In `packages/ui-office/src/theme/use-scene-colors.ts`, add new fields to `SceneColors` interface: `sceneBackground`, `wallShell`, `bookSpine: readonly [string, string, string, string, string]`, `cableChannel`, `vendingScreen`, `tableReading`, `whiteboardSurface`, `whiteboardMarker: readonly [string, string, string]`, `accentWarm`, `accentCool`
- [ ] 5.2 Populate `DARK_SCENE`: `sceneBackground='#020617'`, `wallShell='#1c2538'`, `bookSpine=['#10b981', '#059669', '#047857', '#34d399', '#6ee7b7']`, `cableChannel='#0c4a6e'`, `vendingScreen='#fbbf24'`, `tableReading='#064e3b'`, `whiteboardSurface='#f8fafc'`, `whiteboardMarker=['#06b6d4', '#334155', '#f97316']`, `accentWarm='#d97706'`, `accentCool='#06b6d4'`
- [ ] 5.3 Verify all existing token consumers still compile (no removed tokens)
- [ ] 5.4 Spec-gate: `grep -nE "#[0-9a-fA-F]{3,6}" packages/ui-office/src/components/scene/prefabs/*.tsx` returns zero matches (only token references remain)
- [ ] 5.5 Spec-gate: `grep -nE "#[0-9a-fA-F]{3,6}" packages/ui-office/src/components/scene/office3d-scene-primitives.tsx` returns zero matches in the geometry/material section (Html-styled tooltips can keep inline literals — they're not 3D materials)

## 6. Material token system

- [ ] 6.1 Create `packages/ui-office/src/theme/scene-materials.ts` exporting `MaterialClass = 'wood' | 'metal' | 'glass' | 'leather' | 'fabric' | 'plastic'` and `MATERIAL_PRESETS: Record<MaterialClass, MaterialPreset>` populated from design Decision 6 table
- [ ] 6.2 Define `MaterialPreset` interface: `{ component: 'standard' | 'physical', roughness: number, metalness: number, transmission?: number, ior?: number, opacity?: number, clearcoat?: number, clearcoatRoughness?: number, envMapIntensity: number, useProceduralNormal?: boolean, normalScale?: number }`
- [ ] 6.3 Implement `useMaterial(materialClass, color, overrides?)` hook returning a memoized JSX element. Internally branches on `preset.component`: `'standard' → <meshStandardMaterial ...preset color={color} {...overrides} />`, `'physical' → <meshPhysicalMaterial ...preset color={color} {...overrides} />`. Apply procedural normal when `preset.useProceduralNormal`
- [ ] 6.4 For glass: pass `attenuationColor={sc.partition}` and `attenuationDistance={2.0}` (configurable via override)
- [ ] 6.5 Spec-gate: `grep -nE "roughness=\{?[0-9]" packages/ui-office/src/components/scene/prefabs/*.tsx` returns zero matches (no inline numeric literals; only `useMaterial` consumers)
- [ ] 6.6 Spec-gate: `grep -nE "metalness=\{?[0-9]" packages/ui-office/src/components/scene/prefabs/*.tsx` returns zero matches
- [ ] 6.7 Spec-gate: `grep -nE "transmission=\{?[0-9]" packages/ui-office/src/components/scene/prefabs/*.tsx` returns zero matches

## 7. Procedural texture generator

- [ ] 7.1 Create `packages/ui-office/src/lib/scene-procedural-textures.ts`
- [ ] 7.2 Export `getDustNormalTexture(): THREE.Texture` — lazily creates a 256×256 grayscale `DataTexture` (or canvas-backed) using a hashed-gradient algorithm; cached at module level so all consumers share one upload
- [ ] 7.3 Export `getWoodGrainNormalTexture(): THREE.Texture` — 256×256 procedural grain (sinusoidal noise streaked along U axis)
- [ ] 7.4 Internal: use `OffscreenCanvas` when available, fall back to `HTMLCanvasElement.transferToImageBitmap()` shim, fall back to direct `Uint8Array` `DataTexture` if neither is available
- [ ] 7.5 Set `texture.wrapS = texture.wrapT = THREE.RepeatWrapping`, `texture.needsUpdate = true`

## 8. Shadow bias helper

- [ ] 8.1 Create `packages/ui-office/src/lib/shadow-bias.ts` exporting `computeShadowBias({ lightDistance, sceneScale }: { lightDistance: number; sceneScale?: number }): number`
- [ ] 8.2 Implementation: `return -0.0005 - lightDistance * 0.00002 * (sceneScale ?? 1)`
- [ ] 8.3 Document behavior in JSDoc — values around `-0.001` for our default light (≈28 unit distance, scale 1), softer falloff than the previous hardcoded `-0.0005`

## 9. Prefab migration: Workstation

- [ ] 9.1 In `WorkstationMesh3D.tsx`, replace desk surface `meshStandardMaterial color={sc.desk} roughness={0.2}` with `useMaterial('wood', sc.desk)`. Pass override `{ useProceduralNormal: true, normalScale: 0.08 }`
- [ ] 9.2 Replace leg `meshStandardMaterial color={sc.deskEdge} metalness={0.5}` with `useMaterial('metal', sc.deskEdge, { roughness: 0.30 })`
- [ ] 9.3 Replace glass divider `meshPhysicalMaterial color={sc.partition} transmission={0.9} opacity={1} roughness={0.1} ior={1.5} thickness={0.05} transparent` with `useMaterial('glass', sc.partition, { thickness: 0.05 })`. Add the procedural dust normal at default scale
- [ ] 9.4 In `Laptop` (same file), replace chassis material with `useMaterial('metal', sc.metal, { roughness: 0.25 })` and screen with unchanged `meshBasicMaterial` (LED-bright, unlit)
- [ ] 9.5 In `OfficeChair`, replace seat / back `meshStandardMaterial color={sc.furniture}` with `useMaterial('leather', sc.furniture)`; base `useMaterial('plastic', sc.furnitureDark)`; pole `useMaterial('metal', sc.furnitureLight, { roughness: 0.30 })`
- [ ] 9.6 Verify file compiles + render snapshot still shows desk/chair/laptop in correct positions (visual smoke test in dev)

## 10. Prefab migration: MeetingTable

- [ ] 10.1 Replace conference table `meshStandardMaterial color={sc.furniture} roughness={0.3}` with `useMaterial('wood', sc.furniture)`
- [ ] 10.2 Replace table base `meshStandardMaterial color={sc.furnitureDark}` with `useMaterial('plastic', sc.furnitureDark)`
- [ ] 10.3 Whiteboard panel: replace `meshStandardMaterial color={sc.desk} roughness={0.3}` with `useMaterial('plastic', sc.whiteboardSurface)` (uses the new token)
- [ ] 10.4 Whiteboard frame: keep `lineBasicMaterial color={sc.metal}` — line geometry is unaffected by the material system

## 11. Prefab migration: ServerRack

- [ ] 11.1 Replace rack cabinet material with `useMaterial('metal', sc.serverBody, { roughness: 0.30 })`
- [ ] 11.2 Replace front panel material with `useMaterial('metal', sc.furniture, { roughness: 0.40 })`
- [ ] 11.3 Replace ventilation slat material with `useMaterial('metal', sc.furnitureLight, { roughness: 0.50 })`
- [ ] 11.4 Replace inline floor cable channel `meshStandardMaterial color="#0c4a6e"` with `useMaterial('plastic', sc.cableChannel)` (token added in step 5)
- [ ] 11.5 Add LOD: wrap LED grid + ventilation slat block in a conditional driven by camera distance; thresholds 16 / 20 with hysteresis; baked texture replacement
- [ ] 11.6 Create `packages/ui-office/src/components/scene/server-rack-lod-texture.ts` exporting `buildServerRackBakedTexture(sc: SceneColors): THREE.Texture` — draws 5 LEDs × 8 rows + 6 vents × 3 rows on a 256×128 OffscreenCanvas using `sc.ledCyan / leafPrimary / ledBlue / furnitureLight` palette and the same `(rowIndex + ledIndex) % 3` pattern; returns a `Texture` for the front panel `meshBasicMaterial` (emissive)
- [ ] 11.7 LOD threshold logic: in the `ServerRackMesh3D` component, track `lodLevel: 'live' | 'baked'` via `useFrame((state) => { const d = state.camera.position.distanceTo(rackCenter); if (lodLevel === 'live' && d > 20) setLodLevel('baked'); else if (lodLevel === 'baked' && d < 16) setLodLevel('live'); })`
- [ ] 11.8 Render switch: `lodLevel === 'live'` renders the existing LED + vent meshes; `lodLevel === 'baked'` renders one front-panel `Plane` mesh with the baked texture as `meshBasicMaterial`

## 12. Prefab migration: Bookshelf, Whiteboard, RestArea, Decorative, Infrastructure

- [ ] 12.1 In `BookshelfMesh3D.tsx`, replace shelf frame `meshStandardMaterial color={sc.furniture}` with `useMaterial('wood', sc.furniture)`; shelf level (top of shelf) with `useMaterial('wood', sc.furnitureLight)`; reading table top with `useMaterial('wood', sc.tableReading)` (uses new token, replacing inline `#064e3b`)
- [ ] 12.2 Bookshelf book spines: replace inline 5-color array `['#10b981', '#059669', '#047857', '#34d399', '#6ee7b7']` with `sc.bookSpine[i]`. Each spine `useMaterial('plastic', sc.bookSpine[(shelfIndex + bookIndex) % 5], { roughness: 0.85 })` (cardstock leans high-roughness)
- [ ] 12.3 In `WhiteboardMesh3D.tsx`, replace board surface `meshStandardMaterial color="#f8fafc"` with `useMaterial('plastic', sc.whiteboardSurface)`; vertical posts with `useMaterial('metal', sc.furnitureLight, { roughness: 0.40 })`; tray with `useMaterial('plastic', sc.furniture)`; markers with `useMaterial('plastic', sc.whiteboardMarker[i])` for `i in [0, 1, 2]`
- [ ] 12.4 In `RestAreaMesh3D.tsx`, replace inline `#d97706` (sofa 2 main + back) with `sc.accentWarm`; replace `#f8fafc` (coffee table top) with `sc.whiteboardSurface` (white surface token); sofa 1 + 2 fabric-class with `useMaterial('fabric', sc.ledAmber)` and `useMaterial('fabric', sc.accentWarm)`; coffee table top `useMaterial('plastic', sc.whiteboardSurface)`; coffee table base `useMaterial('plastic', sc.furnitureDark)`; vending machine body `useMaterial('plastic', sc.furniture, { metalness: 0.4 })`; vending screen `meshBasicMaterial color={sc.vendingScreen}`; vending product window `useMaterial('glass', sc.partition, { thickness: 0.05 })`; carpet `useMaterial('fabric', sc.furnitureLight)`
- [ ] 12.5 In `DecorativeMesh3D.tsx` (`PlantMesh3D`), pot `useMaterial('plastic', sc.desk, { roughness: 0.85 })`; foliage primary `useMaterial('plastic', sc.leafPrimary, { roughness: 0.65 })`; foliage secondary `useMaterial('plastic', sc.leafSecondary, { roughness: 0.65 })`
- [ ] 12.6 In `InfrastructureMesh3D.tsx` (`NetworkSwitchMesh3D`, `CableTrayMesh3D`), switch body `useMaterial('metal', sc.furniture, { roughness: 0.30 })`; front panel `useMaterial('plastic', sc.furnitureDark)`; cable tray `useMaterial('plastic', sc.furnitureDark)`; LED port indicators stay `meshBasicMaterial`
- [ ] 12.7 Spec-gate: `grep -rn "meshStandardMaterial\|meshPhysicalMaterial" packages/ui-office/src/components/scene/prefabs/` returns zero matches (all materials go through `useMaterial`)

## 13. Office3D scene primitives migration

- [ ] 13.1 In `office3d-scene-primitives.tsx::RoomShell`, replace floor `meshStandardMaterial color="#020617" roughness={0.9}` with `useMaterial('plastic', sc.sceneBackground, { roughness: 0.92 })`; walls (`#1e293b` × 3) with `useMaterial('plastic', sc.wallShell)`
- [ ] 13.2 Replace `gridHelper args=[ROOM_W, 40, '#1e293b', '#0f172a']` with `gridHelper args={[ROOM_W, 40, sc.wallShell, sc.sceneBackground]}` (gridHelper uses raw color args, not material system)
- [ ] 13.3 In `AmbientStateLight`, change from rendering `<ambientLight>` directly to populating `gl.scene.userData.ambientStateColor` + `gl.scene.userData.ambientStateIntensity`. Cap intensity at 0.25 internally (clamp the `targetIntensity` math)
- [ ] 13.4 In `SceneLightingRig`, mount the subordinate `<ambientLight color={state.ambientStateColor ?? '#ffffff'} intensity={Math.min(0.25, state.ambientStateIntensity ?? 0.20)} />` — frame-loop sync via `useFrame` reading `gl.scene.userData`
- [ ] 13.5 Verify ceremony color still drives the subordinate ambient (lavender during meeting, orange when blocked) but is no longer the dominant fill

## 14. Post-processing pipeline

- [ ] 14.1 `pnpm --filter @offisim/ui-office add @react-three/postprocessing` (peer of three / @react-three/fiber)
- [ ] 14.2 Create `packages/ui-office/src/components/scene/scene-postprocessing.tsx` exporting `<ScenePostprocessing tier={tier} cameraTarget={[0,0,2]} />`
- [ ] 14.3 Body: dynamic `import('@react-three/postprocessing').then(...)`; mount `<EffectComposer multisampling={0}>` containing `<DepthOfField focusDistance={0.02} focalLength={0.05} bokehScale={2} />` (high tier only) + `<Vignette offset={0.4} darkness={0.35} eskil={false} />` (high + medium); render null otherwise
- [ ] 14.4 In `Office3DView.tsx`, conditionally render `<ScenePostprocessing tier={tier} />` after `<OrbitControls>`; the dynamic import lazy-loads the post chunk only when tier is high or medium
- [ ] 14.5 Spec-gate: bundle analyzer (`pnpm --filter @offisim/web build && du -sh apps/web/dist/assets/*postprocessing*`) shows the post chunk is split (not in main)

## 15. Dev hot-toggle panel

- [ ] 15.1 Create `packages/ui-office/src/components/scene/DevLightingPanel.tsx`. Top-level guard: `if (!import.meta.env.DEV) return null;`
- [ ] 15.2 Implement keyboard handlers: `L` cycles tier (high → medium → low → off → high), `E` toggles `localStorage.offisim.scene.devOverride.env` boolean, `S` toggles `.shadows`, `B` cycles hemisphere intensity (0.4 / 0.6 / 0.8 / 1.0) under `.hemi`, `P` toggles `.post`
- [ ] 15.3 Render fixed-position badge top-right reading `DEV: tier=<tier> · hemi=<hemi> · env=<on|off> · shadows=<on|off> · post=<on|off> · [Reset]` styled `text-xs font-mono bg-black/70 text-amber-300 px-2 py-1 rounded`
- [ ] 15.4 `[Reset]` button clears all `localStorage.offisim.scene.devOverride.*` entries and dispatches a custom event `offisim.scene.devOverride.reset` so consumers re-read
- [ ] 15.5 In `useScenePerformanceTier()`, on mount add `addEventListener('offisim.scene.devOverride.reset', refresh)` to re-read overrides on reset
- [ ] 15.6 Mount `<DevLightingPanel />` inside `Office3DView` outside the `<Canvas>` (DOM, not 3D)
- [ ] 15.7 In production builds, verify the file is tree-shaken: `pnpm --filter @offisim/web build && grep -l "DevLightingPanel" apps/web/dist/assets/*.js | wc -l` returns 0

## 16. SceneCanvas tier integration

- [ ] 16.1 In `SceneCanvas.tsx`, drop binary `force2D` toggle reliance; consume tier from `useScenePerformanceTier()` directly via prop drilling or context
- [ ] 16.2 Keep `crashCountRef` two-error catch as the hard floor (independent of tier); after 2 thrown errors, force 2D regardless of tier
- [ ] 16.3 Add a 2D-fallback request channel: `useScenePerformanceTier()` exposes a `requestForce2D` callback; `SceneCanvas` sets `setForce2D(true)` when the hook fires it (after `< 15 fps for 3 s` at `tier='off'`)
- [ ] 16.4 Add a Recovery path: if user manually returns to 3D via UI, reset `crashCountRef` and the FPS-floor flag, give the engine one fresh chance

## 17. Build + verify gates (serial per CLAUDE.md)

- [ ] 17.1 `pnpm --filter @offisim/shared-types build`
- [ ] 17.2 `pnpm --filter @offisim/core build`
- [ ] 17.3 `pnpm --filter @offisim/ui-office build`
- [ ] 17.4 `pnpm --filter @offisim/ui-office typecheck`
- [ ] 17.5 `pnpm --filter @offisim/web typecheck`
- [ ] 17.6 `pnpm --filter @offisim/web build` — confirm post-processing chunk splits (search dist for `postprocessing` chunk file)
- [ ] 17.7 `npx biome check packages/ui-office/src/components/scene packages/ui-office/src/theme packages/ui-office/src/lib` — zero new errors
- [ ] 17.8 `pnpm --filter @offisim/desktop build` — release `.app` builds with new UI dist (per CLAUDE.md release desktop verification rule)
- [ ] 17.9 Spec-gate greps from steps 1.5, 5.4, 5.5, 6.5, 6.6, 6.7, 12.7, 14.5, 15.7 — all return expected zero matches (or expected file counts)

## 18. Live verification (release Tauri app + browser)

- [ ] 18.1 Launch Tauri release `.app`. Open Office workspace. Confirm scene loads at default camera (`[0, 22, 28]`) within 2 s, no console errors, no missing-texture warnings
- [ ] 18.2 Visual: backlit employee faces are readable (hemisphere fill working). The shadow side of the room (negative-X facing surfaces) is illuminated, not silhouetted
- [ ] 18.3 Visual: shadow edges on desks and chairs are soft (PCF Soft active), no aliased pixel-step shadows. Move camera close (zoom to ~5 unit distance), shadows still smooth
- [ ] 18.4 Visual: glass dividers on workstations are visibly glass — slight blue-grey tint, soft refraction, dust-scatter highlights when camera tilts. Vending machine product window same. Confirm panes are not invisible
- [ ] 18.5 Visual: wood vs metal vs leather vs fabric distinction. Conference table (wood) reads as warm matte; chair pole (metal) reflects environment; chair seat (leather) has clearcoat sheen; sofa (fabric) reads as soft and matte
- [ ] 18.6 Visual: Server rack at default camera distance. Confirm LED grid + vent slats render live (live mesh tier active). Orbit camera back beyond 20 units; LED grid replaces with baked texture, no flicker. Orbit forward to < 16 units; live mesh re-engages, no flicker
- [ ] 18.7 Visual: fog engagement. Far walls at z=-15 read with subtle blue-grey fade; near elements at z=2 are crisp. Floor at far edge is barely fog-tinted, reads as 3D depth
- [ ] 18.8 Performance: F2 to enable PerformanceHUD. Confirm fps stable ≥ 50 on Apple Silicon at default tier (high). Trigger meeting ceremony (`/meeting` or via task), confirm fps ≥ 50 sustained with the new ambient state lerp + lighting rig
- [ ] 18.9 Performance: open dev mode (`pnpm --filter @offisim/web dev`), press F2, then press `L` to cycle to medium. Visible: shadow map quality drops slightly, post DoF disables. Press `L` to low; hemisphere drops, env disables. Press `L` to off; shadows disable. Press `L` again to wrap back to high
- [ ] 18.10 Performance: in dev, press `S` to toggle shadows off/on. Visible immediately; no reload. Press `E` to toggle Environment off/on; metal/glass IBL reflections disengage and re-engage. Press `B` to cycle hemisphere intensity; fill brightness changes. Press `P` to toggle post; Vignette + DoF engage / disengage at high tier
- [ ] 18.11 Performance: simulate slow GPU by adding a load via Spotlight on `pnpm --filter @offisim/web dev` while running another GPU-heavy app. After ~1.5 s sustained < 50 fps, tier auto-downgrades to medium. After < 30 fps for 1.5 s, tier auto-downgrades to low. After < 15 fps for 3 s, tier sets to off then SceneCanvas demotes to 2D. Confirm transitions are not flickery
- [ ] 18.12 Crash recovery: artificially throw inside the lighting rig (temporary `if (Math.random() < 0.5) throw new Error('test')`). Confirm `crashCountRef` increments, after 2 crashes 2D mode locks. Revert the test throw

## 19. Spec / docs / memory sync

- [ ] 19.1 Update `packages/ui-office/CLAUDE.md` "UI / Scene / 3D" section: add `SceneLightingRig` SSOT + `useMaterial` SSOT bullets; replace any reference to `getOffice3DPerformanceConfig`
- [ ] 19.2 Update root `CLAUDE.md` "Cross-Cutting Facts" if needed: add a note that 3D scene lighting + materials are token-driven SSOT and that inline hex / inline `roughness=` literals are forbidden under `prefabs/`
- [ ] 19.3 Update memory `MEMORY.md` Active Backlog: remove `upgrade-3d-scene-lighting-and-materials` from queue once archived; add a brief Skills entry pointing to lighting / material SSOT location for future agents
- [ ] 19.4 No protocol ledger touch (no A2A / MCP / Better Auth / Tauri / LangGraph / Apple-Intelligence / Skill.md surface change). Confirm `openspec/protocols-ledger.md` is unchanged
