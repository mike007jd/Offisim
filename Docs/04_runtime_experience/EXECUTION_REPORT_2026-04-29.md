# Offisim Runtime Execution Report - 2026-04-29

## R2 carry-over

R2 evidence and closure remain in `Docs/04_runtime_experience/EXECUTION_REPORT_2026-04-28.md`.
R3 was started only after the R2 change was archived and `openspec validate --all --strict`
passed.

## R3 - sandbox honesty and kanban CAS

Status: **release live verification passed after follow-up fixes; post-fix full gates passed**.

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
- follow-up commit: closes live verification blockers found after `50c1e296`

### Gate commands

Passed after the live-verification follow-up fixes:

- `pnpm --filter @offisim/shared-types build`
- `pnpm --filter @offisim/core typecheck`
- `pnpm --filter @offisim/core build`
- `pnpm --filter @offisim/db-local typecheck`
- `pnpm --filter @offisim/ui-office build`
- `pnpm --filter @offisim/web typecheck`
- `pnpm lint` (exit 0; 10 pre-existing warnings)
- `pnpm exec node scripts/harness-contract.mjs`
  - `scenarioCount: 40`
- `pnpm exec node scripts/harness-replay.mjs`
- `pnpm exec node scripts/harness-soak.mjs --iterations 20 --concurrency 4`
- `git diff --check`

Rust gates after the R3 Rust changes also passed:

- `cd apps/desktop/src-tauri && cargo check`
- `cd apps/desktop/src-tauri && cargo clippy -- -D warnings`

Release build passed after rebuilding the UI package that feeds the desktop bundle:

- `pnpm --filter @offisim/desktop build`
- Release app: `apps/desktop/src-tauri/target/release/bundle/macos/Offisim.app`
- DMG: `apps/desktop/src-tauri/target/release/bundle/dmg/Offisim_0.0.1_aarch64.dmg`
- Launch command used for Computer Use attach: `open -b com.offisim.desktop`

### Computer Use evidence

1. Project creation + workspace root: **passed**.
   - Project: `R3 RC Live Verify 2026-04-29`
   - Workspace: `/Users/haoshengli/Documents/Offisim-R3-RC-Workspace-20260429`
   - Screenshot: `Docs/04_runtime_experience/evidence/2026-04-29-r3/01-project-workspace-root.png`

2. Direct-chat `read_file('README.md')`: **passed**.
   - Task run: `tr-dc-a8649419-b4b0-4960-bf71-109605705b48`
   - Employee: `642d114b-d837-4771-846e-085785f7ac1f` (`YOLO Master`)
   - `mcp_audit_log`: `read_file {"path":"README.md"}` returned the workspace README bytes.
   - Physical file readback matched:
     `/Users/haoshengli/Documents/Offisim-R3-RC-Workspace-20260429/README.md`

3. Direct-chat `write_file` + `read_file` readback: **passed**.
   - Task run: `tr-dc-a0034211-bf72-4cea-8a04-e1ce60c87015`
   - Employee: `6ff53fde-5ead-4ff3-91ff-2b40117c4f79` (`Kai Nakamura`, internal employee)
   - `mcp_audit_log`: `write_file {"path":"rc-live-tool-proof-final.txt","content":"OFFISIMR3FINALOK20260429"}`
   - `mcp_audit_log`: `read_file {"path":"rc-live-tool-proof-final.txt"}` returned `OFFISIMR3FINALOK20260429`
   - Physical file exists at:
     `/Users/haoshengli/Documents/Offisim-R3-RC-Workspace-20260429/rc-live-tool-proof-final.txt`

4. Out-of-bounds path rejection and error redaction: **passed**.
   - Same task run: `tr-dc-a0034211-bf72-4cea-8a04-e1ce60c87015`
   - `mcp_audit_log`: `read_file {"path":"../offisim-r3-outside-deny-final.txt"}` returned
     `Error reading file: parent-directory path segments are not allowed`.
   - The LLM-facing error did not include a host absolute path.

5. Bash timeout: **passed**.
   - Same task run: `tr-dc-a0034211-bf72-4cea-8a04-e1ce60c87015`
   - `mcp_audit_log`: `bash {"command":"sleep 35"}` returned timeout with exit code `-1`.
   - Recorded latency was approximately `30048ms`.

6. SOP boss-proxy true completion: **passed**.
   - Thread: `thread-fe24a509-d505-4bb9-9107-b67e08521996`
   - Eight task runs created at `2026-04-29T07:01:53.967Z`; all ended `completed`.
   - `graph_threads.status` ended `completed` at `2026-04-29T07:07:34.182Z`.
   - Synopsis begins `**DAG Verification Final Handoff: APPROVED FOR RELEASE**`.
   - Screenshot: `Docs/04_runtime_experience/evidence/r3-release-sop-completed-20260429.png`

7. Kanban illegal transition: **passed**.
   - Card: `card-19dd812e985-b723a2246658aed9`
   - Project: `proj-66eac6d4-56c5-49b5-be0b-b537353dea66`
   - Title: `R3 illegal transition live card`
   - The legal `todo -> done` move succeeded. Once in `done`, the release UI exposed no illegal next-state buttons and rendered the terminal state.
   - Backend invalid-transition behavior remains fail-closed with `invalid kanban transition: {expected} -> {next}`.
   - Screenshot: `Docs/04_runtime_experience/evidence/r3-release-kanban-invalid-transition-20260429.png`

### Root causes found during live verification

- SDK lane false tool surface: `codex-local-auth` resolves to an SDK lane, so it must stay text/reasoning-only. Fixed by only injecting Offisim tools when the effective lane is `gateway`, and by making SDK adapters fail closed if any tool call reaches them.
- Completion verifier over-blocking: file/shell tasks now require matching tool evidence, but plain SOP text deliverables are allowed to complete without fake tool proof.
- Direct/YOLO stale plan state: direct setup now clears stale `taskPlan` together with the rest of the plan-scoped state.
- Local tool routing to external A2A: file/shell/workspace tasks now route only to internal, enabled employees; external A2A employees fail fast for direct local-tool requests.
- Release window attach/reopen: the release app now creates and reopens a labeled main window that Computer Use can attach to via `open -b com.offisim.desktop`.
- Stale desktop UI bundle: `@offisim/ui-office` must be rebuilt before `@offisim/desktop` release builds after UI source changes.

### OpenSpec tooling note

The R3 change folder is named `2026-04-29-sandbox-honesty-and-kanban-cas`. The local OpenSpec CLI rejects numeric-leading change IDs, so this change's `tasks.md` and spec deltas were maintained directly rather than through CLI subcommands.

### Tag gate

`v1.1.0-rc.1` is eligible only after the follow-up commit is recorded. The post-fix full gate run and Section 7 release-app live verification have passed with screenshots and physical workspace evidence.
