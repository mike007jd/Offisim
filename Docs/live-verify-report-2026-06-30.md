# Offisim Real User Live Verify - 2026-06-30

## Summary
- Objective: run the real-user live verification loop against the current Offisim worktree.
- Current time: 2026-06-30 21:08:46 NZST.
- Run target: desktop release app.
- Live artifact: `apps/desktop/src-tauri/target/release/bundle/macos/Offisim.app`.
- Data mode: sanitized-local.
- Evidence dir: `Docs/evidence/live-verify-2026-06-30/`.
- Evidence availability: historical local-only screenshots and logs are ignored and are not available from a fresh clone; the tracked manifest records this past run and is not current release evidence.
- Protected actions: production data, paid calls, credentials, model downloads, publish, install, merge/discard worktrees, irreversible delete.
- Decision: verify the release `.app` itself with Computer Use after release build and core gates. Dev webview/browser checks are not final evidence.

## Source Truth
| claim | status | evidence | implication |
|---|---|---|---|
| Offisim is a desktop-only Tauri product; final verification must use the release `.app`. | TRUE | `AGENTS.md`; `Docs/00_start_here/RELEASE_GATES.md` | Build and launch the exact worktree app path before UI PASS. |
| Pi Agent is the only active runtime; Offisim must not restore provider/model catalogs or alternate SDK lanes. | TRUE | `AGENTS.md`; `Docs/UI_FRAMEWORK_STACK.md`; `Docs/FEATURES.md` | Settings and runtime checks focus on Pi config/auth/model summary only. |
| User-visible navigation contains Office, Connect, Loops, Market, Personnel, Activity, Tasks, Settings, Studio. | TRUE | `apps/desktop/renderer/src/app/nav-registry.ts`; `apps/desktop/renderer/src/surfaces/SurfaceRouter.tsx` | Inventory covers every nav entry, not only Office. |
| Connect is company chat, isolated from Office project work. | TRUE | `Docs/FEATURES.md`; `apps/desktop/renderer/src/surfaces/workspace/apps/MessengerApp.tsx` | Connect tests must not expect project tools or Office thread state. |
| Loops are reusable authoring artifacts; run materialization happens through Office send/start. | TRUE | `Docs/FEATURES.md`; `apps/desktop/renderer/src/surfaces/mission/MissionSurface.tsx`; `LoopLibrary.tsx`; `LoopEditor.tsx` | Live verify covers library/editor gates and stops before external Pi-dependent compile if auth is absent. |
| Market publish/install/registry token paths can mutate shared state or require credentials. | TRUE | `MarketSurface.tsx` | Verify dialogs and safe-stop states, not final publish/install/token save without explicit approval. |
| Task Board merge/discard worktree actions are destructive/shared-state actions. | TRUE | `TaskBoardSurface.tsx` | Verify review UI up to first confirmation only. |
| Project workspace browsing must go through sandboxed Tauri commands. | TRUE | `AGENTS.md`; `desktop-agent-runtime.ts`; `evaluation-context.ts` | Live verify records project scope and workspace folder behavior without direct webview fs access. |

## Plan Packet
- Phase 1: inventory and data setup.
  - Oracle: this report contains every user-facing surface and acceptance criteria; data manifest records sanitized local state.
  - Gate: no live testing before inventory v0 exists.
- Phase 2: build and core release gates.
  - Oracle: command logs under `logs/`, release app hash in `evidence-manifest.json`.
  - Gate: release `.app` must exist and launch from the exact worktree path.
- Phase 3: Computer Use live verification.
  - Oracle: window identity, screenshots, interaction notes, and pass/fail rows in the manifest.
  - Gate: no localhost/dev-webview evidence counted as final PASS.
- Phase 4: bug fix loop if failures are confirmed.
  - Oracle: GitNexus impact before symbol edits, targeted regression gate, cleanup/review, live rerun.
  - Gate: confirmed P0/P1/P2 cannot remain open unless blocked by external credentials/hardware/protected action.
