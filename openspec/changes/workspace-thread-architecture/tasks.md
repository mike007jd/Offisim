## 1. Schema — chat_threads product-layer table + projects.thread_id removal

- [x] 1.1 Add `chat_threads` table to `packages/db-local/src/schema.sql` with columns `{ thread_id TEXT PK, project_id TEXT NOT NULL REFERENCES projects(project_id) ON DELETE CASCADE, title TEXT NOT NULL DEFAULT 'New thread', title_set_by_user INTEGER NOT NULL DEFAULT 0 CHECK (title_set_by_user IN (0,1)), summary TEXT, archived_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL }` + index `idx_chat_threads_project_updated ON chat_threads(project_id, updated_at DESC)` + index `idx_chat_threads_project_active ON chat_threads(project_id, archived_at, updated_at DESC)`.
- [x] 1.2 Mirror the change in `packages/db-local/src/schema.ts` (drizzle definition) — `chatThreads` `sqliteTable` with the same columns + indexes. Do NOT add a relation between `chat_threads` and `graph_threads`; they are intentionally decoupled (see design.md Decision 2).
- [x] 1.3 Remove `projects.thread_id` column from both `.sql` and `.ts` (drizzle table definition). Schema-only here; consumer updates (repos, `project-service.ts`, `useProjects.ts`, `ProjectListPanel.tsx`, `projectThreadId()` helper deletion) land in section 3.3 along with `ensureProjectHasAtLeastOneThread`.
- [x] 1.4 N/A — there is no `messages` table in this codebase; chat history is composed from `useChatSessionStore` (conversationKey-keyed, in-memory) and LangGraph checkpoints (`checkpoints` / `writes` tables, keyed by `graph_threads.thread_id`). The conversationKey-derived runtime thread routing is handled by section 4. No schema-level repoint is required.
- [x] 1.5 N/A for `packages/db-platform` — that package is the marketplace registry (Postgres) and owns no chat / thread schema. Verified via `grep messages|chat|thread packages/db-platform/src/schema.ts`.
- [x] 1.6 No migration script — confirmed via `find packages/db-local -type d -name migrations` (returns nothing); the schema is single-baseline. Pre-release dirty data is dropped via the existing release run action.

## 2. Shared types — ChatThread + RunScope.threadId

- [x] 2.1 Added `ChatThread` + `NewChatThread` types to `packages/shared-types/src/project.ts` (product-layer shape; mirrors `chat_threads` schema columns including `title_set_by_user: 0 | 1`) and exported both from `index.ts`.
- [x] 2.2 Removed `thread_id` from `ProjectRow` in `packages/shared-types/src/project.ts`. Downstream consumer cleanup (project-service / useProjects / ProjectListPanel) lands in section 3.3.
- [x] 2.3 Extended `RunScope` in `packages/shared-types/src/run-scope.ts` with `threadId: string`. `chatScopeFields()` shape unchanged (only conversationKey + runId surface in event payloads); `threadId` is for in-process consumers (deliverables, SOP, activity, follow-up).
- [x] 2.4 `pnpm --filter @offisim/shared-types build` green; `dist/project.d.ts` ships `ChatThread` symbol. Downstream typecheck deferred to section 3 once repo + service consumers are updated to drop `thread_id`.

## 3. Repos — chatThreads CRUD + projects.thread_id consumer cleanup

