## Context

Today's right rail is a single conversation surface keyed by `(projectId, employeeId?)`. Every project ships exactly one thread (`projects.thread_id` FK on `chat_threads`-as-1-row). Five live-verify defects (#6 thread search / nesting; #15 oversized Kanban; #17 mis-located Mode selector; #18 scattered install / dashboard / notification entries; #20 always-rendered empty Tasks subtabs) fall out of this collapsed model: there's no way to keep more than one conversation per project, and the header / right rail end up as the only available real estate for any new affordance, so they fight each other.

Three constraints lock the shape of this change:

1. **No migration**: per CLAUDE.md "Migration chains 已废", `db-local/src/schema.sql` is the single baseline; pre-release dirty data is dropped via release run action, not a migration script.
2. **No partial delivery**: per CLAUDE.md Product Closure Bar, the spec scenarios all land or none of them do. Threading 1/5 cascade modules and shipping is not allowed.
3. **Find root causes, don't patch**: e.g. notification badge clipping at #13 is part of 桶 1's shell-interaction-baseline scope, but its structural cause (header `overflow-hidden` vs absolute badge) is also resolved here for free when notification leaves the header for the bottom status bar. Don't suppress, don't dual-mount.

The two existing capabilities we touch are mature: `chat-streaming-ux` already locks `conversationKey`-based run scoping and direct-chat partitioning; `workspace-state-management` already locks `OfficeSessionState` as the single read/write source. The change widens both rather than replacing them.

## Goals / Non-Goals

**Goals:**
- Project / Thread / Chat are three distinct first-class layers: the user can have many threads per project, each with its own message history, deliverables, kanban scope, SOP run history, and activity events.
- Right rail surfaces ONE thread at a time and exposes a clear list affordance for the rest. Switching threads does not pollute message history, run scope, deliverables, or activity events from the previously visible thread.
- The header has a single role: workspace identity (workspace pills + workspace-level tools). Any affordance that previously fought for header room (Mode, Notification, Dashboard, Install) lives in a contextual mount: chat input footer, bottom status bar, or Market detail.
- Tasks tab and Kanban entry-point are content-gated: surfaces that have nothing to show don't render empty section frames.
- Boss orchestration drives Kanban surfacing, not header real estate.
- The Workspace search bar is a single debounced index over thread titles + workspace files + employees with one unified result list.
- All capability deltas (`chat-streaming-ux`, `workspace-state-management`) reference the new key shape and entry-point relocation; the previously-locked invariants (run scope, dedupe, activeWorkspace identity) survive verbatim.

**Non-Goals:**
- Thread archive / soft-delete UX. Reserve `chat_threads.archived_at TIMESTAMP NULL` for a follow-up but no surface affordance.
- Thread share / export / merge.
- Cross-project thread move. A thread is bound to its origin project for the lifetime of this change.
- Group / multi-employee threads. Each thread is project-scoped; direct-chat targeting still narrows by `employeeId` inside a thread.
- Re-architecting `OrchestrationService` or LangGraph runtime — the change passes a wider `runScope.threadId` through the existing channels.
- Replacing `useChatSessionStore` with a different state library. We change the key derivation; the store stays.
- Re-doing the Tasks tab data shape — only its render gating changes. (Plan / Outputs / Activity data already exists; we just stop forcing them into a fixed three-subtab shell.)
- Touching `office-overlay-interactions` (just landed). Inspector + company switcher behaviors are unrelated.

## Decisions

### Decision 1: New capability `workspace-thread-architecture`, not deltas spread across five existing capabilities

**Choice**: a single new capability named after the structural change. It owns the `chat_threads` data contract, the right-rail Project → Thread → Chat IA, the bottom status-bar slot host, the chat-input mode-chip placement, the install-entry singularity rule, and the boss-driven Tasks / Kanban gating. Existing capabilities receive narrowly-scoped deltas only where their already-locked Requirements reference shapes that change shape (`chat-streaming-ux` conversationKey; `workspace-state-management` OfficeSessionState).

**Alternative rejected**: scatter the changes — e.g. add Requirements to `workspace-state-management` for status bar / Tasks gating, modify `chat-streaming-ux` for thread keys, modify `kanban-data-pipeline` for chip entry-point, leave the search bar without a spec home, etc. Rejected because the discoverability anchor matters more than spec-level orthogonality. A future agent reading "where is the workspace right-rail contract?" should land in one place, not five.

