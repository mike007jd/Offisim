## 1. Baseline And Evidence Setup

- [x] 1.1 Read archived tasks from `openspec/changes/archive/2026-04-26-consolidate-post-overhaul-runtime-followups/tasks.md` and copy the remaining unchecked gates into this change's working notes.
- [x] 1.2 Confirm current validation baseline: `openspec validate verify-post-overhaul-runtime-live-gaps --strict`, `pnpm typecheck`, and touched-file Biome checks.
- [x] 1.3 Start web runtime on `127.0.0.1:5176` and capture browser console/page evidence for every web gate.

## 2. Web Runtime Residual Gates

- [x] 2.1 Verify missing direct-chat target path: simulate absent `selectedEmployeeId` for direct chat, confirm `Direct chat target missing — selectedEmployeeId not propagated` surfaces as a typed error and does not silently fall back to Alex.
- [x] 2.2 Verify chat single-bubble variants on web: normal `hi`, abort mid-stream, and tool-call mid-stream all end with one assistant bubble containing reasoning plus final content.
- [x] 2.3 Verify SOP dispatcher on web: run a reproducible complex 8+ step SOP DAG with mixed dependencies and confirm convergence to `boss_summary` without recursion-limit hit.
- [x] 2.4 Verify SOP dispatcher infinite-loop negative path: use a debug-only hand-crafted loop or harness to force non-convergence, and confirm `sop.dispatcher.recursion_limit` fires with `{ planId, stepCount, completedSteps, pendingSteps, recursionDepth }` before the limit error surfaces.

## 3. Desktop Release Residual Gates

- [x] 3.1 Build release `.app` with `pnpm --filter @offisim/desktop tauri build` and launch `apps/desktop/src-tauri/target/release/bundle/macos/Offisim.app`.
- [x] 3.2 Verify release CSP allowed paths still reach platform `localhost:4100` through Market, Settings, and external-employee install flows.
- [x] 3.3 Verify release CSP non-allowlisted port rejection using a controlled request to a non-allowlisted port, and confirm a typed network error without relaxing the allowlist.
- [x] 3.4 Verify desktop chat single-bubble invariant for normal `hi`, abort mid-stream, and tool-call mid-stream.
- [x] 3.5 Verify desktop SOP dispatcher convergence with the same complex SOP DAG used for web.

## 4. Skill Self-Authoring Desktop Gates

- [x] 4.1 In release desktop direct chat, trigger `create_skill_from_scratch` with a valid SKILL.md body and confirm the create preview shows the selected employee.
- [x] 4.2 Confirm the valid desktop create path writes SKILL.md to the expected vault path and inserts a `skills` row with `source_kind='self-authored'`.
- [x] 4.3 Confirm desktop cancel path discards staging and does not write a vault file or `skills` row.
- [x] 4.4 Confirm desktop rejection paths render Retry for reserved `offisim.*`, unknown field, and missing `description`.
- [x] 4.5 Simulate LLM mismatch in Maya direct chat by passing Alex as `targetEmployeeId`; confirm no staging is created and the typed mismatch error is surfaced.

## 5. Closeout

- [x] 5.1 Remove or production-gate any temporary fault-injection hooks added for verification.
- [x] 5.2 Run `openspec validate verify-post-overhaul-runtime-live-gaps --strict`.
- [x] 5.3 Update tasks with exact evidence notes for every checked item.
- [x] 5.4 Archive this follow-up only after all gates are checked or any remaining external blocker is explicitly accepted by the user.
