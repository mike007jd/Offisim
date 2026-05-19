# interaction-modes Specification

## Purpose

Defines Offisim runtime entry modes for boss-proxy, human-in-loop, direct-to-employee, and YOLO execution, including mode-specific state reset and trusted tool availability.
## Requirements
### Requirement: Direct and YOLO modes SHALL start from clean plan-scoped state

Direct-to-employee and YOLO entry paths SHALL clear stale SOP/plan execution state before dispatching an employee turn. Old verifier evidence, pending assignments, dispatched steps, completed steps, blocked steps, and step outputs SHALL NOT leak into the new direct or YOLO run.

#### Scenario: YOLO mode does not reuse prior SOP state

- **WHEN** a prior boss-proxy plan left completed or dispatched step state in the checkpoint
- **AND** the user starts a YOLO turn
- **THEN** the graph enters `yolo-master` first
- **AND** the YOLO employee receives only the new assignment state.

### Requirement: Gateway lane SHALL expose trusted desktop file and shell tools

In a `desktop-trusted` Tauri runtime using the `gateway` lane, employee and YOLO tool pools SHALL include bounded built-in `read_file`, `write_file`, and `bash` capabilities for project workspaces.

Browser-limited runtimes SHALL NOT expose those built-ins. SDK-backed model transports SHALL NOT receive Offisim runtime tools unless a true tool bridge or SDK-native employee runtime profile is implemented and verified.

#### Scenario: Desktop gateway YOLO sees project tools

- **WHEN** a desktop-trusted gateway runtime starts a YOLO employee turn
- **THEN** the model request exposes `read_file`, `write_file`, and `bash`
- **AND** the commands are constrained to bound project workspace roots.

#### Scenario: Browser runtime omits project tools

- **WHEN** a desktop-trusted runtime starts an employee turn without desktop built-ins
- **THEN** the model request does not expose `read_file`, `write_file`, or `bash`.

### Requirement: SDK-backed model transports SHALL NOT expose Offisim runtime tools

Until a tool bridge or full SDK-native employee runtime profile is implemented and verified, Claude, Codex, and OpenAI SDK-backed model transports SHALL set runtime tool-call capability false and SHALL NOT expose file, shell, memory, todo, skill, MCP, or built-in tool schemas to the model.

Adapters for SDK-backed model transports SHALL fail closed with explicit user-facing text if any tool request reaches them. Provider/UI capability copy SHALL NOT label transport selection as an Offisim tools-capable path.

#### Scenario: SDK transport hides all Offisim tools

- **WHEN** an employee or YOLO turn would call a model through an SDK-backed transport
- **THEN** the model request contains none of `read_file`, `write_file`, `bash`, `todo_create`, `todo_update`, `todo_list`, `handoff_to`, skill tools, memory tools, MCP tools, or built-in tools
- **AND** settings copy describes the transport as not tool-capable for Offisim tools.

#### Scenario: SDK transport adapter fails closed on unexpected tools

- **WHEN** a tool request reaches an SDK-backed model transport adapter
- **THEN** the adapter rejects the request instead of forwarding it to a sidecar that cannot execute Offisim tools
- **AND** the error points the user to the default Offisim harness / gateway tools or a verified tool-capable employee profile for project file and command work.

### Requirement: Local tool work SHALL NOT route to external A2A employees

Requests that require Offisim-local filesystem, shell, workspace, or path-bounded project tools SHALL route only to enabled internal employees running in a verified tool-capable context. The current verified context is the default Offisim harness / gateway path; future employee agent profiles need separate evidence before they qualify. External A2A employees and unverified SDK-backed model transports SHALL NOT be selected for those tasks as if they could access local project files or commands.

The "requires local tools" decision SHALL be the precomputed `state.taskToolIntent.requiresLocalTools` from the `task-tool-intent` capability, NOT a per-call regex match against task text. Routing nodes (`boss-node`, `manager-node`, `pm-planner/preflight`, `employee-direct-setup-node`) SHALL read this state field; they SHALL NOT call any text-matching helper to re-derive the same decision.