- Phase 5: fresh full rerun and final decision.
  - Oracle: full gate results, final screenshot set, bug ledger status, GO/HOLD/BLOCKED conclusion.

## Inventory V0
| ID | Surface / workflow | Acceptance criteria | Edge cases | Evidence oracle | Live GUI | Protected |
|---|---|---|---|---|---|---|
| INV-01 | Cold start / company lifecycle | Existing companies load or create wizard appears; create company persists and routes to Office or Studio depending template. | Empty state, create-your-own, long name, optional description, failed storage. | Screenshot, SQLite/company count or app state, toast. | Yes | Delete/archive final action stops before confirm unless test-owned row. |
| INV-02 | Scope bar company/project switch | Company dropdown, project dropdown, new/edit project dialog, workspace root validation, open folder affordance render correctly. | No project, overbroad folder, empty project name, missing workspace root. | Screenshot, toast, project row evidence. | Yes | OS folder open is local safe; no arbitrary data deletion. |
| INV-03 | Office workbench shell | Workspace panel, stage/theater, team dock, chat rail, collapse/expand controls and empty conversation states are usable. | No thread, collapsed rails, no employees, no project. | Screenshot, visible panels, no render error. | Yes | Sending Pi work may require auth; stop if credentials absent. |
| INV-04 | Office conversation draft | New conversation can be opened; composer accepts text; send path either persists draft or honestly reports Pi auth/runtime absence. | Empty draft, model override absent, workspace root unavailable. | Screenshot, toast/error banner, DB/thread row if sent. | Yes | Paid/external model call only if existing Pi auth is already present. |
| INV-05 | Connect Chats | Chat list/search, new chat dialog, direct/group draft, Ask Team dialog, archive affordance and empty/error states behave. | No employees, archived thread, mentions-only, roundtable. | Screenshot, collaboration tables or UI state. | Yes | AI replies require Pi auth; no project tool execution expected. |
| INV-06 | Connect Calendar/Contacts/Workplace | Rail switching works; Calendar honest-empty; Contacts can route to message; Workplace can open listed app such as Kanban. | Empty agenda, missing employee, no tasks. | Screenshot, selected rail/app state. | Yes | None beyond no external calls. |
| INV-07 | Loops Library | Library loads; search/profile/status filters work; New Loop creates draft; card actions show correct disabled/safe states. | No loops, archived filter, not compiled. | Screenshot, loop row evidence. | Yes | Start run/Use in Office only after saved revision. |
| INV-08 | Loops Editor | Editor opens; example prompt fills composer; Compile/Save/Use gates reflect state; version menu and graph/drawer render. | Empty prompt, stale graph, needs input, invalid compile. | Screenshot, loop revision row or auth absence note. | Yes | Compile/Enhance may call Pi; stop if auth absent. |
| INV-09 | Market Browse/Installed | Browse/search/kind/sort/Installed tabs render; no registry shows honest state; local import and registry token dialogs open. | Registry missing, file import cancel, no listings, search no match. | Screenshot, dialog state. | Yes | Do not save token, publish, or install final. |
| INV-10 | Personnel roster | Roster search/filter/collapse; hire dialog; profile/skills/tools/memory/appearance/runtime/history tabs render; save guard works. | Empty roster, unsaved profile switch, external employee read-only. | Screenshot, employee row evidence, toast. | Yes | Employee delete final confirmation protected unless test-owned employee. |
| INV-11 | Activity | Date/type/actor/search filters, stats, empty/no-match/detail states work; Back to Office works. | Today empty auto-widen, stale selected event. | Screenshot, event row/detail. | Yes | None. |
| INV-12 | Tasks | Status/search/refresh/stats, empty/no-match/detail, interrupted recovery strip, worktree review safe-stop states render. | No runs, child runs, interrupted run, lease with conflicts. | Screenshot, run/detail row evidence. | Yes | Cancel/resume/discard/merge final actions protected unless test-owned run. |
| INV-13 | Settings Pi Agent | Pi Agent pane shows status, auth/model paths, models.json summary, copy buttons, advanced override; no Offisim provider catalog. | No auth, malformed models.json, desktop unavailable. | Screenshot, `pi_agent_status` UI, config path redacted. | Yes | Do not enter credentials. |
| INV-14 | Settings Runtime/MCP/External | Runtime ownership summary, local vault disclosure, diagnostics export, MCP and External Employees panes render. | Vault unavailable, no diagnostics, no MCP servers. | Screenshot, export artifact hash if run. | Yes | External install/credentials safe-stop. |
| INV-15 | Studio | Studio surface renders custom office editor, scene tree, prefab browser, inspector, 3D/2D scene without blank canvas. | Empty/custom company, prefab selection, scene load error. | Screenshot, visual nonblank check. | Yes | None. |

