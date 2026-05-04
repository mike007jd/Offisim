# scene-3d-performance-fallback delta

## MODIFIED Requirements

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
