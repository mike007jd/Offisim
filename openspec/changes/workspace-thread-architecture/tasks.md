## 1. Schema — chat_threads product-layer table + projects.thread_id removal

- [ ] 1.1 Add `chat_threads` table to `packages/db-local/src/schema.sql` with columns `{ thread_id TEXT PK, project_id TEXT NOT NULL REFERENCES projects(project_id) ON DELETE CASCADE, title TEXT NOT NULL DEFAULT 'New thread', title_set_by_user INTEGER NOT NULL DEFAULT 0 CHECK (title_set_by_user IN (0,1)), summary TEXT, archived_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL }` + index `idx_chat_threads_project_updated ON chat_threads(project_id, updated_at DESC)`.
- [ ] 1.2 Mirror the change in `packages/db-local/src/schema.ts` (drizzle definition) — `chatThreads` `sqliteTable` with the same columns + index. Do NOT add a relation between `chat_threads` and `graph_threads`; they are intentionally decoupled (see design.md Decision 2).
- [ ] 1.3 Remove `projects.thread_id` column from both `.sql` and `.ts`. Update any drizzle relation definitions, repos, services, and helpers (`projectThreadId()`, `ProjectListPanel.tsx`, `useProjects.ts`, `project-service.ts`) that read or write the column.
- [ ] 1.4 N/A — there is no `messages` table in this codebase; chat history is composed from `useChatSessionStore` (conversationKey-keyed, in-memory) and LangGraph checkpoints (`checkpoints` / `writes` tables, keyed by `graph_threads.thread_id`). The conversationKey-derived runtime thread routing is handled by section 4. No schema-level repoint is required.
- [ ] 1.5 N/A for `packages/db-platform` — that package is the marketplace registry (Postgres) and owns no chat / thread schema. Verified via `grep messages|chat|thread packages/db-platform/src/schema.ts`.
- [ ] 1.6 No migration script — confirm via `find packages/db-local -type d -name migrations` returns nothing; the schema is single-baseline. Pre-release dirty data is dropped via the existing release run action.

## 2. Shared types — ChatThread + RunScope.threadId

- [ ] 2.1 Add `ChatThread` type to `packages/shared-types/src` (mirroring schema columns) + export from index.
- [ ] 2.2 Remove `thread_id` from `ProjectRow` (or whatever the canonical `ProjectRow` shape is in shared-types).
- [ ] 2.3 Extend `RunScope` (currently in `shared-types`, hoisted from chat layer) to include `threadId: string`.
- [ ] 2.4 Build shared-types and confirm downstream packages still compile (turbo cache miss expected).

## 3. Repos — chatThreads CRUD + project/message rewires

- [ ] 3.1 Add `chat_threads` repo methods in `packages/core/src/runtime/repositories.ts` (or per existing repo layering): `listByProject(projectId)` (active rows ordered by `updated_at DESC`), `findById(threadId)`, `create({ projectId, title? })` (returns the new row with `title_set_by_user = 0`), `updateTitle(threadId, title, { byUser: boolean })` — when `byUser === true`, persist `title_set_by_user = 1`; when `byUser === false`, no-op if existing row already has `title_set_by_user = 1` (preserves user rename), else write title and keep `title_set_by_user = 0`. `touch(threadId)` (bump `updated_at`), `archive(threadId)` (set `archived_at`).
- [ ] 3.2 `messages` repo: any thread-scoped query SHALL accept a `threadId` param; remove any "default to project's first thread" fallbacks.
- [ ] 3.3 `projects` repo: drop any `thread_id` field reads / writes. Add `ensureProjectHasAtLeastOneThread(projectId)` helper.
- [ ] 3.4 Wire all three Tauri SQL adapters (drizzle / memory / Tauri SQL) — confirm parity. Run `pnpm --filter @offisim/core build` clean.

## 4. conversationKey shape change — chat-streaming-ux delta

- [ ] 4.1 Update `getScopedConversationKey()` (or equivalent in `packages/ui-office/src/runtime/use-chat-session-store.ts` / wherever the SSOT lives) to derive from `(projectId, threadId, employeeId?)` and emit shape `<projectId>::<threadId>::<employeeId?>`.
- [ ] 4.2 Update all callers (`ChatPanel.handleSend`, `handleSwapPerson`, retry paths, `interaction-follow-up.ts`, outcome mappers) to pass `threadId` from `OfficeSessionState.selectedThreadId`.
- [ ] 4.3 `OrchestrationService.ensureGraphThread()` keys off the new conversationKey. Verify `graph_threads` row creation is unchanged structurally — only key shape widens.
- [ ] 4.4 `useChatStreamingSync` listeners: confirm they continue to scope by `event.payload.chatConversationKey === store.activeRun.conversationKey` — no logic change, just key shape change passes through.
- [ ] 4.5 Confirm `bossSummaryNode` direct-chat suppression still triggers under the new key shape (`state.entryMode === 'direct_chat'` + `state.targetEmployeeId` set).
- [ ] 4.6 Cascade verify: search the repo for any `<projectThread>::<employeeId>` literal or comment referencing the old shape — update or remove.

## 5. Cascade modules — thread awareness in 5 consumers