**Alternative rejected**: split the new capability into three siblings (`chat-thread-data-model`, `workspace-rail-ia`, `app-status-bar`). Rejected because the user constraint "禁止最小化交付" treats the five sub-fixes as one closure, and the spec home should mirror that: one capability, one verify run, one archive.

### Decision 2: `chat_threads` is a product-layer table; `projects.thread_id` is removed (not nullable-deprecated); `chat_threads.thread_id` is NOT FK'd to `graph_threads.thread_id`

**Choice**: drop `projects.thread_id` from the schema. New `chat_threads` table holds `{ thread_id PK, project_id FK NOT NULL, title TEXT, title_set_by_user INTEGER, summary TEXT NULL, archived_at TEXT NULL, created_at, updated_at }`. The `thread_id` column is a **product-layer** identifier — independent of `graph_threads.thread_id`, with no FK between the two.

**Why no FK / not 1:1**: `chat-streaming-ux` already partitions runtime by `conversationKey = <projectId>::<threadId>::<employeeId?>`. Team chat under thread T derives runtime thread `<P>::<T>::`; each direct chat under T with employee E derives its own runtime thread `<P>::<T>::<E>`. One product `chat_thread` therefore backs MANY `graph_threads` rows over its lifetime, not one. Locking `chat_threads.thread_id` to a single `graph_threads.thread_id` would force direct chat to either re-use the team thread (breaking the existing direct-chat partitioning Requirement) or mismatch the FK. The clean separation is: `chat_threads` is the user-facing product entity; `graph_threads` is the runtime thread the orchestrator uses; the binding is the conversationKey middle segment, computed by the chat session store + `OrchestrationService.ensureGraphThread`.

**Why no `messages` repoint**: the spec author originally wrote "messages.thread_id repointed to chat_threads.thread_id" but **no `messages` table exists in this codebase**. Chat history is composed at runtime from (a) the in-memory `useChatSessionStore` keyed by conversationKey and (b) LangGraph checkpoint state in `checkpoints` / `writes` keyed by `graph_threads.thread_id`. The decision below replaces the "repoint messages" instruction with: "wire conversationKey derivation through the new `chat_threads.thread_id` segment per Decision 3" — there is nothing to repoint at the schema level.

**Why `title_set_by_user` is a column**: spec scenario "User rename is sticky and persists across sessions" requires the byUser flag to survive across sessions; an in-memory flag is not enough. The repo helper `updateTitle(threadId, title, { byUser })` uses this column to no-op auto-retitle attempts.

**Alternative rejected**: keep `projects.thread_id` as a nullable "default thread" pointer. Rejected because it leaks the old single-thread mental model into the schema, and the dual-source ambiguity (do we trust `projects.thread_id` or the latest `chat_threads` row?) becomes a forever-bug surface. Per CLAUDE.md "no fallback hack" rule.

**Alternative rejected**: synthetic `default_thread_view` SQL view. Rejected for the same reason — adds an indirection that future readers must remember.

**Alternative rejected**: `chat_threads.thread_id REFERENCES graph_threads(thread_id)` (1:1 FK). Rejected because direct chat needs an additional runtime thread per employee under the same product thread; a 1:1 FK forces the wrong choice (either lose direct-chat partitioning or allow the FK to dangle). The product/runtime separation kept here mirrors the same separation in CLAUDE.md ("Project = name + description + 可选 workspace_root + 专属 thread" — runtime thread already moves independently of the project row).

**Why no migration**: per CLAUDE.md "Migration chains 已废" and per user lock 2026-05-02; pre-release dirty data is wiped via the release run action; ship with the new schema as the single baseline.

### Decision 3: `conversationKey` shape is `<projectId>::<threadId>::<employeeId?>`

**Choice**: widen the existing `chat-streaming-ux` key from `<projectThread>::<employeeId>` to a 3-tuple `<projectId>::<threadId>::<employeeId?>`. Direct chat appends the `::<employeeId>` segment as today; team chat omits it. The empty-employee form is `<projectId>::<threadId>::` (kept as a single segment so the parser is dumb-split-on-`::`).

**Alternative rejected**: introduce an opaque `conversationId UUID` row on `chat_threads` and use that as the key. Rejected because the parts are still needed downstream (graph thread bookkeeping in `OrchestrationService.ensureGraphThread`, activity-event scoping, deliverable filters) — the structured form gives debuggability "for free".

