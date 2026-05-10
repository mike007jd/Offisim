# Release App Verification - 2026-05-10

Change: `complete-claude-parity-full-agent-harness`

2026-05-11 review correction: this file is historical release evidence. Its
previous Codex promotion conclusion is superseded by
`review-fix-evidence-2026-05-11.md`, which proves selected model pass-through
and blocks `codex-engine:sdk-native-full-power` because the active release model
`MiniMax-M2.7` is unsupported by Codex local auth. The 2026-05-10 Codex task
rows remain useful sidecar behavior evidence, but they no longer count as
production promotion evidence.

## Bundle Evidence

- Release app path: `apps/desktop/src-tauri/target/release/bundle/macos/Offisim.app`
- Executable: `apps/desktop/src-tauri/target/release/bundle/macos/Offisim.app/Contents/MacOS/offisim-desktop`
- Executable sha256 after final Codex full-agent cancellation rebuild: `c0cf914d152acb75bcd08922d037e64e849a0439fe534294260d3e53e4bfe368`
- Executable timestamp after final Codex full-agent cancellation rebuild: `2026-05-11 00:28:05 +1200`
- Launched exact app path: `/Users/haoshengli/Seafile/WebWorkSpace/Offisim/apps/desktop/src-tauri/target/release/bundle/macos/Offisim.app`
- Computer Use attachment: `com.offisim.desktop`, final pid `16686`
- Window URL observed by Computer Use: `tauri://localhost/?thread=thread-release-verify-20260510-clean`

## Surface Evidence

- Active company: `Multi Model Harness Stress Co`
- Active provider footer: `MiniMax-M2.7`
- Personnel runtime page observed in release app:
  - Text-only profiles show profile id, tier, evidence class, partial verification status, and missing full-agent gates.
  - Full-agent target is presented as unavailable until release evidence, not as a permanent blocked strategy.
- Settings runtime page observed in release app:
  - Default employee runtime selected `Codex full-agent`.
  - Codex, Claude, and OpenAI text profiles show missing release evidence.
  - Main harness control shows `Default owner Offisim core`, no verified driver, and replacement unavailable until release evidence.

## Local DB Compatibility Blocker Fixed

During release `.app` verification, the current worktree app hit an existing user DB constraint from an older schema:

`CHECK constraint failed: status IN ('queued', 'running', 'waiting_human', 'blocked', 'completed', 'failed', 'cancelled')`

Root cause: old local SQLite databases had a `task_runs.status` CHECK constraint that did not include `planned` or `waiting_dependency`. `CREATE TABLE IF NOT EXISTS` did not upgrade that constraint.

Fix evidence:

- `apps/desktop/src-tauri/src/local_db.rs` now rebuilds legacy `task_runs` constraints during schema compatibility.
- `cargo test local_db --quiet` passed after adding a legacy-constraint upgrade regression test.
- `cargo check` passed.
- Release `.app` rebuilt after the fix.
- Before startup, the user DB had the old constraint; after launching exact release `.app`, `sqlite_master` showed the upgraded constraint:
  - `status IN ('planned', 'queued', 'running', 'waiting_dependency', 'waiting_human', 'blocked', 'completed', 'failed', 'cancelled')`

## Live Task Evidence

Prompt submitted in the release app:

`Use local tools to read the first line of README.md and reply. Do not modify files.`

Initial observed result:

- The app returned to `READY`.
- Footer recorded provider usage: `3.1K`, `$0.0034`, latency `6.0 s`.
- Chat output showed `provider-call-ok`.
- This was provider smoke only and did not count as local-tool evidence.

Clean release project seeded for final verification:

- Project: `Release Verify Clean 20260510`
- Project id: `proj-release-verify-20260510-clean`
- Product thread: `thread-release-verify-20260510-clean`
- Runtime graph thread: `proj-release-verify-20260510-clean::thread-release-verify-20260510-clean::`
- Workspace root: `/Users/haoshengli/Seafile/WebWorkSpace/Offisim`

Successful local-tool + denied-path + completion evidence:

- Computer Use selected `Release Verify Clean 20260510` in the exact release `.app`.
- YOLO/employee task id: `tr-yolo-7c6c58cd-3f47-4850-93e8-2502165a0094`
- Status: `completed`
- Audit row `ma-6e8d0565-fc3d-4ef7-865b-2dea83d49239`:
  - Tool: `builtin.read_file`
  - Args: `{"path":"README.md"}`
  - Result begins with `# Offisim`
  - Created at: `2026-05-10T11:06:18.042Z`
- Audit row `ma-cd319f06-b8c8-4f25-aeb3-860805b89156`:
  - Tool: `builtin.read_file`
  - Args: `{"path":"/etc/passwd"}`
  - Error: `path is outside bound project workspaces: <out-of-bounds>`
  - Created at: `2026-05-10T11:06:18.041Z`
- Task output:
  - `README=# Offisim`
  - `DENIED=path is outside bound project workspaces: <out-of-bounds>`
