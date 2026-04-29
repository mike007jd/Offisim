# Offisim 1.1.0-rc.1 Execution Report

Status: blocked before RC tag.
Date: 2026-04-28
Branch: `codex/long-running-rc1`

## Phase Status

- Phase A long-running runtime: implemented and tagged `phase-a-long-running-runtime`.
- Phase B interaction modes: implemented and tagged `phase-b-interaction-modes`.
- Phase C kanban data pipeline: implemented and tagged `phase-c-kanban-data-pipeline`.
- Phase D deterministic harness: `harness:contract`, `harness:replay`, and `harness:soak` passed before live closure.
- Live web closure: blocked at 6.3.3. Do not tag `v1.1.0-rc.1` yet.
- Tauri release closure: release `.app` built and opened with Computer Use on 2026-04-29, but 6.4.2 remains blocked by the same employee tool-surface gap.

## Key Commits

- `da44313d` micro-compact tool-result truncator.
- `b9026a9a` rolling journal with stable anchor objective.
- `81e113a` forkSubContext primitive.
- `b0d3cf75` completion-verifier evidence gate.
- `5dd6833b` ResumeCoordinator with platform/Tauri routes.
- `84a2aa94` InteractionMode expanded to 4 values.
- `9240ad58` mode-aware graph router and YOLO Master node.
- `6c8e40c0` idempotent YOLO Master ensure.
- `817b47fe` kanban_cards table.
- `2ad0fb44` KanbanRepo state machine.
- `4a2716a7` planner persists kanban cards.
- `e866db81` employee completion transitions cards.
- `77531fa1` platform/Tauri kanban CRUD and SSE.
- `5c4d87a6` live KanbanOverlay wiring.
- `7f3d018e` Phase D soak and mode-kanban matrix harness.
- `8ddd0591` live blocker fix: YOLO Master role mapped to workspace zones.

## Scope Metrics

- Current branch delta before this report: 28 commits over `main`.
- Current branch delta before this report: 213 files changed, 6787 insertions, 612 deletions.
- Harness manifest: 16 scenarios.
- Soak result: final non-system tokens 5361, micro-compact passes 20, rolling-journal writes 10, completion-verifier allows 1, blocks 0.

## Live Closure Evidence

- `rm -rf node_modules dist && pnpm install` completed. pnpm warned only about ignored build scripts for bundled deps.
- Root `pnpm dev` does not exist; actual repo entry is `pnpm dev:all`.
- `pnpm dev:all` started web on `http://localhost:5176/` and platform on `:4100`.
- Fresh AI Startup creation initially failed because `yolo_master` had no matching workspace zone.
- Fixed the template/zone mapping in `8ddd0591`; after dev server restart, live browser created `RC1 AI Startup Live 1777384564685`.
- Employee panel showed 7 employees including YOLO Master.
- SOP live request reached Boss and then Employee using MiniMax-M2.7.

## Blocking Finding

6.3.3 requires employee execution to create project files and run `pnpm test` before completion. In the live web runtime, the employee tool pool exposed skill/memory tools only. The employee explicitly reported that file write/read and command execution tools were unavailable, so it could not create `Counter.tsx`, create tests, or run `npm/pnpm test`.

Because completion-verifier correctly requires verification evidence, checking 6.3.3 would be false. 6.3.4-6.3.10 and 6.4 are also not closed, because the same missing trusted file/command tool surface blocks Direct and YOLO mode from proving real implementation and test execution.

## Tauri Release Follow-up

- `pnpm --filter @offisim/desktop build` completed and produced `apps/desktop/src-tauri/target/release/bundle/macos/Offisim.app` plus `Offisim_0.0.1_aarch64.dmg`.
- Computer Use attached to the release app (`tauri://localhost`, bundle id `com.offisim.desktop`), not a dev webview. The app showed provider `gpt-5.4`, 11 employees, and YOLO Master present.
- A boss-proxy prompt on the old shared thread exposed a false-complete path: Boss/Manager/PM reused stale DAG context, created queued task runs, `step_dispatcher` queued 0 assignments, then Boss summary still said `Task processing complete.` No employee actually executed that run.
- A clean direct chat to YOLO Master in the release app asked it to create a harmless scratch note and run `pwd` only if native file/command tools existed. The employee replied: available callable tool categories were `none`; it did not create a file and did not run `pwd`.
- Source-code cause is explicit in the Tauri Codex bridge: `scripts/tauri-codex-agent-host.mjs` tells the model not to invoke tools, not to execute commands, and not to read or modify local files; it also states that upstream tool definitions are not exposed by the bridge.
- The direct-chat run also uncovered a persistence bug: verifier-blocked completion tried to write `review_ready` into `task_runs.status`, but SQLite only allows `queued/running/waiting_human/blocked/completed/failed/cancelled`. This was patched so the DB stores `blocked` while UI/runtime events still report `review_ready`.
- After rebuilding the release app with that patch, the same YOLO Master validation no longer raised the SQLite constraint error. The latest task run `tr-dc-1777421186923` is stored as `blocked`, with a `completion-blocked` event reason `No verification evidence tool ran before completion.` The employee output still states no scratch file was created and `pwd` was not executed.

