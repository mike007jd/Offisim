# Issues #48 / #49 release evidence — 2026-07-13

Validated the current worktree release bundle only:

- App: `apps/desktop/src-tauri/target/release/bundle/macos/Offisim.app`
- Executable PID: `41663`
- Main window: `CGWindowNumber 10418`, title `Offisim`, bounds `36,33 1440×886`
- Renderer origin: `tauri://localhost`
- Project scope: `/private/tmp/offisim-p4-verify-project`

## #48 native Stage capabilities

- Real PTY launched `/bin/zsh`, accepted keyboard input, printed `FINAL_RELEASE_PTY_OK`, and returned the scoped project path.
- Built-in Browser loaded `https://www.iana.org/help/example-domains`; Back and Reload were live, the address/title updated, and the shell continued to show `You · Manual` plus `No local access`.
- Closing each view returned to Game View and reaped its scoped session.

Evidence: [terminal-release.jpeg](terminal-release.jpeg), [browser-release.jpeg](browser-release.jpeg).

## #49 local Codex pets

- The release app read the real local catalog at `/Users/haoshengli/.codex/pets` without copying or changing it and reported four valid packages: `bubu`, `chub`, `papaluo`, and `tongtong`.
- Initial selection followed Codex's `custom:papaluo` setting. `Sync pets` completed with the `Codex pets synced` toast.
- All four packages were selected in turn and loaded successfully. `papaluo` rendered from its real atlas in 3D; `Bubu` rendered from its real atlas in 2D, proving both modes consume the same selected package instead of bundled Offisim art.
- `Show in office` was toggled off and back on. `Tongtong` remained selected after closing and relaunching the exact release `.app`; the final local selection was restored to `papaluo` with display enabled.
- Stage View Options exposed `Show Codex pet papaluo` plus `Choose pet 4 synced from Codex`.
- The Rust boundary rejects traversal, symlinks, oversized/corrupt/animated/wrong-size WebP files, stale content hashes, missing alpha, and non-transparent unused cells. Focus/reduced-motion and event-priority behavior remain covered by `harness:office-companion`.

Evidence: [catalog/settings](codex-pets-settings-release.jpeg), [papaluo in 3D](codex-pet-papaluo-3d-release.jpeg), [Bubu in 2D](codex-pet-bubu-2d-release.jpeg).

## Gates

- `pnpm validate`: PASS
- `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml`: 185/185 PASS
- `cargo fmt --manifest-path apps/desktop/src-tauri/Cargo.toml --all -- --check`: PASS
- `pnpm harness:office-companion`: PASS
- `pnpm --filter @offisim/desktop build`: PASS; exact release `.app` bundled and ad-hoc signed
- Two independent cold reviews: PASS, no remaining P0–P2
