# Codex Project file boundary — release evidence

Checked on 2026-07-20 against installed `codex-cli 0.144.6` and the current
[Codex App Server file-change approval contract](https://learn.chatgpt.com/docs/app-server#file-change-approvals).

## Regression

The first release run proved that checking only optional `grantRoot` was not
sufficient: a file-change approval without that field could be accepted and
write outside the selected Project.

The corrected adapter records the proposed `fileChange.changes` paths from the
authoritative item notification before the approval request. Missing path
authority, traversal, symlink escape, an outside absolute path, or an outside
`grantRoot` now receives a native `decline` response without presenting a
misleading approval choice.

## Release verification

- App:
  `apps/desktop/src-tauri/target/aarch64-apple-darwin/release/bundle/macos/Offisim.app`
- Window: `Offisim`; renderer URL: `tauri://localhost`
- Project: `/private/tmp/offisim-w6-live-project`
- Engine: `Codex CLI · Auto`
- Project write: `d2-fixed2-inside-20260720.txt` created with exact content
  `D2_FIXED2_INSIDE_OK`.
- Outside write: `/private/tmp/offisim-codex-boundary-fixed2-outside-20260720.txt`
  rejected; independent filesystem check confirmed the path did not exist.
- UI result: final response reports `patch rejected by user`; no approval control
  was surfaced for the outside path.
- Test sentinels were moved to Trash after verification.

Screenshot: `release-boundary-rejected.png` (1243 × 768).

## Gates

- `cargo test --locked --manifest-path apps/desktop/src-tauri/Cargo.toml` —
  469 passed, 0 failed.
- `node scripts/release-gates.mjs --lane=node` — 4 gates green; harness inventory
  73/73.
- `pnpm --filter @offisim/desktop build` — signed release app built successfully;
  notarization skipped because notarization credentials were unavailable.
