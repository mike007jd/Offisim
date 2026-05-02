# scene-3d-performance-fallback Specification

## Purpose
The Office 3D scene SHALL gracefully degrade across four
lighting tiers (`'high' | 'medium' | 'low' | 'off'`) driven by an
FPS-sampled hook (`useScenePerformanceTier`) before falling back
to 2D. Operators on mid-tier hardware SHALL receive a smoother
experience than the previous binary "3D works or 2D forced"
toggle. The capability owns the FPS sampling window, the tier
transition thresholds (50 / 30 / 15 fps), the upgrade hysteresis
(90 consecutive frames above the next-higher boundary), the
2D-fallback floor (3 seconds at `tier='off'` with sustained
< 15 fps), the LOD distance hysteresis (16 / 20 units for
`ServerRack`), and the dev override channel (localStorage). The
capability does NOT own the lighting rig itself or the material
system — those are sister capabilities `scene-3d-lighting` and
`scene-3d-materials`.

## ADDED Requirements

### Requirement: useScenePerformanceTier SHALL sample FPS in a 60-frame window

The hook `useScenePerformanceTier(): { tier: SceneLightingTier; sampledFps: number; isOverridden: boolean }` SHALL be exported from `packages/ui-office/src/components/scene/useScenePerformanceTier.ts`.
The hook SHALL sample frame deltas via `useFrame` (r3f) and
maintain a 60-entry ring buffer of frame times. Average FPS
SHALL be computed each frame as `60 * 1000 / sum(frameTimes)`.

The hook SHALL be invoked exactly once per Canvas (typically
inside `Office3DView`). Multiple invocations SHALL share state
through a hook-internal singleton (or be discouraged via doc
comment).

#### Scenario: 60-frame ring buffer averages frame deltas

- **WHEN** the Canvas has been rendering for 60 frames at a
  steady 16.67 ms per frame
- **THEN** `sampledFps` is approximately 60 (within ±1)
- **AND** the ring buffer is fully populated

#### Scenario: Hook initializes at tier='high' before sampling

- **WHEN** `useScenePerformanceTier()` is called on the first
  render
- **THEN** the returned `tier` is `'high'`
- **AND** `sampledFps` is `0` (no samples yet)

### Requirement: Tier transitions follow asymmetric thresholds with hysteresis

Tier downgrades SHALL fire immediately on the boundary cross.
Tier upgrades SHALL require 90 consecutive frames (1.5 s at
60 fps) above the next-higher boundary.

The mapping from `sampledFps` to candidate tier:
- `sampledFps >= 50` → `'high'`
- `sampledFps >= 30 && sampledFps < 50` → `'medium'`
- `sampledFps >= 15 && sampledFps < 30` → `'low'`
- `sampledFps < 15` → flagged for `'off'`

When the candidate tier is lower than the current tier, the
hook SHALL transition immediately. When the candidate is
higher, the hook SHALL count consecutive frames above the
threshold and transition only after 90 such frames.

#### Scenario: Immediate downgrade on FPS drop

- **WHEN** the current tier is `'high'` and `sampledFps` drops
  to `45`
- **THEN** the next call to `useScenePerformanceTier()` returns
  `tier='medium'` immediately

#### Scenario: 90-frame hysteresis on upgrade

- **WHEN** the current tier is `'medium'` and `sampledFps` rises
  to `52` for 30 consecutive frames
- **THEN** the returned tier remains `'medium'` (not yet
  upgraded)
- **WHEN** `sampledFps` continues at `>= 50` for 90 consecutive
  frames total
- **THEN** the returned tier is `'high'`

#### Scenario: Wobble around 50 fps does not flap

- **WHEN** the current tier is `'medium'` and `sampledFps`
  oscillates `48 / 51 / 49 / 52 / 47 / 50` over 60 frames
- **THEN** the returned tier remains `'medium'` (no upgrade
  triggered because no 90-frame consecutive streak above 50)

### Requirement: tier='off' transitions to 2D fallback after 3 seconds

When `sampledFps < 15` for any single frame, the hook SHALL set
the candidate tier to `'off'`. When the tier remains `'off'`
for `>= 3` consecutive seconds (180 frames at 60 fps;
sample-clock based, not frame-count based, to handle low-fps
correctly), the hook SHALL invoke a `requestForce2D` callback
provided by the consumer. `SceneCanvas` SHALL set
`setForce2D(true)` in response.

If `sampledFps` recovers above 15 before the 3-second window
elapses, the hook SHALL cancel the pending 2D request.

#### Scenario: 2D fallback fires after 3 s at tier='off'

- **WHEN** `sampledFps < 15` for 3 consecutive seconds
- **THEN** `requestForce2D()` is invoked exactly once
- **AND** `SceneCanvas` transitions to 2D rendering

#### Scenario: Recovery before 3 s cancels the 2D request

- **WHEN** `sampledFps` falls below 15 for 2 seconds
- **AND** then rises above 15 for the third second
- **THEN** `requestForce2D()` is NOT invoked
- **AND** the tier transitions back to `'low'` or higher
  according to the standard mapping

#### Scenario: Crash floor is independent of FPS

- **WHEN** the 3D scene throws 2 errors (existing
  `crashCountRef` ≥ 2)
- **THEN** `SceneCanvas` forces 2D regardless of current tier
  or sampled FPS
- **AND** the FPS-driven tier path is bypassed

