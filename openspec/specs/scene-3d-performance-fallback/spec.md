# scene-3d-performance-fallback Specification

## Purpose

Defines the Office 3D performance fallback contract: frame sampling, hysteresis-based lighting-tier changes, development overrides, and the 2D fallback request path when WebGL repeatedly fails or cannot sustain the required frame rate.
## Requirements
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

### Requirement: Tier transitions follow symmetric hysteresis on both directions

Tier downgrades SHALL require 30 consecutive frames where
`rank(candidate) < rank(tier)` (≈ 0.5 s at 60 fps) before
transitioning. Tier upgrades SHALL require 90 consecutive frames
(≈ 1.5 s at 60 fps) above the next-higher boundary.

The mapping from `sampledFps` to candidate tier:
- `sampledFps >= 50` → `'high'`
- `sampledFps >= 30 && sampledFps < 50` → `'medium'`
- `sampledFps >= 15 && sampledFps < 30` → `'low'`
- `sampledFps < 15` → flagged for `'off'`

When the candidate tier is lower than the current tier, the hook
SHALL increment a `downgradeFramesRef` counter and apply
`setTier(candidate)` only when the counter reaches 30. When the
candidate is higher, the hook SHALL increment a separate
`upgradeFramesRef` counter and apply `setTier(candidate)` only when
that counter reaches 90. When `candidate === tier` (or in the
upgrade/downgrade branches when one fires), both counters SHALL
reset to zero so direction changes always start a fresh window.

The `'off'` candidate SHALL continue to engage the
`OFF_FALLBACK_MS = 3000` 2D-fallback branch independently of
mid-tier downgrade gating; the 2D fallback timer keys on
`candidate === 'off'`, not on `tier`, so a 3 s sustained sub-15-fps
window still triggers `requestForce2D()` regardless of whether the
hysteresis-gated `setTier('off')` has fired yet.

#### Scenario: 30-frame hysteresis on downgrade

- **WHEN** the current tier is `'high'` and `sampledFps` drops to
  `45` for 1 frame and recovers to `>= 50` on the next frame
- **THEN** the returned `tier` remains `'high'` (single-frame dip
  does not trigger downgrade)
- **WHEN** `sampledFps` stays below `50` for 30 consecutive frames
- **THEN** the returned `tier` is `'medium'`

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
- **AND** if the current tier were `'high'` under the same
  oscillation, it would also remain `'high'` (no downgrade
  triggered because no 30-frame consecutive streak below 50)

#### Scenario: Fast camera-orbit drag does not strip lighting preset

- **WHEN** the user performs a fast camera-orbit drag that produces
  fewer than 30 consecutive sub-50-fps frames
- **THEN** the returned tier remains `'high'`
- **AND** the `SceneLightingRig` preset (env map, hemisphere
  intensity, spotlight count, postprocessing) does NOT swap during
  the drag
- **AND** the user does NOT see mid-rotation desaturation or
  hemisphere intensity drops

### Requirement: tier='off' transitions to 2D fallback after 3 seconds

When `sampledFps < 15` for any single frame, the hook SHALL set
the candidate tier to `'off'`. When the tier remains `'off'`
for `>= 3` consecutive seconds (180 frames at 60 fps;
sample-clock based, not frame-count based, to handle low-fps
correctly), the hook SHALL invoke a `requestForce2D` callback
provided by the consumer. `SceneCanvas` SHALL set
`force2D = true` (via its internal fallback-state reducer) in response.

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

#### Scenario: Crash floor accumulates but does not gate explicit user retry

- **WHEN** the 3D scene throws 2 or more errors and the internal fallback-state reducer's `crashCount >= 2`
- **THEN** `SceneCanvas` keeps `force2D === true` until an explicit user retry signal is received
- **AND** the FPS-driven tier path is bypassed while `force2D === true`
- **WHEN** an explicit user retry signal arrives (`viewModeNonce` bump or `<SceneFallbackBadge>` click)
- **THEN** the reducer dispatches `requestRetry`, resetting `crashCount = 0` and `force2D = false`
- **AND** the next render attempts 3D again

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

### Requirement: SceneCanvas SHALL own a single fallback-state reducer

`SceneCanvas` SHALL replace its previous `useState<boolean>` + `useRef<number>` pair (`force2D`, `crashCountRef`) with a single `useReducer` driving:

```ts
type FallbackState = {
  force2D: boolean;
  crashCount: number;
  lastError: string | null;
};
type FallbackAction =
  | { type: 'reportCrash'; error: Error }
  | { type: 'fpsTierOff' }
  | { type: 'requestRetry' }
  | { type: 'viewModeBumped' };
```

Reducer transitions:
- `reportCrash`: `crashCount += 1`, `force2D = true`, `lastError = error.message`
- `fpsTierOff`: `force2D = true` (idempotent); `crashCount` and `lastError` unchanged. This action carries the FPS-driven performance signal from `useScenePerformanceTier` (3 s sustained `tier='off'`) and SHALL NOT bump the crash floor — it is a perf degradation, not an exception.
- `requestRetry`: `crashCount = 0`, `force2D = false`, `lastError = null`
- `viewModeBumped`: same as `requestRetry`

The `SceneErrorBoundary` `onError` callback SHALL dispatch `reportCrash`. The 3D `onRequestForce2D` callback wired to `useScenePerformanceTier` SHALL dispatch `fpsTierOff`. No code outside the reducer SHALL mutate `force2D` or `crashCount`.

#### Scenario: Reducer is the only writer of force2D / crashCount

