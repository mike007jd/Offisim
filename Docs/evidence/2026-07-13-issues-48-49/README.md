# Issues #48 / #49 release evidence — 2026-07-13

Validated the current worktree release bundle only:

- App: `apps/desktop/src-tauri/target/release/bundle/macos/Offisim.app`
- Executable PID: `96166`
- Main window: `CGWindowNumber 10340`, title `Offisim`, bounds `36,33 1440×886`
- Renderer origin: `tauri://localhost`
- Project scope: `/private/tmp/offisim-p4-verify-project`

## #48 native Stage capabilities

- Real PTY launched `/bin/zsh`, accepted keyboard input, printed `FINAL_RELEASE_PTY_OK`, and returned the scoped project path.
- Built-in Browser loaded `https://www.iana.org/help/example-domains`; Back and Reload were live, the address/title updated, and the shell continued to show `You · Manual` plus `No local access`.
- Closing each view returned to Game View and reaped its scoped session.

Evidence: [terminal-release.jpeg](terminal-release.jpeg), [browser-release.jpeg](browser-release.jpeg).

## #49 Codex companion

- The generated companion rendered in both the 3D diorama and the 2D mirror from the same state sheet and projection.
- View options exposed `Codex companion — Ambient only · no AI work` with an accessible pressed state.
- Turning the option off removed the companion in both modes. Closing and relaunching the exact release app preserved `off`; it was restored to `on` after the persistence check.
- The companion stayed outside employee interaction targets; Focus/reduced-motion and all event-priority states are covered by `harness:office-companion`.

Evidence: [companion-3d-release.jpeg](companion-3d-release.jpeg), [companion-2d-release.jpeg](companion-2d-release.jpeg).

## Gates

- `pnpm validate`: PASS
- `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml`: 175/175 PASS
- `cargo fmt --manifest-path apps/desktop/src-tauri/Cargo.toml --all -- --check`: PASS
- `pnpm harness:office-companion`: PASS
- Two independent cold reviews: PASS, no remaining P0–P2
