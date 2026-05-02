# pm-planner-node-boundaries

## Purpose

`packages/core/src/agents/pm-planner-node.ts` is the LangGraph PM planner node — translates `managerDirective.intent` into a `TaskPlan` via SOP matching (explicit or substring), LLM plan generation, optional human-in-loop plan-review, then plan persistence. Pre-refactor (Round 2) it was a single 689-line function that inlined preflight + prompt assembly + LLM call + SOP match + plan parse + plan-review interaction + plan persistence + event emission. This spec nails down the post-refactor decomposition so future edits keep each stage single-owner and the barrel thin.
## Requirements
### Requirement: pmPlannerNode is a thin pipeline barrel

`packages/core/src/agents/pm-planner-node.ts` SHALL contain no more than 150 non-blank, non-comment lines and SHALL only: (a) import sibling modules from `agents/pm-planner/`, (b) sequence the pipeline stages (preflight → SOP try → LLM plan if no SOP → plan-review-gate → plan-persistence), (c) re-export the public helpers (`PM_SYSTEM_PROMPT`, `parsePmPlan`, `matchSopTemplate`, `findEmployeeForRole`, `sopBatchesToLlmPlan`, `tryBuildSopPlan`, `LlmPlanStep`). Inline LLM call bodies, prompt string assembly, SOP matching logic, plan parsing, or plan persistence SHALL NOT live in this file.

#### Scenario: File size gate
- **WHEN** `grep -cvE '^\s*(//|$|/\*|\*)' packages/core/src/agents/pm-planner-node.ts` is run after refactor
- **THEN** the non-blank, non-comment line count is at most 150

#### Scenario: Public helpers re-exported
- **WHEN** comparing `grep '^export' packages/core/src/agents/pm-planner-node.ts` pre-change vs post-change
- **THEN** every pre-existing export name (`PM_SYSTEM_PROMPT`, `parsePmPlan`, `matchSopTemplate`, `findEmployeeForRole`, `sopBatchesToLlmPlan`, `tryBuildSopPlan`, `LlmPlanStep`, `pmPlannerNode`) is still exported

### Requirement: PM planner sibling modules are one-responsibility-per-file

The 6 sibling modules SHALL live in `packages/core/src/agents/pm-planner/`:

- `preflight.ts` — read graph state, enumerate employee roster via `buildEnrichedEmployeeList`, extract user intent, validate boundary conditions (empty roster / no user message), return either `{ kind: 'ready', intent, roster, ... }` or `{ kind: 'short-circuit', result }`
- `prompt-assembly.ts` — hold `PM_SYSTEM_PROMPT` constant + construct the user prompt body (intent + roster summary + SOP templates hint)
- `plan-parser.ts` — export `LlmPlanStep` interface and `parsePmPlan(content): LlmPlan | null` with its schema / fallback handling
- `sop-matching.ts` — export `matchSopTemplate`, `findEmployeeForRole`, `sopBatchesToLlmPlan`, `tryBuildSopPlan`
- `plan-persistence.ts` — construct `TaskPlan` / `PlanStep[]` / `PlanTask[]` and persist via runtime repos + emit `planCreated`
- `plan-review-gate.ts` — `awaitPlanReview(plan, state, config)` handling `PLAN_REVIEW_REQUIRED` interaction trigger and async resolution

Each sibling SHALL be the single owner of its listed responsibility. The barrel SHALL import from each but siblings SHALL NOT import each other.

#### Scenario: One file per sibling
- **WHEN** listing `packages/core/src/agents/pm-planner/*.ts`
- **THEN** exactly these 6 files exist

#### Scenario: No cross-sibling imports
- **WHEN** grepping `packages/core/src/agents/pm-planner/*.ts` for `from '\\./(preflight|prompt-assembly|plan-parser|sop-matching|plan-persistence|plan-review-gate)'`
- **THEN** zero matches exist

#### Scenario: Single owner of PM_SYSTEM_PROMPT
- **WHEN** grepping `packages/core/src/agents/**/*.ts` for `PM_SYSTEM_PROMPT\s*=`
- **THEN** exactly one match exists, inside `agents/pm-planner/prompt-assembly.ts`

### Requirement: PM planner observable behavior is unchanged after refactor

For identical graph state input (same user message, roster, SOP templates), the planner SHALL produce byte-identical: plan generation path selection (SOP-first, LLM-fallback), `plan.created` event payload, plan review interaction trigger, plan persistence side-effects.

#### Scenario: SOP plan path preserved
- **WHEN** the graph state contains a user intent that matches a configured SOP template
- **THEN** `tryBuildSopPlan` returns the same plan as pre-refactor and no LLM call is made

#### Scenario: LLM plan fallback path preserved
- **WHEN** no SOP matches
- **THEN** `parsePmPlan(llmResponseContent)` produces the same plan steps as pre-refactor, and `planCreated` event is emitted with byte-identical payload (summary / steps / step count)

#### Scenario: Plan review gate preserved
- **WHEN** `state.mode === 'plan-review'` and a plan is produced
- **THEN** `PLAN_REVIEW_REQUIRED` interaction is emitted and the async resolution flow matches pre-refactor

### Requirement: Main-graph consumer is unchanged

`packages/core/src/graph/main-graph.ts` SHALL continue to import `pmPlannerNode` from its current module path without modification. `packages/core/src/index.ts` re-exports SHALL NOT be removed.

#### Scenario: Main-graph import path unchanged
- **WHEN** comparing `grep "import.*pmPlannerNode" packages/core/src/graph/main-graph.ts` pre-change vs post-change
- **THEN** the import path is byte-identical

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
