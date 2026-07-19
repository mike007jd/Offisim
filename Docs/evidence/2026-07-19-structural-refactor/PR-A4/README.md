# PR A4 release `.app` live screenshot acceptance

- Overall result: `completed_with_risks`
- Checked at: 2026-07-19 18:00 NZST (Pacific/Auckland)
- Branch / commit supplied for acceptance: `refactor/A4-relative-time-empty-states` / `811a91e8`
- App: `/Users/haoshengli/worktrees/offisim-refactor-a4/apps/desktop/src-tauri/target/aarch64-apple-darwin/release/bundle/macos/Offisim.app`
- Build action: not run; the supplied signed release app was used as required.

## Process proof

Computer Use launched and attached the window titled `Offisim` from the exact app path above. The recorded main process was PID `49393`:

```text
49393  1  /Users/haoshengli/worktrees/offisim-refactor-a4/apps/desktop/src-tauri/target/aarch64-apple-darwin/release/bundle/macos/Offisim.app/Contents/MacOS/offisim-desktop
```

The app was closed through Computer Use. A final `ps -p 49393` returned no process row, confirming the main process exited.

## Surface results

| Surface | Result | Evidence | Reach path and observation |
| --- | --- | --- | --- |
| Settings / AI Accounts | `not_verified` | [live-01-ai-accounts.png](live-01-ai-accounts.png) | `Settings -> AI Accounts`. The current company has one configured provider (`openrouter-free`) and API activity (10 runs), so `No API providers yet` and `No API activity yet` were not safely reachable without deleting state. The populated layout has no overflow, clipping, overlap, or broken cards. |
| Settings / MCP server details | `blocked` | [live-02-mcp-unreachable.png](live-02-mcp-unreachable.png) | `Settings -> Tools & Integrations`. There are no registered MCP servers, so an unconnected/no-tools server detail and its `No tools discovered yet` compact EmptyState cannot be opened. The reachable empty server list is laid out normally. No server was fabricated. |
| Office / employee Memory | `verified` | [live-03-office-employee-memory.png](live-03-office-employee-memory.png) | `Office -> Team -> Marcus Johnson`. The Memory section shows the planned icon + `No employee memory yet.` compact empty block. It stays inside the employee popover with balanced spacing and no overflow, clipping, or overlap. This is the expected shape change from a plain text row. |
| Office / Recovery relative time | `blocked` | [live-08-office-recovery-unreachable.png](live-08-office-recovery-unreachable.png) | `Office`. No interrupted-run recovery card was present, so the `Started <relative time>` label was not reachable. Existing failed/running conversations did not produce a recovery card. The normal Office layout remains intact. |
| Mission / Loops Library time labels | `blocked` | [live-04-loops-library.png](live-04-loops-library.png) | `Loops -> Library`. The company has no saved loops, so loop-card relative-time labels were unavailable. The reachable Library empty state has no overflow, clipping, or overlap. |
| Mission / Loop Runs time labels | `blocked` | [live-05-loop-runs.png](live-05-loop-runs.png) | `Loops -> Runs`. The company has no loop runs, so run-history relative-time labels were unavailable. The reachable Runs empty state is centered and undamaged. |
| Board / Activity timeline | `verified` | [live-06-board-activity.png](live-06-board-activity.png) | `Office -> Timeline`, with the stage maximized to inspect the full Board timeline. Labels render in the new Intl short form, including `15 min. ago`, `16 hr. ago`, and `18 hr. ago`. They remain on one line with no truncation, wrapping, overlap, or column damage. This is the expected copy convergence from forms such as `15m ago`. |
| Connect / new draft | `verified` | [live-07-connect-draft.png](live-07-connect-draft.png) | `Office -> Company channels -> New chat -> Direct message -> Marcus Johnson`. The empty draft renders exactly `No messages yet — your first message starts it.` with no visible wording change, overflow, clipping, or overlap. No message was sent. |

## Acceptance conclusion

