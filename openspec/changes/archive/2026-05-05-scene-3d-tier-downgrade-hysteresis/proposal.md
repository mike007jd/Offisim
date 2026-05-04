# scene-3d-tier-downgrade-hysteresis

## Why

桶 2b of the UX/IA 9-bucket queue. User-provided release `.app`
rotation videos
(`.live-verify/bucket-2b-rotation/release-app-{slow,fast}-rotation-window.mp4`)
showed Office 3D lighting visibly desaturating mid-fast-drag —
cyan/mint floor → grey, hemisphere darkens, env reflections drop —
recovering only ~1.5 s after the user released. The plan flagged
three candidate root causes (tier downgrade vs. intensity recompute
vs. hemisphere swap); the slow-vs-fast frame comparison and
`useScenePerformanceTier` source isolated it to **tier downgrade**:

`useScenePerformanceTier` had **asymmetric** thresholds. Downgrade
fired instantly on a single sub-50fps sample; upgrade required 90
consecutive frames at the higher candidate. A burst of fast-orbit
geometry updates dipping one frame below 50 fps was enough to drop
the tier from `'high'` to `'medium'` (or lower), which made
`SceneLightingRig` swap to a smaller preset — `envMapPreset = null`
at `'low'`, lower `hemisphereIntensity`, fewer bounce spotlights, no
postprocessing — all visible mid-rotation. The 90-frame upgrade
window then held the user in that degraded state for ~1.5 s after
release.

Hemisphere-swap and intensity-recompute were ruled out: hemisphere
direction is fixed at `(0,1,0)` and not coupled to camera; tier
preset values are constants per tier, no per-frame recompute.

## What Changes

- `useScenePerformanceTier` adds `DOWNGRADE_FRAMES = 30` (≈ 0.5 s @
  60 fps) hysteresis, mirroring the existing `UPGRADE_FRAMES = 90`
  asymmetry but in the down direction. A new
  `downgradeFramesRef: useRef<number>` counts consecutive frames
  where `rank(candidate) < rank(tier)`; `setTier(candidate)` fires
  only when the counter reaches the threshold. The counter resets
  whenever `candidate >= tier` (upgrade or steady-state branches).
- `OFF_FALLBACK_MS = 3000` and the `requestForce2D` 2D-fallback
  branch are untouched — they key on `candidate === 'off'`, not on
  `tier`, so the safety net still fires after 3 s of sustained sub-15
  fps regardless of the new mid-tier downgrade gate.
- Spec delta: modifies the existing "Tier transitions follow
  asymmetric thresholds with hysteresis" Requirement in
  `scene-3d-performance-fallback` to specify both directions are
  hysteresis-gated, with a 30-frame threshold downgrade and the
  existing 90-frame threshold upgrade. The "Immediate downgrade on
  FPS drop" scenario is replaced with a "30-frame hysteresis on
  downgrade" scenario.

## Impact

- **Affected capability**: `scene-3d-performance-fallback` (existing,
  modified).
- **Affected code**:
  `packages/ui-office/src/components/scene/useScenePerformanceTier.ts`
  only.
- **Migration**: none. Single-file behavioral change.
- **Risk**: low. Worst-case is a real sustained slowdown takes 0.5 s
  longer to react than before the change; well within the 3 s
  off→2D safety net.

## Out of Scope (deferred)

- Lighting fade between tier transitions. Tier presets carry
  binary-flip values (`envMapPreset: null` vs `'apartment'`,
  `bounceSpotlightCount: 0|1|2`, `postProcessing: null | 'vignette'
  | 'dof+vignette'`) — interpolation across these is not a one-line
  change, and the hysteresis fix alone resolves the user-visible
  flicker per release `.app` live verify.