The intent detector SHALL NOT trigger on bare nouns like "file" / "command" / "命令" / "文件" or natural-prose phrases like "describe the workspace" / "file a bug" — only on verb+object pairs, explicit tool-name tokens, or explicit Chinese imperatives (see `task-tool-intent` capability for the full token contract). Free-text false positives SHALL NOT silently lock external A2A employees out of harmless conversational requests.

Direct-to-employee requests that explicitly target an external A2A employee for local file or command work SHALL fail fast with a user-facing explanation instead of sending the task to the external endpoint.

#### Scenario: Boss avoids external A2A for local tools

- **WHEN** a user asks to read, write, list, or execute commands in the project workspace (verb+object form)
- **AND** both internal and external employees are available
- **THEN** routing selects an enabled internal employee for the local-tool task
- **AND** no A2A request is sent as local filesystem evidence.

#### Scenario: External direct local-tool request fails fast

- **WHEN** direct chat targets an external A2A employee with a local file or shell request
- **THEN** the request is rejected before external dispatch
- **AND** the user is told to use an internal gateway-lane employee for project file and command work.

#### Scenario: Free-text noun does not lock out external employees

- **WHEN** a user sends a direct chat to an external A2A employee containing only bare nouns or idiomatic phrases (`describe the workspace`, `file a bug`, `请描述一下当前的命令行界面`)
- **THEN** `state.taskToolIntent.requiresLocalTools` is `false`
- **AND** the request is dispatched to the external A2A endpoint without fail-fast
- **AND** no `task.assignment.rerouted` event fires

### Requirement: InteractionMode is a 4-value union

`packages/shared-types/src/interactions.ts` SHALL export `type InteractionMode = 'boss_proxy' | 'human_in_loop' | 'direct_to_employee' | 'yolo'`. The same file SHALL export `INTERACTION_MODE_LABEL: Record<InteractionMode, string>`, `INTERACTION_MODE_DESCRIPTION: Record<InteractionMode, string>`, and `DEFAULT_INTERACTION_MODE: InteractionMode = 'boss_proxy'`.

The label values SHALL be `'SOP'` for `boss_proxy`, `'Human-in-loop'` for `human_in_loop`, `'Direct'` for `direct_to_employee`, `'YOLO'` for `yolo`.

The 4 values SHALL appear in this exact ordering wherever the union is enumerated for UI (badge / switcher / dropdown).

#### Scenario: Default is boss_proxy
- **WHEN** code reads `DEFAULT_INTERACTION_MODE`
- **THEN** it equals `'boss_proxy'`

#### Scenario: localStorage rejects unknown values
- **WHEN** `localStorage` contains `offisim.interaction-mode.default` = `'random_string'` and `loadDefaultInteractionMode()` is called
- **THEN** the function returns `'boss_proxy'`

#### Scenario: All 4 values have label and description
- **WHEN** iterating union values
- **THEN** `INTERACTION_MODE_LABEL[v]` and `INTERACTION_MODE_DESCRIPTION[v]` are non-empty strings for every `v`

### Requirement: meeting_sessions persists interaction_mode column

`packages/db-local/src/schema.ts` `meetingSessions` table SHALL include column `interaction_mode TEXT NOT NULL DEFAULT 'boss_proxy'` with index `idx_meeting_sessions_mode`.

`packages/db-local/src/schema.sql` SHALL include this column and index in the pre-launch bootstrap schema.

#### Scenario: Fresh bootstrap creates the default
- **WHEN** a fresh local SQLite DB is initialized from `schema.sql`
- **THEN** `meeting_sessions.interaction_mode` exists with default `'boss_proxy'`

### Requirement: main-graph routes by interactionMode

`packages/core/src/graph/state.ts` `OffisimGraphState` SHALL include `interactionMode: InteractionMode` (default `'boss_proxy'`).

