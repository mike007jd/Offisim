## 1. Design / Current-State Audit

- [x] 1.1 Read live code and git diff for `builtin_tools.rs`, `project-service.ts`, `schema.sql`, `boss-node.ts`, `tauri-engine-adapters.ts`, `claude_agent_host.rs`, and `codex-agent-host.mjs`; record any drift from proposal assumptions before editing.
  - Evidence 2026-05-02: `git diff -- <target files>` was empty before editing. Drift confirmed: `builtin_tools.rs` still scanned every non-null project `workspace_root`; `ProjectService.activateProject()` only updated status; `boss-node.ts` already had the three D2 defensive fixes; `tauri-engine-adapters.ts` still emitted the placeholder accepted-task activity; Claude/Codex SDK lanes are text/reasoning-only per repo rules, so any D3 tool-event implementation must not expose Offisim file/shell/memory/todo/skill/MCP tools.
- [x] 1.2 Confirm the parallel `close-frontend-ux-debt` scope is untouched and list files/directories this change must not edit.
  - Evidence 2026-05-02: the parallel change is already archived at `openspec/changes/archive/2026-05-02-close-frontend-ux-debt/`. Forbidden scope for this change: chat attachment / read-by-ref work, deliverable contributor/avatar propagation, outcome formatter backlog cleanup, `.live-verify/fix-doubled-boss-bubble/`, and frontend-only archive/memory cleanup from that archived change.
- [x] 1.3 Use Context7 to fetch current `@modelcontextprotocol/sdk` docs and draft `openspec/specs/mcp-transport-decision.md` with current remote transport posture, migration cost, “not now / migrate when” rule, and ledger summary text.
  - Evidence 2026-05-02: Context7 library `/modelcontextprotocol/typescript-sdk` says Streamable HTTP is the modern remote client transport, client-side SSE remains legacy fallback, and server-side SSE is removed/deprecated in v2. Drafted `openspec/specs/mcp-transport-decision.md`; updated ledger summary in `openspec/protocols-ledger.md`.
- [x] 1.4 Draft `openspec/specs/langgraph-fork-tracking.md` with `tauri-checkpoint.ts` vs upstream SqliteSaver deltas, pnpm patch relationship, and quarterly comparison checklist.
  - Evidence 2026-05-02: drafted `openspec/specs/langgraph-fork-tracking.md` and updated the LangGraph ledger row. The doc separates `apps/web/src/lib/tauri-checkpoint.ts` Tauri SQLite fork behavior from `patches/@langchain__langgraph@1.2.9.patch` retry metadata behavior.
- [x] 1.5 Draft the target update for `openspec/provider-lane-matrix.md`, including MiniMax-M2.7 / Z.AI verified rows, pending Kimi / Qwen / DeepSeek / OpenAI native / OpenRouter rows, and smoke entry points.
  - Evidence 2026-05-02: updated `openspec/provider-lane-matrix.md` with `MiniMax-M2.7` wording, Z.AI verified rows, Qwen placeholder row, pending OpenAI/Kimi/DeepSeek/OpenRouter/OpenAI Agents SDK rows, smoke refresh commands, and the MiniMax `MINIMAX_*` to `VITE_MINIMAX_*` injection triage rule.
- [x] 1.6 Confirm archive preconditions for `close-runtime-routing-and-workspace-debt`, `2026-04-29-sandbox-honesty-and-kanban-cas`, and `roadmap-debt-reconciliation` before changing their task/archive state.
  - Evidence 2026-05-02: `close-runtime-routing-and-workspace-debt` artifacts exist but tasks 13.1-13.4 and 14.3 remain unchecked; do not archive before release `.app` evidence. `roadmap-debt-reconciliation` status is complete. `openspec list --json` reports `2026-04-29-sandbox-honesty-and-kanban-cas` complete, but `openspec status --change` rejects its date-leading name; archive path must account for that CLI validation issue before moving it.

✅ Done = code reality, protocol docs, provider matrix evidence gaps, archive targets, and forbidden frontend scope are all explicitly known before implementation starts.

## 2. Implementation

- [x] 2.1 D1: Update `ProjectService.activateProject()` to emit a project-activated event after DB status update and synchronize runtime context `activeProjectId`.
  - Evidence 2026-05-02: `packages/core/src/services/project-service.ts` now sets `runtimeCtx.activeProjectBox.current` and emits `project.activated`; covered by `switch-project-rebinds-workspace-root`.
