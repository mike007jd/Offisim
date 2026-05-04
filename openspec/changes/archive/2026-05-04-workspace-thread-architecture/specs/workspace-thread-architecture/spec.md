## ADDED Requirements

### Requirement: Project ↔ Thread is one-to-many in the data layer

A `chat_threads` table SHALL exist in the single-baseline `db-local/src/schema.sql` as the product-layer thread metadata, with columns `{ thread_id TEXT PK, project_id TEXT NOT NULL FK projects(project_id), title TEXT NOT NULL DEFAULT 'New thread', title_set_by_user INTEGER NOT NULL DEFAULT 0, summary TEXT NULL, archived_at TEXT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL }`. `projects.thread_id` column SHALL NOT exist. Drizzle (`schema.ts`) and raw SQL (`schema.sql`) SHALL stay in lockstep. No migration script SHALL be authored — pre-release dirty data is dropped via the release run action.

`chat_threads.thread_id` SHALL be a product-layer identifier independent of `graph_threads.thread_id`; chat history is NOT persisted in a `messages` table (no such table exists in this codebase). Conversation history is composed at runtime from the in-memory `useChatSessionStore` (keyed by `conversationKey`) and from LangGraph checkpoint state (keyed by `graph_threads.thread_id`). The product `chat_thread` is bound to runtime threads via the `<projectId>::<threadId>::<employeeId?>` `conversationKey` shape — team chat under a thread T derives one runtime thread, and each direct chat under T with employee E derives its own runtime thread (per `chat-streaming-ux` Direct chat partitioning Requirement). One `chat_thread` therefore MAY back many `graph_threads` rows over its lifetime; the data layer SHALL NOT enforce a 1:1 FK between `chat_threads.thread_id` and `graph_threads.thread_id`.

#### Scenario: A project can carry many threads

- **WHEN** a project exists and the user creates a second `chat_threads` row referencing the same `project_id`
- **THEN** both rows SHALL be readable via the project's thread list query
- **AND** the project row SHALL NOT carry a single `thread_id` pointer

#### Scenario: A single chat_thread backs both team-chat and per-employee direct-chat runtimes

- **WHEN** the user has chat thread T1 active under project P, exchanges a team-chat turn, and then opens direct chat with employees Maya and Alex under the same T1
- **THEN** the runtime SHALL operate three distinct `graph_threads` rows scoped to T1: one for the team-chat conversationKey `<P>::<T1>::`, one for `<P>::<T1>::<maya>`, and one for `<P>::<T1>::<alex>`
- **AND** all three runtime threads SHALL trace back to the same `chat_threads.thread_id = T1` via the conversationKey middle segment, without any FK column on `chat_threads` pointing to a single owning `graph_threads.thread_id`

#### Scenario: Bootstrap on first runtime mount

- **WHEN** the runtime mounts (`OffisimRuntimeProvider` initializes) and an existing project has zero `chat_threads` rows
- **THEN** the runtime SHALL idempotently create exactly one default thread for that project before any UI consumer reads the thread list
- **AND** the default thread title SHALL be `New thread`
- **AND** the bootstrap SHALL NOT create a `graph_threads` row eagerly; the runtime thread SHALL be created on first chat send via the existing `OrchestrationService.ensureGraphThread()` path

### Requirement: Right rail nests Project → Thread → Chat

The right rail SHALL render a three-layer structure: Project selector at top, Thread list as a sidebar (titles + last-message preview + timestamp + active state + a `+ New thread` affordance), and Chat main area for the currently active thread. Switching threads SHALL replace the visible message history, run scope, deliverable scope, and activity-event scope wholesale; no state SHALL leak from the previous thread.

#### Scenario: Multi-thread isolation

- **WHEN** the user opens project P, creates threads T1 and T2, sends a message in T1, switches to T2, sends a message in T2, and switches back to T1
- **THEN** T1's chat rail SHALL render exactly the messages sent and received in T1
- **AND** T2's chat rail SHALL render exactly the messages sent and received in T2
- **AND** no message, run-scope artifact, deliverable, or activity event from one thread SHALL render in the other thread's rail

#### Scenario: New thread starts blank

