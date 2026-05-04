## Why

2026-05-02 release `.app` live verify exposed five overlapping right-rail / workspace-shell defects (issues #6 #15 #17 #18 #20) that share one root cause: today's right rail collapses Project, Threads, and Messages into a single conversation per project, so high-traffic affordances (Mode selector, Notification, Dashboard, Install entry, Kanban tray, Tasks subtabs) all fight for header / right-rail real estate. The fix is structural — introduce a real `chat_threads` layer, relocate the affordances that don't belong in the header / right rail, and gate the Tasks / Kanban surfaces on actual content. Per user constraint (2026-05-02 lock): no migration, no MVP / partial / fallback delivery, must drive to root cause.

## What Changes

- **Add `chat_threads` data model**: new `chat_threads` table in the single-baseline `db-local/src/schema.sql` (drizzle + raw `.sql` in lockstep) as the **product-layer** thread metadata, holding `{ thread_id, project_id, title, title_set_by_user, summary, archived_at, created_at, updated_at }`. `projects.thread_id` column **REMOVED**. There is no `messages` table in this codebase — chat history is composed at runtime from the in-memory `useChatSessionStore` (keyed by `conversationKey`) plus LangGraph checkpoint state (keyed by `graph_threads.thread_id`). Project ↔ chat_thread becomes one-to-many. The product `chat_thread` is bound to runtime threads via the `<projectId>::<threadId>::<employeeId?>` `conversationKey` shape; one chat_thread MAY back many `graph_threads` rows over its lifetime (one for team chat, one per direct-chat target). **BREAKING** for any pre-release dirty data — drop via release run action, not a migration.
- **Cascade thread awareness through 5 consumer modules**: `useChatSessionStore` (conversationKey now derived from `(projectId, threadId, targetEmployeeId?)`), `useDeliverables` (thread-scoped filter), Activity Log (event payloads carry `threadId`), SOP runtime (SOP run binds to a thread), interaction-follow-up / outcome mappers (thread-aware key).
- **Right-rail IA = three-layer nesting**: new `WorkspaceRight` shell renders Project selector → Thread list (sidebar with title + last-message preview + timestamp + active state + `+ New thread`) → Chat main area. Workspace search bar unifies thread titles + workspace files + employees in one debounced result list.
- **Thread title strategy**: boss auto-generates a title on the thread's first assistant turn (LLM 1-line summary) with a user-editable label. Empty / pre-first-turn threads default to `New thread`.
- **Relocate entry points** (recommended scheme, locked):
  - **Mode selector** (`SOP / HIL / Direct / YOLO`) leaves the header and lives in the chat input footer chip row, alongside future model / scope chips. Header keeps only workspace pills + workspace tools.
  - **Dashboard** opens from a bottom status-bar slot (small icon → click-popup); the dashboard content itself is unchanged.
  - **Notification center** moves from header to a bottom status-bar slot; the badge becomes an inline ring (kills the absolute-overflow clipping bug noted in 桶 1 issue #13 at the structural level).
  - **Install entry** is collapsed to a single source: the Market detail page CTA. No independent "Install package" entry-point anywhere else (status bar, command palette, deep-link handling, etc. continue to ROUTE to Market detail rather than open their own dialog).
- **Tasks tab → boss-driven gating**: drop the fixed three-subtab shell (Activity / Plan / Outputs always rendered). Activity stays as the always-visible baseline; Plan section renders only when plan items exist; Outputs section renders only when at least one deliverable is bound.
- **Kanban entry-point shrink**: remove the top `taskTray` slot. Kanban becomes a small chip inside the Tasks tab (`📋 Board ▾`) that expands an overlay over the right-sidebar region. Boss MAY emit a `kanban.suggested` event during long ceremonies to highlight the chip, but never auto-opens full-width.
- **Bottom status bar**: new fixed-bottom slot host owning Dashboard / Notification / git-branch / token-cost / latency mounts.
- **Spec lands on a new `workspace-thread-architecture` capability** with deltas to two existing capabilities (`chat-streaming-ux` for threaded `conversationKey`; `workspace-state-management` for `OfficeSessionState` thread integration).

## Capabilities

### New Capabilities

- `workspace-thread-architecture`: covers the chat-thread data model, the right-rail Project → Thread → Chat IA, the bottom status-bar slot host, the chat-input mode-chip placement, the install-entry singularity contract, and the boss-driven Tasks / Kanban gating. The capability is the discoverability anchor for "where does X live in the workspace shell".

### Modified Capabilities

- `chat-streaming-ux`: `conversationKey` shape is widened from `<projectThread>::<employeeId>` to `<projectId>::<threadId>::<employeeId?>`; direct-chat partitioning still holds but is now scoped to a specific thread. Existing run-scope / dedupe Requirements continue unchanged in spirit but reference the new key shape.
- `workspace-state-management`: `OfficeSessionState` adds `selectedThreadId: string | null`. Read / write paths keep the `updateWorkspaceState('office', updater)` SSOT. Workspace-switch persistence rules apply to `selectedThreadId` the same way they apply to `selectedEmployeeId`. Header-mounted Mode / Notification / Dashboard affordances are relocated; their state in `OfficeSessionState` keeps the same field names but is read/written from new mount points.

## Impact

- **Schema**: `packages/db-local/src/schema.sql` + `packages/db-local/src/schema.ts` — new `chat_threads` table (product-layer thread metadata, including `title_set_by_user` flag for rename stickiness); `projects.thread_id` column removed. No `messages` table is introduced or repointed because none exists — chat history flows through `useChatSessionStore` + LangGraph checkpoints. `packages/db-platform` does not own any chat schema (registry-only); N/A there. **No migration**.
- **Types**: `packages/shared-types` — new `ChatThread` type; `ProjectRow.thread_id` removed; `RunScope` carries `threadId`.
- **Core / runtime**: `OrchestrationService.ensureGraphThread()` keys off the new conversationKey shape. SOP runtime binds `runScope.threadId`. Interaction-follow-up mappers re-key. `task.assignment.rerouted` (and other thread-scoped events) carry `threadId`.
- **UI**: `apps/web/src/App.tsx` shell composition — header strips Mode / Notification / Dashboard mounts; new `BottomStatusBar` host added; chat input footer hosts the Mode chip; new `WorkspaceRight` three-pane shell; new `ThreadList` component in ui-office; `useChatSessionStore.conversationKey` derivation updated; `RightSidebar` Tasks tab refactored to gated sections; `Kanban` entry moves into Tasks-tab chip overlay.
- **Search**: workspace search bar wires into thread title index + workspace file listing (`project_list_dir`-bounded) + employee directory. Debounced; returns up to N per family.
- **Live verify**: release `.app` walk-through (per user constraint — not main-session computer-use) covering multi-thread isolation, search hits, mode-chip routes, status-bar slot affordances, Tasks gating, Kanban chip, Market install singular entry. Web SPA covers narrow-tier responsive layout.
- **Out of scope**: thread-level archive / soft-delete UX (data column reserved as `archived_at?` but no UI affordance this change); thread share / export; thread merge. These are deferred to follow-up.