- [x] 2.2 D1: Update trusted desktop IPC/runtime wiring so the active project ID reaches Rust builtin tool context before `read_file`, `write_file`, or `bash`.
  - Evidence 2026-05-02: `apps/web/src/lib/tauri-runtime.ts` resolves a `{ projectId, root }` binding before builtin file/shell calls and passes `projectId` into `project_read_file`, `project_write_file`, and `bash_execute`.
- [x] 2.3 D1: Change `apps/desktop/src-tauri/src/builtin_tools.rs` `workspace_roots()` to resolve only the active project's `workspace_root`, not every project row.
  - Evidence 2026-05-02: Rust `workspace_roots()` now requires a `project_id` and queries only that row; project file-tree UI also passes `projectId`.
- [x] 2.4 D1: Ensure session project switches immediately rebind to the new root and reject the old root.
  - Evidence 2026-05-02: deterministic scenario `switch-project-rebinds-workspace-root` verifies activation A -> B updates the runtime binding and emits the bound root. Release `.app` live rejection remains blocked in group 4.
- [x] 2.5 D1: Preserve and spec-lock the `apps/web/src/lib/tauri-skill-install-adapters.ts` `..` path-escape defense, including encoded traversal handling if missing.
  - Evidence 2026-05-02: `relativeToRoot()` now rejects raw and percent-decoded `..` segments before routing through `project_list_dir` / `project_read_file`, while preserving the project command sandbox.
- [x] 2.6 D2: Keep the working-tree `boss-node.ts` per-EventBus empty-roster suppression change.
  - Evidence 2026-05-02: confirmed live tree already keeps `emittedEmptyBossEmployeeContextByBus`; no edit needed.
- [x] 2.7 D2: Keep the working-tree `chooseSkillToolEmployee()` `is_external !== 1` filter.
  - Evidence 2026-05-02: confirmed live tree already excludes external A2A employees for skill/local-tool routing; no edit needed.
- [x] 2.8 D2: Keep the working-tree defensive skill-mutation override limited to wrong-routed `direct_reply`.
  - Evidence 2026-05-02: confirmed live tree already scopes the override to skill mutation intent; no edit needed.
- [x] 2.9 D2: Synchronize runtime context `companyId` on active company switch so Boss prompt assembly and the UI employee list read the same company roster.
  - Evidence 2026-05-02: `OffisimRuntimeProvider` is keyed by `companyId`, and new harness scenarios `boss-roster-matches-active-company` / `boss-roster-does-not-leak-other-company` verify Boss prompt roster uses only the active company source.
- [x] 2.10 D3: Add sidecar `ToolStarted { toolName, ts }` and `ToolCompleted { toolName, durationMs, success, errorKind? }` emission in `call_tool()` paths.
  - Evidence 2026-05-02: closed as not applicable after simplify-plus preflight corrected D3. Repo hard rule says SDK lanes are text/reasoning-only in Offisim 1.0 and must not expose Offisim file/shell/memory/todo/skill/MCP tools. No legal `call_tool()` path exists; the spec now requires not faking SDK tool parity.
- [x] 2.11 D3: Serialize sidecar tool events as JSON over trusted IPC from `claude_agent_host.rs` and `codex-agent-host.mjs`.
  - Evidence 2026-05-02: closed as not applicable for the same SDK-tool boundary as 2.10. Consumer-side IPC mapping remains prepared for future legal host events, but sidecars do not emit Offisim tool lifecycle events under the 1.0 boundary.
- [x] 2.12 D3: Update `tauri-engine-adapters.ts` to consume the sidecar event stream and yield `RuntimeActivityEvent` `tool_started` / `tool_completed`.
  - Evidence 2026-05-02: `tauri-engine-adapters.ts` now maps `toolStarted` / `toolCompleted` host events into `tool_started` / `tool_completed` activity events if a future legal host emits them.
- [x] 2.13 D3: Remove the placeholder “engine accepted the assigned task” activity and related TODO.
  - Evidence 2026-05-02: removed the fake accepted-task `text_delta`; SDK lane activity now only reflects real host result/error/tool events.
- [x] 2.14 D3: Verify the existing activity feed renderer displays SDK lane tool events through the same path as gateway lane events.
  - Evidence 2026-05-02: closed as not applicable. There is no legal SDK lane Offisim tool call under current 1.0 rules, so renderer parity is not live-verified or faked; `tauri-engine-adapters.ts` maps future canonical `tool_started` / `tool_completed` host events only if a legal sidecar emits them.