## Anti-overengineering Decisions
- KEEP: release `.app` plus Computer Use as final evidence, because project rules explicitly reject dev webview/browser proof.
- KEEP: Pi Agent auth/model status as an observed state, not a fabricated fixture.
- REMOVE: no standalone web or launcher validation, because Offisim is desktop-only.
- REMOVE: no new broad product test suite; retained gates and harnesses are the release contract.
- DEFER: live Pi model execution if credentials are absent; record as auth-dependent SKIP/BLOCKED instead of adding fake runtime.

## Test / Verification Log
- Completed against current real-world baseline: 2026-06-30 21:53:16 NZST.
- Release target: exact current worktree app at `apps/desktop/src-tauri/target/release/bundle/macos/Offisim.app`.
- Sanitized data: `HOME=/tmp/offisim-live-verify-home-20260630`, workspace root `/tmp/offisim-live-verify-workspace-20260630`; fresh rerun used `/tmp/offisim-live-verify-home-20260630-fresh`.
- Gates passed: `pnpm install --frozen-lockfile`, `pnpm validate`, `pnpm check:ui-hygiene`, `pnpm security:harness`, `pnpm audit --prod --audit-level high`, `cargo test --locked`, `pnpm --filter @offisim/desktop-renderer build`, `pnpm --filter @offisim/desktop build`, and `git diff --check`.
- Toolchain note: the first `pnpm validate` attempt used global pnpm 11.7.0 in a nested process and failed on package-manager enforcement; rerun with a Corepack pnpm 10.15.1 shim passed.
- Computer Use live verify attached the release app by the exact `.app` path, exercised all inventory rows INV-01 through INV-15, and saved screenshots `SS-00` through `SS-37`.
- Protected actions were verified to the safe-stop boundary only: Office Send, Loop Compile/Enhance/Use, Market token save/import/install/publish, MCP/external credential paths, employee delete, and worktree cancel/resume/discard/merge were not finalized.
- Pi Agent auth was absent in this sanitized profile; Settings correctly showed Pi Agent as the only runtime and surfaced `auth.json` / `models.json` paths without restoring Offisim provider catalog.
- Confirmed bug BUG-LV-01 was found in Loops draft persistence, fixed in `apps/desktop/renderer/src/data/loops.ts` and `apps/desktop/renderer/src/surfaces/mission/loops/LoopEditor.tsx`, then verified in the original profile and a fresh HOME rerun.
- GitNexus was refreshed before edits. Impact was LOW for `LoopEditor`; HIGH risk on `createLoopService` was avoided by not modifying core service. Final `detect_changes` reported MEDIUM expected scope limited to Loops/Mission renderer data flows.

## Final Decision
GO.

The current worktree release app passes the real-user live verify loop for all user-facing surfaces under sanitized local data. No P0/P1/P2 remains open. Auth-dependent or protected external actions are explicitly recorded as safe-stop, not product failures.
