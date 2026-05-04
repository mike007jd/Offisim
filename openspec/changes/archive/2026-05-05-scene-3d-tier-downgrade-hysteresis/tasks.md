# Tasks — scene-3d-tier-downgrade-hysteresis

## 1. Implementation

- [x] 1.1 Add `DOWNGRADE_FRAMES = 30` constant (≈ 0.5 s @ 60 fps) with load-bearing JSDoc explaining the asymmetric pairing with `UPGRADE_FRAMES = 90` and the user-visible symptom.
- [x] 1.2 Add `downgradeFramesRef = useRef(0)` alongside the existing `upgradeFramesRef`.
- [x] 1.3 In the `candidate < tier` branch, increment the counter and fire `setTier(candidate)` only when it reaches `DOWNGRADE_FRAMES`. Reset the counter on `candidate >= tier`.
- [x] 1.4 Confirm OFF→2D fallback path untouched: `offSinceRef` keys off `candidate === 'off'`, not `tier`; the 3 s `OFF_FALLBACK_MS` timer fires independently of mid-tier downgrade gating.

## 2. Spec delta

- [x] 2.1 MODIFY existing `scene-3d-performance-fallback/spec.md` Requirement "Tier transitions follow asymmetric thresholds with hysteresis": both directions are now hysteresis-gated; downgrade requires 30 consecutive sub-threshold frames, upgrade 90.
- [x] 2.2 REPLACE scenario "Immediate downgrade on FPS drop" with "30-frame hysteresis on downgrade".
- [x] 2.3 Keep upgrade hysteresis scenario + wobble scenario + off→2D scenarios as-is (still accurate).

## 3. Live verify

- [x] 3.1 Slow rotation baseline: `release-app-slow-rotation-window.mp4` — tier stays high, cyan/mint floor + warm hemisphere stable.
- [x] 3.2 Fast rotation reverify: `offisim-fast-rotation-horizontal-20260504.mov` — horizontal continuous fast-drag, no mid-drag desaturation, hemisphere intensity stable throughout. Confirms the hysteresis prevents single-frame dips from triggering the preset swap.
- [x] 3.3 Evidence in `.live-verify/bucket-2b-rotation/` (verify-record.md + 2 window-mp4 + 2 reference frames + horizontal-mov).

## 4. Documentation + archive gate

- [x] 4.1 9-bucket queue (`memory/project_ux_9_bucket_queue.md`) marks 桶 2b archived with this change name.
- [x] 4.2 Protocols ledger: no protocol touched.
- [x] 4.3 OpenSpec Archive Gate three-check.
- [ ] 4.4 Run `/opsx:archive scene-3d-tier-downgrade-hysteresis`.
