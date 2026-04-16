# plan-step-store

## Purpose

`PlanStepStoreProvider` (`packages/ui-office/src/hooks/plan-step-store.tsx`) owns the single copy of plan/step/task state derived from runtime events. `TaskDashboard`, `KanbanBoard`, `SopDagCanvas`, and any other consumer read step status via `usePlanStepStore()` — none of them subscribe to plan/task events directly. Other subscribers of the same events (e.g. 3D ceremony bubble in `useSceneOrchestrator`, activity feed in `use-runtime-activity-feed`) are independent concerns that do not maintain step state.

## Requirements

### Requirement: Single subscriber for plan step state
`PlanStepStoreProvider` SHALL be the only subscriber that consumes `plan.created` / `plan.step.started` / `plan.step.completed` / `plan.completed` / `task.state.changed` / `task.assignment.changed` for the purpose of maintaining plan step state. Other subscribers MAY listen to these events for unrelated concerns (scene bubble text, activity feed).

#### Scenario: Only one step-state subscriber
- **WHEN** a `plan.step.started` event is emitted
- **THEN** exactly one handler updates plan step state — the one inside `PlanStepStoreProvider`

### Requirement: PlanStepStoreContext provides shared step state
`PlanStepStoreProvider` SHALL provide plan step state (`planId`, `steps`, `currentStepIndex`, `isComplete`, `sopTemplateId`, `stats`) via React Context, accessible by any descendant component.

#### Scenario: Multiple consumers read same state
- **WHEN** TaskDashboard and SopViewSurface both read plan step state
- **THEN** they observe identical `steps[].status` values at any point in time

### Requirement: useTaskDashboard consumes store instead of subscribing
`useTaskDashboard` SHALL read step state from `PlanStepStoreContext` and SHALL NOT subscribe to EventBus plan events directly. It MAY maintain local UI state (`expanded`, `toggleStep`) independently.

#### Scenario: Dashboard shows step status from store
- **WHEN** a plan step transitions to `'completed'`
- **THEN** TaskDashboard and KanbanBoard both reflect `'completed'` status without independent event processing

### Requirement: useSopRuntimeState derives from store
`useSopRuntimeState` SHALL read step state from `PlanStepStoreContext`, filter by `sopTemplateId`, and apply a 3-second auto-clear after runtime stops. It SHALL NOT subscribe to EventBus events directly.

#### Scenario: SOP editor shows step progress
- **WHEN** a plan with matching `sopTemplateId` has step 0 active
- **THEN** `useSopRuntimeState` returns `[{ stepIndex: 0, status: 'active' }, ...]`

#### Scenario: Auto-clear after runtime stops
- **WHEN** runtime stops and 3 seconds elapse
- **THEN** `useSopRuntimeState` returns `null` (store retains data for dashboard)

### Requirement: Provider mounted inside runtime + company providers
`PlanStepStoreProvider` SHALL be mounted as a descendant of both `OffisimRuntimeProvider` (for `eventBus`) and `CompanyProvider` (for `useAgentStates` → `useCompany`).

#### Scenario: Provider hierarchy
- **WHEN** any component calls `usePlanStepStore()`
- **THEN** it receives the store provided by the nearest `PlanStepStoreProvider` ancestor

#### Scenario: Provider requires company context
- **WHEN** `PlanStepStoreProvider` renders
- **THEN** it is wrapped by `CompanyProvider` / `CompanyBridge`, so its internal `useAgentStates()` call can read `useCompany()` without error
