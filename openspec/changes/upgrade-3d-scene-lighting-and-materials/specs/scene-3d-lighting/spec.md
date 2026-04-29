# scene-3d-lighting Specification

## Purpose
The Office 3D scene SHALL render under a single SSOT lighting rig
(`SceneLightingRig`) consumed by `Office3DView` and any future 3D
scene surface (Studio, market preview, prefab catalog). The rig
provides the light tree (hemisphere + ambient state + key
directional + side fill + back rim + bounce spotlights +
Environment IBL + fog), the lighting tier preset table
(high / medium / low / off), the shadow configuration (PCF Soft
shadow map type, tier-driven shadow map resolution, distance-aware
shadow bias), and the contract that dev and production render the
SAME light tree at the SAME intensities — only shadow map size,
Environment HDRI presence, post-processing presence, and bounce
spotlight count change between tiers. `AmbientStateLight` is
subordinate to hemisphere fill, not a parallel root light. This
capability owns the lighting performance contract, not the
material contract or the FPS sampling contract — those are the
sister capabilities `scene-3d-materials` and
`scene-3d-performance-fallback`.

## ADDED Requirements

### Requirement: SceneLightingRig SHALL be the SSOT for 3D office lighting

The component `SceneLightingRig` exported from `packages/ui-office/src/components/scene/scene-lighting-rig.tsx` SHALL be the only light tree in the Office 3D scene. `Office3DView`
SHALL mount exactly one `<SceneLightingRig tier={tier} agents={agents} />`
inside its `<Canvas>`; no inline `<directionalLight>`,
`<pointLight>`, `<hemisphereLight>`, `<ambientLight>`,
`<spotLight>`, or `<Environment>` MAY be added directly to
`Office3DView` outside the rig.

The rig SHALL render the following light components:
- `<hemisphereLight skyColor="#ffe9c8" groundColor="#1a2030"
  intensity={preset.hemisphereIntensity} />`
- `<directionalLight castShadow position={[12, 25, 12]}
  intensity={1.6} color="#fffaf0" shadow-mapSize={[preset.shadowMapSize, preset.shadowMapSize]}
  shadow-bias={computeShadowBias({ lightDistance: 28, sceneScale: 1 })}
  shadow-camera-left={-25} shadow-camera-right={25}
  shadow-camera-top={20} shadow-camera-bottom={-20} />`
  (key directional, present at all tiers including `off` but
  with `castShadow=false` when `tier === 'off'`)
- `<directionalLight position={[-15, 12, -10]} intensity={0.45}
  color="#9bb4d4" />` (side fill)
- `<directionalLight position={[5, 8, -18]} intensity={0.35}
  color="#7e90b8" />` (back rim)
- 0–2 bounce spotlights driven by `preset.bounceSpotlightCount`
- One `<Environment preset="apartment" />` when
  `preset.envMapPreset != null`
- One subordinate `<ambientLight>` driven by the
  `AmbientStateLight` controller, intensity capped at 0.25
- `<fog attach="fog" args={['#020617', 20, 120]} />` applied
  exactly once at the rig root

The rig SHALL NOT introduce additional lights beyond the above set.

#### Scenario: Office3DView mounts exactly one SceneLightingRig

- **WHEN** rendering `Office3DView`
- **THEN** the React tree under `<Canvas>` contains exactly one
  `<SceneLightingRig>` instance
- **AND** no `<directionalLight>` / `<pointLight>` /
  `<hemisphereLight>` / `<ambientLight>` / `<spotLight>` /
  `<Environment>` exists outside the rig

#### Scenario: Rig produces hemisphere + key + side + rim + bounces

- **WHEN** rendering `<SceneLightingRig tier="high" agents={...} />`
- **THEN** the rendered three.js scene contains exactly:
  - 1 hemisphere light at intensity 0.65
  - 1 directional light at `[12, 25, 12]` intensity 1.6 with
    castShadow true
  - 1 directional light at `[-15, 12, -10]` intensity 0.45
  - 1 directional light at `[5, 8, -18]` intensity 0.35
  - 2 spotlights (front + back bounce)
  - 1 Environment preset `'apartment'` map applied to scene
    `environment` slot
  - 1 ambient light at intensity ≤ 0.25 driven by ambient state

#### Scenario: Fog is configured at near=20 far=120

- **WHEN** the rig is mounted
- **THEN** `state.scene.fog.near === 20`
- **AND** `state.scene.fog.far === 120`
- **AND** `state.scene.fog.color.getHex() === 0x020617`

### Requirement: Lighting tier presets SHALL drive all per-tier numeric variation

The file `packages/ui-office/src/components/scene/scene-performance-tier.ts` SHALL export `SceneLightingTier = 'high' | 'medium' | 'low' | 'off'` and `LIGHTING_TIER_PRESETS: Record<SceneLightingTier, LightingTierPreset>`.

