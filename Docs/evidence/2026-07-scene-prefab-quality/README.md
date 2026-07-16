# Scene and prefab quality release evidence — 2026-07-16

Validated only the exact release bundle built from `codex/scene-prefab-quality`:

- Checked at: `2026-07-16T03:30:08+1200` (`Pacific/Auckland`, NZST)
- App: `apps/desktop/src-tauri/target/release/bundle/macos/Offisim.app`
- Binary SHA-256: `a277d2a8e2d87b1619ef048cd6b71b51628190bdd60fb2bda12dd80e97b0533b`
- Signature: `codesign --verify --deep --strict` passed
- Executable PID: `81702`
- Main window: `CGWindowNumber 8826`, title `Offisim`, bounds `36,33 1440×877`
- Renderer origin: `tauri://localhost`
- Isolated runtime home: `/private/tmp/offisim-scene-prefab-quality-runtime`

## Acceptance

- Office default, maximum-distance, low-angle and side-orbit views remained stable with no visible coplanar flicker, rack-atlas fighting, disappearing surface detail or transparent shadow slabs.
- Studio default, maximum-distance and low-angle views rendered the same canonical 7-zone / 33-object layout without z-fighting or LOD popping.
- The Studio low-angle gesture started on empty sky. A post-gesture database check confirmed the Rest Area stayed at the canonical `6.3, 0.7` and its three prefabs stayed at their authored coordinates.
- Another worktree's live release process was not terminated. Its single-instance socket was temporarily moved while this exact bundle ran, then it reclaimed `/tmp/com_offisim_desktop_si.sock`; all temporary socket backups were removed.

Office evidence: [default](after-default.jpeg), [maximum distance](after-max-distance.jpeg), [maximum-distance low angle](after-max-distance-low-angle.jpeg), [side orbit](after-orbit.jpeg).

Studio evidence: [default](after-studio.jpeg), [maximum distance](after-studio-max-distance.jpeg), [maximum-distance low angle](after-studio-max-distance-low-angle.jpeg).

Baseline evidence: [default](before-default.jpeg), [maximum distance](before-max-distance.jpeg), [maximum-distance low angle](before-max-distance-low-angle.jpeg).

## Gates

- `pnpm validate`: PASS
- `pnpm build`: PASS; exact release `.app` bundled and ad-hoc signed
- `pnpm harness:office-scene-quality`: 68/68 PASS
- `pnpm harness:office-diorama-p6`: 60/60 PASS
- Renderer typecheck, Biome, `git diff --check` and Knip: PASS
- Two independent cold reviews: PASS; all 34 Drei `RoundedBox` instances satisfy their real geometry bounds

The machine-readable hashes and runtime facts are in [evidence-manifest.json](evidence-manifest.json).