### Requirement: Dev override via localStorage SHALL take precedence over FPS sampling

When any of the keys `localStorage.offisim.scene.devOverride.tier`, `...env`, `...shadows`, `...hemi`, or `...post` are set, the hook SHALL return the override values regardless of sampled FPS. `isOverridden` SHALL be `true` whenever any override key
exists.

The dev panel `<DevLightingPanel />` SHALL be the only
component that writes these keys. It SHALL only mount when
`import.meta.env.DEV` is true. Production builds SHALL NOT read
or write these keys; the override channel is a dev-only
affordance.

A `[Reset]` button on the dev panel SHALL clear all five keys
and dispatch a `'offisim.scene.devOverride.reset'` custom event;
`useScenePerformanceTier()` SHALL listen for this event and
re-read overrides on receipt.

#### Scenario: Dev tier override beats FPS sampling

- **WHEN** dev mode AND `localStorage.offisim.scene.devOverride.tier`
  is `'low'`
- **AND** `sampledFps === 60`
- **THEN** `useScenePerformanceTier()` returns `tier='low'`
- **AND** `isOverridden === true`

#### Scenario: Reset event clears overrides

- **WHEN** dev mode AND any override is set
- **AND** the user clicks `[Reset]` on the dev panel
- **THEN** all `offisim.scene.devOverride.*` keys are removed from
  localStorage
- **AND** `useScenePerformanceTier()` returns the FPS-derived
  tier on the next frame
- **AND** `isOverridden === false`

#### Scenario: Production build ignores overrides

- **WHEN** `import.meta.env.DEV === false`
- **AND** localStorage somehow contains an override key
- **THEN** the production build does not read it
- **AND** `useScenePerformanceTier()` returns the FPS-derived
  tier

### Requirement: ServerRack LOD threshold uses 16/20 hysteresis

`ServerRackMesh3D` SHALL use a distance-driven LOD swap with
asymmetric thresholds: live → baked at distance `>= 20` units;
baked → live at distance `< 16` units. The component SHALL
track its current LOD level (`'live' | 'baked'`) in component
state, NOT recompute on every frame.

The `useFrame` callback SHALL read the camera position and
compute distance to the rack center each frame, but the LOD
level SHALL only change when the relevant threshold is crossed.

#### Scenario: Live mode at close distance

- **WHEN** the camera distance to a ServerRack center is `< 16`
- **THEN** the LOD level is `'live'`
- **AND** the live mesh LED + vent grid renders

#### Scenario: Baked mode at far distance

- **WHEN** the camera distance is `>= 20`
- **THEN** the LOD level is `'baked'`
- **AND** the baked-texture front panel renders

#### Scenario: 18-unit boundary does not flicker

- **WHEN** the camera position is set such that distance equals
  18 (exactly between thresholds)
- **AND** the previous LOD level was `'live'`
- **THEN** the LOD level remains `'live'` (downgrade requires
  reaching 20)
- **WHEN** the previous LOD level was `'baked'`
- **THEN** the LOD level remains `'baked'` (upgrade requires
  reaching < 16)

### Requirement: Renderer config (DPR) SHALL follow the tier

`getRendererConfig(tier: SceneLightingTier): { dpr: [number, number] }` SHALL be exported from `scene-performance-tier.ts` and SHALL return:
- high: `{ dpr: [1, 1.5] }`
- medium: `{ dpr: [1, 1.25] }`
- low: `{ dpr: [1, 1] }`
- off: `{ dpr: [1, 1] }`

`Office3DView` SHALL pass `getRendererConfig(tier).dpr` to the
`<Canvas dpr=>` prop. Tier change SHALL trigger DPR change
because Canvas re-renders with the new prop.

#### Scenario: High tier requests up to 1.5x DPR

- **WHEN** `tier === 'high'`
- **THEN** the Canvas `dpr` prop is `[1, 1.5]`

#### Scenario: Low and off tiers cap DPR at 1x

- **WHEN** `tier === 'low'` or `tier === 'off'`
- **THEN** the Canvas `dpr` prop is `[1, 1]`

### Requirement: Post-processing chunk is lazy-loaded only at high/medium tier

`<ScenePostprocessing tier={tier} />` SHALL dynamically import
`@react-three/postprocessing` only when the tier requires post
(`high` or `medium`). The dynamic import SHALL be triggered by
the `useEffect` keyed on tier. When tier downgrades to `low` or
`off`, the post components SHALL unmount but the loaded chunk
remains in memory (no proactive cleanup).

The web build output SHALL split the post-processing chunk into
its own JS file (vite default chunk-splitting on dynamic
import); the chunk SHALL NOT appear in the main entry bundle.

#### Scenario: Post chunk loads on first high/medium render

- **WHEN** `tier='high'` is reached for the first time in the
  session
- **THEN** a network request fetches the post-processing chunk
- **AND** subsequent tier changes do not re-fetch

#### Scenario: Post chunk is split from main bundle

- **WHEN** running `pnpm --filter @offisim/web build`
- **AND** searching the output `apps/web/dist/assets/` for a
  chunk file containing `'@react-three/postprocessing'`
- **THEN** the post-processing code lives in a separate chunk
  file, not in the main entry chunk

#### Scenario: Low tier does not load post chunk

- **WHEN** the session starts at `tier='low'` and never enters
  high or medium
- **THEN** no post-processing chunk is requested by the network