Each `LightingTierPreset` SHALL contain exactly these fields:
- `shadowMapSize: number` — 2048 (high), 1024 (medium), 512 (low),
  0 (off; rig MUST set `castShadow=false` on all lights when 0)
- `envMapPreset: 'apartment' | null` — `'apartment'` (high, medium),
  `null` (low, off)
- `hemisphereIntensity: number` — 0.65 (high), 0.55 (medium),
  0.35 (low), 0.25 (off)
- `bounceSpotlightCount: 0 | 1 | 2` — 2 (high), 1 (medium), 0
  (low, off)
- `postProcessing: 'dof+vignette' | 'vignette' | null` —
  `'dof+vignette'` (high), `'vignette'` (medium), `null` (low, off)

Side fill (`intensity 0.45`), back rim (`intensity 0.35`), and key
directional (`intensity 1.6`) SHALL remain constant across tiers.
Tier downgrade SHALL NOT touch them — they are the recognizable
visual identity of the room.

`getRendererConfig(tier)` SHALL also be exported, returning
`{ dpr: [number, number] }` derived from the tier:
- high: `[1, 1.5]`
- medium: `[1, 1.25]`
- low: `[1, 1]`
- off: `[1, 1]`

#### Scenario: All four tiers have explicit preset entries

- **WHEN** importing `LIGHTING_TIER_PRESETS`
- **THEN** `Object.keys(LIGHTING_TIER_PRESETS)` equals exactly
  `['high', 'medium', 'low', 'off']` (in any order)
- **AND** every preset has all five required fields populated

#### Scenario: Tier 'off' disables shadows on all lights

- **WHEN** `<SceneLightingRig tier="off" />` is rendered
- **THEN** every light in the scene has `castShadow === false`
- **AND** `LIGHTING_TIER_PRESETS.off.shadowMapSize === 0`

#### Scenario: Constant lights survive tier downgrade

- **WHEN** comparing `<SceneLightingRig tier="high" />` and
  `<SceneLightingRig tier="low" />`
- **THEN** the side fill `intensity` is 0.45 in both
- **AND** the back rim `intensity` is 0.35 in both
- **AND** the key directional `intensity` is 1.6 in both

### Requirement: Dev mode renders the same rig as production

The behavior of `<SceneLightingRig>` SHALL NOT diverge between
`import.meta.env.DEV` and `import.meta.env.PROD` builds. Both
modes SHALL render the same light tree at the same intensities
for the same `tier` value. The legacy
`scene-performance-config.ts::getOffice3DPerformanceConfig(isDev)`
function SHALL be deleted.

Dev mode MAY override the active tier through
`localStorage.offisim.scene.devOverride.tier` (read by
`useScenePerformanceTier`), but the override produces a normal
tier value — the rig renders that tier identically to how
production would render it.

#### Scenario: getOffice3DPerformanceConfig is deleted

- **WHEN** running `grep -rn "getOffice3DPerformanceConfig" packages/`
- **THEN** the result is zero matches
- **AND** `packages/ui-office/src/components/scene/scene-performance-config.ts`
  does not exist

#### Scenario: Dev tier override resolves to a real tier value

- **WHEN** `localStorage.offisim.scene.devOverride.tier` is `'medium'`
- **AND** `useScenePerformanceTier()` is invoked
- **THEN** the returned `tier` is `'medium'`
- **AND** rendering `<SceneLightingRig tier="medium" />` produces
  the same DOM and three.js scene as in production at medium tier

#### Scenario: PROD build does not include DevLightingPanel

- **WHEN** building production bundle (`pnpm --filter @offisim/web build`)
- **AND** searching the output `apps/web/dist/assets/*.js` for
  the literal `'DevLightingPanel'`
- **THEN** zero JS chunks contain the symbol

### Requirement: Shadow map type is PCFSoftShadowMap and bias is computed

The Canvas SHALL set `gl.shadowMap.type = THREE.PCFSoftShadowMap`
via `<Canvas onCreated={({ gl }) => { gl.shadowMap.type =
THREE.PCFSoftShadowMap; }}>`. The shadow bias for the key
directional light SHALL be computed via the helper
`computeShadowBias({ lightDistance, sceneScale })` exported from
`packages/ui-office/src/lib/shadow-bias.ts`, which SHALL implement
`return -0.0005 - lightDistance * 0.00002 * (sceneScale ?? 1)`.

The hardcoded `shadow-bias={-0.0005}` form SHALL NOT appear in
`Office3DView.tsx` or `scene-lighting-rig.tsx`. Other lights that
do not cast shadows MAY omit `shadow-bias` entirely.

#### Scenario: PCFSoftShadowMap is set on Canvas creation

- **WHEN** `<Canvas onCreated={...} />` invokes the `onCreated`
  handler