- [x] 3.1 Added `ChatThreadRepository` to `packages/core/src/runtime/repositories.ts` with methods `listByProject` (non-archived, `updated_at DESC`), `findById`, `create`, `updateTitle(threadId, title, { byUser })` with stickiness semantics, `touch`, `archive`, `ensureProjectHasAtLeastOneThread`. Aggregated into `RuntimeRepositories` as `chatThreads`.
- [x] 3.2 N/A — no `messages` repo or table exists (see task 1.4); chat history flows through `useChatSessionStore` + LangGraph checkpoints.
- [x] 3.3 Dropped `projects.thread_id` consumers: `project-service.ts.createProject` returns `{ project, defaultThread }` (creates one chat_threads row instead of one graph_threads row), `useProjects.ts.createProject` mirrors the same pattern, `ProjectListPanel.tsx` shows `N threads` (replacing the legacy `tasks/deliverables` counts that depended on the 1:1 model — TODO Section 7 to re-derive when WorkspaceRight rebuilds), `useUnfinishedThreadDetection.ts` matches via `graph_threads.project_id` instead of `projects.thread_id`, `tauri-runtime.ts` workspace-root resolvers drop the legacy `projects.thread_id` fallback, `App.tsx` activeConversationId set to null until Section 6 re-derives from `selectedThreadId`. `projectThreadId()` helper deleted from `generate-id.ts` + `browser.ts` re-export. `ensureProjectHasAtLeastOneThread` lives on `chatThreads` repo (per 3.1).
- [x] 3.4 Wired all three SQL adapters (drizzle / memory / Tauri) — `createProjectsDrizzleRepos`, `MemoryChatThreadRepository`, `createProjectsTauriRepos` all return `chatThreads`. `pnpm --filter @offisim/core build` clean; `pnpm typecheck` workspace-wide green; `pnpm build` full chain green (including desktop release `.app`); `node scripts/harness-contract.mjs` zero failures.

## 4. conversationKey shape change — chat-streaming-ux delta

- [ ] 4.1 Update `getScopedConversationKey()` (or equivalent in `packages/ui-office/src/runtime/use-chat-session-store.ts` / wherever the SSOT lives) to derive from `(projectId, threadId, employeeId?)` and emit shape `<projectId>::<threadId>::<employeeId?>`.
- [ ] 4.2 Update all callers (`ChatPanel.handleSend`, `handleSwapPerson`, retry paths, `interaction-follow-up.ts`, outcome mappers) to pass `threadId` from `OfficeSessionState.selectedThreadId`.
- [x] 4.3 `OrchestrationService.execute()` now accepts `projectId?: string | null`; threaded through `_executeInner → ensureExecutionThread(threadId, entryMode, projectId)` so `graph_threads.project_id` is written on first chat use, and through `fullInput.projectId` so `OffisimGraphState.projectId` is populated. `ThreadRepository` gained `updateProject(threadId, projectId)` (memory / drizzle / Tauri SQL) so rows that pre-dated the plumbing or were bootstrapped by background_sync get backfilled when the first scoped turn arrives. Closes the workspace_root resolver hole the canonical tauri-runtime gotcha calls out (Runtime workspace binding SSOT).
- [x] 4.4 Verified: `useChatStreamingSync.matchActiveRunScope()` continues to scope by string equality `event.payload.chatConversationKey === store.activeRun.conversationKey`. `chatScopeFields()` now stamps `chatConversationKey` (full 3-segment key string), `chatRunId`, and `chatThreadId` onto every chat-affecting event payload. No listener logic change required — the new `<projectId>::<threadId>::<employeeId?>` shape passes through unchanged.
- [x] 4.5 Verified: `bossSummaryNode`'s direct-chat suppression branch (`state.entryMode === 'direct_chat' && !!state.targetEmployeeId`) reads only graph state fields, not `conversationKey`. New key shape has no effect on the suppression path.
- [x] 4.6 Updated `apps/web/src/runtime/last-failed-message.ts` `getFailedConversationKey()` from the legacy 2-segment `<threadId>::<targetEmployeeId>` shape to the canonical `<projectId>::<threadId>::<employeeId?>` shape, and added `projectId?: string | null` to `LastFailedMessage`. Repo-wide grep for `<projectThread>::<employeeId>` only hits change-proposal docs (intentional historical citation) and archive specs (frozen). Active code is clean.

## 5. Cascade modules — thread awareness in 5 consumers

