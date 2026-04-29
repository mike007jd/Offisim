## 1. SSOT module: `task-tool-intent`

- [x] 1.1 Create `packages/core/src/agents/task-tool-intent.ts` exporting `TaskToolIntent` interface, `detectTaskToolIntent`, `evidenceToolsForIntent`, and named keyword sets (`LOCAL_TOOL_NAME_TOKENS`, `READ_VERB_OBJECT_PAIRS`, `WRITE_VERB_OBJECT_PAIRS`, `BASH_VERB_OBJECT_PAIRS`, `VERIFICATION_TOKENS`, plus `CHINESE_*` parallels)
- [x] 1.2 Implement detector — verb+object pairs use `\b<verb>\b[^.]{0,80}\b<object>\b` patterns (English) and `<verb>.{0,8}<object>` patterns (Chinese); explicit tool tokens use `\b<token>\b`; bare nouns explicitly excluded
- [x] 1.3 Implement `evidenceToolsForIntent` returning deduped, stable-ordered tool list per intent buckets
- [x] 1.4 Move `isLocalToolAssignableEmployee(employee)` from `local-tool-routing.ts` into `task-tool-intent.ts` (or a new `agents/employee-routing-helpers.ts` if cleaner)
- [x] 1.5 Delete `packages/core/src/agents/local-tool-routing.ts` (no aliases, pre-launch)
- [x] 1.6 Update `packages/core/src/index.ts` and `browser.ts` re-exports — remove old `requiresLocalOffisimTools`, add new SSOT exports if any are public

## 2. Graph state: `taskToolIntent` field

- [x] 2.1 Add `taskToolIntent: TaskToolIntent | null` to `OffisimGraphState` in `packages/core/src/graph/state.ts`
- [x] 2.2 Add `taskToolIntent: null` to `createEmptyPlanScopedState()` so plan-scoped resets clear stale intent
- [x] 2.3 Update `boss-node.ts` to call `detectTaskToolIntent(userMessageContent)` once at entry and return it in the partial state update
- [x] 2.4 Update `pm-planner/preflight.ts` to populate `taskToolIntent` if not already set (direct-to-employee entry path)
- [x] 2.5 Update `yolo-master-node.ts` to populate `taskToolIntent` for yolo entry path

## 3. Replace inline intent calls in routing nodes

- [x] 3.1 `boss-node.ts` — remove `requiresLocalOffisimTools(text)` call; consume `state.taskToolIntent.requiresLocalTools` for routing decision
- [x] 3.2 `manager-node.ts` — remove `requiresLocalOffisimTools(text)` call; consume `state.taskToolIntent.requiresLocalTools`
- [x] 3.3 `pm-planner/preflight.ts` — remove inline call, consume state field (after step 2.4 populates it)
- [x] 3.4 `employee-direct-setup-node.ts` — remove inline call, consume state field
- [x] 3.5 Grep `packages/core/src/agents/**/*.ts` for `requiresLocalOffisimTools(` and `LOCAL_TOOL_REQUEST_RE` — must return zero matches

## 4. Replace `evidenceToolsForTask` in completion verifier

- [x] 4.1 In `employee-completion.ts`, replace inline `evidenceToolsForTask(taskDescription)` body with `evidenceToolsForIntent(state.taskToolIntent ?? detectTaskToolIntent(taskDescription))`
- [x] 4.2 Delete the inline `evidenceToolsForTask` function declaration from `employee-completion.ts`
- [x] 4.3 Update `verifyTaskCompletion` signature if needed so callers pass `state` (already has it; verify)
- [x] 4.4 Grep `employee-completion.ts` for `function evidenceToolsForTask` — must return zero matches

## 5. Reroute event factory + shared types

- [x] 5.1 Add `taskAssignmentRerouted(companyId, taskRunId, requestedEmployeeId, resolvedEmployeeId, reason, threadId, source)` factory in `packages/core/src/events/event-factories.ts`
- [x] 5.2 Define event type literal `'task.assignment.rerouted'` and the `RerouteReason` union (`'requires-local-tools' | 'employee-not-found' | 'employee-disabled' | 'no-recommendation-fallback'`) in `packages/shared-types/src/event-types.ts` (or whichever file holds the event union)
- [x] 5.3 Build shared-types first: `pnpm --filter @offisim/shared-types build`