- **WHEN** searching `SceneCanvas.tsx` for direct mutations of `force2D` or `crashCount`
- **THEN** all mutations go through the reducer's three actions
- **AND** there is no `useState<boolean>('force2D')` or `useRef<number>('crashCount')` in the file

#### Scenario: Crash dispatch updates state atomically

- **WHEN** the inner `<SceneErrorBoundary>` catches an error
- **THEN** `dispatch({ type: 'reportCrash', error })` fires exactly once
- **AND** the next render reads `force2D === true`, `crashCount === <prev + 1>`, `lastError === error.message`

### Requirement: Explicit user retry SHALL always reset force2D regardless of crashCount

The 3D / 2D toggle in `OfficeSceneSurface` SHALL bump a numeric `viewModeNonce` on every click — even when `viewMode` does not change value. `SceneCanvas` SHALL accept `viewModeNonce: number` as a non-optional prop.

`SceneCanvas` SHALL `useEffect [viewModeNonce]` (skipping the initial render via a `useRef` guard) and dispatch `{ type: 'viewModeBumped' }`. The `viewModeBumped` action SHALL reset `force2D` and `crashCount` regardless of the current `crashCount` value (including `>= 2`).

The `<SceneFallbackBadge>` click handler SHALL dispatch `{ type: 'requestRetry' }` directly, with the same effect.

#### Scenario: Bumping viewModeNonce resets force2D after multiple crashes

- **WHEN** the 3D scene has crashed 3 times and `state.crashCount === 3`, `state.force2D === true`
- **WHEN** the user clicks the 3D toggle button (which bumps `viewModeNonce` by 1)
- **THEN** the next render dispatches `viewModeBumped`
- **AND** `state.force2D === false`, `state.crashCount === 0`, `state.lastError === null`
- **AND** `effectiveViewMode === '3D'`

#### Scenario: Bumping viewModeNonce when viewMode prop did not change still resets

- **WHEN** `viewMode === '3D'` and `viewModeNonce === 7` and force2D became true via crash
- **WHEN** the parent bumps to `viewModeNonce === 8` without changing `viewMode`
- **THEN** the reducer receives `viewModeBumped` and resets force2D

#### Scenario: SceneFallbackBadge click resets

- **WHEN** the SceneFallbackBadge is rendered and the user clicks it
- **THEN** the click handler dispatches `requestRetry`
- **AND** `state.force2D === false`, `state.crashCount === 0`

### Requirement: Force-2D ghost state SHALL surface a visible affordance

When `viewMode === '3D'` (user has selected 3D in the toggle) and `effectiveViewMode === '2D'` (force2D is active because of crash or FPS-tier-off), `SceneCanvas` SHALL render a `<SceneFallbackBadge>` overlay on top of the 2D canvas in the bottom-right corner. The badge SHALL display "3D unavailable · Retry" and SHALL be clickable to trigger a retry.

The badge SHALL NOT render when:
- `viewMode === '2D'` (user explicitly chose 2D — no ghost state)
- `effectiveViewMode === '3D'` (no fallback active)

The badge SHALL use token-driven colors only (`bg-warning-muted`, `text-warning`, `border-warning` Tailwind utilities resolved via `@theme inline`). No raw hex / rgba literals.

#### Scenario: Badge appears in ghost state

- **WHEN** `viewMode === '3D'` and the 3D scene has crashed (`force2D === true`)
- **THEN** the rendered DOM contains a `<button>` matching "3D unavailable" + "Retry" positioned `absolute bottom-3 right-3`

#### Scenario: Badge is hidden in normal 3D

- **WHEN** `viewMode === '3D'` and `force2D === false`
- **THEN** the SceneFallbackBadge is not in the rendered DOM

#### Scenario: Badge is hidden when user chose 2D

- **WHEN** `viewMode === '2D'` (regardless of `force2D`)
- **THEN** the SceneFallbackBadge is not in the rendered DOM

### Requirement: SceneErrorPanel SHALL be theme-aware

The fallback panel rendered by `SceneErrorBoundary.render()` when `state.hasError === true` and no custom `fallback` prop is provided SHALL be a function component `<SceneErrorPanel error={...} onRetry={...} />` (extracted from `SceneCanvas.tsx` to a new file `packages/ui-office/src/components/scene/scene-error-panel.tsx`).

The component SHALL consume `useSceneColors()` for the surface background (`sceneBackground` field). All other colors SHALL come from `@theme inline`-resolved Tailwind utilities (e.g., `text-destructive`, `text-muted-foreground`, `bg-muted`, `text-foreground`). No raw hex / rgba literals SHALL appear in this file.

The previous inline-rendered `<div className="flex items-center justify-center h-full bg-black/50 text-white">...</div>` block in `SceneCanvas.tsx` SHALL be removed.

#### Scenario: Error panel adapts to light theme

- **WHEN** the active theme is `'light'` and a 3D crash bubbles to the outer `SceneErrorBoundary`
- **THEN** the rendered panel's background color matches `LIGHT_SCENE_3D.sceneBackground` (`#e8edf4`)
- **AND** the destructive text color matches the light-theme destructive token

#### Scenario: Error panel adapts to dark theme

- **WHEN** the active theme is `'dark'` and a 3D crash bubbles to the outer `SceneErrorBoundary`
- **THEN** the rendered panel's background color matches `DARK_SCENE_3D.sceneBackground` (`#020617`)

#### Scenario: SceneCanvas.tsx is exemption-free

- **WHEN** running `pnpm tokens:lint-hex`
- **THEN** `SceneCanvas.tsx` reports zero violations
- **AND** `SceneCanvas.tsx` does not carry a `// raw-hex-allowed-file:` header
