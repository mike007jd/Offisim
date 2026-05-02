## ADDED Requirements

### Requirement: `sanitizePlanEmployees` SHALL emit observable rebind events with planner-recommended fallback ordering

`packages/core/src/agents/pm-planner/plan-persistence.ts::sanitizePlanEmployees` SHALL, whenever it swaps a planned `task.employeeId` for a different valid employee, emit a `task.assignment.rerouted` event (see `interaction-modes` spec for the event contract) with `source: 'pm-planner'` and one of:
- `reason: 'employee-not-found'` — the original employee id does not exist (or is not in `validEmployeeIds`)
- `reason: 'employee-disabled'` — the original employee exists but `enabled !== 1`
- `reason: 'no-recommendation-fallback'` — neither of the above; the swap is purely a fallback because the plan provided no `recommendedEmployees` ordering

The fallback selection SHALL prefer the first employee in the plan's `recommendedEmployees` ordering that is also in `validEmployees`. If `recommendedEmployees` is missing or empty, the swap SHALL use `validEmployees[0]` (existing behavior) AND emit the event with `reason: 'no-recommendation-fallback'` so the operator can see the silent ordering dependency.

A logger.info entry with the same field set SHALL accompany the event so headless runs surface the rebind.

The barrel-size invariant from the existing spec (`pmPlannerNode is a thin pipeline barrel`, ≤150 NBNC) SHALL still hold after this change. If the new event-emission logic pushes `plan-persistence.ts` past its current responsibilities, the work SHALL go into a new sibling helper (e.g. `pm-planner/sanitize-rebind.ts`) rather than inline in `plan-persistence.ts`.

#### Scenario: Missing employee swap emits event with planner-recommended fallback
- **WHEN** `sanitizePlanEmployees` processes a plan task whose `employeeId` does not exist in `validEmployeeIds`
- **AND** the plan provides `recommendedEmployees: ['emp-recommended', 'emp-other']` and both are valid
- **THEN** the resolved task `employeeId` is `'emp-recommended'` (NOT `validEmployees[0]`)
- **AND** a `task.assignment.rerouted` event fires with `source: 'pm-planner'`, `reason: 'employee-not-found'`, `requestedEmployeeId` of the missing id, `resolvedEmployeeId: 'emp-recommended'`

#### Scenario: No recommendation falls back to first valid with explicit reason
- **WHEN** `sanitizePlanEmployees` swaps a missing employee and the plan has no `recommendedEmployees`
- **THEN** the resolved id is `validEmployees[0]`
- **AND** the emitted event has `reason: 'no-recommendation-fallback'` so downstream tooling can flag the silent ordering dependency

#### Scenario: Disabled employee swap reports disabled reason
- **WHEN** `sanitizePlanEmployees` encounters an `employeeId` that exists but has `enabled !== 1`
- **THEN** the swap occurs AND the event reason is `'employee-disabled'` (NOT `'employee-not-found'`)

#### Scenario: Valid plan task does not emit event
- **WHEN** `sanitizePlanEmployees` processes a plan task whose `employeeId` is in `validEmployeeIds` and enabled
- **THEN** no `task.assignment.rerouted` event fires for that task and no logger entry is written
