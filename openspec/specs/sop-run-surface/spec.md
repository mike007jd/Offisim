# sop-run-surface Specification

## Purpose

Visualization contract for an in-flight or just-finished SOP run inside the SOP
workspace. Owns the in-canvas presentation of step status (including
`'failed'`), edge flow, the run-progress strip, the failure-reason inspector
section, and the persistent missing-role warning chip. Reads exclusively from
`usePlanStepStore` / `useSopRuntimeState` / `useAgentStates`; introduces no new
event types, repo methods, schema columns, tables, or dispatch paths. The Run
action remains a single `sendMessage(formatRunCommand(name))` call through the
existing PM planner / Boss / dispatcher pipeline.

## Requirements

### Requirement: Run progress strip surfaces the in-flight run

The SOP workspace SHALL render a run-progress strip between `SopLibraryBar` and `SopDagCanvas` whenever a plan whose `sopTemplateId` matches the currently selected SOP is in flight or has finished within the last 3 seconds. The strip SHALL surface: a running indicator (pulse dot), the current step's label, a `step N of M` counter, and a `<completed>/<total>` task tally. It MUST NOT be a toast or modal — it lives in the same column as the canvas and persists across pan / zoom / selection.

#### Scenario: Run starts and strip mounts
- **WHEN** the user clicks Run on a SOP and the dispatched plan emits `plan.created` with a matching `sopTemplateId`
- **THEN** the strip mounts above the canvas with the running indicator pulsing, current step label = the first step's label (or empty until `plan.step.started` arrives), counter `step 1 of N`, task tally `0/<total>`

#### Scenario: Strip updates as steps progress
- **WHEN** `plan.step.started` fires for step index 2 of 5
- **THEN** the strip updates to `step 3 of 5` (1-indexed display) with the step's label

#### Scenario: Run completes, strip enters "just finished" mode
- **WHEN** `plan.completed` fires
- **THEN** the strip stops pulsing, the running indicator becomes a static check or cross (depending on whether any step ended `'failed'`), and the strip remains visible for 3 seconds before unmounting

#### Scenario: Strip auto-clears after run completion
- **WHEN** 3 seconds have elapsed since `plan.completed` (or `useSopRuntimeState` returned `null`)
- **THEN** the strip unmounts and the canvas reclaims the vertical space

#### Scenario: Strip is scoped to the selected SOP
- **WHEN** a plan is in flight whose `sopTemplateId` does not match `selectedSop.sopTemplateId`
- **THEN** the strip does NOT mount on the current SOP view (the run is visible in chat / Tasks / Activity, but the SOP surface is silent)

### Requirement: Step-level failure surfaces on the graph

When `useSopRuntimeState` returns a step with `status === 'failed'`, the corresponding `SopDagNode` SHALL render a `failed` chip beside the role badge in addition to the existing red status dot. The chip styling MUST be visually distinct from the role badge (red background, white text) and short ("failed", not the error description).

#### Scenario: Failed step gets a red chip
- **WHEN** runtime state for step `s2` is `{ stepIndex: 2, status: 'failed' }`
- **THEN** the node for step `s2` renders a `failed` chip beside its role badge AND the existing `STATUS_DOT.failed` red dot

#### Scenario: Failed chip clears when step is no longer failed
- **WHEN** the runtime store reverts step `s2` to `'pending'` (e.g. retry after a transient failure)
- **THEN** the `failed` chip on `s2`'s node disappears on the next render; the dot reverts to its mapped color

### Requirement: Inspector surfaces the failure reason

When the selected step's `status === 'failed'`, `SopInspectorPanel` SHALL render a "Last error" section showing the `taskType` and `description` of the most recent failed task on that step. The section MUST appear above the existing "Status" / "Instruction" rows so it cannot be missed. When the step is not `'failed'`, the section MUST NOT render.

#### Scenario: Failed step shows last-error section
- **WHEN** the selected step's runtime status is `'failed'` and its most recent `'failed'` / `'cancelled'` task is `{ taskType: 'analysis', description: 'Skill not found: forecast' }`
- **THEN** the inspector renders a "Last error" row with heading `analysis` and body `Skill not found: forecast`, styled in red

