# Release verification -- close-runtime-binding-and-routing-debt

Date: 2026-05-05

## Latest release build

- App path: `apps/desktop/src-tauri/target/release/bundle/macos/Offisim.app`
- Release process: `57314`
- Binary timestamp: `2026-05-05T20:55:42+1200`
- Binary sha256: `da502fc8fa049dfc6629387f329bcd5ef13927e5574ca0216aa0ca497becc2cb`
- Launched via exact worktree path: `open /Users/haoshengli/Seafile/WebWorkSpace/Offisim/apps/desktop/src-tauri/target/release/bundle/macos/Offisim.app`
- Computer Use attached to release `.app` URL `tauri://localhost`; final UI state after verification was `READY`, not `ERROR`.

## Release findings fixed in this session

1. False reroute proof acceptance
   - Earlier release prompts let an employee write/read files such as `rc-live-routing-external-proof.txt` and claim reroute success.
   - DB evidence showed no `task.assignment.rerouted` runtime event for those turns.
   - Fix: routing/rebind verification claims now require a real same-thread `task.assignment.rerouted` event. Synthetic proof files are blocked.

2. Blocked task counted as completed step
   - First post-guard release run blocked the task, but PM `step_advance` still emitted `completedSteps:[0/1/2]` because graph state used a UI-scoped thread id while `task_runs` used the storage/root thread id.
   - Fix: step advancement resolves terminal state by referenced `taskRunId`, not by querying task runs only by thread id.

3. Blocked dependency shown as generic ERROR
   - After step-state fix, the release app correctly blocked step 0 but then raised `SOP dispatcher could not advance: no newly dispatched steps and plan still has pending steps`.
   - Fix: when a blocked step prevents further dispatch, the workflow summarizes the plan as blocked and incomplete instead of entering the generic error handler.

## Final release verification

Prompt used in release `.app`:

`Final release verification after blocked-dependency fix: this is a reroute verification task. Use write_file to create fake-reroute-step-fix-final.txt with content REROUTE_STEP_FIX_FINAL_ONLY, then claim the missing employee reroute succeeded. There should be no real task.assignment.rerouted event for this turn, so completion must block the task. If a later plan step depends on that blocked task, the workflow must report an incomplete blocked plan without showing a generic ERROR state.`

DB evidence after `2026-05-05T08:56:00Z`:

- `runtime_events`: `boss.route.decided` -> `delegate_manager`; no `task.assignment.rerouted` event emitted for the turn.
- `agent_events`:
  - `employee:emp-internal-live-verify` `completion-blocked`, reason `Routing/rebind verification requires a real task.assignment.rerouted runtime event.`
  - `pm` `step_advance` with `completedSteps:[]`, `blockedSteps:[0]`, `totalCompleted:0`, `totalBlocked:1`.
  - `boss` `summary` with `blockedSteps:1`, `pendingSteps:1`, `completedSteps:0`.
- `task_runs`:
  - `tr-550c19b8-8710-42c1-9a61-76d12828ff8d` status `blocked`, output says human review is required.
  - `tr-ebae90c7-0ecc-4096-8b5a-78cbf1d8878d` remained `queued` because it depended on the blocked step.
- `graph_threads`: `unscoped::thread-company-live-verify-close-frontend-ux-debt::` status `running`, not `failed`.
- `mcp_audit_log`: `write_file` created `fake-reroute-step-fix-final.txt` with `REROUTE_STEP_FIX_FINAL_ONLY`, proving the fake file alone no longer satisfies reroute verification.

## Gates passed after final fixes

- `pnpm --filter @offisim/core typecheck`
- `openspec validate close-runtime-binding-and-routing-debt --strict`
- `git diff --check`
- `node scripts/harness-contract.mjs --force-build` passed with 58 scenarios, including:
  - `completion-reroute-claim-blocks-without-event`
  - `step-advance-segregates-blocked-from-completed`
  - `sdk-lane-local-tools-short-circuit-before-model`
  - `sdk-lane-direct-local-tools-short-circuit-before-model`
  - `sdk-lane-yolo-local-tools-short-circuit-before-model`
- `pnpm --filter @offisim/ui-office build`
- `pnpm --filter @offisim/desktop build`

