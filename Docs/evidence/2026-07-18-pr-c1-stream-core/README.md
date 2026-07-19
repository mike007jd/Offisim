# PR-C1 release live verification

Checked at `2026-07-18 21:40:58 NZST (+1200)` against the exact C1 worktree release app rebuilt after the final review fix:

`/Users/haoshengli/worktrees/offisim-refactor-c/apps/desktop/src-tauri/target/aarch64-apple-darwin/release/bundle/macos/Offisim.app`

## Window identity

- Executable PID: `26374`
- `CGWindowNumber`: `31062`
- Title: `Offisim`
- Bounds: `x=36, y=33, width=1440, height=890`
- WebView URL reported by Computer Use: `tauri://localhost`
- Binary SHA-256: `d037b0139b5c00c80ff62e95e6bbe00b20998b986d537015b65e9414e3d7daba`
- `codesign --verify --deep --strict`: PASS
- The window was closed through Computer Use after verification; PID `26374` and its Offisim window were absent afterward.

## Live cases

| Case | Exact engine shown by release UI | Request | Result |
| --- | --- | --- | --- |
| Claude | `Claude` | `只回复 C1-CLAUDE-FINAL-OK，不调用工具。` | `C1-CLAUDE-FINAL-OK`, complete, subscription/no API cost |
| Codex | `Codex CLI` | `只回复 C1-CODEX-FINAL-OK，不调用工具。` | `C1-CODEX-FINAL-OK`, complete, subscription/no API cost |
| Pi API | `cohere/north-mini-code:free` | `只回复 C1-PI-FINAL-OK，不调用工具。` | `C1-PI-FINAL-OK`, complete, API usage recorded |
| Pi reattach | `cohere/north-mini-code:free` | `使用 bash 执行 sleep 15，然后只回复 C1-RECONNECT-FINAL-OK。` | renderer reload preserved the same running turn and `bash running...`; it later produced exactly one `C1-RECONNECT-FINAL-OK` and one complete terminal |

Marcus Johnson was temporarily bound to Claude for the live case, then restored to `Use each conversation's AI`. Final runtime state was all employees idle with no active control.

## Screenshots

- `01-claude-complete.png` — SHA-256 `05c2f8b57f34691676a10ce6dcec5f40cfa8a6594fdfc51fa703dd898bac31e5`
- `02-codex-complete.png` — SHA-256 `0f4239bcc654ca553925e288696fe051eb498d65c4f625e87d4707ea377bcfda`
- `03-pi-complete.png` — SHA-256 `71168f7a4f18f73f12c72726edf1ff17b915dfcff4ab45de22937467192f43a5`
- `04-pi-reattached-running.png` — SHA-256 `86375fecbec27bcca17bfe8f77520fba351955ab145cf9c4a0c207755448c91d`
- `05-pi-reattached-complete.png` — SHA-256 `9ddd914e6f25ecb7fae11447b9af152b98c39c588adeb3d2bd62bd2cbf9a23c6`

All screenshots are `1243 x 768` Computer Use captures of the resolved release window.

## Automated gates

- Stream semantic cases: Pi and Codex publish/subscribe/replay cursor/terminal/bounded-pending/cursor validation all green.
- `cargo test --locked`: `460 passed; 0 failed`.
- `node scripts/release-gates.mjs --lane=node`: `4 gate(s) green`.
- `pnpm --filter @offisim/desktop build`: PASS; produced the exact signed app above.

## Plan deviation recorded

The roadmap and repository acceptance text cite `apps/desktop/src-tauri/target/release/bundle/macos/Offisim.app`, but the repository's official desktop build command fixes `--target aarch64-apple-darwin` and therefore produces only the target-triple path used above. The literal non-existent path was not represented as a passing gate; this is a documented plan/repository path conflict, and the actual artifact from the official build command was verified instead.
