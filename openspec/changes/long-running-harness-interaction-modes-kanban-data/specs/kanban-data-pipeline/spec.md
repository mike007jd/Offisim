## ADDED Requirements

### Requirement: kanban_cards table on db-local with project FK

`packages/db-local/src/schema.ts` SHALL declare `kanbanCards = sqliteTable('kanban_cards', ...)` with columns:

- `id TEXT PRIMARY KEY`
- `project_id TEXT NOT NULL` referencing `projects.project_id` ON DELETE CASCADE
- `company_id TEXT NOT NULL` referencing `companies.company_id` ON DELETE CASCADE
- `title TEXT NOT NULL`
- `note TEXT NOT NULL DEFAULT ''`
- `state TEXT NOT NULL DEFAULT 'todo'` — application-enforced enum `'todo'|'doing'|'blocked'|'review'|'done'`
- `origin TEXT NOT NULL` — application-enforced enum `'pm-planner'|'employee'|'manager'|'human'`
- `created_by_employee_id TEXT` (nullable)
- `assigned_employee_id TEXT` (nullable)
- `parent_card_id TEXT` (nullable, self-FK for sub-cards)
- `blocked_reason TEXT` (nullable, only set when `state === 'blocked'`)
- `task_run_id TEXT` (nullable, links to graph task run for employee-completion sync)
- `sort_order INTEGER NOT NULL DEFAULT 0`
- `created_at TEXT NOT NULL`
- `updated_at TEXT NOT NULL`

Indexes:
- `idx_kanban_project_state ON (project_id, state)`
- `idx_kanban_assignee ON (assigned_employee_id, state)`
- `idx_kanban_task_run ON (task_run_id)`

A migration SHALL create the table with `CREATE TABLE IF NOT EXISTS` and indexes with `CREATE INDEX IF NOT EXISTS`.

#### Scenario: Project deletion cascades cards
- **WHEN** a project row is deleted
- **THEN** all `kanban_cards` with that `project_id` are deleted

#### Scenario: Migration is idempotent
- **WHEN** the kanban migration runs against a db-local that already has the table
- **THEN** no error occurs and existing rows are unchanged

### Requirement: KanbanRepo enforces state machine and emits events

`packages/core/src/runtime/repos/kanban-repo.ts` SHALL export `class KanbanRepo` with constructor `(db, eventBus?)` and methods:

- `create(input): Promise<KanbanCardRow>` — generates `id` (uuid), sets timestamps, inserts; emits `{ kind: 'kanban', op: 'created', card }`
- `transition(id, next, blockedReason?): Promise<KanbanCardRow | null>` — updates `state`, sets `blockedReason` only when `next === 'blocked'` (else nulls it), updates `updated_at`; emits `{ kind: 'kanban', op: 'transitioned', card }`
- `transitionByTaskRun(taskRunId, next, blockedReason?): Promise<void>` — same as above keyed by `task_run_id`
- `listByProject(projectId): Promise<KanbanCardRow[]>` — ordered by `sort_order DESC`
- `listByEmployee(employeeId, state?): Promise<KanbanCardRow[]>`
- `assign(id, employeeId | null): Promise<void>`

The repo SHALL be wired into `RuntimeContext.runtime.repos.kanban` in `packages/core/src/runtime/repositories.ts`.

#### Scenario: Blocked state requires reason
- **WHEN** `transition(id, 'blocked', 'waiting on manager review')` is called
- **THEN** the row's `state = 'blocked'` and `blocked_reason = 'waiting on manager review'`

#### Scenario: Leaving blocked clears reason
- **WHEN** a card with `state: 'blocked'` is transitioned to `'doing'`
- **THEN** `blocked_reason` is null afterward

#### Scenario: Each write emits an event
- **WHEN** `create`, `transition`, `transitionByTaskRun`, or `assign` succeeds and an event bus is configured
- **THEN** exactly one event with `kind: 'kanban'` is published per operation

### Requirement: pm-planner persists plan steps as cards

`packages/core/src/agents/pm-planner-node.ts` SHALL, after the planner finalises its plan steps, invoke `ctx.runtime.repos.kanban.create({...})` once per step with:

