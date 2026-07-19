# PR A4 release `.app` live screenshot acceptance

- Current overall result: `completed`
- Latest checked at: 2026-07-20 09:57 NZST (Pacific/Auckland)
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

## Current-commit rebuild proof

- Checked at: 2026-07-19 NZST.
- Current branch head `ac2ae6b8` differs from the visually accepted `811a91e8` only by this evidence README and screenshots; no product source changed between them.
- `pnpm --filter @offisim/desktop build` rebuilt the exact current-head release `.app` successfully at the path above. Executable SHA-256: `14a04075e51d41756a475826bd1083684b5dd5b33aaedcc8b121b702764a2a39`; `codesign --verify --deep --strict` PASS; notarization skipped because the machine has no notarization environment credentials.
- Fresh-profile AI Accounts remains unavailable without redirecting the hard-coded `~/.offisim` storage root or destructively replacing global account state; the product has no test-profile/storage override. The prior new-company proof confirms providers/activity are global, not company-scoped.
- Loop Runs time and Recovery time remain blocked because their UI requires a real loop run and a real interrupted agent run respectively. No paid/API run or fabricated DB state was introduced. A4 therefore remains `completed_with_risks`, not fully accepted for those three unreachable states.

## 2026-07-20 independent audit correction

- A current Kimi K3 read-only audit identified a real boundary defect in the pre-existing shared `relativeTime`: using `Math.round` could render threshold artifacts such as `60 min. ago`, `24 hr. ago`, or `7 days ago` at the end of a unit interval. A4 newly adopted that helper on four surfaces, so the defect was corrected in this branch rather than accepted as inherited behavior.
- The implementation now uses signed truncation, preserving past/future direction while keeping the selected unit below its next threshold. Direct current-Node checks cover both directions at the minute, hour, and day boundaries and return `59 min.`, `23 hr.`, and `6 days` respectively.
- GitNexus upstream impact for `relativeTime` was LOW with no indexed execution-flow expansion. Full Node/Rust/release/live results for the corrected head are recorded in the final acceptance addendum after rebuilding the exact release app.

## 2026-07-20 main integration refresh

- Current integration commit: `41aa5e453abb1ba633c890baaa05354f53d3b27f`, based on main `ca865326c3ab598a81409baed699227ea1155327`.
- U2 had moved Board activity presentation, Board timeline and Connect thread-detail ownership. The three merge conflicts were resolved by retaining main's extracted components and transplanting only A4's relative-time and shared empty-copy behavior into `BoardTimeline.tsx`, `activity-presentation.ts` and `ThreadDetailShell.tsx`; no retired duplicate component was restored.
- Direct boundary checks, renderer typecheck, Activity 51/51 and Connect 11/11 passed. Full Node release gates passed 4/4 with 73/73 harnesses; Rust passed 465/465; `cargo fmt --check` and `git diff --check` passed.
- Latest GitNexus compare against main is **HIGH**, covering 13 existing UI execution flows across AI Accounts, MCP, Board Timeline and the shared EmptyState. This aggregate result is retained as the acceptance risk and is not downgraded from the three LOW conflict-symbol impacts.
- The exact release app rebuilt and signed successfully at the documented worktree path. Executable SHA-256: `4c5b5f781dacf4f5b08c3a367e0038e5c4940f40ef458a4c7dca16ceccff3f1e`; `codesign --verify --deep --strict` passed.
- Current-commit live acceptance remains blocked before launch: the official Computer Use entrypoint returns `Sky Computer Use requires the trusted nodeRepl runtime` even after a clean kernel reset and trusted import. No AppleScript, bundle-id launch, localhost, dev WebView or fabricated profile was used as a substitute. AI Accounts fresh-profile, Loop Runs time and Recovery time therefore remain open.

## 2026-07-20 final release acceptance

- Computer Use recovered after the host app was reopened. All interactions below used the exact release app path documented above; AX reported `tauri://localhost`. No bundle-id launch, AppleScript, localhost browser, dev server or dev WebView was used.
- The unreachable fresh-profile provider state exposed a real product defect: `AiAccountsPane` automatically opened the add-provider form whenever the provider list was empty, making `No API providers yet` unreachable. The auto-open effect was removed; the explicit `Add provider` action remains. `harness-first-run-onboarding` now locks both empty-state reachability and the absence of the auto-open pattern (23/23).
- Full gates for the corrected product source passed: Node release gates 4/4 with 73/73 harnesses, Rust 465/465, renderer typecheck, `cargo fmt --check`, and `git diff --check`.
- A fresh GitNexus index of this exact worktree reports **HIGH** aggregate risk: 16 changed files, 28 changed symbols, and 13 affected existing UI flows. The scope matches A4 (AI Accounts, MCP detail, Board Timeline, shared empty/time presentation); the unrelated 184-file MCP result from the main worktree was rejected as a repository-binding error.
- The exact corrected release app rebuilt and signed successfully. Executable SHA-256: `5ae1a32c6f71c43c25a88200f83d9fa9c4c403e97884f610040ffe06ac71c3fa`; `codesign --verify --deep --strict` passed.

| Surface | Result | Evidence | Final path and observation |
| --- | --- | --- | --- |
| Settings / AI Accounts fresh profile | `verified` | [a4-fresh-ai-accounts-empty-state.jpeg](a4-fresh-ai-accounts-empty-state.jpeg) | Fresh HOME `/private/tmp/offisim-a4-fresh.bs72X0`; PID `84458`; CGWindowNumber `38465`; bounds `36,33 1440x886`. After creating `Northstar Studio` through onboarding, `Settings -> AI Accounts` showed `No API providers yet` and `No API activity yet` together. `Add provider` then opened the form explicitly. |
| Mission / Loop Runs relative time | `verified` | [a4-loop-runs-time.jpeg](a4-loop-runs-time.jpeg) | Real profile; PID `84782`; CGWindowNumber `38494`; bounds `36,33 1440x886`. A saved loop was started through the release UI; `Loops -> Runs` rendered status `Running` with relative time `now`. |
| Office / Recovery relative time | `verified` | [a4-recovery-time.jpeg](a4-recovery-time.jpeg) | A Codex CLI task was started, the exact release window was closed through Computer Use while the task was active, and the same release app was relaunched. PID `85758`; CGWindowNumber `38582`; bounds `36,33 1440x886`. Office rendered an interrupted-work card with `Started now`, `CAN RESUME`, `Resume`, `Discard`, and `Details`. No `sleep 300` or child Codex process remained after the close. |

### Final cleanup

- The temporary recovery run was discarded through the product UI after capture.
- The temporary loop was archived through the product UI. The product has no run-delete action; its inert `Ready to resume` history row remains as product-managed acceptance history, with no live process.
- Fresh-profile directories `/private/tmp/offisim-a4-fresh.rqwbPL` and `/private/tmp/offisim-a4-fresh.bs72X0` were moved to `/Users/haoshengli/.Trash/` and are recoverable.
- Each release window was closed through Computer Use and its exact PID exited.

A4 release acceptance is complete. The three states previously blocked by profile data or the unavailable Computer Use host are now covered by current release-app evidence.
