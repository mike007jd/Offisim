# Claude Code orchestration release evidence

Checked at: 2026-07-17 NZST
Result: PASS for T07; the wider package remains incomplete until T16 closes.

## Identity

- Worktree: `/private/tmp/offisim-t07-claude-engine`
- Branch: `codex/offisim-claude-engine`
- Release app: `apps/desktop/src-tauri/target/aarch64-apple-darwin/release/bundle/macos/Offisim.app`
- Matched process during final verification: PID `51272`
- Matched window: CGWindowNumber `15640`, bounds `x=36 y=33 1440x884`
- Claude Code CLI: `2.1.211 (Claude Code)`, installed and logged in
- Final app binary SHA-256: `677e7cc685fa3e37b6cc3a3d6190b4882ad210ea1fb7469dc2c2d936754e17cb`
- Bundled Claude adapter SHA-256: `c71482362e92a267820c61b068021998c700d58e9eb3c3be2caf55bfa6ed60f1`

The target window was resolved by exact executable path, PID, window number,
bounds, and release-app content before Computer Use interaction. The app was
launched by its exact worktree path, never by shared bundle id.

## Current official protocol basis

- CLI print mode and streaming: https://code.claude.com/docs/en/cli-usage
- Authentication: https://code.claude.com/docs/en/authentication
- Hook lifecycle: https://code.claude.com/docs/en/hooks
- Sandbox configuration: https://code.claude.com/docs/en/sandboxing

The adapter uses `claude -p --output-format stream-json --verbose` with partial
messages and hook events. It reuses the user's CLI login; Offisim receives no
raw credential, model catalog, account health, or subscription usage window.

## Release interactions

- AI Engines Settings projected Claude `Ready`, version `2.1.211`, native login
  command, official guide, and “订阅内 · 无 API 成本”.
- A real Claude run returned `OFFISIM_CLAUDE_RELEASE_OK` and persisted the
  `claude / claude:local / subscription / engine-managed` execution identity.
- A final-bundle Bash-tool run returned `OFFISIM_CLAUDE_FINAL_CLEAN_OK`; the
  timeline persisted a completed `conversation.run.tool` event with exact tool
  name `Bash` for attempt `attempt-2c9d31f3-b751-454e-831d-9ac33749bf4d`.
- The completed final tool run persisted 4 input, 103 output, 47,591 cache-read,
  179 cache-write tokens and 6,222 ms wall-clock duration, with no dollar
  conversion.
- Computer Use clicked the live `Stop run` control. The final UI showed
  `Interrupted`, and SQLite persisted the attempt as `cancelled`.

## Screenshots

- `claude-status-ready.png` — installed/logged-in/version status and guide.
- `claude-task-complete.png` — real release task plus Token/Duration projection.
- `claude-tool-complete.png` — real Claude Bash-tool task completion.
- `claude-stop-available.png` — live run with Stop available.
- `claude-stop-interrupted.png` — stopped run terminal state.

## Guard and wire evidence

`pnpm harness:claude-agent-host` covers renderer/Rust execute and enhance field
lockstep, native target identity, CLI lifecycle with stdin held open, status and
secret projection, process events, token/duration-only cost, Stop, PreToolUse
write boundaries, Bash sandboxing, Project-folder containment, and symlink escape
rejection.