## Deviations

- OpenSpec change directory was renamed from the date-prefixed invalid path to `openspec/changes/long-running-harness-interaction-modes-kanban-data`.
- Task 3.6 startup ensure could not be wired exactly in platform startup/Rust main because the platform route does not own db-local runtime repositories; it was wired in browser/Tauri JS runtime creation.
- Package-local old db migration drift remains: fresh package migration chain has pre-existing issues in `010_projects.sql` and `016_company_template_metadata.sql`.
- 6.3.1 uses `pnpm dev:all`, not `pnpm dev`, because the root package has no `dev` script.
- 6.4.2 was attempted through release `.app`, but cannot be closed because desktop employee execution still lacks native file/command tools.

## 2026-04-29 Remediation Round

This round addressed the false-completion and false-green patterns documented in `CODEX_REMEDIATION_2026-04-29.md`. It is source + deterministic-harness remediation only; RC tag remains blocked until the release `.app` live checklist is rerun.

- Boss summary no longer marks empty or blocked work completed. Covered by `boss-summary-empty-with-stale-plan-does-not-mark-complete` and `boss-summary-idle-no-plan-does-not-mark-complete`.
- Step advancement separates completed and blocked terminal states with `blockedStepIndices`. Covered by `step-advance-segregates-blocked-from-completed`.
- PM planner, preflight, direct setup, and YOLO setup now clear plan-scoped stale state. Covered by `pm-planner-clears-stale-dispatch-state` and `yolo-mode-skips-boss-chain`.
- Employee completion without `taskRunId` defaults to blocked, not `{ok:true}`. Covered by `completion-without-taskrunid-defaults-to-blocked`.
- PM heartbeat now reports verifier-blocked task runs as attention-needed. Covered by `pm-heartbeat-flags-blocked-task`.
- Tauri desktop gateway lane now injects bounded project `read_file` / `write_file` / `bash` built-ins; browser mode omits them. Covered by `gateway-lane-yolo-has-fs-shell-tools` and `tool-kit-without-builtins-omits-fs-shell`.
- Codex/Claude/OpenAI SDK lanes now explicitly state the fs/shell limitation and point project-file work to gateway lane. Full SDK-lane tool bridging remains outside this round.
- Kanban state transitions are enforced in memory repo and Tauri command path; `done -> todo` is rejected. Covered by `kanban-rejects-illegal-transition`.
- Harness anti-self-proofing was tightened: `RecordingToolExecutor` now requires explicit `toolFixtures`; `FakeGateway` now requires prompt/tool match constraints; `mode-kanban-matrix` evaluates its own assertions; `replay-gateway` is exercised by `recorded-stream-tool-call-replay` and `stream-nonstream-middleware-parity`; soak now runs an actual 80-turn YOLO graph and leak detector has a negative fixture.

Fresh deterministic evidence:

- `pnpm --filter @offisim/core typecheck` passed.
- `cargo check` in `apps/desktop/src-tauri` passed.
- `node scripts/harness-contract.mjs --force-build` passed with 27 manifest scenarios.
- `node scripts/harness-replay.mjs` passed with 20 deterministic graph scenarios plus 2 replay-gateway scenarios.
- `node scripts/harness-soak.mjs --force-build --iterations=1` passed the 80-turn YOLO graph; leak summary: active interactions 0, pending assignments 0, duplicate task runs 0, duplicate tool calls 0.

## Current Gate

Do not create `v1.1.0-rc.1` and do not archive the OpenSpec change until release `.app` live verification proves the remediation:

1. Clean direct chat to YOLO Master creates `verify-2026-04-29.md` under the bound project `workspace_root`, and the file is confirmed with both Computer Use screenshot and physical `ls`.
2. Clean direct chat runs `pwd` / `ls -la`, and the chat output matches the physical project workspace.
3. SOP run with real employee output does not show the old `Task processing complete.` fallback.
4. Verifier-block path persists `task_runs.status = blocked`, keeps boss summary non-successful, and heartbeat reports `verifier-blocked`.
5. Stale checkpoint isolation is visually rechecked after one completed plan followed by a new plan.