## 6. Manager-node assignment rebind observability

- [x] 6.1 In `manager-node.ts`, when `decision.assignments.filter(...)` drops an LLM-chosen assignment due to the routing gate, capture the dropped requestedEmployeeId
- [x] 6.2 Emit `taskAssignmentRerouted` event with `source: 'manager'`, `reason: 'requires-local-tools'`, requested vs resolved IDs
- [x] 6.3 Add `logger.info('manager.assignment.rerouted', { ... })` mirror entry
- [x] 6.4 If the manager picks a different fallback than the gate-filter result (no match), emit with `reason: 'no-recommendation-fallback'`

## 7. PM-planner sanitize rebind observability + recommended ordering

- [x] 7.1 Read `plan-persistence.ts` `sanitizePlanEmployees` — locate the `validEmployees[0]` fallback site
- [x] 7.2 Inspect upstream plan generation to find the planner-recommended ordering field name (`recommendedEmployees` or equivalent in `LlmPlan` / `TaskPlan` types). If no such field exists, add one in `plan-parser.ts` extraction
- [x] 7.3 Replace `validEmployees[0]` fallback with: prefer first valid employee in `recommendedEmployees`, else fall back to `validEmployees[0]`
- [x] 7.4 For every swap, emit `taskAssignmentRerouted` with `source: 'pm-planner'` and the appropriate `reason` (`'employee-not-found'` / `'employee-disabled'` / `'no-recommendation-fallback'`)
- [x] 7.5 If the new logic pushes `plan-persistence.ts` past its sibling-module responsibility per `pm-planner-node-boundaries`, extract a new sibling `pm-planner/sanitize-rebind.ts` and route through it
- [x] 7.6 Add `logger.info('pm-planner.assignment.rerouted', { ... })` mirror entry
- [x] 7.7 Verify `pmPlannerNode is a thin pipeline barrel` invariant still holds: `grep -cvE '^\s*(//|$|/\*|\*)' packages/core/src/agents/pm-planner-node.ts` ≤ 150

## 8. Tauri `project_read_file_preview` command

- [x] 8.1 In `apps/desktop/src-tauri/src/builtin_tools.rs`, add `MAX_PREVIEW_BYTES: u64 = 65536` constant
- [x] 8.2 Add `ProjectFilePreview { content: String, truncated: bool, total_size: u64 }` struct with `serde(rename_all = "camelCase")`
- [x] 8.3 Implement `project_read_file_preview(app, path, cwd, max_bytes)` Tauri command — clamp `max_bytes` to `MAX_PREVIEW_BYTES`, use `tokio::fs::File::open` + `take(clamped)` + `read_to_end`, get `total_size` from `metadata().len()`
- [x] 8.4 UTF-8 boundary safety — convert with `String::from_utf8` first; on `Utf8Error`, walk back from `error.valid_up_to()` and return only the valid prefix; if walk-back yields zero bytes, return `truncated: true, content: ""`
- [x] 8.5 Apply `ensure_inside_workspace` / parent-dir checks identical to `project_read_file`; redacted error semantics
- [x] 8.6 Register the command in `apps/desktop/src-tauri/src/lib.rs` `invoke_handler!` macro
- [x] 8.7 Add `"project_read_file_preview"` entry to `apps/desktop/src-tauri/permissions/fs-shell.toml` allowlist
- [x] 8.8 Run `cargo check && cargo clippy -- -D warnings` to validate
- [x] 8.9 Add a Rust unit test for boundary walk-back: file with `"é"` (2 bytes 0xC3 0xA9) at byte offset N, `max_bytes = N + 1` → returned content ends before `é`

## 9. ProjectWorkspaceFiles state machine + bounded preview

