# A3 shell environment boundary correction

Checked at: 2026-07-20 17:44:07 NZST (+1200)

## Contract restored

- Ordinary built-in shell execution receives only `BASE_ENV_ALLOWLIST`.
- Git execution additionally receives `SSH_AUTH_SOCK` and keeps its Git-only pinned variables.
- The shared helper owns only the common scrub operation; each caller owns its additions.

This matches the behavior immediately before PR #104. No renderer or UI files changed.

## Verification

- Focused Rust regressions: passed.
- Full desktop Rust suite: 470 passed, 0 failed.
- Node release gates: 4/4 green, including 73/73 harnesses and the production dependency audit.
- Release bundle: built from this worktree at `apps/desktop/src-tauri/target/aarch64-apple-darwin/release/bundle/macos/Offisim.app`.
- Signing: valid Developer ID signature; Gatekeeper accepted the local bundle. Notarization was skipped because notarization credentials are not configured.
- Release UI smoke: Computer Use attached the exact bundle and confirmed the `Offisim` window at `tauri://localhost` rendered normally.

## Live boundary status

Computer Use ran a real Pi-backed conversation in the exact release bundle. Its
built-in Bash tool checked the ordinary-shell environment and returned exactly
`A3_SHELL_BOUNDARY_PASS`, confirming that `SSH_AUTH_SOCK` was unset. The run
completed all four stages; no raw credential was read, displayed, or recorded.
