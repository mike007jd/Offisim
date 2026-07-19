# Codex Stop orphan-process fix — release app evidence

## Status

`completed`

## Scope and conclusion

- Baseline defect: Codex `app-server` tools may create a new session/process group; stopping the parent group left `sleep 300` reparented to PID 1.
- Process fix: capture the Codex process tree before termination and terminate those captured descendants in addition to the app-server process group.
- Terminal-state fix: keep the internal `Interrupted` outcome and message, but emit the cross-engine stream status `aborted`, which is the renderer's existing terminal contract.
- Result: both stage `Stop` and conversation `Stop run` reached the visible `Interrupted` / `Stopped` state, and every exact Codex/tool PID from each experiment was gone four seconds after Stop.

## Build identity

- checkedAt: `2026-07-19 20:52–20:53 NZST` (`Pacific/Auckland`)
- commit: `25b0ea747b4ccb30bf7445577b9389f4393a35cf`
- exact release app: `/Users/haoshengli/worktrees/offisim-codex-stop-fix/apps/desktop/src-tauri/target/aarch64-apple-darwin/release/bundle/macos/Offisim.app`
- executable SHA-256: `1ae44af568f7636b76215620cb68b00c873a8f69d0dcb74fe1911a4743a48335`
- signing: `codesign --verify --deep --strict` passed
- notarization: not run; this worktree had no notarization credentials in the environment

## Window identity

- launch/attach/click/screenshot: Computer Use bound to the exact app path
- executable PID: `9397`
- CGWindowNumber: `36410`
- title: `Offisim`
- bounds: `X=36 Y=33 W=1440 H=886`
- AX URL: `tauri://localhost`
- exclusions: no bundle-id launch, AppleScript, dev server, localhost browser, or dev WebView was used

## Stage Stop

Before Stop:

```text
9570   node .../@openai/codex/bin/codex.js app-server --stdio   PGID 9570
9573   codex app-server --stdio                                 PGID 9570
9852   sleep 300                                                PPID 9573 PGID 9852
```

Four seconds after clicking the stage `Stop` control:

- UI: `Interrupted: 0 of 4 stages`, `Last run interrupted`, `0 / 4 Stopped`; the Stop control was absent.
- Process check: only the exact Offisim PID `9397` remained; `9570`, `9573`, and `9852` no longer existed.
- Screenshot: [`01-stage-stop-terminal.jpeg`](./01-stage-stop-terminal.jpeg), SHA-256 `13b848a45a02b8f572fc45b920f7dc359a9b4af321b51a030acc712f38872472`.

## Conversation Stop run

Before Stop:

```text
9977    node .../@openai/codex/bin/codex.js app-server --stdio   PGID 9977
9978    codex app-server --stdio                                 PGID 9977
10149   sleep 300                                                PPID 9978 PGID 10149
```

Four seconds after clicking the conversation `Stop run` control:

- UI: `Interrupted: 0 of 4 stages`, `Last run interrupted`, `0 / 4 Stopped`; the conversation Stop control was absent.
- Process check: only the exact Offisim PID `9397` remained; `9977`, `9978`, and `10149` no longer existed.
- Screenshot: [`02-conversation-stop-terminal.jpeg`](./02-conversation-stop-terminal.jpeg), SHA-256 `31b29c7003a33004886f53bdad773d379d81842dc91211ae3a35954279e8d465`.

The employee summary card still showed `WORKING` because another older conversation remained `RUNNING`; it was not used as the terminal assertion for either selected run.

## Gates

- `node scripts/prepare-desktop-cargo-test.mjs && cargo test --locked`: `459 passed; 0 failed`
- `node scripts/release-gates.mjs --lane=node`: `4/4 passed`
- `cargo fmt --check`: passed
- `git diff --check`: passed
- focused Codex host harness, including the outward `aborted` assertion: passed

## Cleanup

- Both experiment process trees were already absent after their respective Stop actions; no manual kill was needed.
- The exact release app is closed after evidence capture, with PID and experiment-process absence rechecked.