- **WHEN** the user clicks `+ New thread` in the thread list
- **THEN** a new `chat_threads` row SHALL be persisted with title `New thread`
- **AND** the right rail SHALL switch to the new thread with an empty chat rail

### Requirement: Boss-auto thread title with user override

A thread's title SHALL initialize to `New thread` with `title_set_by_user = 0`. On the first assistant turn, the runtime SHALL invoke a low-cost LLM 1-line summarizer to set the title (or, on summarizer failure, fall back to the user's first prompt truncated to 60 characters). The user MAY rename the thread at any time via a thread-list rename affordance; a user-driven rename SHALL persist `title_set_by_user = 1` on the row. After a user rename, subsequent boss-driven retitle attempts SHALL no-op by inspecting `title_set_by_user`.

The repo `updateTitle(threadId, title, { byUser: boolean })` method SHALL be the only write path for the title and SHALL set `title_set_by_user` to `byUser ? 1 : 0` only when transitioning from 0; it SHALL NOT downgrade a user-set title to system-set.

#### Scenario: Auto-title on first assistant turn

- **WHEN** a freshly created thread receives its first user prompt and the assistant turn completes
- **THEN** the runtime SHALL invoke a 1-line summarizer asynchronously
- **AND** the thread title SHALL update from `New thread` to the summarizer output once available
- **AND** the title update SHALL NOT block the user-facing first render of the assistant reply
- **AND** the persisted row SHALL retain `title_set_by_user = 0`

#### Scenario: User rename is sticky and persists across sessions

- **WHEN** the user manually edits a thread title from `New thread` to `Q3 launch plan`
- **THEN** the row SHALL persist `title_set_by_user = 1`
- **AND** subsequent assistant turns on the same thread SHALL NOT trigger a boss-driven retitle
- **AND** reopening the application SHALL still show `Q3 launch plan` (no system overwrite)

### Requirement: Header shrinks to workspace identity only

The application header SHALL render only the workspace pill nav and workspace-level tools. Mode selector, Notification center, and Dashboard entry SHALL NOT mount in the header. Install affordances SHALL NOT mount in the header.

#### Scenario: No mode / notification / dashboard / install in header

- **WHEN** any workspace is active and the header is rendered
- **THEN** no DOM ancestor of the header SHALL host a Mode dropdown, a Notification bell, a Dashboard launcher, or a standalone Install button

### Requirement: Mode chip lives in the chat input footer

The Mode selector (`SOP / HIL / Direct / YOLO`) SHALL render as a chip dropdown in the chat input footer chip row. Selecting a mode SHALL apply to the next chat turn under the active thread.

#### Scenario: Mode chip switches runtime mode

- **WHEN** the user opens the Mode chip dropdown and selects `YOLO`
- **THEN** the next chat turn submitted on the active thread SHALL execute under `entry_mode = 'yolo'`
- **AND** the chip SHALL display the selected mode label

### Requirement: Bottom status bar hosts Dashboard, Notification, and runtime telemetry

The application SHALL mount a fixed-bottom status bar slot host. The slot host SHALL accept exactly the following mount kinds: Dashboard launcher, Notification center, git-branch indicator (when project workspace_root is bound), token-cost indicator, latency indicator. Adding a new mount kind SHALL require extending the slot enum at the host level — ad-hoc mounts SHALL be forbidden.

#### Scenario: Dashboard opens from status bar

- **WHEN** the user clicks the Dashboard slot in the bottom status bar
- **THEN** the existing dashboard surface SHALL open as a popup overlay
- **AND** the same surface SHALL NOT also be reachable from the header

#### Scenario: Notification badge is inline, not absolute

- **WHEN** the Notification slot has unread items
- **THEN** the unread count SHALL render as an inline ring inside the slot bounds
- **AND** the badge SHALL NOT clip against any ancestor `overflow-hidden`

#### Scenario: Git-branch slot respects workspace binding

- **WHEN** the active project has `workspace_root = null`
- **THEN** the git-branch slot SHALL NOT render
- **WHEN** the active project has a bound `workspace_root`
- **THEN** the slot SHALL render the branch name resolved from that root

### Requirement: Install affordance is exclusive to Market detail

