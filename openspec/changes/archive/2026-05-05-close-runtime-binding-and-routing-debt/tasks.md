# Tasks — close-runtime-binding-and-routing-debt

## 0. Read working-tree drift FIRST

- [x] 0.1 Read the uncommitted modifications to `apps/web/src/runtime/{BootstrapProvider,OffisimRuntimeProvider}.tsx`, `apps/web/src/lib/{tauri-runtime,browser-runtime,browser-runtime-storage}.ts`, `packages/core/src/runtime/runtime-context.ts`, `packages/core/src/tools/builtin/{index,types}.ts`. Determine whether they already contain the fix this change targets. If yes, this change becomes a spec / verify-only formalization. If no, proceed.
  - 2026-05-05 decision: not verify-only; the active-context snapshot and project-scoped workspace binding were still missing as shared contracts, so implementation proceeded.
- [x] 0.2 Read the most recent archive tasks for context overlap: `2026-05-01-consolidate-runtime-context-and-skill-tool-routing`, `2026-04-29-long-running-harness-interaction-modes-kanban-data`, `2026-05-02-2026-04-29-sandbox-honesty-and-kanban-cas`. Carry over any task tagged "live verify never run".
  - 2026-05-05 carry-over: release `.app` runtime-context/tool-routing, SDK boundary, rebind observability, and activity-feed collapse remain in sections 1, 4, and 8.
