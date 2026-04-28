## ADDED Requirements

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

A migration file in `packages/db-local/src/migrations/` SHALL add this column via `ALTER TABLE meeting_sessions ADD COLUMN interaction_mode TEXT NOT NULL DEFAULT 'boss_proxy'`. The migration SHALL be idempotent (using `CREATE INDEX IF NOT EXISTS` and a guarded ALTER if necessary).

#### Scenario: Existing rows backfill to default
- **WHEN** the migration runs against a db-local with pre-existing meeting_sessions rows
- **THEN** every row has `interaction_mode = 'boss_proxy'` afterward

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

`apps/web/src/components/session-mode/SessionModeSwitcher.tsx` SHALL render the current mode as a coloured badge (using `--color-foam`/`--color-coral-orange`/`--color-sea-blue`/`--color-kelp-green` for the 4 values respectively) and offer a popover listing all 4 modes with their `INTERACTION_MODE_DESCRIPTION`.

`apps/web/src/components/app-shell/AppMainShell.tsx` header SHALL include the switcher between `notificationSlot` and `projectSlot`. The switcher SHALL only render when an active conversation exists.

The switcher SHALL persist the change via `PATCH /api/sessions/:id/mode` (web) or the Tauri `set_session_mode` command (desktop), then update local state. No reload SHALL be required.

#### Scenario: Switching mode in UI does not require reload
- **WHEN** user clicks YOLO in the switcher popover
- **THEN** the badge updates to show YOLO immediately, the next sent message is processed by `yolo-master-node`, and no full-page reload occurs