`packages/core/src/graph/main-graph.ts` SHALL export `function modeRouter(state): 'boss' | 'pm-planner' | 'yolo-master'` and use it via `addConditionalEdges(START, modeRouter, ...)`. The mapping SHALL be:

- `'boss_proxy'` → `'boss'`
- `'human_in_loop'` → `'boss'` (chain identical to boss_proxy; the difference is plan-review-gate strictness, enforced in `plan-review-gate.ts`)
- `'direct_to_employee'` → `'pm-planner'`
- `'yolo'` → `'yolo-master'`

Pre-existing `boss_proxy` and `human_in_loop` traces SHALL be byte-identical post-change (no new node visits, no event reorder).

#### Scenario: yolo skips boss
- **WHEN** a conversation with `interactionMode: 'yolo'` enters main-graph
- **THEN** the first executed node in the trace is `'yolo-master'`, never `'boss'`, `'manager'`, `'hr'`, or `'pm-planner'`

#### Scenario: direct skips boss but uses planner
- **WHEN** `interactionMode: 'direct_to_employee'`
- **THEN** the first executed node is `'pm-planner'`, never `'boss'`/`'manager'`/`'hr'`

#### Scenario: boss_proxy unchanged
- **WHEN** comparing pre-change vs post-change traces for an identical `boss_proxy` conversation fixture
- **THEN** node visit order, event sequence, and final state are byte-identical

### Requirement: YOLO Master is seeded into every company template

`packages/core/src/agents/yolo-master-persona.ts` SHALL export `YOLO_MASTER_ROLE_SLUG = 'yolo_master' as const` and `YOLO_MASTER_EMPLOYEE: CompanyTemplateEmployee` with persona reflecting an autonomous full-stack engineer optimised for long-running coding tasks (TDD-first, completes only after running verification commands, prefers fork-sub-context for parallel sub-tasks).

The `RoleSlug` union in `packages/shared-types/src/...` SHALL include `'yolo_master'`.

Each of `packages/core/src/templates/{rd-company,content-studio,product-team,agency-lite,ai-startup}.ts` SHALL include `YOLO_MASTER_EMPLOYEE` in its `employees` array.

#### Scenario: All 5 templates contain YOLO Master
- **WHEN** iterating `listTemplates()`
- **THEN** every template has at least one employee with `role_slug === 'yolo_master'`

### Requirement: Existing companies idempotently gain YOLO Master

`packages/core/src/runtime/ensure-yolo-master.ts` SHALL export `async function ensureYoloMasterForActiveCompanies(repos): Promise<void>` that, for every active company missing a `role_slug = 'yolo_master'` employee, inserts one with persona/config from `YOLO_MASTER_EMPLOYEE` and a fresh `employee_id`.

`apps/platform/src/startup.ts` and the desktop Tauri main entry SHALL call this function once during initialization.

The function SHALL be idempotent — calling it twice in a row results in zero inserts on the second call.

#### Scenario: Idempotent on second call
- **WHEN** `ensureYoloMasterForActiveCompanies` is called twice consecutively against a db-local with 3 companies
- **THEN** after the first call each company has exactly one `yolo_master` employee, and the second call inserts zero rows

### Requirement: yolo-master-node loop bypasses organisational chain

`packages/core/src/agents/yolo-master-node.ts` SHALL export `async function yoloMasterNode(state, ctx): Promise<Partial<OffisimGraphState>>` that:
- Looks up the YOLO Master employee for the active company via `repos.employees.findByRoleSlug('yolo_master', state.activeCompanyId)`
- Throws an error with message containing `"YOLO Master employee not found"` and `"ensureYoloMasterForActiveCompanies"` if the lookup returns null
- Delegates to `runEmployeeTurn({ ..., options: { skipPlannerHandoff: true, enableSubagentFork: true, enableTodoTool: true } })`

The graph SHALL register this node as `'yolo-master'` and edge it directly to `END`.