- `projectId: state.activeProjectId`
- `companyId: state.activeCompanyId`
- `title: step.label` (or whatever the real `PlanStep` field name is — see baseline note Task 1.8)
- `note: step.rationale ?? ''`
- `origin: 'pm-planner'`
- `assignedEmployeeId: step.assigneeId ?? null`
- `taskRunId: step.taskRunId`
- `state: 'todo'`

#### Scenario: Plan with N steps creates N cards
- **WHEN** the planner finalises a plan with 3 steps for project `p1`
- **THEN** `listByProject('p1')` returns 3 rows with `origin: 'pm-planner'` and `state: 'todo'`

### Requirement: employee-completion transitions card on done/review

`packages/core/src/agents/employee-completion.ts` SHALL, after the completion-verifier decides the next state, invoke:

```
ctx.runtime.repos.kanban.transitionByTaskRun(
  state.currentTaskRunId,
  nextState === 'completed' ? 'done' : 'review',
  nextState === 'completed' ? undefined : verdict.reason,
)
```

— but only if `state.currentTaskRunId` is non-null.

#### Scenario: Verified completion flips card to done
- **WHEN** completion-verifier allows and `currentTaskRunId` matches a card
- **THEN** that card's `state === 'done'` afterward

#### Scenario: Blocked completion flips card to review with reason
- **WHEN** completion-verifier blocks with reason `'no test evidence'`
- **THEN** the matching card's `state === 'review'` and `blocked_reason === 'no test evidence'` (kanban surfaces verifier reason in `blocked_reason` despite state being `'review'`, providing visibility)

### Requirement: Platform exposes kanban CRUD + SSE

`apps/platform/src/routes/kanban.ts` SHALL implement:

- `GET /api/projects/:projectId/kanban` — returns `{ cards: KanbanCardRow[] }`
- `POST /api/projects/:projectId/kanban` — body zod validates `{ title, note?, origin, assignedEmployeeId? }`, returns `{ card }` with HTTP 201
- `PATCH /api/kanban/:id` — body `{ state, blockedReason? }` zod-validated, returns `{ card }`
- `GET /api/projects/:projectId/kanban/stream` — SSE; subscribes to event bus and forwards events whose `kind === 'kanban'` and `card.projectId` matches
- `GET /api/employees/:employeeId/kanban-count` — returns `{ count }` of cards in `'todo'` or `'doing'` for that employee

`apps/desktop/src-tauri/` SHALL expose equivalent Tauri commands `list_kanban_cards`, `create_kanban_card`, `transition_kanban_card`, `count_kanban_for_employee`, plus a Tauri event channel `kanban://updates/:projectId` replacing SSE.

#### Scenario: SSE delivers transition in real time
- **WHEN** a client is connected to `GET /api/projects/p1/kanban/stream` and a card on project `p1` is transitioned via `PATCH /api/kanban/c1`
- **THEN** within 200 ms the SSE stream emits an `event: kanban.update` containing the updated card

#### Scenario: Invalid state rejected
- **WHEN** `PATCH /api/kanban/c1` body is `{ state: 'random' }`
- **THEN** HTTP 400 and the row is unchanged

### Requirement: useKanbanStream hook provides reactive cards to UI

`apps/web/src/runtime/useKanbanStream.ts` SHALL export `useKanbanStream(projectId): { cards, move, create }` that:

- on mount fetches `GET /api/projects/:projectId/kanban` and stores cards
- subscribes to `EventSource('/api/projects/:projectId/kanban/stream')` and merges updates
- exposes `move(id, next)` calling `PATCH /api/kanban/:id`
- exposes `create(input)` calling `POST /api/projects/:projectId/kanban`

A desktop-equivalent hook SHALL exist in the Tauri binding directory with identical API shape, using `invoke()` and `listen('kanban://updates/:projectId')`.

#### Scenario: New card from agent appears without manual refresh
- **WHEN** pm-planner creates a card while the user is viewing the kanban overlay
- **THEN** the overlay shows the new card within 500 ms without any page interaction

### Requirement: KanbanOverlay accepts cards/onMove/onCreate without breaking existing callers

`packages/ui-office/src/components/kanban/KanbanOverlay.tsx` SHALL accept, in addition to existing props (e.g., `open`, `onClose`, `requestText?`):

- `cards?: KanbanCard[]`
- `onMove?: (id: string, next: KanbanState) => Promise<void>`
- `onCreate?: (input: { title: string; note?: string }) => Promise<void>`