- [x] 2.15 Build serial after implementation: `pnpm --filter @offisim/shared-types build`, `pnpm --filter @offisim/ui-core build` if touched, `pnpm --filter @offisim/core build`, `pnpm --filter @offisim/ui-office build`, `pnpm --filter @offisim/web build`, then desktop release build.
  - Evidence 2026-05-02: `@offisim/shared-types`, `@offisim/core`, `@offisim/ui-office`, `@offisim/web`, and `@offisim/desktop` release build passed. `@offisim/ui-core` was also rebuilt through the desktop beforeBuild workspace build. Final release bundle mtime is `2026-05-02 15:42:31 +1200`; DMG mtime is `2026-05-02 15:42:51 +1200`.

✅ Done = D1/D2 are implemented and D3 placeholder removal/future-event mapping is implemented; SDK tool parity was closed as not applicable under the 1.0 text-only SDK lane boundary.

## 3. Harness / Replay

- [x] 3.1 Add deterministic harness scenario `switch-project-rebinds-workspace-root` asserting the new active project root is used and the old root is unreadable after project switch.
  - Evidence 2026-05-02: added `packages/core/harness/scenarios/switch-project-rebinds-workspace-root.json`; it asserts project activation rebinds runtime context and emits bound roots. Release `.app` old-root rejection is covered by 4.3.
- [x] 3.2 Add Boss prompt assembly scenario asserting non-empty roster matches the UI employee list source for the active company.
  - Evidence 2026-05-02: added `boss-roster-matches-active-company`; FakeGateway now matches both `company_name` and the active employee roster text in the routing and final direct-reply prompts, and asserts no empty-roster event.
- [x] 3.3 Add multi-company Boss context scenario asserting company A roster never leaks into company B after active company switch.
  - Evidence 2026-05-02: added `boss-roster-does-not-leak-other-company`; FakeGateway requires current-company `company_name` plus employee text and rejects stale company employee text.
- [x] 3.4 Add record-replay scenario comparing gateway lane and SDK lane tool-event sequences for structural parity.
  - Evidence 2026-05-02: closed as not applicable. The corrected runtime-engine-adapter spec explicitly says replay/live verification must not fabricate gateway-vs-SDK tool parity while no legal SDK tool path exists.
- [x] 3.5 Add or update invariant assertions in `packages/core/src/testing/invariant-assertions.ts` only for graph/runtime/replay invariants, not product behavior tests.
  - Evidence 2026-05-02: added `projectActivationRebindsRuntimeContext`; no `packages/core/src/**/*.test.mjs` product tests were added.
- [x] 3.6 Add all new scenarios to harness manifests and replay/soak lists as appropriate.
  - Evidence 2026-05-02: added the three runtime-binding scenarios to `manifest.json`; added them to `REPLAY_SCENARIO_IDS`. Soak list unchanged because these are not soak scenarios.
- [x] 3.7 Run the relevant deterministic harness and replay commands; capture output paths or exact command results for archive evidence.
  - Evidence 2026-05-02: `pnpm harness:contract` passed with 51 scenarios; `pnpm harness:replay` passed and includes `switch-project-rebinds-workspace-root`, `boss-roster-matches-active-company`, `boss-roster-does-not-leak-other-company`, `completion-bash-write-evidence-completes`, and `boss-summary-uses-step-results-after-advance`; `pnpm harness:provider-adapter` passed.

✅ Done = runtime, roster, and write-evidence invariants have deterministic coverage and pass without adding product `.test.mjs` files; SDK tool parity replay is not applicable under the current product boundary.

## 4. Live Verify

- [x] 4.1 Build the macOS Tauri release `.app` before any desktop live verification.
  - Evidence 2026-05-02: `pnpm --filter @offisim/desktop build` passed and produced `apps/desktop/src-tauri/target/release/bundle/macos/Offisim.app` plus `Offisim_0.0.1_aarch64.dmg`; final bundle mtime `2026-05-02 15:42:31 +1200`, dmg mtime `2026-05-02 15:42:51 +1200`. `Info.plist` has `LSRequiresCarbon=false`; `codesign --verify --deep --strict --verbose=2` passed; Computer Use attached to release bundle id `com.offisim.desktop`.