- **THEN** `gl.shadowMap.type === THREE.PCFSoftShadowMap`
- **AND** `gl.shadowMap.enabled === true` when any tier is high /
  medium / low

#### Scenario: Shadow bias for default light returns ≈ -0.001

- **WHEN** calling `computeShadowBias({ lightDistance: 28,
  sceneScale: 1 })`
- **THEN** the returned value equals `-0.0005 - 28 * 0.00002 * 1`
  which is `-0.00106`

#### Scenario: No hardcoded shadow-bias in scene files

- **WHEN** running `grep -nE "shadow-bias=\{?-?0\.[0-9]" packages/ui-office/src/components/scene/`
- **THEN** zero matches outside the `scene-lighting-rig.tsx`'s
  one usage of `computeShadowBias(...)`

### Requirement: AmbientStateLight is subordinate to hemisphere fill

`AmbientStateLight` SHALL stop rendering its own root
`<ambientLight>`. Instead, it SHALL behave as a controller that
writes the target color and target intensity (clamped to `[0,
0.25]`) into `gl.scene.userData.ambientStateColor` and
`gl.scene.userData.ambientStateIntensity` on each frame using
`useFrame` and the existing 0.02-step lerp.

The `SceneLightingRig` SHALL mount a single subordinate
`<ambientLight>` and SHALL read the controller's outputs each
frame to drive `ambientLight.color` and `ambientLight.intensity`.
The maximum intensity SHALL be clamped to `0.25` regardless of
ceremony state.

The hemisphere light at `intensity = preset.hemisphereIntensity`
SHALL be the dominant fill across all tiers; the subordinate
ambient SHALL provide the ceremony color tint accent only.

#### Scenario: AmbientStateLight does not render its own ambientLight

- **WHEN** inspecting `office3d-scene-primitives.tsx::AmbientStateLight`
  return value
- **THEN** it returns `null` (or a fragment with no ambient light
  JSX)
- **AND** the only `<ambientLight>` in the scene is the one mounted
  inside `SceneLightingRig`

#### Scenario: Ambient intensity caps at 0.25

- **WHEN** the ceremony state is `'meeting'` (which previously
  drove ambient intensity to 0.6)
- **AND** the rig syncs from `gl.scene.userData.ambientStateIntensity`
- **THEN** the rendered ambient `intensity` is `Math.min(0.25,
  resolvedIntensity)` which equals `0.25`

#### Scenario: Hemisphere remains dominant under ceremony tint

- **WHEN** ceremony is `'meeting'` and tier is `'high'`
- **THEN** hemisphere `intensity` is 0.65
- **AND** subordinate ambient `intensity` ≤ 0.25
- **AND** the dominant fill on backlit surfaces is the hemisphere
  warm/cool gradient, not the ceremony tint

### Requirement: Environment preset is `apartment` at high and medium tiers

The drei `<Environment>` IBL preset SHALL be `'apartment'` when
`preset.envMapPreset != null` (high and medium tiers). The
`'city'` preset SHALL NOT be used. `'lobby'`, `'warehouse'`, and
custom HDRI files SHALL NOT be used in the 1.0 release.

When `preset.envMapPreset === null` (low and off tiers), the rig
SHALL NOT mount `<Environment>`. Metal and glass surfaces under
those tiers SHALL fall back to direct light reflectance only.

#### Scenario: High tier uses apartment preset

- **WHEN** rendering `<SceneLightingRig tier="high" />`
- **THEN** the scene contains one `<Environment preset="apartment" />`
- **AND** `state.scene.environment` is non-null

#### Scenario: Low tier omits Environment

- **WHEN** rendering `<SceneLightingRig tier="low" />`
- **THEN** no `<Environment>` is rendered
- **AND** `state.scene.environment === null`

#### Scenario: City preset is not used anywhere

- **WHEN** running `grep -rn "preset=\"city\"" packages/ui-office/src/components/scene/`
- **THEN** zero matches

### Requirement: Fog is configured at near=20 far=120 across the scene

The `<fog>` directive SHALL be applied exactly once inside the
rig as `<fog attach="fog" args={['#020617', 20, 120]} />`. Other
locations under `packages/ui-office/src/components/scene/` SHALL
NOT mount additional `<fog>` elements.

The numeric near/far values SHALL come from the design Decision 10
analysis (camera at `[0, 22, 28]`, target `[0, 0, 2]`, room depth
30, near plane should engage at the meeting zone).

#### Scenario: Single fog declaration

- **WHEN** running `grep -rn "<fog" packages/ui-office/src/components/scene/`
- **THEN** exactly one match in `scene-lighting-rig.tsx`

#### Scenario: Fog values match the design

- **WHEN** the rig is mounted
- **THEN** `state.scene.fog.near === 20`
- **AND** `state.scene.fog.far === 120`