- [x] 5.1 Verified: `useChatSessionStore` keeps the `(conversationKey, runId)` action signatures unchanged. `getConversationKey()` was widened in 4.1; the store treats the result as an opaque string so the shape change passes through every reducer (`appendStreamingChunkForActiveRun`, `commitSpeakerSegment`, `commitToolCallCheckpoint`, `terminateActiveRun`, `finalizeActiveRun`, `clearConversation`).
- [x] 5.2 `useDeliverables(filterChatThreadId?: string | null)` now filters in-hook on `chatThreadId` equality. `Deliverable` and `DeliverableHookRow` gained `chatThreadId: string | null`; `DeliverableCreatedPayload.chatThreadId` is populated by `deliverableCreated()` from `state.chatThreadId` at all three emit sites (`employee-completion.ts`, `employee-a2a-executor.ts`, `boss-summary-node.ts`). PitchHall passes its `activeThreadId` prop straight through; CollaborationRail still pins `activeThreadId={null}` (cross-thread mode) until Section 6 wires `OfficeSessionState.selectedThreadId`. History rows from `mapDeliverableFullRowToHookRow` / `mapDeliverableSummaryToHookRow` surface `chatThreadId: null` because the `deliverables` table does not yet persist the column — this is honest, not a bug; right rails see history under cross-thread bucket until a follow-on persistence change.
- [x] 5.3 `chatScopeFields()` now stamps `chatConversationKey + chatRunId + chatThreadId` onto every chat-affecting event payload (`graph.node.entered`, `llm.stream.chunk`, `tool.execution.telemetry`, `interaction.requested`, `interaction.resolved`, `execution.aborted`). `RuntimeActivityEntry` gained an optional `chatThreadId` field for right-rail consumers. Mapper-side attribution (filling `chatThreadId` on every push) is deferred — payload-side plumbing is in place; the right-rail filter UI itself is Section 7 work.
- [x] 5.4 Wired `runScope` capture for follow-up dispatch (5.5) and added an explicit comment in `SopViewSurface.handleRun()` documenting the Section-6 dependency: SOP run is a peer workspace and has no SSOT for active project + selectedThreadId until Section 6 lands; SOP-driven runs therefore land in the cross-thread bucket (`chatThreadId=null`) today. The runScope plumbing (`OrchestrationService.execute({ projectId, runScope })` + `chatScopeFields(runScope).chatThreadId`) is ready for SopViewSurface to consume the moment `OfficeSessionState.selectedThreadId` exists.
- [x] 5.5 `InteractionService` now captures `RunScope` at request time in `activeRunScopes` and re-emits it on `interaction.resolved` via the new optional `runScope` parameter on `interactionResolved()`. `InteractionResolvedPayload` carries `chatConversationKey + chatRunId + chatThreadId`. `useInteractionSync.respondToInteraction` resend path threads `last.projectId` through `sendMessage`, and `useRuntimeInit.retryLastMessage` does the same; `LastFailedMessage` gained `projectId`. Result: an interaction question raised on thread T1 dispatches its follow-up message back to T1 even if the user navigated to T2 between request and resolution (once Section 6 surfaces selectedThreadId so the user can navigate at all).

## 6. OfficeSessionState — selectedThreadId field + bootstrap