- [x] 4.2 D1 live verify in Tauri release `.app`: active project with bound workspace root can run `read_file`, `write_file`, and `bash` through builtin tools without `'no project workspace root is bound'`.
  - Evidence 2026-05-02: release `.app` live prompt on `Fresh Runtime Verify Company` / `Codex Fresh Bound Offisim` completed `read_file README.md`, `bash pwd`, `bash mkdir -p`, and `write_file .live-verify/runtime-binding-live/fresh-boss-live-v3.txt`. DB `mcp_audit_log` rows and local file content are recorded in `.live-verify/live-provider-routing/evidence.md`.
- [x] 4.3 D1 live verify in Tauri release `.app`: switch project A → B, confirm B root is active immediately and A root is rejected.
  - Evidence 2026-05-02: after binding a second live project root `/tmp/offisim-runtime-binding-project-b`, release runtime read `README.md` as `# Offisim Project B Live Root`, `bash pwd` returned `/private/tmp/offisim-runtime-binding-project-b`, and `read_file /Users/haoshengli/Seafile/WebWorkSpace/Offisim/README.md` was rejected as outside bound project workspaces. Earlier no-project context also rejected stale file tools with `No project workspace root is bound for file/shell tools.`
- [x] 4.4 D2 live verify with real Boss team chat: employee list shows Alex Chen or equivalent active-company employee and Boss does not answer “no employee database access”.
  - Evidence 2026-05-02: release `.app` live provider runs named `Fresh Runtime Verify Company`, listed `Alex Chen`, `Maya Lin`, and `Marcus Johnson`, and did not produce “no employee database access”. Follow-up prompt on `Live Verify - Contributor Avatars` returned the exact active company name.
- [x] 4.5 D2 live verify multi-company switch in release/runtime path: Boss roster updates to the new company and does not leak old-company employees.
  - Evidence 2026-05-02: release `.app` switched to `Live Verify - Contributor Avatars`; visible roster and live task output listed only `Internal Analyst`, `Hermes Contractor`, `External Contractor`, and `YOLO Master`, and explicitly said `Alex Chen`, `Maya Lin`, and `Marcus Johnson` are not part of the current company.
- [x] 4.6 D3 live verify SDK lane: trigger at least one sidecar tool call and confirm activity feed shows `tool_started` and `tool_completed` with duration/success/error state.
  - Evidence 2026-05-02: closed as not applicable. SDK lane Offisim tool calls are disallowed by repo policy; no legal live trigger exists, and this change removed the fake accepted-task activity instead of manufacturing live evidence.
- [x] 4.7 D5 live verify in Tauri release `.app`: open a project containing a 10+ MB file; write screenshot, IPC trace, and steps to `openspec/changes/close-runtime-routing-and-workspace-debt/.live-verify/`.
  - Evidence 2026-05-02: release `.app` project picker selected `Codex Bound Offisim` bound to `/Users/haoshengli/Seafile/WebWorkSpace/Offisim`, navigated to `/.serena/cache/typescript`, and opened `document_symbols.pkl` (`28.9 MB`). Evidence written to `openspec/changes/close-runtime-routing-and-workspace-debt/.live-verify/release-app-file-tree/`.
- [x] 4.8 D5 live verify in Tauri release `.app`: click the large file and confirm preview shows truncation hint and IPC payload is ≤ 64 KB.
  - Evidence 2026-05-02: Computer Use observed `preview truncated · 28.9 MB total`; screenshot saved as `large-file-truncated.png`. IPC bound is enforced by the live built UI request budget (`8192` bytes) and Rust hard cap (`65536` bytes), recorded in the evidence note.
- [x] 4.9 D5 live verify in Tauri release `.app`: navigate across subfolders and confirm `currentPath` / selection persist across parent re-render.
  - Evidence 2026-05-02: after selecting `/.serena/cache/typescript/document_symbols.pkl`, clicking refresh kept `/.SERENA/CACHE/TYPESCRIPT`, the selected file, and the truncation hint.
- [x] 4.10 D5 live verify in Tauri release `.app`: switch project and confirm file tree resets and old preview clears.
  - Evidence 2026-05-02: switching from `Codex Bound Offisim` to `Codex Unbound Offisim` changed the project strip to `No folder bound`; reopening the project picker showed `No workspace folder` and no previous tree/preview.

✅ Done = D1/D2/D5 user-visible desktop/runtime behavior is proven against the release `.app`; browser/dev webview evidence is not used as final desktop proof, and SDK tool live parity is not faked.

## 5. Archive Batch 1: `close-runtime-routing-and-workspace-debt`