**Alternative rejected**: keep the 2-tuple and stuff thread into the `projectThread` segment. Rejected because the project / thread distinction is meaningful at the routing layer (workspace-level events vs thread-level events).

**Why direct chat keeps the optional `::<employeeId>` tail**: per `chat-streaming-ux` already-locked Requirement "Direct chat runtime is partitioned by conversationKey", direct chat must remain a separate runtime partition from team chat. The tail preserves that partition under the new shape.

### Decision 4: Boss-auto thread title with user override

**Choice**: thread starts with `New thread` (or empty string) and gets renamed once on the first assistant turn via a low-cost LLM 1-line summary call (or, if no LLM call ran, the user's first prompt truncated to 60 chars). User can edit the title at any time via a rename affordance in the thread list. Subsequent boss output does NOT overwrite a user-edited title.

**Alternative rejected**: always-manual title. Rejected because users will leave threads as `New thread` and lose searchability — the search bar relies on titles.

**Alternative rejected**: take user's first prompt verbatim. Rejected because raw prompts often start with "hi" / "can you" / "I want to…" — low signal vs. a 1-line summary.

**Trade-off**: the auto-summary LLM call is an extra round-trip on the first turn. Mitigation: piggyback on the boss's existing first-turn LLM context (or run as a fire-and-forget tail call); never block the first user-facing render on it.

### Decision 5: Mode chip in chat input footer; Notification + Dashboard in bottom status bar

**Choice**: chat input footer hosts the Mode selector (`SOP / HIL / Direct / YOLO`) as a chip dropdown alongside future model / scope chips. Bottom status bar (a new fixed-bottom slot host) mounts Dashboard + Notification + git branch + token cost / latency. Header shrinks to workspace pills + workspace tools.

**Alternative rejected**: keep Mode in the header and add a second slot row. Rejected because the header collision is the structural cause of #17 + #18 — moving things INTO a contextual mount kills the symptom AND the cause.

**Alternative rejected**: floating Notification panel triggered from anywhere. Rejected because the user wanted a stable, predictable mount.

**Why bottom status bar**: persistent, low-noise, conventional (matches IDE + chat-app status bars), and gives a host for future telemetry without re-litigating header real estate.

### Decision 6: Install singularity = Market detail page CTA

**Choice**: any code path that today opens a standalone install dialog ROUTES to the Market detail page for the listing instead, then triggers the install CTA there. Deep-link `offisim://install/<listing>` opens Market detail, not a standalone overlay. The Marketplace deep-link install overlay (`MarketplaceDetailOverlay`) is preserved per existing CLAUDE.md note ("仅保留给 deep-link install") but renders the same install affordance shape.

**Alternative rejected**: keep both Market detail CTA and a separate Install dialog. Rejected because dual-source breeds drift — install state, version pickers, dependency previews, etc. would have to stay in lockstep across two surfaces.

**Out of scope here**:桶 9 will redo Market detail page styling + add screenshot carousel / changelog / dependencies. This change only locks the contract that Market detail is the ONLY install entry; the visual upgrade is桶 9's scope.

### Decision 7: Tasks tab is gated; Kanban is a chip overlay inside Tasks

**Choice**: Tasks tab content is conditional: Activity always renders (minimum process transparency); Plan section renders only when `plan_items.length > 0`; Outputs section renders only when `deliverables.length > 0`. Kanban is a `📋 Board ▾` chip inside Tasks; clicking expands a Kanban overlay over the right-sidebar region, clicking again collapses. The top `taskTray` slot in `AppLayout` is removed.

**Alternative rejected**: keep Kanban auto-mounted full-width during multi-task ceremonies. Rejected because the user reported (#15) that Kanban dominates the screen even when the ceremony is mid-step. Boss SHALL emit `kanban.suggested` to highlight the chip on long ceremonies, but never auto-open it.

**Why "Activity always renders"**: per project-direction "过程即价值", users must always be able to see what the system did; Activity is the load-bearing transparency surface.

### Decision 8: Workspace search bar is a single debounced index over three families

**Choice**: one search input in the right-rail header. Debounced (300ms). Returns up to N hits per family (thread titles / workspace files / employees) in a unified result list with family icons. Click on a hit routes appropriately: thread → switch thread; file → open file preview overlay (existing `ProjectWorkspaceFiles` viewer); employee → focus rail.

**Alternative rejected**: three separate search inputs (thread search / file search / employee search). Rejected because it's the same affordance (find an entity by name); splitting just multiplies UI clutter.

**Trade-off**: search results from three sources need stable ordering. Order: exact-prefix > substring > fuzzy; within tier, recently-touched first. Implementation builds on existing in-memory filters per family, no new index infrastructure.

## Risks / Trade-offs

- **Highest risk: thread isolation invariant** → the test that "switching threads does not pollute message / run-scope / deliverable / activity rendering of the previously visible thread" must hold across five consumer modules. **Mitigation**: the `chat-streaming-ux` Requirement on conversationKey-based dedupe carries forward verbatim under the new key shape; the cascade is structural (one shape change at the source) rather than five hand-coded guards. Live verify exercises the multi-thread path explicitly.
- **Risk: "no migration" loses pre-release thread state** → users on the build before this change have a single thread per project; that thread is bootstrapped as the project's first `chat_threads` row on first launch post-update. **Mitigation**: the bootstrap is explicit (`ensureProjectHasAtLeastOneThread`), runs on `OffisimRuntimeProvider` mount, and is idempotent.
- **Risk: boss auto-title LLM call adds latency to first turn** → mitigated by running the title summarizer as a fire-and-forget tail call (not blocking the user-facing first render), and falling back to the truncated first user prompt if the summarizer call fails.
- **Risk: bottom status bar becomes a junk drawer** → mitigated by spec-locking the slot host to known mount kinds (Dashboard / Notification / git branch / token cost / latency) and forbidding ad-hoc mounts. Adding a new mount requires extending the slot enum.
- **Risk: Tasks gating hides too much when boss is mid-plan but plan_items is briefly empty** → mitigated by gating on `plan_items.length > 0 || run.state === 'planning'` (renders Plan placeholder during the planning ceremony so it doesn't pop in).
- **Risk: Kanban chip overlay collides with Tasks tab body content** → mitigated by overlay rendering at a higher z-stack and capturing pointer events; closing on Esc / outside click. Behavior matches existing inspector popover stack discipline.
- **Trade-off: search relevance is heuristic** → no full-text index for now; thread title is a small set, file list is bounded by `project_list_dir`, employee list is small. Acceptable for v1; add fts5 later if size grows.
- **Trade-off: `archived_at` column reserved but no UI** → minor schema overhead; explicitly documented as deferred.

## Migration Plan

No DB migration in the operational sense. The deploy plan is:

1. Land schema change in `db-local/src/schema.sql` + `schema.ts` (drizzle) + `db-platform` (if mirrored).
2. Release `.app` startup runs the existing release run action; pre-release dirty data is dropped.
3. On first runtime mount post-update, `ensureProjectHasAtLeastOneThread(projectId)` creates a default thread per existing project so every project has at least one `chat_threads` row before the rail tries to render the list.
4. UI cascade lands behind the new `WorkspaceRight` shell. Old shell removed in the same commit (no flag, no fallback path).
5. Capability spec lands as new `workspace-thread-architecture` + deltas to `chat-streaming-ux` + `workspace-state-management`.

**Rollback**: revert the change. No production data shape to undo (pre-release).

## Open Questions

- **Q1**: should `chat_threads.summary` be auto-populated alongside `chat_threads.title` (e.g. multi-line synopsis for the search-result preview), or do we surface only the latest message preview? **Tentative**: latest-message preview for v1 (cheaper, no extra LLM call); reserve `summary` column for a future enhancement.
- **Q2**: workspace search across team members — does it match employee role label, persona description, or only `name`? **Tentative**: name + role label for v1; full persona search later.
- **Q3**: Kanban chip — does it appear in every Tasks tab regardless of task count, or only when `kanban_cards.length > 0`? **Tentative**: appears only when there are kanban cards (consistent with the gating philosophy of the rest of the tab).
- **Q4**: status bar — should `git branch` be project-workspace-bound (read from `workspace_root`) or app-bound? **Tentative**: project-workspace-bound when `workspace_root` is set, else hidden. Matches the `project-workspace-binding` capability.
- **Q5**: `selectedThreadId` persistence on workspace switch — survives the switch (like `selectedEmployeeId`)? **Tentative**: yes, scoped per project, so re-entering Office restores the last thread per active project.