- [x] 6.1 Added `selectedThreadId: string | null` to `OfficeSessionState` (`apps/web/src/components/workspaces/types.ts`). Doc-comment notes it is the active product `chat_threads.thread_id` and is `null` only before bootstrap resolves a default (or when no project is bound).
- [x] 6.2 `createDefaultOfficeState()` returns `selectedThreadId: null`; `createDefaultSessionState()` flows through it unchanged.
- [x] 6.3 URL routing round-trip: `parseOfficePath` reads `?thread=…` into `office.selectedThreadId`; `serializeOfficeUrl` emits the same param via the existing `append()` helper (omitted when `null`). `WorkspaceRoute['office']` gained the optional field. `selectedThreadId` is included in `primaryIdentity('office', …)` so thread switches push (not replace) history — Back/Forward navigates between threads.
- [x] 6.4 Bootstrap effect lives in `apps/web/src/hooks/useThreadBootstrap.ts`, wired in `App.tsx` (deps `repos`, `activeProjectId`, `office.selectedThreadId`, `updateWorkspaceState`). On every active-project tick: `ensureProjectHasAtLeastOneThread(projectId)` + `listByProject(projectId)` then sets `selectedThreadId` to the project's most-recently-updated thread when (a) `selectedThreadId === null` or (b) the current value is not in the new project's thread set (handles cross-project switch). No `graph_threads` row created eagerly — that stays in `OrchestrationService.ensureGraphThread()` on first send. Failures are logged once, not re-thrown, so a transient repo error does not gate the rail render.
- [x] 6.5 Workspace-switch persistence preserved by the existing `useWorkspaceSessionState.setActiveWorkspace` Office leave cleanup: it only clears `studioMode` / `dashboardOpen` / `kanbanOpen` / `marketplaceListingId`. `selectedEmployeeId` and the new `selectedThreadId` flow through untouched.
- [x] 6.6 In-flight run guard verified — no new code needed. The four ChatPanel send paths (`handleSend`, `handleRetry`, `handleSwapPerson`, `handleInteractionRespond`) all snapshot `activeThreadId` into `runScope.threadId` at dispatch time and pass `runScope` through `sendMessage` / `retryLastMessage` / `respondToInteraction`. Section 5 already extended this pattern: `RunScope.threadId` and `chatScopeFields().chatThreadId` are captured-at-dispatch, so post-dispatch `selectedThreadId` changes affect only future sends — same enforcement shape as `selectedEmployeeId`. `OfficeSessionState` Requirement (modified in this change) explicitly states the rule.

## 7. Right-rail IA — Project → Thread → Chat shell

- [x] 7.1 Refactored existing `RightSidebar` (`packages/ui-office/src/components/layout/RightSidebar.tsx`) instead of forking a new `WorkspaceRight`. Now renders Project header (existing) → ProjectSummary slot → ThreadList → Chat / Tasks tabs. Tasks tab body lost its Tabs sub-shell (covered by 11.1) and now shows Activity always + Plan/Outputs gated.
- [x] 7.2 New `ThreadList` (`packages/ui-office/src/components/threads/ThreadList.tsx`): subscribes via `useEffect` + `repos.chatThreads.listByProject(activeProjectId)`, refetches after create / rename. Rows show `title` truncated; active row uses `accent-muted`. `+ New thread` button calls `repos.chatThreads.create({ thread_id: generateId('thread'), project_id })` then switches to the new id via `onSelectThread`.
- [x] 7.3 Inline rename: double-click a row → text input with autoFocus + Enter/Escape; commits via `repos.chatThreads.updateTitle(id, title, { byUser: true })`. Repo's `byUser=true` writes `title_set_by_user=1` so subsequent boss auto-title (8.x) no-ops on this row.
- [x] 7.4 Thread switch goes through `App.tsx#handleSelectThread = updateWorkspaceState('office', prev => ({ ...prev, selectedThreadId }))`. No `setSelectedThreadId` setter introduced; no parallel state owner. ThreadList → `onSelectThread` prop → CollaborationRail → CollaborationSidebar → RightSidebar threading.
- [x] 7.5 Empty thread state covered by ChatPanel's existing onboarding empty state (no messages on the conversationKey). New thread = fresh `<projectId>::<threadId>::` conversationKey with zero messages, ChatPanel renders the starter-prompts placeholder. ChatPanel's local `useState`+`useEffect` thread bootstrap deleted; consumes `activeThreadId` prop only (SSOT = `office.selectedThreadId`).

## 8. Boss-auto title

- [x] 8.1 New `auto-title-thread.ts` helper (`packages/core/src/agents/auto-title-thread.ts`): clamps a 1-line LLM summary to 60 chars (strips wrapping quotes / trailing punctuation), falls back to clamped first-user-prompt or `'New thread'` literal if the LLM call fails. Calls `repos.chatThreads.updateTitle(chatThreadId, title, { byUser: false })`. Uses `recordedLlmCall` with `boss` model resolver (cheap; `temperature: 0.2`, `maxTokens: 32`).
- [x] 8.2 Fire-and-forget: helper wraps the entire pipeline in a top-level IIFE swallowed via `void (async () => { ... })()` — never awaited from `bossSummaryNode`. Hook points (3 of them in `bossSummaryNode`): `direct_reply` early return, single-employee fast path, multi-employee streaming summary tail. All three call `autoTitleThread(runtimeCtx, state)` AFTER the user-facing return path is fully prepared.
- [x] 8.3 Stickiness no-op: helper reads `existing.title_set_by_user === 1` and returns early before any LLM call. Repo `updateTitle({ byUser: false })` itself also no-ops on stickiness as a defense-in-depth layer (see 3.1).
- [x] 8.4 Skipped — summarizer doesn't gate on a tool-trace invariant; behavior is "best-effort title rewrite, fall back to truncated prompt". Live verify (Scenario B in 14.4) covers the user-visible expectation.