#### Scenario: Successful or pending step has no last-error section
- **WHEN** the selected step's runtime status is `'pending'`, `'active'`, or `'completed'`
- **THEN** the "Last error" section does NOT render

#### Scenario: Inspector falls back when step has no failed tasks
- **WHEN** a step is `'failed'` because of derivation from terminal cancellation (no failed task, only cancelled tasks)
- **THEN** the "Last error" section heading reflects the cancelled task and the body reads its description; if both are empty strings, the body reads `(no detail provided)` placeholder

### Requirement: Persistent missing-role warning on the graph

The SOP workspace SHALL display a persistent missing-role warning chip on every node whose `step.role_slug` is not present in the live employee roster (`useAgentStates` map values' `role` field). The chip MUST update reactively as employees are created / deleted / role-edited, NOT only on Run click. The pre-existing one-shot `addToast` warning inside `handleRun` SHALL be removed.

#### Scenario: Node with unfilled role gets a warning chip
- **WHEN** `definition.steps` contains a step with `role_slug = 'qa'` and no employee in the active company has `role === 'qa'`
- **THEN** the node renders a `⚠ no qa` chip beside its role badge in amber

#### Scenario: Warning clears when an employee fills the role
- **WHEN** an employee is created (or has their role edited to) `role = 'qa'`
- **THEN** the `⚠ no qa` chip on every affected node disappears on the next render

#### Scenario: Inspector mirrors the warning
- **WHEN** the selected step's role is missing
- **THEN** the inspector renders a "Role gap" warning row (amber) under the "Role" row reading `No employee with this role; the dispatcher will fall back to any available employee`

#### Scenario: Run click no longer toasts about missing roles
- **WHEN** the user clicks Run while one or more steps have role gaps
- **THEN** the persistent on-graph chip continues to communicate the gap; NO toast fires; the Run dispatch proceeds (the runtime fallback behavior is preserved)

### Requirement: Edge animation respects upstream failure

`SopDagEdge` SHALL animate its flowing-dot motion only when the edge's resolved status is `'active'` AND the upstream step is not `'failed'`. When the upstream step is `'failed'`, the edge SHALL render in the failed (red) stroke style and MUST NOT animate, because the downstream cannot run.

#### Scenario: Edge below failed step is short-circuited red
- **WHEN** step `s1` is `'failed'` and edge `s1 → s2` exists
- **THEN** the edge `s1 → s2` renders with red stroke and no animation regardless of `s2`'s status

#### Scenario: Edge below active step keeps flowing
- **WHEN** step `s1` is `'active'` and edge `s1 → s2` exists
- **THEN** the edge animates per the existing E1 contract (blue stroke, motion dot)

#### Scenario: Edge below completed step is solid emerald
- **WHEN** step `s1` is `'completed'` and edge `s1 → s2` exists
- **THEN** the edge renders solid emerald, no animation

### Requirement: Surface boundary against dispatch and persistence

This capability SHALL NOT introduce new event types, new repo methods, new schema columns, or new tables. The Run action MUST continue to dispatch via `sendMessage(formatRunCommand(name))` through the PM planner / Boss / dispatcher pipeline. All run-status reads MUST flow through `usePlanStepStore` / `useSopRuntimeState`. The persistent on-graph state MUST NOT diverge from the store — there is no parallel UI state of "what the SOP run looks like."

#### Scenario: Run dispatch path unchanged
- **WHEN** the user clicks Run on the SOP toolbar
- **THEN** `sendMessage(formatRunCommand(selectedSop.name))` is the only dispatch call; no new event is published; no new repo write occurs from this capability

#### Scenario: No new persistent storage for run state
- **WHEN** any run-related visual state is rendered (progress strip, failed chip, role gap chip, inspector last-error)
- **THEN** the source is one of: `usePlanStepStore` (plan / step / task derived state), `useSopRuntimeState` (filtered view), `useAgentStates` (employee map), or the parsed `definition_json` already in scope; NO additional API or table is queried

#### Scenario: Run history is out of scope
- **WHEN** the user wants to inspect previous runs of the SOP
- **THEN** the SOP surface defers to existing surfaces (Activity Feed, chat thread); this capability does NOT add a SOP-scoped history list