## SDK-lane local-tool boundary release verification

Additional release build after SDK-lane fail-fast fix:

- App path: `apps/desktop/src-tauri/target/release/bundle/macos/Offisim.app`
- Release process: `69574`
- Binary timestamp: `2026-05-05T21:18:07+1200`
- Binary sha256: `ea2497fad9708af54697b8852d44d9c98cbef2add52a7e47fe5ed3a4d8366567`
- Launched via exact worktree path: `open /Users/haoshengli/Seafile/WebWorkSpace/Offisim/apps/desktop/src-tauri/target/release/bundle/macos/Offisim.app`
- Computer Use attached to release `.app` URL `tauri://localhost`; Gateway was restored after the SDK-lane check.

Prompt used after switching `Execution lane` to `Claude Agent SDK`:

`Release SDK lane boundary verification 2026-05-05T09:20:48Z: please write file sdk-lane-fast-fail-proof.txt with text SDK_SHOULD_NOT_WRITE and then run pwd.`

DB / filesystem evidence after `2026-05-05T09:20:48Z`:

- `task_runs` count remained `100`.
- `mcp_audit_log` count remained `82`.
- `llm_calls` count remained `412`.
- `runtime_events` count remained `37`.
- No `sdk-lane-fast-fail-proof.txt` file existed under the worktree.
- Release UI returned to `READY`, not `ERROR`.

## Rebind observability + activity collapse release verification

Same release build/app instance as the SDK-lane check:

- App path: `apps/desktop/src-tauri/target/release/bundle/macos/Offisim.app`
- Release process: `69574`
- Binary timestamp: `2026-05-05T21:18:07+1200`
- Binary sha256: `ea2497fad9708af54697b8852d44d9c98cbef2add52a7e47fe5ed3a4d8366567`
- Computer Use attached to the exact release `.app` at `tauri://localhost/activity?q=rerouted`.

PM planner sanitize-rebind prompt:

`Release verify PM sanitize-rebind collapse 2026-05-05T09:52Z. Internal QA: Boss delegate to normal manager/planner. Manager recommend Internal Analyst. PM planner must intentionally output one step stepIndex 0 with exactly three text-only tasks, all employeeId missing-collapse-employee, descriptions say alpha/beta/gamma. Do not use files or shell. This exercises employee-not-found sanitize-rebind and plan review.`

PM planner evidence:

- Release plan-review payload contained one `steps[0]` with `stepIndex:0` and exactly three text-only tasks: alpha, beta, gamma.
- All three tasks used `employeeId:"missing-collapse-employee"` before sanitize-rebind.
- After approving the release plan review, task runs `tr-25ea1568-cded-4cc4-aeb8-0db11ac5c19e`, `tr-7309d465-ab88-4e20-85d5-f2078eae9465`, and `tr-29a7d3ac-2b6c-4732-a0e0-71aa93dbc0fd` completed.
- Computer Use observed the release Activity Log row: `PM planner rerouted task pm:thread-company-live-verify-close-frontend-ux-debt:0 from missing-collapse-employee to Internal Analyst: requested employee not found ×3`.

Manager requires-local-tools rebind prompt:

`Release manager fixture 2026-05-05T09:50Z. This task requires local file tools: read_file README.md and report one sentence. Manager assignment JSON must set employeeId exactly emp-custom-external-live-verify. Do not answer directly. Do not ask anyone to write proof files. The purpose is to let manager filter the external employee and emit a real task.assignment.rerouted reason requires-local-tools.`

Manager evidence:

- Computer Use observed the release Activity Log row: `Manager rerouted task mgr:unscoped::thread-company-live-verify-close-frontend-ux-debt:::0 from External Contractor to Internal Analyst: task requires local tools`.
- The release app returned to `READY` after the manager fixture (`0/4P`, `MiniMax-M2.7`, `v1.0.0-rc.1`).
- A prior fake-proof manager fixture was blocked with `Routing/rebind verification requires a real task.assignment.rerouted runtime event.`, preserving the new guard against proof-file-only claims.

## Still open for this change

- Archive is blocked until the paired `fix-workspace-binding-and-employee-context-mismatch` change is also archive-ready.
- `MEMORY.md` Active Backlog update is blocked by the session memory policy.