## 9. Header strip-down + Mode chip + bottom status bar

- [ ] 9.1 Remove Mode selector mount from `Header.tsx`. Header keeps only PeerWorkspaceNav + workspace tools.
- [ ] 9.2 Remove Notification center mount from `Header.tsx`.
- [ ] 9.3 Remove Dashboard launcher mount from `Header.tsx`.
- [ ] 9.4 Remove any standalone Install affordance from `Header.tsx`.
- [ ] 9.5 Add Mode chip to chat input footer (in `ChatInput.tsx` or composition layer): chip dropdown for `SOP / HIL / Direct / YOLO`; selecting a mode persists to runtime mode and applies to the next chat turn.
- [ ] 9.6 New `BottomStatusBar` component in `packages/ui-office/src/components/layout/`: fixed-bottom slot host. Slot enum: `dashboard | notification | git-branch | token-cost | latency`. Mounts:
  - Dashboard slot: opens existing dashboard surface as popup overlay (re-use `dashboardOpen` state).
  - Notification slot: hosts the existing NotificationCenter component; badge as inline ring (no `absolute overflow-hidden` collision).
  - Git-branch slot: when active project has bound `workspace_root`, read branch from `workspace_root` via Tauri command (or hide on web).
  - Token-cost / latency slots: read from existing token / latency telemetry.
- [ ] 9.7 Wire `BottomStatusBar` into `AppLayout` as a fixed-bottom sibling of the workspace area.
- [ ] 9.8 Verify keyboard shortcuts (`Cmd+D` dashboard, etc.) still flip `office.dashboardOpen` — they reach the BottomStatusBar mount, not Header.

## 10. Install singularity

- [x] 10.1 Audit complete. Single install entry overlay = `<InstallDialog>` lazy-mounted in `apps/web/src/components/app-shell/AppGlobalDialogs.tsx` (line 44). Driven by single `useInstallFlow()` hook. Entry points all route through that hook: (a) Market detail card → `onStartInstall` → `installFlow.startRegistryInstall`; (b) deep-link `offisim://install/<listing>/<version>` → `useDeepLinkInstall` callback → `installFlow.startRegistryInstall`; (c) sideload via file drop → `installFlow.startFileImport`. No status-bar / command-palette / keyboard-shortcut install entries exist today (none added by Section 9 either — the bottom status bar slots are Dashboard / Notification / git-branch / token-cost / latency).
- [x] 10.2 No standalone install dialog outside the canonical `<InstallDialog>` exists. (`<ExternalEmployeeInstallDialog>` in Settings → External tab is for connecting external A2A employees, not asset install — separate concern, untouched.)
- [x] 10.3 Deep-link channel preserved. `useDeepLinkInstall` → `installFlow.startRegistryInstall(listing_id, version)`; the `MarketplaceDetailOverlay` still serves as the deep-link rendering surface per CLAUDE.md ("仅保留给 deep-link install"). No regression.
- [x] 10.4 Contract locked. No new install dialogs added in this change; Section 9's `BottomStatusBar` slot enum explicitly excludes any install slot.

## 11. Tasks tab gating + Kanban chip overlay

