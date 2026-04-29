# Offisim Runtime Execution Report - 2026-04-29

## R2 carry-over

R2 evidence and closure remain in `Docs/04_runtime_experience/EXECUTION_REPORT_2026-04-28.md`.
R3 was started only after the R2 change was archived and `openspec validate --all --strict`
passed.

## R3 - sandbox honesty and kanban CAS

Status: **implementation complete, RC live verification blocked, tag not allowed**.

### Implementation commits

- `3f618ce9 fix(runtime): harden gateway builtin tool sandbox`
- `d8491cd6 fix(desktop): gate privileged invokes with capabilities`
- `eb74daab chore(harness): reject self-attesting scenarios`
- `d71084bd fix(runtime): enforce kanban transition CAS`
- `c2180948 docs(spec): centralize kanban runtime truth`
- `cceeedef fix(runtime): reduce hot-path resource use`
- `8c7709d2 chore(harness): clean RC runtime literals`
- `0a153de0 fix(desktop): unblock release verification gates`
- `50c1e296 fix(runtime): gate desktop builtins to gateway lane`

### Gate commands

Passed before the latest release build:

- `pnpm --filter @offisim/shared-types build`
- `pnpm --filter @offisim/core typecheck`
- `pnpm --filter @offisim/core build`
- `pnpm --filter @offisim/db-local typecheck`
- `pnpm --filter @offisim/web typecheck`
- `pnpm lint` (exit 0; 10 pre-existing warnings)
- `pnpm exec node scripts/harness-contract.mjs`
- `pnpm exec node scripts/harness-replay.mjs`
- `pnpm exec node scripts/harness-soak.mjs --iterations 20 --concurrency 4`
- `git diff --check`

Earlier Rust gates after the R3 Rust changes also passed:

- `cd apps/desktop/src-tauri && cargo check`
- `cd apps/desktop/src-tauri && cargo clippy -- -D warnings`

Release build passed after the latest follow-up:

- `pnpm --filter @offisim/desktop build`
- Release app: `apps/desktop/src-tauri/target/release/bundle/macos/Offisim.app`
- DMG: `apps/desktop/src-tauri/target/release/bundle/dmg/Offisim_0.0.1_aarch64.dmg`

### Computer Use evidence

1. Project creation + workspace root: **passed**.
   - Project: `R3 RC Live Verify 2026-04-29`
   - Workspace: `/Users/haoshengli/Documents/Offisim-R3-RC-Workspace-20260429`
   - Screenshot: `Docs/04_runtime_experience/evidence/2026-04-29-r3/01-project-workspace-root.png`

2. Direct-chat `read_file('README.md')`: **blocked**.
   - Two release-app attempts were made against YOLO Master.
   - Both task runs finished `blocked`.
   - `tool_calls` count for the two attempts was `0`.
   - The first attempt was blocked by the completion verifier with `No verification evidence tool ran before completion`.
   - The second attempt also had no `tool_calls`; the UI text claimed an equivalent local read, which is not acceptable RC evidence.

### Root cause found during live verification

The local WebKit provider config stores:

```json
{"productId":"codex","accessMode":"local-auth","executionLane":"gateway","model":"gpt-5.4","providerVariantId":"codex-local-auth"}
```

But `codex-local-auth` only supports `codex-agent-sdk`, so provider resolution clamps the effective lane away from gateway. Before `50c1e296`, Tauri runtime still injected `read_file` / `write_file` / `bash` into the employee tool pool even when the effective lane was not gateway. That made SDK lane appear tool-capable while the sidecar could not execute Offisim fs/shell tools.

Fix applied: desktop builtin tools are now created and exposed only when `resolvedProvider.executionLane === 'gateway'`. This prevents SDK lane from advertising fake Offisim fs/shell capability.

### Remaining RC live verification

The following Section 7 items are **not passed** and must stay blocking:

- direct-chat read_file with real Offisim tool call
- direct-chat write_file + read back
- direct-chat out-of-bounds rejection with redacted error
- direct-chat bash timeout
- SOP boss-proxy true completion through the release app
- kanban illegal transition through UI or debug invoke

Current blocker: no gateway credential is stored on this device (`runtime_secret.txt` is absent), and the active saved provider is Codex local-auth, whose effective lane is SDK. Running the rest of Section 7 under this config would either fail honestly or test the wrong lane.

### Tag gate

`v1.1.0-rc.1` **must not be tagged** from this state. Implementation and deterministic gates are green, but Section 7 has not passed under a real gateway-lane release-app session.