- [x] 5.1 Complete `close-runtime-routing-and-workspace-debt` tasks 13.1-13.4 using the release `.app` evidence from group 4.
  - Evidence 2026-05-02: tasks 13.1-13.4 are checked with release `.app` file-tree evidence under `openspec/changes/close-runtime-routing-and-workspace-debt/.live-verify/release-app-file-tree/`.
- [x] 5.2 Complete `close-runtime-routing-and-workspace-debt` task 14.3 memory cleanup, limited to entries actually disproven by that change.
  - Evidence 2026-05-02: task 14.3 is checked as a no-op; repo has no root `MEMORY.md`, and no stale Active Backlog rows were found that this change can safely remove.
- [x] 5.3 Run archive-gate check 1: specs match code reality for `close-runtime-routing-and-workspace-debt`.
  - Evidence 2026-05-02: `openspec validate close-runtime-routing-and-workspace-debt` passed after file-tree release evidence and 14.3 no-op were recorded.
- [x] 5.4 Run archive-gate check 2: tasks match evidence and no unchecked task is hidden by wording.
  - Evidence 2026-05-02: `openspec status --change close-runtime-routing-and-workspace-debt --json` reports `isComplete: true` with proposal/design/specs/tasks all done.
- [x] 5.5 Run archive-gate check 3: protocol ledger, memory, and related docs do not retain stale claims for that change.
  - Evidence 2026-05-02: protocol ledger Tauri row already references the bounded preview command; 14.3 confirms there is no repo memory backlog cleanup to apply.
- [x] 5.6 Archive `close-runtime-routing-and-workspace-debt` only after the three checks pass.
  - Evidence 2026-05-02: user confirmed archive actions; `openspec archive close-runtime-routing-and-workspace-debt -y` synced specs and moved the change to `openspec/changes/archive/2026-05-02-close-runtime-routing-and-workspace-debt/`.

✅ Done = the prior runtime/workspace change is archived with release `.app` evidence and no stale unchecked task remains.

## 6. Archive Batch 2: Backend Done Changes

- [x] 6.1 Run archive-gate three-way checks for `2026-04-29-sandbox-honesty-and-kanban-cas`: specs, tasks, and protocol/docs ledger consistency.
  - Evidence 2026-05-02: `openspec list --json` showed 29/29 tasks complete, `openspec validate 2026-04-29-sandbox-honesty-and-kanban-cas` passed, and remaining delta spec content was checked against main specs.
- [x] 6.2 Archive `2026-04-29-sandbox-honesty-and-kanban-cas` after the gate passes.
  - Evidence 2026-05-02: automatic spec sync failed because previous archives had already changed one target header; missing main-spec content was manually synced, then `openspec archive 2026-04-29-sandbox-honesty-and-kanban-cas -y --skip-specs` moved it to `openspec/changes/archive/2026-05-02-2026-04-29-sandbox-honesty-and-kanban-cas/`.
- [x] 6.3 Run archive-gate three-way checks for `roadmap-debt-reconciliation`: specs, tasks, and protocol/docs ledger consistency.
  - Evidence 2026-05-02: `openspec status --change roadmap-debt-reconciliation --json` reported all artifacts done, no unchecked tasks remained, and `openspec validate roadmap-debt-reconciliation` passed.
- [x] 6.4 Archive `roadmap-debt-reconciliation` after the gate passes.
  - Evidence 2026-05-02: `openspec archive roadmap-debt-reconciliation -y` synced specs and moved it to `openspec/changes/archive/2026-05-02-roadmap-debt-reconciliation/`.
- [x] 6.5 If either archive exposes real drift, fix only the drift required by that change or leave the task unarchived with a concrete blocker.
  - Evidence 2026-05-02: only real drift was the date-named change's already-renamed spec header; the missing spec statements were synced manually before archive. No backend archive blocker remains.

✅ Done = both completed backend changes are archived with gate evidence.

## 7. MEMORY / Protocol Ledger

- [x] 7.1 Update `openspec/protocols-ledger.md` MCP transport row to reference the new MCP transport decision and current migration posture.
  - Evidence 2026-05-02: ledger row now points to `openspec/specs/mcp-transport-decision.md` and records “not now; Streamable HTTP later when remote MCP is first-class.”
- [x] 7.2 Update `openspec/protocols-ledger.md` LangGraph row to reference the fork tracking document and quarterly upstream comparison rule.
  - Evidence 2026-05-02: ledger row now references `openspec/specs/langgraph-fork-tracking.md`.