Any code path that triggers an install of a marketplace listing SHALL route the user to the listing's Market detail page and surface the install CTA there. Standalone install dialogs SHALL NOT exist outside `MarketplaceDetailOverlay` (which itself renders the same install affordance shape and is reserved for deep-link install entry per the existing CLAUDE.md note).

#### Scenario: Deep link routes to Market detail

- **WHEN** the user follows `offisim://install/<listing>`
- **THEN** the application SHALL navigate to the Market detail page (or `MarketplaceDetailOverlay`) for that listing
- **AND** the install CTA shall be visible on that surface
- **AND** no separate install dialog SHALL open

#### Scenario: Status bar / palette / shortcut do not own install

- **WHEN** any non-Market surface (status bar, command palette, keyboard shortcut, etc.) requests an install
- **THEN** that surface SHALL route the user to Market detail
- **AND** SHALL NOT render its own install dialog

### Requirement: Tasks tab is content-gated

The Tasks tab SHALL render an Activity section unconditionally as the always-visible baseline. Plan and Outputs sections SHALL render only when their data is non-empty. Empty section frames SHALL NOT render.

#### Scenario: Empty tasks tab shows only Activity

- **WHEN** the active thread has zero plan items and zero deliverables
- **THEN** the Tasks tab SHALL render only the Activity section
- **AND** Plan and Outputs section frames SHALL NOT render

#### Scenario: Plan placeholder during planning ceremony

- **WHEN** the active thread has zero plan items but the boss is in the `planning` ceremony state
- **THEN** the Tasks tab Plan section SHALL render a placeholder so it does not pop in mid-ceremony
- **AND** the placeholder SHALL replace itself with the plan list when items materialize

#### Scenario: Outputs renders when deliverables exist

- **WHEN** the active thread has at least one deliverable
- **THEN** the Tasks tab Outputs section SHALL render the deliverable list
- **AND** the section frame SHALL NOT render when the deliverable list is empty

### Requirement: Kanban entry-point is a Tasks-tab chip overlay

The Kanban surface SHALL render as a `📋 Board ▾` chip inside the Tasks tab. Clicking the chip SHALL expand a Kanban overlay over the right-sidebar region; clicking again SHALL collapse it. The previously-existing top `taskTray` slot in `AppLayout` SHALL NOT exist. The boss MAY emit a `kanban.suggested` event during long ceremonies to highlight the chip; the event SHALL NOT auto-expand the overlay.

#### Scenario: Kanban chip expands and collapses

- **WHEN** the user clicks the `📋 Board ▾` chip in the Tasks tab
- **THEN** a Kanban overlay SHALL render above the right-sidebar region with pointer events captured
- **AND** clicking the chip again (or pressing Escape) SHALL collapse the overlay

#### Scenario: Kanban does not auto-mount full-width

- **WHEN** the boss emits `kanban.suggested` during a multi-task ceremony
- **THEN** the Tasks-tab chip SHALL render a highlight cue
- **AND** the Kanban overlay SHALL NOT auto-expand

#### Scenario: Kanban chip only when cards exist

- **WHEN** the active thread has zero kanban cards
- **THEN** the `📋 Board ▾` chip SHALL NOT render

### Requirement: Workspace search bar unifies threads, files, and employees

The right-rail SHALL host a single workspace search input. The input SHALL be debounced (300 ms) and SHALL return up to N hits per family across thread titles, workspace files (bounded via `project_list_dir`), and employees (name + role label) in a unified result list with family icons. Result ordering SHALL be exact-prefix > substring > fuzzy, with recently-touched entries first within each tier. Selecting a hit SHALL route to the appropriate surface: thread → switch active thread; file → open the existing bounded file preview; employee → focus the employee in the personnel rail.

#### Scenario: Search hits all three families

- **WHEN** the user types `q3` into the workspace search bar
- **THEN** the result list SHALL include any thread whose title matches, any workspace file whose name matches, and any employee whose name or role label matches
- **AND** each result row SHALL display a family icon distinguishing thread / file / employee

#### Scenario: Selection routes correctly

- **WHEN** the user clicks a thread result
- **THEN** the right rail SHALL switch to that thread
- **WHEN** the user clicks a file result
- **THEN** the bounded file preview SHALL open for that path
- **WHEN** the user clicks an employee result
- **THEN** the personnel rail SHALL focus that employee
