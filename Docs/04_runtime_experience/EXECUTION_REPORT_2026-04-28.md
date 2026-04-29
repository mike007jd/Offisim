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

## Current Gate

Do not create `v1.1.0-rc.1` and do not archive the OpenSpec change until one of these is true:

1. A trusted file/read/write + fixed verification command tool surface is added for live runtime employees.
2. The product checklist is narrowed so web browser live closure does not claim project-file execution, and desktop/MCP-equipped runtime becomes the only required execution closure.