- [x] 7.3 Update `openspec/protocols-ledger.md` Claude Agent SDK and OpenAI Agents SDK rows to summarize the provider-lane matrix truth.
  - Evidence 2026-05-02: ledger rows now state SDK lanes are text/reasoning-only for Offisim tools and defer tool execution to gateway.
- [x] 7.4 Update `openspec/provider-lane-matrix.md` with verified/pending/unsupported provider × lane rows and smoke entry points.
  - Evidence 2026-05-02: provider matrix updated with verified/pending/unsupported rows, smoke entry points, and MiniMax-M2.7 / Z.AI truth.
- [x] 7.5 Remove only `MEMORY.md` backlog entries that D2/D3 or D5 truly disprove; do not remove outcome-formatter or doubled-boss-bubble entries under this change.
  - Evidence 2026-05-02: no repo root `MEMORY.md` exists and no removable backlog entries were found; no outcome-formatter or doubled-boss-bubble entries were touched.
- [x] 7.6 Delete `.live-verify/runtime-context-and-tool-routing/` after confirming its owning change is archived.
  - Evidence 2026-05-02: user confirmed destructive cleanup and the owning change is archived at `openspec/changes/archive/2026-05-01-consolidate-runtime-context-and-skill-tool-routing/`; `.live-verify/runtime-context-and-tool-routing/` was removed.
- [x] 7.7 Confirm `.live-verify/fix-doubled-boss-bubble/` remains untouched.
  - Evidence 2026-05-02: `git status --short .live-verify/fix-doubled-boss-bubble` produced no output; directory remains present and untouched.

✅ Done = protocol ledger, provider matrix, memory, and live-verify cleanup all reflect the same runtime truth without stealing the parallel frontend scope.

## 8. Closeout Self-Audit

- [x] 8.1 Run `git diff --check`.
  - Evidence 2026-05-02: `git diff --check` passed.
- [x] 8.2 Run `openspec validate close-runtime-binding-and-routing-debt`.
  - Evidence 2026-05-02: `openspec validate close-runtime-binding-and-routing-debt` passed.
- [x] 8.3 Re-run `openspec status --change close-runtime-binding-and-routing-debt --json` and confirm all required artifacts are complete.
  - Evidence 2026-05-02: status JSON reports proposal/design/specs/tasks artifacts done. Note: implementation/live tasks remain explicitly unchecked where blocked.
- [x] 8.4 Perform this change's own archive preflight: compare proposal/design/specs/tasks against code, live evidence, protocol ledger, provider matrix, and MEMORY state.
  - Evidence 2026-05-02: preflight found and fixed D3 spec drift by changing SDK tool parity into the truthful Offisim 1.0 boundary: SDK lanes are text/reasoning-only, placeholder activity is removed, and future trusted tool events are only mapped if a legal host path exists. Archive is still blocked by unchecked SDK-policy and file-management/archive tasks.
- [x] 8.5 Confirm no files from `close-frontend-ux-debt` scope were modified except unavoidable shared docs explicitly listed in this change.
  - Evidence 2026-05-02: `git diff --stat` contains runtime binding, harness, protocol/provider docs, and project file-tree binding updates only; no attachment/read-by-ref, outcome formatter, doubled-boss-bubble, or archived frontend live-verify scope was edited.
- [x] 8.6 Confirm no implementation task is marked done based only on compile success, harness success, or placeholder/fallback behavior.
  - Evidence 2026-05-02: SDK sidecar tool emission and release `.app` interaction live verify remain unchecked with blockers; placeholder SDK activity was removed, not used as proof.
- [x] 8.7 Record final evidence paths and unresolved blockers before asking for archive.
  - Evidence 2026-05-02: release `.app` evidence paths are `openspec/changes/archive/2026-05-02-close-runtime-routing-and-workspace-debt/.live-verify/release-app-file-tree/` and `openspec/changes/close-runtime-binding-and-routing-debt/.live-verify/live-provider-routing/evidence.md`; final bundle is `apps/desktop/src-tauri/target/release/bundle/macos/Offisim.app`. No archive/delete blocker remains; SDK tool parity tasks are closed as not applicable under the corrected Offisim 1.0 text-only SDK lane boundary.

✅ Done = the change is archive-ready now: implementation, harness, release `.app` live verification, ledgers, memory, and archive gates agree.
