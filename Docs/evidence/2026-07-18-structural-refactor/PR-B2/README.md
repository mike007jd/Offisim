# PR-B2 live verification evidence

Checked at `2026-07-18T23:47:54+12:00` on branch
`refactor/B2-host-event-dispatch`, stacked directly on
`refactor/B1-runtime-pure-functions` at
`6bc048728cbcbf2addbeafe8fdb9478427868d50`.

Contract/cleanup amendment checked at `2026-07-19` NZST: the user explicitly
authorized deletion of all test data. The three retained restart-test
conversations/runs were discarded and deleted, and the full-app continuation
expectation was re-audited against the current B1 architecture under §0.5.

## Scope

PR-B2 moves all 14 `PiAgentHostEvent` kinds behind one
`HOST_EVENT_HANDLERS` table and one `dispatchHostEvent` entrypoint. Live,
reattach, and shared consumers inject persistence, snapshot, event bus, and
control-settlement callbacks; the handler module does not import the runtime
class. No PR-B3 persistence extraction is included.

## Automated gates

- `node scripts/release-gates.mjs --lane=node`: PASS, 4/4 (`validate`,
  `ui-hygiene`, `security-harness`, `supply-chain-audit`).
- Renderer typecheck/build: PASS.
- Targeted harnesses: `agent-run-projection` 65/65,
  `runtime-conformance` 12/12, `chat-persistence` 18/18,
  `execution-provenance` 29/29, plus renderer engine authority,
  project workspace, stream watchdog, Pi agent host, and chat attachment
  round-trip: PASS.
- `git diff --check`: PASS.
- GitNexus `detect_changes(scope=all, worktree)`: HIGH because the core
  dispatch change reaches six expected `RunNativeTurn`/cursor/context flows;
  no unrelated B3 persistence symbol was moved.

## Release artifact

- B2 app:
  `/Users/haoshengli/worktrees/offisim-refactor-b/apps/desktop/src-tauri/target/aarch64-apple-darwin/release/bundle/macos/Offisim.app`
- B2 binary SHA-256:
  `538e82813299912612b2c8029382e3e2d620d8988ee8af6aff6e9e3edb371b5d`
- B1 comparison app:
  `/private/tmp/offisim-b1-live-baseline/apps/desktop/src-tauri/target/aarch64-apple-darwin/release/bundle/macos/Offisim.app`
- B1 binary SHA-256:
  `dfc358546becbdcd6ee6b0b5dd75a46ff1f506df5ffd6af7338cb55d88aa3845`

Both artifacts were launched by exact path. Computer Use attached to the
resolved Offisim window/PID before every interaction.

## Live matrix

| Scenario | Result | Evidence |
| --- | --- | --- |
| Normal run | PASS | `01-normal-complete.jpeg`; reply `B2-NORMAL-OK`, UI `Complete`, 4/4. |
| App restart + reattach | PLAN CONFLICT / NON-REGRESSION PASS | B2 Pi run `attempt-763e67bb-00b7-4354-ac55-ad7d6621c2b4` and B2 Codex run `attempt-09d1c2a7-153a-4833-b8bf-bafaa10412b7` both restart as `interrupted / CAN RESUME`, without automatically continuing. `02`-`05` show B2 before/after. `09-b1-baseline-after-restart.jpeg` is the exact B1 app after restart in the same persisted state; its action-time AX tree contains the B1 sentinel card and `CAN RESUME`. DB identified that card as `attempt-d30d0358-3ed2-494e-ae35-58f250b6efb7`, status `interrupted`. This reproduces the same contract on the exact B1 baseline, so B2 did not regress reattach behavior. No manual Resume was used. Automatic continuation is not claimed. |
| Approval banner | PASS | The release app ran the selected thread in `Ask` (`cohere/north-mini-code:free · Ask`). `Bash rm -rf ./x` reached `Approval / Waiting for approval` with `Reject` and `Approve`; Computer Use chose `Reject`, the UI recorded `Rejected by operator`, and the sentinel remained. `10` is the pending chat frame paired with the same-frame AX waiting/button record; the banner itself is below its crop. `11` is the rejected frame. The thread-only mode setup was written while the app was closed and restored to the captured 420-byte original value (before/after SHA-256 `8e7d58143c2a34a11cc8aba649d41941f1622d277f1bd5bb9041b8eadcb7fa20`); no approval was granted. |
| Stop | PASS | Second run `attempt-c4246552-cefe-415d-8906-14b5135ac042` reached `bash running…`; Computer Use clicked `Stop run`; action-time AX reached `Interrupted / 0 of 4 / Stopped`, DB reached `cancelled`, and `sleep 180` plus Pi host exited. `07` and `08` are the accepted before/after pair. The center-stage status is obscured by retained CAN RESUME cards in `08`; the exact AX/DB/process observations are recorded in `live-observations.txt`. Reloading the retained conversation resets the stage projection to Ready, so no replacement screenshot is claimed. `06` is an earlier diagnostic run that naturally completed and is not counted as acceptance. |

The roadmap's literal full-app automatic-continuation expectation conflicts
with the existing process ownership: Pi streams/stdin/workspace authority and
Codex run/RPC/stream projection are owned in Tauri memory, while their
sidecars/children are deliberately terminated with the app process group.
`Resume` starts a new native turn; it is not an in-flight continuation.
Implementing true automatic continuation would require a persistent,
authenticated broker/service for both engines, which is an unlisted lifecycle
abstraction and a behavior change outside B2. Under §0.5 this is recorded as a
plan conflict, not silently invented inside the dispatch refactor. The
reviewable B2 acceptance is therefore: preserve run identity, terminate safely,
surface durable `CAN RESUME`, and introduce no duplicate side effects. B2 and
the exact B1 baseline match that contract.

Current-source anchors for that decision:

- Pi run streams are process-local static memory:
  `apps/desktop/src-tauri/src/pi_agent_host/stream.rs:16-28`.
- Pi's sidecar process-group guard kills the owned group on drop:
  `apps/desktop/src-tauri/src/pi_agent_host/run.rs:253-278`.
- Codex managed runs are process-local manager state:
  `apps/desktop/src-tauri/src/codex_agent_host/manager.rs:64-80`.
- Codex launches `app-server --stdio` with piped I/O and `kill_on_drop(true)`:
  `apps/desktop/src-tauri/src/codex_agent_host/protocol.rs:243-259`.
- Renderer `resume` explicitly accepts only durable `interrupted` rows:
  `apps/desktop/renderer/src/runtime/desktop-agent-runtime.ts:1250-1261`.

## Cleanup state

- The temporary thread-only `Ask` setup was restored byte-for-byte to the
  original local-storage value; the test thread therefore returned to its
  default `Auto` mode.
- `active_thread_interactions` is empty.
- B2 Stop-session PID `60042` and approval-session PID `98253`, with their
  resolved Offisim windows, exited through Computer Use.
- No test `sleep` process or Pi host remains.
- The user subsequently explicitly authorized deletion of all test data. The
  three `CAN RESUME` cards were discarded in the release UI, then their exact
  test conversations were removed with the product deletion statement order
  while the app was closed.
- Final direct state: all three restart-test run ids are absent, active agent
  runs `0`, and active thread interactions `0`.
- No project workspace files or unrelated conversations were deleted.

The machine-readable record, including screenshot hashes, is in
`manifest.json`. Exact action-time AX, DB, PID/window, and process observations
are in `live-observations.txt`.

This PR is ready for code review. It remains unmerged; merge is exclusively
subject to user approval.