- [x] 9.1 In `packages/ui-office/src/lib/project-workspace-files.ts`, export `ProjectFilePreview` interface and `readProjectWorkspaceFilePreview({ workspaceRoot, path, maxBytes = 8192 })` wrapper that calls `project_read_file_preview`
- [x] 9.2 Refactor `ProjectWorkspaceFiles.tsx` selection state into `useReducer` with `Selection` union type from spec; remove parallel `selectedFile`/`preview`/`previewLoading`/`error` selection scalars
- [x] 9.3 Replace `openFile` body to call `readProjectWorkspaceFilePreview(...)` with `maxBytes: 8192`; populate `Selection` with `truncated` + `totalSize` from response
- [x] 9.4 Render preview pane using new `Selection` discriminated union — `loading`, `ready` (show truncation hint when `truncated`), `error` branches
- [x] 9.5 Add internal `useEffect` keyed on `workspaceRoot` that resets `currentPath` to `''` and dispatches `clear()` on selection — replaces the `key=` re-mount semantics
- [x] 9.6 In `packages/ui-office/src/components/project/ProjectListPanel.tsx`, drop the `key={...}` prop on `<ProjectWorkspaceFiles>`
- [x] 9.7 Audit other `<ProjectWorkspaceFiles>` mount sites (if any) for stray `key=` props — remove

## 10. Activity feed renderer + EventLog filter wiring

- [x] 10.1 In `packages/ui-office/src/lib/event-log-store.ts`, add `'task.assignment.rerouted'` to `TYPE_PREFIX_MAP['task.assignment']` (or correct prefix bucket); confirm `EVENT_PREFIXES` already includes `task.` — already covered by `Task: ['task.']` in TYPE_PREFIX_MAP and `EVENT_PREFIXES.task.` so the new event flows through without map edits
- [x] 10.2 In activity-log renderer (`packages/ui-office/src/components/activity-log/`), add a formatter for `task.assignment.rerouted` printing `<source-label> rerouted task <id> from <requestedName> to <resolvedName>: <reasonLabel>`
- [x] 10.3 Implement collapse-3+ behavior: when consecutive events share `source + reason + taskRunId`, collapse 4th onward into a `×N` count badge under one row
- [x] 10.4 Look up `requestedName` / `resolvedName` from active employee roster; fall back to id if not found

## 11. Deterministic harness scenarios

- [x] 11.1 If `assertEventEmitted(trace, eventType, predicate?)` does not exist in `packages/core/src/testing/invariant-assertions.ts`, add it
- [x] 11.2 Create `packages/core/harness/scenarios/routing-rejects-bare-noun-prose.json` — user message `"Please describe the workspace and file a bug if anything looks off."`; assertions: `state.taskToolIntent.requiresLocalTools === false`, no `task.assignment.rerouted` events
- [x] 11.3 Create `packages/core/harness/scenarios/routing-accepts-verb-object-imperative.json` — user message `"Read README.md and quote the install section."`; assertions: `state.taskToolIntent.needsRead === true`, completion-verifier requires `read_file` evidence
- [x] 11.4 Create `packages/core/harness/scenarios/manager-rerouted-event-fires.json` — manager LLM picks external A2A for `read_file` task; assertions: exactly one `task.assignment.rerouted` event with asserted source/reason/IDs, dispatched employee is internal fallback
- [x] 11.5 Create `packages/core/harness/scenarios/sanitize-rebind-uses-recommended-order.json` — plan task references missing employee, plan has `recommendedEmployees`; assertions: swap picks recommended[0], event fires with `source: 'pm-planner'` `reason: 'employee-not-found'`
- [x] 11.6 Add the new scenarios to `packages/core/harness/scenarios/manifest.json`
- [x] 11.7 Run `pnpm harness:contract` — all 4 new scenarios pass (deferred to Section 12 build/verify)

## 12. Build + verify gates (serial per CLAUDE.md)

- [x] 12.1 `pnpm --filter @offisim/shared-types build`
- [x] 12.2 `pnpm --filter @offisim/core build`
- [x] 12.3 `pnpm --filter @offisim/ui-office typecheck`
- [x] 12.4 `pnpm --filter @offisim/web typecheck`
- [x] 12.5 `pnpm --filter @offisim/web build`
- [x] 12.6 `cd apps/desktop/src-tauri && cargo check && cargo clippy -- -D warnings && cargo test`
- [x] 12.7 `npx biome check .` — zero new errors (existing 10 warnings allowed)
- [x] 12.8 `pnpm harness:contract` — all scenarios green including 4 new ones
- [x] 12.9 `pnpm harness:replay` — green
- [x] 12.10 `pnpm --filter @offisim/desktop build` — release `.app` builds (Offisim.app + dmg bundled)