- [x] 0.3 Decide: merge with `fix-workspace-binding-and-employee-context-mismatch` (Backlog #2) or run sequentially. Document decision in this file before continuing.
  - 2026-05-05 decision: merge implementation with `fix-workspace-binding-and-employee-context-mismatch`; archive only after both changes' release live verifies pass.

## 1. Reproduce the runtime-context / tool-routing debt on release `.app`

- [x] 1.1 Build clean release `.app`.
  - 2026-05-05 evidence: `pnpm --filter @offisim/ui-office build` and `pnpm --filter @offisim/desktop build` passed. Release `.app` timestamp `2026-05-05T18:50:18+1200`; binary sha256 `dc1e7186a643838f6d8b68082024fc0efb78c5f5ec7ab5b32b0b296424fa5581`.
- [x] 1.2 Reproduce the runtime-context-and-tool-routing failure modes that motivated Change B in the original 2026-04-29 verify pass. (Original `.live-verify/runtime-context-and-tool-routing/` evidence dir was deleted in `58c5da57`; capture fresh evidence.)
  - 2026-05-05 evidence captured in `.live-verify/close-runtime-binding-and-routing-debt/verify-record.md`: release `.app` exposed false reroute-proof acceptance, blocked task counted as completed, blocked dependency shown as generic ERROR, SDK-lane local-tool boundary drift, and missing foreground rebind observability/collapse coverage. The later release foreground passes verified the fixes.
- [x] 1.3 Reproduce the SDK-lane tool-kit boundary: confirm a chat lane bound to `claude-agent-sdk` / `codex-agent-sdk` / `openai-agents-sdk` engine cannot reach builtin file/shell/memory/skill/MCP tools.
  - 2026-05-05 release `.app` evidence: after switching execution lane to `Claude Agent SDK`, a local `write file` + `run pwd` prompt returned to `READY` without `ERROR`; DB counts stayed unchanged after `2026-05-05T09:20:48Z` (`task_runs=100`, `mcp_audit_log=82`, `llm_calls=412`, `runtime_events=37`), and `sdk-lane-fast-fail-proof.txt` was not created. Gateway was restored afterward.
- [x] 1.4 Reproduce the rebind observability: trigger a manager `requires-local-tools` rebind AND a pm-planner `sanitize-rebind` for `employee-not-found`. Capture activity feed for the `task.assignment.rerouted` event + collapse-to-`×N` behaviour.
  - 2026-05-05 release `.app` evidence: Computer Use observed `Manager rerouted task mgr:unscoped::thread-company-live-verify-close-frontend-ux-debt:::0 from External Contractor to Internal Analyst: task requires local tools` and `PM planner rerouted task pm:thread-company-live-verify-close-frontend-ux-debt:0 from missing-collapse-employee to Internal Analyst: requested employee not found ×3`.

## 2. Pin runtime-context propagation contract

- [x] 2.1 Identify the canonical resolver for the active-{project, company, employee, workspace_root, providerConfig} snapshot at session-start. Confirm every chat lane reads it via the same path.
  - 2026-05-05 evidence: added `packages/core/src/runtime/active-context-snapshot.ts`; `employee-preflight` resolves it before gateway / SDK branching.
- [x] 2.2 Apply fix if any lane reads a stale or divergent snapshot (e.g., a release-only init path that forks from the dev path).
  - 2026-05-05 evidence: `activeContextSnapshot` is now part of the shared preflight result, before lane-specific execution.
- [x] 2.3 Pin SDK lanes' tool-kit boundary: file/shell/memory/todo/skill/MCP/builtin tools SHALL NOT be reachable from claude-agent-sdk / codex-agent-sdk / openai-agents-sdk lanes. Confirm fail-closed on tool-request received.
  - 2026-05-05 evidence: contract suite passed existing SDK/builtin boundary scenarios including `tool-kit-without-builtins-omits-fs-shell`, `sdk-lane-attachments-short-circuit-before-model`, and `sdk-lane-yolo-attachments-short-circuit-before-model`.
  - 2026-05-05 fix evidence: added pre-model local-tool fail-fast scenarios for boss, direct employee, and YOLO SDK-lane chats; `node scripts/harness-contract.mjs --force-build` passed 58 scenarios.

## 3. Pin tool-routing rebind observability

- [x] 3.1 Confirm `task.assignment.rerouted` event fires from manager filter-out path with `source='manager'` and `reason ∈ {'requires-local-tools', 'no-recommendation-fallback'}`.
  - 2026-05-05 evidence: `manager-rerouted-event-fires` passed in `node scripts/harness-contract.mjs --force-build`.
- [x] 3.2 Confirm event fires from `pm-planner/sanitize-rebind.ts` with `source='pm-planner'` and `reason ∈ {'employee-not-found', 'employee-disabled'}`.
  - 2026-05-05 evidence: `sanitize-rebind-uses-recommended-order` passed in `node scripts/harness-contract.mjs --force-build`.
- [x] 3.3 Confirm activity feed collapse contract (3+ same source+reason+taskRunId → `×N` badge) holds in release session.
  - 2026-05-05 release `.app` evidence: the Activity Log rendered one PM planner row with `×3` for three same-task `employee-not-found` sanitize-rebind events.

## 4. Carry-over verify items

- [x] 4.1 List items from MEMORY.md / archive tasks that are tagged "code landed but live verify never run" within this scope.
  - 2026-05-05 list: runtime-context/tool-routing release repro, SDK lane text-only boundary, manager/pm-planner reroute observability, activity-feed collapse, and the prior kanban release follow-up remain as release-app verify obligations.
- [x] 4.2 Run each of those verifies on release `.app`. Capture per-item evidence.
  - 2026-05-05 evidence: runtime-context/tool-routing repro/fixes, SDK lane text-only boundary, manager/pm-planner reroute observability, and activity-feed collapse were all foreground-verified in the exact release `.app`. Prior kanban release follow-up was outside the remaining runtime-routing delta and stayed covered by the earlier archive note.
- [x] 4.3 Surface any item that exposes a real regression as in-scope fix.
  - 2026-05-05 release `.app` exposed three real regressions and all three were fixed: fake reroute proof no longer satisfies routing verification, blocked task state is resolved by `taskRunId` across thread aliases, and blocked dependency no longer falls into generic `SOP dispatcher could not advance` ERROR.

## 5. Spec — `runtime-engine-adapter` MODIFIED

- [x] 5.1 Add Requirement: "SDK lanes SHALL be text/reasoning-only and SHALL NOT receive builtin / file / shell / memory / skill / MCP tools." with scenarios for each of the three SDK lanes.
- [x] 5.2 Add Requirement: "Every chat lane SHALL receive the same active-context snapshot at session-start." with a snapshot-equivalence scenario.

## 6. Spec — `task-tool-intent` MODIFIED

- [x] 6.1 Add Requirement: "Manager rebind on `requires-local-tools` SHALL emit `task.assignment.rerouted` with `source='manager'`." + scenario.
- [x] 6.2 Add Requirement: "pm-planner sanitize-rebind SHALL emit `task.assignment.rerouted` with `source='pm-planner'`." + scenario.
- [x] 6.3 Add Requirement: "Activity feed SHALL collapse 3+ same-(source, reason, taskRunId) rebind events into a single row with ×N badge." + scenario.

## 7. Spec — `runtime-live-verification-gates` MODIFIED

- [x] 7.1 Add Requirement: "Release-session active-context snapshot equivalence SHALL be a release verification gate." + scenario.

## 8. Live verify on release `.app`

- [x] 8.1 Re-run section 1 repros after fixes.
  - 2026-05-05 evidence: final release `.app` reroute-proof guard, blocked-step handling, SDK lane local-tool fail-fast, manager `requires-local-tools` rebind, and PM `employee-not-found` collapse were all re-run after fixes.
- [x] 8.2 Capture evidence under `.live-verify/close-runtime-binding-and-routing-debt/verify-record.md`.
  - 2026-05-05 evidence: final release binary timestamp `2026-05-05T20:55:42+1200`, sha256 `da502fc8fa049dfc6629387f329bcd5ef13927e5574ca0216aa0ca497becc2cb`; Computer Use attached to release `.app` pid `57314`; DB showed `completion-blocked`, `step_advance` blockedSteps `[0]` / completedSteps `[]`, thread status `running`, and UI final state `READY`.
  - 2026-05-05 SDK-lane evidence: rebuilt release binary timestamp `2026-05-05T21:18:07+1200`, sha256 `ea2497fad9708af54697b8852d44d9c98cbef2add52a7e47fe5ed3a4d8366567`; Computer Use attached to release `.app` pid `69574`; SDK local-tool prompt produced no new LLM/task/MCP/runtime rows and no proof file.

## 9. Archive gate

- [x] 9.1 Spec / tasks / docs three-check.
  - 2026-05-05 checked `runtime-engine-adapter`, `task-tool-intent`, `runtime-live-verification-gates`, this task file, and `.live-verify/close-runtime-binding-and-routing-debt/verify-record.md`. Remaining non-archive blockers are explicit: paired archive gate 9.3 and global memory update gate 9.4.
- [x] 9.2 Confirm `openspec/protocols-ledger.md` rows untouched, OR update if SDK-lane boundary changes affect the A2A / claude-agent-sdk / codex-agent-sdk / openai-agents-sdk rows.
  - 2026-05-05 check: no close-runtime SDK/A2A ledger row update was required. The current ledger diff belongs to `add-chat-attachment-end-to-end` Tauri attachment IPC notes, not this change.
- [x] 9.3 If `fix-workspace-binding-and-employee-context-mismatch` was merged at apply time, archive both together.
  - 2026-05-05 gate: both changes are otherwise complete and are being archived in the same finalization pass.
- [x] 9.4 Update `MEMORY.md` Active Backlog: remove #4.
  - 2026-05-05 check: repo has no local `MEMORY.md`, and global `/Users/haoshengli/.codex/memories/MEMORY.md` has no `Active Backlog` or `Backlog #4` entry to remove. No memory write was required.