- [ ] 5.1 `useChatSessionStore` → conversationKey derivation per task 4.1; confirm store actions take `(conversationKey, runId)` pairs unchanged.
- [ ] 5.2 `useDeliverables` → filter by `threadId` instead of project-wide; pull `threadId` from `OfficeSessionState.selectedThreadId`.
- [ ] 5.3 Activity log → event payloads carry `threadId`; activity feed filters by active thread when surfaced in workspace right rail (still globally visible in the Activity Log workspace).
- [ ] 5.4 SOP runtime — bind `runScope.threadId` when starting a SOP run; confirm SOP run history filters by thread in the right rail.
- [ ] 5.5 `interaction-follow-up.ts` / outcome mappers — re-key by `(threadId, runId)` so resolved interactions land on the correct thread's rail.

## 6. OfficeSessionState — selectedThreadId field + bootstrap

- [ ] 6.1 Add `selectedThreadId: string | null` to `OfficeSessionState` type in `packages/ui-office/src/components/workspaces/types.ts` (or wherever the type lives).
- [ ] 6.2 `createDefaultSessionState()` returns `selectedThreadId: null`.
- [ ] 6.3 URL routing parser/serializer (`apps/web/src/lib/url-routing/`) round-trips `selectedThreadId`. Add to the `office` workspace URL shape.
- [ ] 6.4 Bootstrap effect: on `OffisimRuntimeProvider` mount with active project + `selectedThreadId === null`, call `ensureProjectHasAtLeastOneThread(projectId)` (idempotent — creates a `chat_threads` row only if the project has zero non-archived rows; does NOT create a `graph_threads` row eagerly), then set `selectedThreadId` to the project's most-recently-updated thread. Runtime thread creation continues to happen lazily via `OrchestrationService.ensureGraphThread()` on first send.
- [ ] 6.5 Workspace-switch persistence: `selectedThreadId` survives leaving Office (like `selectedEmployeeId`); not cleared by `Office leave cleanup`.
- [ ] 6.6 In-flight run guard: switching `selectedThreadId` mid-run does not retarget the run — same enforcement pattern as `selectedEmployeeId` (verify by grepping for the existing in-flight retarget guard and extending it).

## 7. Right-rail IA — Project → Thread → Chat shell

- [ ] 7.1 New component `WorkspaceRight` (or refactor existing `RightSidebar`): renders Project selector at top, Thread sidebar list, Chat main pane.
- [ ] 7.2 New `ThreadList` component in `packages/ui-office/src/components/threads/`: subscribes to `chat_threads.listByProject(activeProjectId)`; renders `{ title, lastMessagePreview, updatedAt, isActive }` rows; click selects thread; `+ New thread` action calls `chat_threads.create()` and switches to it.
- [ ] 7.3 Inline rename affordance on a thread row: edits `chat_threads.updateTitle(id, title, { byUser: true })`. Stickiness flag prevents auto-retitle.
- [ ] 7.4 Confirm thread-switch wires through `updateWorkspaceState('office', prev => ({ ...prev, selectedThreadId: nextId }))` — no parallel state owner.
- [ ] 7.5 Empty thread state: `New thread` with no messages renders an empty chat rail and a placeholder ("Start typing below to send the first message").

## 8. Boss-auto title

- [ ] 8.1 In the boss / runtime layer, after the first assistant turn on a thread whose title === `New thread`, fire a low-cost LLM 1-line summarizer (reuse provider config; keep cost minimal). On success, call `chat_threads.updateTitle(threadId, summary, { byUser: false })`. On failure, fall back to the user's first prompt truncated to 60 characters.
- [ ] 8.2 The summarizer SHALL be fire-and-forget — never block the user-facing first render of the assistant reply.
- [ ] 8.3 The summarizer SHALL no-op if the title has been user-edited (`byUser: true` flag persisted on `updateTitle`).
- [ ] 8.4 Add a small unit test (deterministic harness scenario, not vitest) if the summarizer logic gates on a tool-trace invariant; otherwise rely on live verify.

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

- [ ] 10.1 Audit all install entry points: status bar, command palette, keyboard shortcut, deep-link handler. Confirm or change each to ROUTE to Market detail (or `MarketplaceDetailOverlay` for deep-link).
- [ ] 10.2 If a standalone install dialog component exists outside `MarketplaceDetailOverlay`, deprecate / remove it. Update its callers to route to Market detail.
- [ ] 10.3 Deep-link `offisim://install/<listing>` opens Market detail page (or `MarketplaceDetailOverlay`). Confirm the existing `useDeepLinkInstall` channel still resolves correctly.
- [ ] 10.4 No new install dialogs land in this change. Lock the contract.

## 11. Tasks tab gating + Kanban chip overlay

- [ ] 11.1 Refactor Tasks tab body in `RightSidebar` (or `WorkspaceRight`): drop the always-rendered three-subtab shell. Activity section renders unconditionally; Plan section gated on `plan_items.length > 0 || run.state === 'planning'`; Outputs section gated on `deliverables.length > 0`.
- [ ] 11.2 Remove the top `taskTray` slot from `AppLayout`. Verify Kanban no longer auto-mounts at top.
- [ ] 11.3 Add a `📋 Board ▾` chip to the Tasks tab body when `kanban_cards.length > 0`. Click expands a Kanban overlay over the right-sidebar region; click again or Escape collapses.
- [ ] 11.4 Boss emits `kanban.suggested` event when a multi-task ceremony begins; chip renders a highlight cue (no auto-expand).
- [ ] 11.5 Verify the Kanban overlay routes pointer events / Escape per the existing modal stack discipline.

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