#### Scenario: Missing YOLO Master throws actionable error
- **WHEN** `yoloMasterNode` runs against a company with no `yolo_master` employee
- **THEN** the thrown error message guides the operator toward `ensureYoloMasterForActiveCompanies`

### Requirement: todo_* tools available only in direct/yolo modes

`packages/core/src/agents/employee-tool-kit.ts` SHALL export `todoCreateTool`, `todoUpdateTool`, `todoListTool` that delegate to `ctx.runtime.repos.kanban.create / transition / listByEmployee`.

These tools SHALL only be added to an employee turn's available tool list when `state.interactionMode in ('direct_to_employee', 'yolo')`. In `boss_proxy` and `human_in_loop` modes, plan management is the planner's responsibility, and these tools SHALL be hidden from employees.

#### Scenario: todo_* visible in yolo mode
- **WHEN** an employee turn runs with `interactionMode: 'yolo'`
- **THEN** the available tool list contains `todo_create`, `todo_update`, `todo_list`

#### Scenario: todo_* hidden in boss_proxy mode
- **WHEN** an employee turn runs with `interactionMode: 'boss_proxy'`
- **THEN** the available tool list contains none of `todo_create`, `todo_update`, `todo_list`

### Requirement: Platform / Tauri expose mode CRUD

`apps/platform/src/routes/sessions.ts` SHALL implement:

- `PATCH /api/sessions/:id/mode` — body `{ mode: InteractionMode }` (zod-validated against the 4-value enum), updates `meeting_sessions.interaction_mode`, returns `{ ok: true, mode }`
- `GET /api/sessions/:id` — returns `{ id, mode }`

`apps/desktop/src-tauri/` SHALL expose `set_session_mode(id, mode)` and `get_session(id)` Tauri commands with equivalent behaviour.

#### Scenario: Invalid mode rejected with 400
- **WHEN** `PATCH /api/sessions/:id/mode` receives body `{ mode: "random" }`
- **THEN** the response is HTTP 400 and the database row is unchanged

#### Scenario: Valid mode persists and reads back
- **WHEN** `PATCH /api/sessions/abc/mode { mode: "yolo" }` succeeds and `GET /api/sessions/abc` is called
- **THEN** the GET response contains `{ id: "abc", mode: "yolo" }`

### Requirement: SessionModeSwitcher UI in main shell header

`apps/desktop/renderer/src/components/session-mode/SessionModeSwitcher.tsx` SHALL render the current mode as a coloured badge (using `--color-foam`/`--color-coral-orange`/`--color-sea-blue`/`--color-kelp-green` for the 4 values respectively) and offer a popover listing all 4 modes with their `INTERACTION_MODE_DESCRIPTION`.

`apps/desktop/renderer/src/components/app-shell/AppMainShell.tsx` header SHALL include the switcher between `notificationSlot` and `projectSlot`. The switcher SHALL only render when an active conversation exists.

The switcher SHALL persist the change via `PATCH /api/sessions/:id/mode` (web) or the Tauri `set_session_mode` command (desktop), then update local state. No reload SHALL be required.

#### Scenario: Switching mode in UI does not require reload
- **WHEN** user clicks YOLO in the switcher popover
- **THEN** the badge updates to show YOLO immediately, the next sent message is processed by `yolo-master-node`, and no full-page reload occurs

### Requirement: Gateway-lane filesystem and shell tools are honest about their bounds

Gateway-lane project file tools SHALL only operate under canonicalized `projects.workspace_root` directories that pass workspace-root sanity checks. Write paths SHALL validate the deepest existing ancestor before any parent directory creation or file write occurs, and SHALL re-validate the final written path after the write.

Workspace roots that are host-level directories such as `/`, `/Users`, `/home`, `/tmp`, `/usr`, `/opt`, `/private`, the current user home, the current user home's parent, or paths with insufficient depth SHALL be ignored for tool binding.

LLM-facing filesystem errors SHALL NOT include host absolute paths. Errors SHALL use a stable redacted form or a path relative to a bound root.