When `cards` is undefined, the component SHALL fall back to its pre-change behaviour (current `requestText`-based stub) so existing callers in dist do not break.

`apps/web/src/components/app-shell/AppOverlayHost.tsx` SHALL pass `cards={stream.cards} onMove={stream.move} onCreate={stream.create}` from `useKanbanStream(activeProjectId)`.

#### Scenario: Existing caller without cards still renders
- **WHEN** `<KanbanOverlay open={true} onClose={...} requestText="..." />` is rendered without `cards`
- **THEN** no runtime error occurs and the overlay shows its pre-change stub state

#### Scenario: Live updates flow through to UI
- **WHEN** `cards` array is replaced with a longer array via SSE update
- **THEN** the board re-renders with the new card visible in its column without remounting

### Requirement: KanbanOverlay visual aligns with ocean-cyber DNA

The overlay container SHALL use the existing `.glass-panel` class (no new dark frosted-glass system introduced).

The drawer top edge SHALL render a 2 px gradient strip with `linear-gradient(90deg, var(--color-sea-blue), var(--color-kelp-green), var(--color-sea-blue))` and `box-shadow: 0 0 12px color-mix(in srgb, var(--color-sea-blue) 60%, transparent)`.

Origin pills SHALL use:
- `pm-planner` → background tinted with `var(--color-sea-blue)`
- `employee` → `var(--color-kelp-green)`
- `manager` → `var(--color-coral-orange)`
- `human` → `var(--color-foam)`

Cards SHALL use the `.glass-panel-sm` class (existing). Close button SHALL use `.cyber-button`. Spacing SHALL use `--sp-*` tokens (`p-sp-lg`, `gap-sp-md`, etc.). The component SHALL NOT introduce raw Tailwind values such as `bg-slate-900/85`, `p-3`, `gap-2`, or any wood/metal/chalk texture.

The backdrop scrim SHALL use `color-mix(in srgb, var(--color-abyss) 35%, transparent)` and SHALL NOT cover the left and right side rails.

#### Scenario: No raw spacing values in kanban tree
- **WHEN** `grep -rE 'className=.*\b(p-[0-9]|gap-[0-9]|space-[xy]-[0-9])' packages/ui-office/src/components/kanban` runs
- **THEN** the only matches are tokens of the form `p-sp-*` or `gap-sp-*`

#### Scenario: Origin pill colours match capability
- **WHEN** rendering 4 cards with origins `pm-planner`/`employee`/`manager`/`human`
- **THEN** each pill's computed background colour traces back to `--color-sea-blue` / `--color-kelp-green` / `--color-coral-orange` / `--color-foam` respectively

### Requirement: 3D scene throttles while kanban overlay is open

`apps/web/src/components/office-shell/OfficeSceneSurface.tsx` SHALL accept `paused?: boolean`. When `paused === true`, the surface SHALL forward `active={false}` to the underlying `SceneCanvas` (or call `setTargetFps(12)` if the scene exposes that API). When `paused === false`, the surface SHALL restore normal rendering.

`apps/web/src/components/app-shell/AppMainShell.tsx` SHALL pass `paused={officeState.kanbanOpen}` to `<OfficeSceneSurface>`.

If the underlying scene exposes neither `active` toggling nor `setTargetFps`, the prop SHALL be a no-op and a TODO comment SHALL document the gap — performance throttling is non-blocking for the RC.

#### Scenario: Opening kanban toggles paused
- **WHEN** the user presses ⌘J to open the kanban overlay
- **THEN** `OfficeSceneSurface` receives `paused: true` on next render

### Requirement: Per-employee kanban-count badge in office scene

`apps/web/src/components/office-shell/EmployeeBadgeOverlay.tsx` SHALL render, when count > 0, a small pill anchored to the top-right of the employee 3D label, showing the count of cards in `'todo'` or `'doing'` for that employee. The pill SHALL use `var(--color-kelp-green)` background and `var(--color-pearl)` (white) text.

`OfficeSceneSurface.tsx` SHALL mount one `<EmployeeBadgeOverlay employeeId={...} />` per visible employee.

#### Scenario: Zero cards hides badge
- **WHEN** an employee has no cards in `'todo'` or `'doing'`
- **THEN** no badge element is rendered for that employee
