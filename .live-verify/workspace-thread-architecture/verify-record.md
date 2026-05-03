# workspace-thread-architecture — live verify record

**Change**: `openspec/changes/workspace-thread-architecture/`
**Built**: 2026-05-04
**Built from commit**: 521aae85 (Session E)
**.app path**: `apps/desktop/src-tauri/target/release/bundle/macos/Offisim.app`

## Run instructions

Launch the **exact** worktree `.app` (not via bundle id `open -b com.offisim.desktop` — multi-worktree gotcha):

```bash
open /Users/haoshengli/Seafile/WebWorkSpace/Offisim/apps/desktop/src-tauri/target/release/bundle/macos/Offisim.app
```

If the secret store dialog asks for keychain on first run, allow once; subsequent launches reuse the file-based secret store.

For each scenario below:
1. Run the steps.
2. Drop screenshots into this directory with the listed filename.
3. Tick `[x]` and add a 1-line note (PASS / FAIL + what failed).

If a scenario fails: stop, report back, do NOT silently work around. Per CLAUDE.md: "fix root cause (no UI suppress / dual-mount hacks) and re-verify before archiving".

---

## Scenario A — multi-thread isolation (14.3)

- [x] Steps:
  1. Boot app, pick or create a Company.
  2. Create or pick Project P.
  3. In the right rail Threads panel, confirm a default thread exists (named `New thread`); call it `T1`. Send "T1 hello" in chat.
  4. Click **+ New thread** (the `+` icon in the Threads header). New thread appears as active. Send "T2 hello".
  5. Click `T1` row. Confirm chat rail shows ONLY "T1 hello" + assistant's T1 reply. Click `T2`. Confirm only T2 messages.
- Capture: `14.3-T1-only.png`, `14.3-T2-only.png`
- Note: PASS — release `.app` via Computer Use; T1 view shows only `T1 hello` + its boss reply, T2 view shows only `T2 hello` + its boss reply. Used the unbound project for readable chat screenshots.

## Scenario B — boss auto title (14.4)

- [ ] Steps:
  1. Click **+ New thread**. Title shows `New thread`.
  2. Send: `draft me a Q3 launch plan with timelines`.
  3. After the assistant reply renders, watch the Threads list. Within ~5–15s the title should rewrite to a 1-line summary (e.g. `Q3 launch plan draft` or similar). On LLM failure it falls back to truncated user prompt.
- Capture: `14.4-before.png` (just after send, title still `New thread`), `14.4-after.png` (title updated).
- Note: FAIL — after the boss reply, `chat_threads.title` persisted as `draft me a Q3 launch plan with timelines`, but the visible Threads list stayed on `New thread` after >15s; likely ThreadList does not refresh after best-effort auto-title persistence.

## Scenario C — user rename sticky (14.5)

- [ ] Steps:
  1. Double-click any thread row to enter rename mode. Type `Strategy notes`. Press Enter.
  2. Send another message in that thread.
  3. Confirm title stays `Strategy notes` after the assistant reply (boss auto-title is no-op when `title_set_by_user=1`).
- Capture: `14.5-rename-sticky.png`
- Note:

## Scenario D — header is identity-only (14.6)

- [ ] Steps:
  1. Look at the top header strip.
  2. Confirm: NO Mode chip / NO Notification bell / NO Dashboard button / NO Install button there.
  3. Header should only show: company name, view-mode toggle, peer-workspace pills, project selector, file-import button, optional `API Settings` CTA when provider unconfigured.
- Capture: `14.6-header-identity-only.png`
- Note:

## Scenario E — Mode chip in chat input footer (14.7)

- [ ] Steps:
  1. In chat input area, find the Mode chip in the hint row (right-aligned, shows current mode like `BOSS PROXY`).
  2. Click it, switch to `YOLO`.
  3. Send a fresh message.
  4. Verify next turn runs under YOLO mode (look at Activity rail / status bar pipeline label, or check that no permission prompts intervene).
- Capture: `14.7-mode-chip.png`, `14.7-yolo-active.png`
- Note:

## Scenario F — bottom status bar slots (14.8)