- Finished at: `2026-05-10T11:06:27.013Z`

Cancellation evidence:

- Current release `.app` pid `46904` was attached by Computer Use.
- Thread: `thread-05369d79-2fbf-49e3-9166-21ae12d46c4a`
- Task id: `tr-79bf84f1-4413-4989-a12f-628aa7d48c17`
- Status: `cancelled`
- Output: `{"error":{"code":"RUN_CANCELLED","message":"Request was aborted."}}`
- Finished at: `2026-05-10T10:52:59.851Z`
- Note: this cancellation was captured in a historical project thread after the schema fix, so it proves release cancellation propagation but not a clean-thread final answer.

Observed route boundary:

- Boss/main entry still reported no `read_file` tool in the clean project.
- YOLO/employee entry used `builtin.read_file` correctly through the project workspace sandbox.
- Product implication: default user entrypoint and employee tool capability copy must stay separate in docs/UI until Boss/main advertises the same capability.

## Release Status

- Task 10.3 is verified for current release `.app` employee/YOLO `offisim-core`: local tool success, denied path, completion evidence, and release cancellation propagation are recorded above.
- Task 10.4 is superseded by `review-fix-evidence-2026-05-11.md`; no SDK-native full-agent profile is currently promoted.
- Codex, Claude, and OpenAI SDK-native full-agent profiles remain unavailable; no release `.app` task now promotes them.

## Codex Full-Agent Task 10.4 Evidence

Final release app process:

- PID: `16686`
- Project: `Release Verify Clean 20260510`
- Project id: `proj-release-verify-20260510-clean`
- Workspace root: `/Users/haoshengli/Seafile/WebWorkSpace/Offisim`
- Employee: YOLO Master, `aba3cd58-1fec-4936-bac4-46d579e38ea0`

Final-hash text/native tool success:

- Task id: `tr-yolo-ac914680-820e-4c0a-8887-c3e070b7ceb6`
- Status: `completed`
- Prompt: `Release 10.4 final-hash Codex full-agent text/native success verify: use native shell pwd and reply exactly TEXT_OK plus the working directory.`
- Output: `TEXT_OK /Users/haoshengli/Seafile/WebWorkSpace/Offisim`
- Started: `2026-05-10T12:29:41.782Z`
- Finished: `2026-05-10T12:29:58.289Z`
- Computer Use observed the exact output in the release `.app` chat.

Final-hash denied native path and sandbox escape denial:

- Task id: `tr-yolo-90b4d1ad-6514-40af-aff2-261fdd135422`
- Status: `completed`
- Prompt attempted: `mkdir -p /Users/haoshengli/.offisim-denied-probe && touch /Users/haoshengli/.offisim-denied-probe/file`
- Output: `DENIED_OK`
- Started: `2026-05-10T12:30:53.477Z`
- Finished: `2026-05-10T12:31:09.110Z`
- Filesystem check after task: `/Users/haoshengli/.offisim-denied-probe/file` was absent.
- Computer Use observed `DENIED_OK` in the release `.app` chat.

Final-hash cancellation and typed completion classification:

- Task id: `tr-yolo-c40e8869-5109-4b55-bbec-70a149d5e99a`
- Status: `cancelled`
- Prompt attempted native shell `sleep 90` and final answer `SHOULD_NOT_FINISH`.
- Computer Use clicked Stop in the release `.app`.
- Output JSON: `{"error":{"code":"RUN_CANCELLED","message":"The operation was aborted."}}`
- Started: `2026-05-10T12:32:23.772Z`
- Finished: `2026-05-10T12:32:35.177Z`
- Agent event: `{"action":"cancelled","reason":"The operation was aborted.","employeeName":"YOLO Master","taskRunId":"tr-yolo-c40e8869-5109-4b55-bbec-70a149d5e99a"}`
- This specifically verifies the engine cancellation fix that routes abort-like engine errors to `finalizeEmployeeCancellation` instead of `failed`.

Final release bundle native lifecycle and budget evidence:

- Bundle sidecar path: `apps/desktop/src-tauri/target/release/bundle/macos/Offisim.app/Contents/Resources/resources/codex-agent-host.mjs`
- Success payload emitted `tool_started` and `tool_completed` for `pwd`, `toolType: runtime-profile`, `evidenceClass: sdk-native`, `status: completed`.
- MCP lifecycle payload emitted connecting/connected statuses for `context7`, `codex_apps`, `cloudflare-api`, `computer-use`, `xcodebuildmcp`, and `gitnexus`.
- Session lifecycle payload emitted `session_event started`, `session_event resumed`, and `session_event forked`.
- Checkpoint/rollback payload emitted `checkpoint_created`, `rollback_started`, and `rollback_completed`.
- Timeout payload with `timeoutMs: 1` returned `{"ok":false,"error":{"code":"timeout","message":"Codex app-server timed out after 1ms."}}`; renderer maps this to `budget_exhausted` and `partial_state`.
