## ADDED Requirements

### Requirement: Single EventBus subscriber for plan step state
The system SHALL have exactly one EventBus subscriber for `plan.created`, `plan.step.started`, `plan.step.completed`, `plan.completed`, `task.state.changed`, and `task.assignment.changed` events, managed by `usePlanStepStore`.

#### Scenario: Only one subscriber exists
- **WHEN** a `plan.step.started` event is emitted
- **THEN** exactly one event handler fires to update step state (not two or three independent handlers)

### Requirement: PlanStepStoreContext provides shared step state
`PlanStepStoreProvider` SHALL provide plan step state (planId, steps, currentStepIndex, isComplete, sopTemplateId, stats) via React Context, accessible by any descendant component.

#### Scenario: Multiple consumers read same state
- **WHEN** TaskDashboard and SopViewSurface both read plan step state
- **THEN** they observe identical `steps[].status` values at any point in time

### Requirement: useTaskDashboard consumes store instead of subscribing
`useTaskDashboard` SHALL read step state from `PlanStepStoreContext` and SHALL NOT subscribe to EventBus plan events directly. It MAY maintain local UI state (expanded, toggleStep) independently.

#### Scenario: Dashboard shows step status from store
- **WHEN** a plan step transitions to 'completed'
- **THEN** TaskDashboard and KanbanBoard both reflect 'completed' status without independent event processing

### Requirement: useSopRuntimeState derives from store
`useSopRuntimeState` SHALL read step state from `PlanStepStoreContext`, filter by `sopTemplateId`, and apply 3-second auto-clear after runtime stops. It SHALL NOT subscribe to EventBus events directly.

#### Scenario: SOP editor shows step progress
- **WHEN** a plan with matching `sopTemplateId` has step 0 active
- **THEN** `useSopRuntimeState` returns `[{ stepIndex: 0, status: 'active' }, ...]`

#### Scenario: Auto-clear after runtime stops
- **WHEN** runtime stops and 3 seconds elapse
- **THEN** `useSopRuntimeState` returns `null` (store retains data for dashboard)

### Requirement: Provider mounted inside OffisimRuntimeProvider
`PlanStepStoreProvider` SHALL be mounted as a child of `OffisimRuntimeProvider` so it has access to `eventBus`.

#### Scenario: Provider hierarchy
- **WHEN** any component calls `usePlanStepStore()`
- **THEN** it receives the store provided by the nearest `PlanStepStoreProvider` ancestor