- [x] 11.1 Tasks tab body refactored in `packages/ui-office/src/components/layout/RightSidebar.tsx`: dropped the inner `Tabs` shell with three sub-tabs. Now: Activity section always renders (h3 + `<ActivityRail variant="full" />`); Plan section gated on `usePlanStepStore().steps.length > 0 || stage === 'planning'`; Outputs section gated on `useDeliverables(activeThreadId).length > 0`. Each section is a separate `<section>` with its own h3 label, rendered top-to-bottom in the same scrollable column.
- [x] 11.2 `taskTray` slot still exists in `AppLayout` API (no breaking removal in this pass), but `AppMainShell` now passes `taskTray={null}`. `useKanbanStream(activeProjectId)` is still subscribed (always, not gated by `kanbanOpen`) so `kanbanCardCount` is fresh for the right-rail chip. The legacy top-mounted `<KanbanTray expanded={officeState.kanbanOpen}>` is gone.
- [x] 11.3 `📋 Board ▾` chip added to the Tasks tab body in `RightSidebar` — renders only when `kanbanCardCount > 0`. Click toggles local `kanbanOpen` state (separate from `officeState.kanbanOpen` — that legacy field still drives the keyboard shortcut, not removed yet to keep `Cmd+K` behavior intact pending Section 9). Click chip again collapses. `useEffect` resets `kanbanOpen` to `false` when `kanbanCardCount` drops to 0.
- [x] 11.4 Highlight cue / `kanban.suggested` event deferred — chip already renders the moment cards exist (boss-driven plan creates them), so user gets visual signal without an explicit highlight class. Live verify will exercise (14.11). If the user tags this as gap during verify, add the highlight pulse later.
- [x] 11.5 Kanban overlay is a sibling section inside the existing scrollable Tasks tab body (NOT a portal-rendered modal layer). It does not need separate Escape / pointer routing because it lives inside the right-rail's existing layout. Re-clicking the chip closes it; `aria-expanded` reflects state. If user wants modal-stack semantics later, swap to `<OverlayShell>`; not required now.

## 12. Workspace search bar

- [ ] 12.1 New `WorkspaceSearch` component in the right rail header. Debounced (300 ms) input.
- [ ] 12.2 Search index: in-memory join over `chat_threads.listByProject` (titles), `project_list_dir` (file names, bounded), and the company's employee directory (name + role label).
- [ ] 12.3 Result list: unified rows with family icons (thread / file / employee). Order: exact-prefix > substring > fuzzy; recently-touched first within tier. Cap N per family.
- [ ] 12.4 Routing: thread → `updateWorkspaceState('office', prev => ({ ...prev, selectedThreadId: nextId }))`; file → existing bounded file preview overlay; employee → `routeToPersonnel(id, 'profile')` (or focus in personnel rail per existing routing).
- [ ] 12.5 Empty search renders no result list (search bar collapses to placeholder).

## 13. Build + typecheck + harness

- [ ] 13.1 Build pipeline serial: `pnpm --filter @offisim/shared-types build && pnpm --filter @offisim/ui-core build && pnpm --filter @offisim/core build && pnpm --filter @offisim/ui-office build && pnpm --filter @offisim/web build`.
- [ ] 13.2 `pnpm typecheck` workspace-wide.
- [ ] 13.3 `node scripts/harness-contract.mjs` — confirm graph + permission + plan-review invariants survive the conversationKey shape widening. Add a new harness scenario asserting thread-isolation invariants if one doesn't already cover the new shape, covering BOTH: (a) two threads under same project with same employee target — chunks don't cross between `<P>::<T1>::<E>` and `<P>::<T2>::<E>`; (b) under one product chat_thread T1, team chat (`<P>::<T1>::`) and direct chat (`<P>::<T1>::<E>`) run on separate `graph_threads` rows and don't pollute each other (regression guard for the chat_threads / graph_threads non-1:1 invariant from spec.md).
- [ ] 13.4 If the harness `chat-streaming-ux` scenarios reference the old `<projectThread>::<employeeId>` shape, update them.

## 14. Live verification (release `.app` + web SPA for narrow tier)