All safely reachable changed states passed visual layout acceptance. The expected changes were observed where data allowed: Board relative times use Intl short formatting, the employee Memory empty state is now a compact icon block, and Connect copy is unchanged byte-for-byte in the rendered UI. AI Accounts EmptyStates, MCP detail EmptyState, Office Recovery time, and Loops Library/Runs time labels remain unverified or blocked solely because the existing local data did not expose those states; no destructive or fabricated fixture changes were made.

## Round 2 unblock

- Result: `completed`
- Checked at: 2026-07-19 18:18 NZST (Pacific/Auckland)
- App: `/Users/haoshengli/worktrees/offisim-refactor-a4/apps/desktop/src-tauri/target/aarch64-apple-darwin/release/bundle/macos/Offisim.app`
- Build action: not run; the supplied release app was started directly by exact path.
- Process proof: Computer Use attached the window titled `Offisim`; the exact app main process was PID `63003` (`PPID 1`, `/Users/haoshengli/worktrees/offisim-refactor-a4/apps/desktop/src-tauri/target/aarch64-apple-darwin/release/bundle/macos/Offisim.app/Contents/MacOS/offisim-desktop`). The app was closed through Computer Use, and `ps -p 63003` returned no process row.

| Surface | Result | Evidence | Round 2 path and observation |
| --- | --- | --- | --- |
| Settings / AI Accounts empty states | `not_verified` | — | Created a new Starter Company (`A4 Round 2 QA`) through the product UI and opened `Settings -> AI Accounts`. API providers and activity are global account state rather than company-local state: the existing `openrouter-free` provider and 10 runs remained visible. Therefore `No API providers yet` and `No API activity yet` were still not legally reachable without deleting existing provider/activity data. The temporary company was archived through the UI after acceptance. |
| Settings / MCP server details | `verified` | [live-09-mcp-no-tools-round2.png](live-09-mcp-no-tools-round2.png) | Through `Settings -> Tools & Integrations -> Add server`, registered a temporary stdio server named `A4 QA` with command `/usr/bin/false`, confirmed the product's local-server prompt, waited for the failed handshake, and opened its detail page. The compact EmptyState renders the expected icon block, exact title `No tools discovered yet`, and exact description `Connect or refresh this server to read its live tool catalog.` No overflow, clipping, overlap, truncation, or abnormal wrapping is visible. The server was deleted through the UI immediately after the screenshot; the list returned to `No MCP servers registered.` |
| Loops / Library relative time | `verified` | [live-10-loop-library-time-round2.png](live-10-loop-library-time-round2.png) | Created and compiled a minimal loop through `Loops -> Library -> New Loop`, saved the plan without selecting a project and without starting a run, then returned to Library. The short `Check status, then stop` card renders the relative-time label as `now` beside `Saved plan`, with no overflow, clipping, overlap, truncation, or abnormal wrapping. The product exposes `Archive`, not delete, for loops: both temporary loops created during visual convergence were archived through the UI. |
| Loops / Runs relative time | `blocked` | — | No run was started: `Run` and `Start run` remained disabled because the temporary company had no Project. Generating and saving the loop plan did not create a Loop Run, so the Runs time label remained unavailable without introducing the real agent-run cost and side effects excluded from this round. |
| Office / Recovery relative time | `blocked` | — | No real agent run was started or interrupted, so no recovery card was created. The state remains unavailable without the higher-cost run/interruption side effects explicitly excluded from this round. |

### Round 2 cleanup

- Temporary MCP server `A4 QA`: deleted through the product UI; no server remains registered.
- Temporary company `A4 Round 2 QA`: archived through the product UI and removed from the active company list. The product offers Archive rather than permanent delete, so the archived company remains as product-managed archived data.
- Temporary loops: `Check status, then stop` and the earlier longer-title visual-check loop were both archived through the product UI. The product offers Archive rather than delete, so both remain as archived records inside the archived temporary company.
- No source file, database file, fixture, provider, existing company, real agent run, commit, or remote state was changed.
