## MODIFIED Requirements

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
- A procedurally-baked envmap applied via `useProceduralRoomEnvironment(active)` when `preset.envMapPreset != null`. The envmap SHALL be generated at runtime from `RoomEnvironment` (`three/examples/jsm/environments/RoomEnvironment.js`) baked through `THREE.PMREMGenerator.fromScene(env, 0.04)` and assigned to `state.scene.environment`. The envmap SHALL NOT be loaded from any network URL or external CDN. Drei's `<Environment preset="..."/>` (which fetches HDR files from a CDN) SHALL NOT be used.
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

#### Scenario: Rig produces hemisphere + key + side + rim + bounces + procedural envmap

- **WHEN** rendering `<SceneLightingRig tier="high" agents={...} />`
- **THEN** the rendered three.js scene contains exactly:
  - 1 hemisphere light at intensity 0.65
  - 1 directional light at `[12, 25, 12]` intensity 1.6 with
    castShadow true
  - 1 directional light at `[-15, 12, -10]` intensity 0.45
  - 1 directional light at `[5, 8, -18]` intensity 0.35
  - 2 spotlights (front + back bounce)
  - `state.scene.environment` set to a `THREE.Texture` PMREM-baked from `RoomEnvironment` (no network fetch)
  - 1 ambient light at intensity ≤ 0.25 driven by ambient state

#### Scenario: Envmap is offline-safe

- **WHEN** `<SceneLightingRig tier="high" />` mounts in a Tauri release build with strict CSP and no network access
- **THEN** the envmap is generated successfully without any HTTP / fetch / WebSocket / file:// request
- **AND** the React tree contains no `@react-three/drei` `<Environment>` component
- **AND** `state.scene.environment` is non-null

#### Scenario: Envmap dispose on tier flip to off

- **WHEN** `<SceneLightingRig tier="high" />` is rendered, then re-rendered as `<SceneLightingRig tier="off" />` (where `LIGHTING_TIER_PRESETS.off.envMapPreset === null`)
- **THEN** the previous PMREM-baked envmap texture and `THREE.PMREMGenerator` are disposed
- **AND** `state.scene.environment` is null

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
  `null` (low, off). The `'apartment'` value SHALL be interpreted as a boolean signal "envmap on", not as a CDN preset name; the rig builds it procedurally via `RoomEnvironment` regardless of the string value.
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

## ADDED Requirements

### Requirement: useProceduralRoomEnvironment SHALL be the SSOT for 3D office envmap

A new hook `useProceduralRoomEnvironment(active: boolean): void` exported from `packages/ui-office/src/components/scene/use-procedural-room-environment.ts` SHALL own the lifecycle of the 3D scene's PBR environment map.

When `active === true`:
- The hook SHALL construct a new `RoomEnvironment` instance (from `three/examples/jsm/environments/RoomEnvironment.js`)
- The hook SHALL construct a `THREE.PMREMGenerator` bound to the active renderer obtained via `useThree()`
- The hook SHALL bake the room scene via `pmremGenerator.fromScene(env, 0.04)` into a `THREE.Texture`
- The hook SHALL assign the baked texture to `state.scene.environment`

When `active === false`, on unmount, or on `active` flip from `true → false`:
- The hook SHALL dispose the PMREM-baked texture
- The hook SHALL dispose the `THREE.PMREMGenerator`
- The hook SHALL reset `state.scene.environment = null` (only if the scene's current environment is the one this hook set; never clobber an external setter)

The hook SHALL NOT load any HDR / equirectangular / cube image from disk or network. The envmap SHALL be 100% procedurally generated.

#### Scenario: Hook bakes envmap on activate

- **WHEN** `useProceduralRoomEnvironment(true)` is called inside a mounted Canvas
- **THEN** `state.scene.environment` is a `THREE.Texture` instance
- **AND** no fetch / XHR / WebSocket / file:// request fires

#### Scenario: Hook disposes on deactivate

- **WHEN** the hook re-renders with `active === false` after having been `true`
- **THEN** the previously baked texture's `.dispose()` was called
- **AND** the previously created `PMREMGenerator.dispose()` was called
- **AND** `state.scene.environment === null`

#### Scenario: Hook disposes on unmount

- **WHEN** the host component unmounts while `active === true`
- **THEN** the baked texture and PMREMGenerator are disposed
- **AND** `state.scene.environment === null` (only if it points to the disposed texture)
