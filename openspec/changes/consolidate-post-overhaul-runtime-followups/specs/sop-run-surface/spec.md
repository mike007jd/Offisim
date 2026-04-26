## ADDED Requirements

### Requirement: `step_dispatcher` MUST not redispatch a step after `step.completed`

The LangGraph `step_dispatcher` node SHALL treat `step.completed` (and equivalent terminal step state — `failed` / `cancelled`) as a hard short-circuit: once a step is in a terminal state for the current plan, the dispatcher MUST NOT route execution back to that step's employee node within the same plan instance, regardless of routing edge or recursion depth.

The `routeFromStepDispatcher` and `routeFromStepAdvance` edges SHALL agree on terminal step state via a single source of truth (the planStep store / plan state), not derived independently. Any disagreement is a bug.

When all plan steps reach a terminal state, the dispatcher SHALL route to `boss_summary` (or the equivalent plan-completion sink), never back to itself.

#### Scenario: Completed step does not redispatch

- **WHEN** a SOP plan executes a step `S1`, `S1` reaches `completed`, and the dispatcher is invoked again on the same plan
- **THEN** the dispatcher routes to the next unblocked step (or `boss_summary` if none remain), and never to `S1`

#### Scenario: All terminal steps route to boss_summary

- **WHEN** every step in the active plan is in a terminal state (`completed` / `failed` / `cancelled`)
- **THEN** `step_dispatcher` routes to `boss_summary` exactly once, with no further self-loops

#### Scenario: Mixed terminal + pending plan finds the pending step

- **WHEN** the plan has 1 `completed` step + 1 `pending` step whose dependencies are now satisfied
- **THEN** the dispatcher routes to the pending step's employee node, not back to `step_dispatcher` and not to the completed step

### Requirement: dispatcher recursion entry SHALL be observable

LangGraph dispatcher recursion limit (currently 25) hits SHALL emit an explicit `runtime_event` of `event_type='sop.dispatcher.recursion_limit'` with payload containing `{ planId, stepCount, completedSteps, pendingSteps, recursionDepth }` so future recurrences are diagnosable without re-running the SOP. The event SHALL be emitted before the limit-hit error is thrown, not after.

This requirement is **observability-only** — it does not change recursion limit behavior or fix root causes. It exists so that if a future SOP shape regresses dispatcher convergence, the diagnostic data is captured at the failure boundary.

#### Scenario: Recursion limit hit emits diagnostic event

- **WHEN** the dispatcher's recursion depth reaches the LangGraph limit during plan execution
- **THEN** a `sop.dispatcher.recursion_limit` event is emitted to the runtime event bus with `planId`, `stepCount`, terminal-step list, pending-step list, and current recursion depth, before the limit-hit error propagates to the caller
