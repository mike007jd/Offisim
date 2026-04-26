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
`useTaskDashboard` SHALL read step state from `PlanStepStoreContext` and SHALL NOT subscribe to EventBus plan events directly. It MAY maintain local UI state (`expanded`, `toggleStep`) independently. Consumers SHALL handle the full `PlanStep.status` union, including the newly added `'failed'` value.

#### Scenario: Dashboard shows step status from store
- **WHEN** a plan step transitions to `'completed'`
- **THEN** TaskDashboard and KanbanBoard both reflect `'completed'` status without independent event processing

#### Scenario: Dashboard handles 'failed' step status
- **WHEN** a plan step is derived to `'failed'`
- **THEN** TaskDashboard and KanbanBoard render the step in a failed visual state (red accent or analogous to the existing per-task failed treatment) without subscribing to additional events

### Requirement: useSopRuntimeState derives from store
`useSopRuntimeState` SHALL read step state from `PlanStepStoreContext`, filter by `sopTemplateId`, and apply a 3-second auto-clear after runtime stops. It SHALL NOT subscribe to EventBus events directly. Its returned `SopRuntimeStepState.status` union (`'pending' | 'active' | 'completed' | 'failed'`) MUST match the store's `PlanStep.status` union exactly — `'failed'` is a real value once derivation lands, not a vacant branch.

#### Scenario: SOP editor shows step progress
- **WHEN** a plan with matching `sopTemplateId` has step 0 active
- **THEN** `useSopRuntimeState` returns `[{ stepIndex: 0, status: 'active' }, ...]`

#### Scenario: Auto-clear after runtime stops
- **WHEN** runtime stops and 3 seconds elapse
- **THEN** `useSopRuntimeState` returns `null` (store retains data for dashboard)

#### Scenario: Failed step propagates through filter
- **WHEN** a step in the matching plan is derived to `'failed'`
- **THEN** `useSopRuntimeState` returns the step with `status: 'failed'`; consumers (e.g. `SopDagNode`, `SopInspectorPanel`) receive the real value, not `'pending'`

### Requirement: Provider mounted inside runtime + company providers
`PlanStepStoreProvider` SHALL be mounted as a descendant of both `OffisimRuntimeProvider` (for `eventBus`) and `CompanyProvider` (for `useAgentStates` → `useCompany`).

#### Scenario: Provider hierarchy
- **WHEN** any component calls `usePlanStepStore()`
- **THEN** it receives the store provided by the nearest `PlanStepStoreProvider` ancestor

#### Scenario: Provider requires company context
- **WHEN** `PlanStepStoreProvider` renders
- **THEN** it is wrapped by `CompanyProvider` / `CompanyBridge`, so its internal `useAgentStates()` call can read `useCompany()` without error

### Requirement: Step-level failure derived from terminal task state

`PlanStepStoreProvider` SHALL derive `PlanStep.status === 'failed'` from task-level events. The derivation runs inside the existing `task.state.changed` and `plan.step.completed` event handlers — NO new event subscription, NO new wire payload, NO new repo write. The rule:

- A step transitions to `'failed'` ONLY when (a) it is not currently `'active'`, AND (b) at least one task on the step is in a terminal-failure state (`'failed'` or `'cancelled'`), AND (c) no task on the step is in any non-terminal state (`'planned'` / `'queued'` / `'running'`), AND (d) no task on the step has reached `'completed'`.
- A step that is `'failed'` SHALL revert to `'pending'` if any task on it transitions back to a non-terminal state (e.g. via dispatcher retry).
- The derivation MUST preserve the canonical "single subscriber" rule — it operates on the existing handlers and does not register a new listener.

The exposed `PlanStep.status` union is widened from `'pending' | 'active' | 'completed'` to `'pending' | 'active' | 'completed' | 'failed'` to reflect this capability.

#### Scenario: Step with all tasks failed becomes 'failed'
- **WHEN** a step has two tasks, both transition to `'failed'`, no task is in a non-terminal or `'completed'` state, and the step's last `plan.step.started` was followed by no `plan.step.completed` for it
- **THEN** the store reports the step's status as `'failed'`

#### Scenario: Step with mixed terminal task outcomes ignores 'failed' rollup
- **WHEN** a step has one `'failed'` task and one `'completed'` task
- **THEN** the step's status remains the existing rollup (`'completed'` once `plan.step.completed` arrives, `'active'` while one task is still running, etc.); the step is NOT marked `'failed'`

#### Scenario: Active step is not eagerly marked failed
- **WHEN** a step is currently `'active'` and one of its tasks transitions to `'failed'` while another task is still `'running'`
- **THEN** the step's status remains `'active'`; the rollup waits until no non-terminal task remains

#### Scenario: Retried task reverts step from failed to pending
- **WHEN** a step is `'failed'` and the dispatcher retries one of its tasks, transitioning that task from `'failed'` back to `'queued'`
- **THEN** the store reverts the step's status to `'pending'` (or `'active'` once `plan.step.started` re-fires)

#### Scenario: useSopRuntimeState exposes 'failed' to consumers
- **WHEN** a step is derived to `'failed'` and `useSopRuntimeState(sopTemplateId)` is called by the SOP surface
- **THEN** the returned array contains `{ stepIndex, status: 'failed' }` for that step