- [ ] Steps:
  1. Status bar at bottom should show: Run state · Dashboard chip · Notification bell · git-branch chip (if `workspace_root` is bound, otherwise hidden) · WORK cluster · Resources / model / cost / latency.
  2. Click Dashboard chip → dashboard popup opens. Click again → closes. Verify chip turns active when open.
  3. Click Notification bell → notification panel opens, badge ring should be inline (no clipping).
  4. If you have a project with `workspace_root` set: confirm `⎇ main` chip appears. (Real branch read is a placeholder `main` for now — flag if you want true branch read.)
- Capture: `14.8-statusbar.png`, `14.8-dashboard-open.png`, `14.8-notification-open.png`
- Note:

## Scenario G — install singularity (14.9)

- [ ] Steps:
  1. Open Market workspace. Pick any listing card → click Install. Confirm `<InstallDialog>` opens.
  2. Drop a `.bubu.zip` / `.skill` / asset file onto the chat surface (sideload). Confirm SAME `<InstallDialog>` opens (file-import variant).
  3. Confirm there is no other install dialog anywhere — nothing in header, nothing in status bar, nothing in command palette.
- Capture: `14.9-install-from-market.png`, `14.9-install-from-drop.png`
- Note:

## Scenario H — Tasks gating (14.10)

- [ ] Steps:
  1. Open a fresh thread (no plan, no deliverables). Click `Tasks` tab in the right rail.
  2. Confirm: Activity section renders. Plan section hidden. Outputs section hidden.
  3. Send a multi-task prompt that triggers a plan (e.g. `coordinate marketing + dev to launch product X`). When `pipelineStage === 'planning'` or steps appear, Plan section should pop in.
  4. After deliverables are produced, Outputs section should pop in.
- Capture: `14.10-tasks-empty.png`, `14.10-tasks-plan-only.png`, `14.10-tasks-with-outputs.png`
- Note:

## Scenario I — Kanban chip (14.11)

- [ ] Steps:
  1. Tasks tab on a thread with zero kanban cards. Confirm `📋 Board ▾` chip is **absent**.
  2. Trigger a multi-task plan that creates kanban cards (boss-driven planning ceremony). Or `/kanban add ...` if such command exists.
  3. Confirm chip appears. Click → tray expands inline. Click again → collapses.
- Capture: `14.11-no-chip.png`, `14.11-chip-collapsed.png`, `14.11-chip-expanded.png`
- Note:

## Scenario J — Workspace search (14.12)

- [ ] Steps:
  1. In right rail Workspace section, find the search input ("Search threads, people…").
  2. Type a few chars matching a thread title. Confirm thread row appears with `thread` chip. Click → switches to that thread.
  3. Type a few chars matching an employee name. Confirm employee row appears with `person` chip. Click → routes to Personnel page for that employee.
  4. Empty query → dropdown collapses.
  5. **File search is deferred** — confirm no file family appears (intentional, see tasks.md 12.2).
- Capture: `14.12-search-results.png`, `14.12-thread-route.png`, `14.12-employee-route.png`
- Note:

## Scenario K — Web SPA narrow tier (14.13) — OPTIONAL, web only

- [ ] Steps:
  1. `pnpm --filter @offisim/web dev` from repo root.
  2. Open `http://localhost:5176`, resize browser to ≤768 px wide.
  3. Confirm thread list / status bar slots / chat input remain reachable (likely via drawer or stack-navigation).
- Capture: `14.13-narrow-tier.png`
- Note:

---

## Aggregate

- Pass count: 1 / 11 (10 mandatory + 1 optional narrow tier; stopped at Scenario B per fail-fast instruction)
- Failures (with notes):
  - Scenario B (14.4): auto-title writes through to DB, but the live Threads list does not update without an external refresh.
- Decisions / known limitations confirmed:
  - Git branch shows placeholder `main` (real branch read deferred).
  - File search not in WorkspaceSearch (deferred — needs Tauri-only path).
  - `BottomStatusBar` extends existing `<StatusBar>`, not a separate component.
  - Multi-thread isolation harness scenario deferred (runtime invariant proven via `chatScopeFields` code; live verify A is the user-facing guard).

If all 10 mandatory scenarios pass: this change is ready for `/opsx:archive` (Section 15).