Bash execution in the gateway lane SHALL be cwd-bound to a project workspace and SHALL NOT source login profiles. It SHALL NOT be described as a full command sandbox.

Read and write tools SHALL enforce in-process file size limits.

#### Scenario: Symlink write escape is rejected before side effects
- **WHEN** a project workspace contains a symlink to a directory outside all bound roots
- **AND** the gateway lane attempts to write through that symlink
- **THEN** the write is rejected before creating parent directories outside the root
- **AND** the LLM-facing error does not include a host absolute path

#### Scenario: Overbroad workspace roots are ignored
- **WHEN** a project row binds `/` as `workspace_root`
- **THEN** gateway filesystem tools report that no project workspace root is bound

#### Scenario: Oversized file IO is rejected
- **WHEN** a read or write payload exceeds the configured in-process byte limit
- **THEN** the tool rejects the operation with a redacted path and size-limit error

### Requirement: Desktop privileged invokes require explicit capabilities

Desktop fs/shell invokes and agent bridge invokes SHALL each be guarded by a dedicated Tauri capability limited to the main window. These privileged commands SHALL NOT rely only on broad default capability visibility.

#### Scenario: Privileged invoke is main-window scoped
- **WHEN** desktop capabilities are loaded
- **THEN** fs/shell and agent bridge commands are granted only to the main window capability set

### Requirement: Routing reroutes SHALL emit `task.assignment.rerouted` events

When a routing node overrides an LLM-chosen assignment for any reason — local-tool gating filtering out an external A2A pick, sanitize-fallback swapping a missing or disabled employee, planner-recommended reordering — the runtime SHALL emit a `task.assignment.rerouted` event before dispatching the rerouted assignment.

The event factory SHALL live at `packages/core/src/events/event-factories.ts` with signature `taskAssignmentRerouted(companyId, taskRunId, requestedEmployeeId, resolvedEmployeeId, reason, threadId, source)` where:
- `requestedEmployeeId: string` — the LLM/planner's original pick
- `resolvedEmployeeId: string` — the actual employee that received the dispatch
- `reason: 'requires-local-tools' | 'employee-not-found' | 'employee-disabled' | 'no-recommendation-fallback'`
- `source: 'manager' | 'pm-planner'`

The event payload SHALL be added to `packages/shared-types/src/event-types.ts` event union and SHALL appear under the `task.*` prefix for EventLog filtering. `packages/ui-office/src/lib/event-log-store.ts` `EVENT_PREFIXES` and `TYPE_PREFIX_MAP` SHALL include the new event type. The activity-log renderer SHALL format the event as `Manager rerouted <taskRunId> from <requestedName> to <resolvedName>: <reason>` (or planner-source equivalent).

The runtime SHALL also emit a structured logger record at `info` level with the same field set so headless / CI runs surface the rerouting decision.

#### Scenario: Manager rerouting emits structured event
- **WHEN** manager-node receives an LLM `decision.assignments` entry referencing an external A2A employee for a local-tool task
- **AND** the gate filters that assignment out and re-binds to an internal employee
- **THEN** a `task.assignment.rerouted` event is emitted with `source: 'manager'`, `reason: 'requires-local-tools'`, `requestedEmployeeId` of the external pick, `resolvedEmployeeId` of the internal fallback
- **AND** a logger.info entry with the same fields appears in the runtime log

#### Scenario: Activity feed surfaces the reroute
- **WHEN** the EventLog UI subscribes to the `task.*` prefix
- **THEN** the new `task.assignment.rerouted` event is delivered to the activity feed
- **AND** the renderer shows a row "Manager rerouted task <id> from <Maya> to <Alex>: Maya cannot use local tools" (or analogous formatted text)

#### Scenario: Activity feed collapses noisy reroutes
- **WHEN** the activity feed receives 5 consecutive `task.assignment.rerouted` events with the same `reason` and `source` for the same `taskRunId`
- **THEN** the renderer collapses entries 4 and 5 (and any further duplicates) under a single row with a count badge `×N` instead of stacking N full rows