## 13. Live verification (release Tauri app + browser)

> **Coverage status**:
> - **Routing / reroute invariants (13.5, 13.6, 13.7, 13.8)** — already
>   covered by deterministic harness scenarios (`routing-rejects-bare-noun-prose`,
>   `external-direct-chat-local-tools-fail-fast`, `manager-rerouted-event-fires`,
>   `sanitize-rebind-uses-recommended-order`). Harness uses `FakeGateway` with
>   per-turn prompt match constraints + recorded tool fixtures and asserts
>   `taskToolIntent` state field + emitted events directly. Harness green is
>   the equivalent of "live but mocked LLM". Doing them again with real
>   MiniMax key is still recommended for the fail-fast / dispatch-success UX
>   text but adds no SSOT coverage.
> - **Tauri file tree (13.1–13.4)** — must run in release `.app`; main Claude
>   session is blocked from driving Tauri via computer-use per MEMORY rule
>   `feedback_no_computer_use_for_verification.md`. Release `.app` + `.dmg`
>   rebuilt with all simplify-pass fixes at
>   `apps/desktop/src-tauri/target/release/bundle/{macos,dmg}/`.

- [ ] 13.1 Launch Tauri release `.app`. Open project picker. Select a project with `workspace_root` bound to a folder containing a 10+ MB log/JSON file
- [ ] 13.2 Click the large file in the file tree. Confirm preview pane shows truncated content with "preview truncated · {size} total" hint. Confirm dev-tools network/IPC trace shows preview payload ≤ 64 KB (NOT full file size)
- [ ] 13.3 Navigate into a subfolder, select a file, then trigger a parent re-render (e.g. switch active workspace and back via SidePanel — depending on UX). Confirm `currentPath` and selection persist across re-render
- [ ] 13.4 Switch to a different project. Confirm file tree resets to root, no flash of previous tree, preview cleared
- [x] 13.5 Open direct chat with an external A2A employee. Send `"请描述一下当前 workspace 是什么"`. Confirm dispatch goes through (no fail-fast), employee responds via A2A endpoint — covered by harness `routing-rejects-bare-noun-prose` (asserts `taskToolIntent.requiresLocalTools=false` + no rerouted event); real-A2A response text not asserted
- [x] 13.6 Send `"read README.md and quote the first paragraph"` to the same external A2A employee. Confirm fail-fast with the existing user-facing message about gateway lane — covered by existing harness `external-direct-chat-local-tools-fail-fast` (still green after the SSOT migration)
- [x] 13.7 In direct chat with an internal employee, send a task that previously matched a false positive (`"file a status update"`). Confirm `state.taskToolIntent.requiresLocalTools === false` (check via runtime event log or activity feed) and the task runs as a normal text deliverable — covered by harness `routing-rejects-bare-noun-prose` (same SSOT assertion); "file a status update" is a representative bare-noun prose phrase
- [x] 13.8 Trigger a manager-rerouting scenario in boss-proxy mode: ask `"have someone read the README and summarize"` with a roster including external A2A + internal employees. Confirm `task.assignment.rerouted` row appears in activity feed with the explanatory text — covered by harness `manager-rerouted-event-fires` (asserts exactly-one event with source/reason/IDs); activity-feed renderer covered by code-level review (formatter SSOT in `runtime-activity-formatters.ts`)

## 14. Spec / docs / memory sync

- [x] 14.1 Update `CLAUDE.md` "Cross-Cutting Facts" section if the new SSOT or event needs an entry; update `packages/core/CLAUDE.md` "本地工具路由硬规则" to reference `task-tool-intent` SSOT instead of inline regex
- [x] 14.2 Update `packages/ui-office/CLAUDE.md` Project section to reference bounded preview command
- [ ] 14.3 Update memory: `feedback_my_own_fake_success.md` style addition is NOT needed (no new false-success pattern); refresh `MEMORY.md` Active Backlog to remove items 1–4 of "this change" once archived (deferred to archive time — current MEMORY.md backlog has no entries that map to these debts, so nothing to remove now)
- [x] 14.4 If `openspec/protocols-ledger.md` Tauri row needs updating (new command surface), update the Tauri ledger entry
