# Evidence — UI Framework Hygiene (2026-07-21)

Phase-1 UI Framework Hygiene live verify for this worktree.

## Exact release artifact

`/Users/haoshengli/Seafile/WebWorkSpace/Offisim/apps/desktop/src-tauri/target/aarch64-apple-darwin/release/bundle/macos/Offisim.app`

- PID (first session): `92040` → relaunch `3614`
- Window: title `Offisim`, bounds `1440×887 @ 36,33`
- Executable path matched this worktree (not bundle-id launch)

## Method

Computer Use MCP was unavailable in the Cursor session. Live verify used macOS Accessibility (`AXUIElementPerformAction`) plus `screencapture -l <CGWindowNumber>` and `cliclick` for pointer/keyboard. No AppleScript GUI scripting.

## Captures

| File | What |
| --- | --- |
| `01-office-initial.png` | Company selection |
| `02-after-enter.png` | Office after Enter company |
| `03-after-nav.png` | Settings → AI Accounts |
| `04-board-stage.png` | Board stage |
| `05c-file-context-menu.png` | Files Radix context menu (`Preview in Stage` / `Show in Finder` via AX) |
| `06-team-menu.png` | TeamDock dropdown (Alex Chen) |
| `07-office-final.png` | Office return |
| `08b-board-drawer.png` | Board request detail Drawer (`Close request detail` / Subtasks / Verification via AX) |
| `ax-*.txt` | Accessibility dumps / click logs |

Transient misses (`05`, `05b`, `08`, `09`) kept as process evidence of failed attempts before successful `05c` / `08b`.