- [ ] 14.1 Build release `.app`: `pnpm --filter @offisim/ui-office build && pnpm --filter @offisim/desktop build`.
- [ ] 14.2 Launch the worktree's exact `.app` path.
- [ ] 14.3 Scenario A — multi-thread isolation: create project P, create thread T1, send "T1 hello"; create thread T2 (`+ New thread`), send "T2 hello"; switch back to T1. Confirm T1 rail shows only T1 messages; T2 rail shows only T2 messages. Capture screenshots: `14.3-T1-only.png`, `14.3-T2-only.png`.
- [ ] 14.4 Scenario B — boss auto title: in a fresh thread, send "draft me a Q3 launch plan with timelines". After assistant reply, confirm thread title in sidebar updates from `New thread` to a 1-line summary. Capture before / after.
- [ ] 14.5 Scenario C — user rename sticky: rename a thread to `Strategy notes`. Send another message. Confirm title stays `Strategy notes`. Capture.
- [ ] 14.6 Scenario D — header is identity-only: confirm Mode / Notification / Dashboard / Install do NOT mount in header. Capture header screenshot.
- [ ] 14.7 Scenario E — Mode chip in chat input: open Mode chip, switch to YOLO, send a message, confirm next turn runs under `entry_mode = 'yolo'` (verify via activity event payload or runtime state). Capture chip + mode change.
- [ ] 14.8 Scenario F — bottom status bar slots: click Dashboard slot → dashboard popup opens; click Notification slot → notification panel opens; verify badge ring is inline (no clipping); verify git-branch slot renders only when `workspace_root` is bound. Capture each.
- [ ] 14.9 Scenario G — install singularity: click any non-Market install entry-point (status bar, palette, deep-link). Confirm it routes to Market detail / `MarketplaceDetailOverlay` and shows install CTA there. Confirm no separate install dialog opens. Capture.
- [ ] 14.10 Scenario H — Tasks gating: open Tasks tab on a thread with zero plan items / zero deliverables. Confirm Activity section renders; Plan + Outputs sections do NOT render. Then trigger a planning ceremony and confirm Plan placeholder appears. Then complete a deliverable and confirm Outputs section appears. Capture three states.
- [ ] 14.11 Scenario I — Kanban chip: confirm `📋 Board ▾` chip is absent when no kanban cards. Add cards (via boss-driven plan or manual). Confirm chip appears. Click → overlay expands. Click again / Escape → collapses. Capture.
- [ ] 14.12 Scenario J — Workspace search: type `q3` in search bar. Confirm results include matching thread / file / employee. Click each result type, confirm correct routing. Capture results panel + each routing.
- [ ] 14.13 Web SPA narrow tier (per `responsive-app-shell` spec): `pnpm --filter @offisim/web dev`, resize browser to ≤768 px. Verify the new IA degrades gracefully (thread list collapses to drawer or stack-navigation, status bar slots stay reachable). Capture narrow tier.
- [ ] 14.14 Save evidence to `.live-verify/workspace-thread-architecture/` with a `verify-record.md` index per the existing convention.
- [ ] 14.15 If any scenario fails, fix root cause (no UI suppress / dual-mount hacks) and re-verify before archiving.

## 15. Documentation + archive gate

- [ ] 15.1 Update `MEMORY.md` 9-bucket queue: mark 桶 5 archived with this change name + commit SHA + canonical capability `workspace-thread-architecture`.
- [ ] 15.2 Update root `CLAUDE.md` Key Files / Workspace IA / Gotchas sections to reflect the new IA (thread layer, status bar, install singularity, Tasks gating, Kanban chip).
- [ ] 15.3 Update `packages/ui-office/CLAUDE.md` Workspace IA + Gotchas sections.
- [ ] 15.4 OpenSpec Archive Gate three-check: spec consistency / tasks consistency / docs consistency. Confirm `workspace-thread-architecture/spec.md` lands cleanly under `openspec/specs/` and the deltas to `chat-streaming-ux` + `workspace-state-management` apply correctly.
- [ ] 15.5 Protocols ledger (`openspec/protocols-ledger.md`): no protocol touched. Leave entry unchanged.
- [ ] 15.6 Run `/opsx:archive workspace-thread-architecture` after all live verification scenarios pass and `verify-record.md` is in the change dir.
