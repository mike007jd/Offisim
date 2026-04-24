# shared-types-event-domains Specification

## Purpose
Defines the domain-split shared event payload modules and thin barrel contract so runtime event types stay modular without changing external imports.
## Requirements
### Requirement: events.ts is a thin re-export barrel

`packages/shared-types/src/events.ts` SHALL contain no more than 60 non-blank, non-comment lines and SHALL consist entirely of `export * from './events/<domain>.js'` statements (plus any necessary imports for the barrel itself). Inline `export interface XPayload { ... }` declarations or type unions SHALL NOT live in this file.

#### Scenario: File size gate
- **WHEN** `grep -cvE '^\s*(//|$|/\*|\*)' packages/shared-types/src/events.ts` is run after refactor
- **THEN** the non-blank, non-comment line count is at most 60

#### Scenario: No inline payload declarations
- **WHEN** grepping `events.ts` for `^export interface \w+Payload`
- **THEN** zero matches exist — all payload interfaces live in `events/<domain>.ts`

### Requirement: Event payloads are split by event-prefix domain

Event payload interfaces and related types SHALL be split into one module per event-prefix domain in `packages/shared-types/src/events/`:

- `core.ts` — `RuntimeEvent<P>` envelope, `EventFamily` union, `RuntimeEntityType`-referencing base types
- `employee.ts` — `EmployeeStatePayload`
- `task.ts` — `TaskStatePayload`, `TaskAssignmentPayload`, `TaskAssignmentDispatchedPayload`, `TaskSubtaskProgressPayload`
- `meeting.ts` — `MeetingStatePayload`
- `llm.ts` — `LlmCallStartedPayload`, `LlmCallCompletedPayload`, `LlmUsageRecordedPayload`, `LlmStreamChunkPayload`
- `graph.ts` — `GraphNodeEnteredPayload`, `GraphNodeExitedPayload`
- `boss-route.ts` — `BossRouteAction`, `BossRouteDecidedPayload`
- `interaction.ts` — `InteractionRequestedPayload`, `InteractionResolvedPayload`, `InteractionRestoredPayload`, `InteractionModeChangedPayload`
- `handoff.ts` — `HandoffInitiatedPayload`, `HandoffCompletedPayload`
- `memory.ts` — `MemoryCreatedPayload` + any `memory.*` payloads
- `workspace.ts` — `WorkspaceStalenessDetectedPayload`, `GitAutoCommittedPayload`, `KnowledgeIndexCompletedPayload`
- `execution.ts` — `ExecutionResumedPayload`, `ErrorOccurredPayload`, `ExecutionAbortedPayload` (if present)
- `conversation.ts` — `ConversationSynopsisUpdatedPayload`, `ConversationCompactCompletedPayload`
- `deliverable.ts` — `DeliverableCreatedPayload`
- `plan.ts` — `PlanCreatedPayload`, `PlanStepCompletedPayload`
- `tool.ts` — `ToolExecutionTelemetryPayload`, `McpToolCalledPayload`
- `hr.ts` — `HrRecommendationPayload`
- `session.ts` — `SessionCostUpdatedPayload`

Each file SHALL be the single owner of the listed interfaces. A domain file MAY import from `core.ts` but SHALL NOT import from another domain file (unless a payload genuinely references another domain's type; such cross-references SHALL be documented in the file header comment).

#### Scenario: One file per domain
- **WHEN** listing `packages/shared-types/src/events/*.ts`
- **THEN** at least the 18 files listed above exist; any additional file SHALL correspond to a genuine new event domain

#### Scenario: Payload single-owner
- **WHEN** grepping `packages/shared-types/src/events/*.ts` for `^export interface \w+Payload`
- **THEN** each payload interface name appears in exactly one file

#### Scenario: Core envelope single-owner
- **WHEN** grepping `packages/shared-types/src/**/*.ts` for `export interface RuntimeEvent<`
- **THEN** exactly one match exists, inside `events/core.ts`

### Requirement: Public type surface is unchanged

Every event-related type that was exported from `@offisim/shared-types` (via either `import { X } from '@offisim/shared-types'` or `import { X } from '@offisim/shared-types/events'`) pre-change SHALL remain importable from the same module paths post-change. No consumer import SHALL break.

#### Scenario: Consumer import resolution
- **WHEN** running `pnpm typecheck` across all packages after the refactor
- **THEN** typecheck succeeds with zero errors — every existing `import type { XPayload }` resolves through the barrel

#### Scenario: Re-export parity
- **WHEN** comparing the sorted list of types reachable from `@offisim/shared-types` exports pre-change vs post-change
- **THEN** every pre-existing type name is still reachable (no removals)

### Requirement: Observable runtime behavior is unchanged after refactor

The refactor SHALL be type-only and SHALL NOT affect any runtime value, event payload shape, or compiled output size at production runtime. `pnpm build` and `pnpm typecheck` across all packages SHALL pass without error.

#### Scenario: Full-repo build parity
- **WHEN** running `pnpm build` after the refactor
- **THEN** all packages build successfully with zero errors, and the produced `.d.ts` files continue to export all pre-change types
