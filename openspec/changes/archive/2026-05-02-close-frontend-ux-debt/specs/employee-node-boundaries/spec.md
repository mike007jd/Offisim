## MODIFIED Requirements

### Requirement: Observable behavior is unchanged after refactor

For identical input (same `OffisimGraphState`, same RuntimeContext, same provider / model, same task description), the user-visible behavior SHALL be byte-identical before and after the refactor across event sequence, event payload keys, `conversationHistory` shape per round, `Partial<OffisimGraphState>` return fields, and `Command` goto / update payload for handoff — **except for the two additive fields `isExternal: boolean` and `brandKey: string | null` that this change adds to every `StepTaskOutput` (and therefore to `currentStepOutputs[]` entries pushed by handoff and to `DeliverableCreatedPayload.contributingEmployees[]`).**

The additive fields are required (non-optional) on the new `StepTaskOutput` shape; pre-change consumers SHALL receive them filled from the employee row's `is_external` / `brand_key`. The legacy four-field shape (`employeeId` / `employeeName` / `sourceKind` / `roleSlug`) remains exactly as before; nothing is renamed or removed.

#### Scenario: Normal task event sequence
- **WHEN** a normal task (`buildSomething` with no handoff, no recovery) is executed
- **THEN** the EventBus emits the same ordered sequence of `graph.node.entered` + `employee.state.changed` + `task.state.changed` + `task.subtask.progress` + `llm.stream.chunk*` + `task.assignment.changed` + optional `deliverable.created` as pre-refactor, verifiable by a pre/post Playwright live capture
- **AND** any emitted `deliverable.created` event carries `contributingEmployees[]` whose elements include the new `isExternal` + `brandKey` fields populated from the producing employee's row

#### Scenario: Handoff Command payload preserved (with additive fields)
- **WHEN** a handoff_to tool call fires
- **THEN** the returned `Command({ goto: 'employee', update })` has `update.pendingAssignments[0]` equal to `{ taskType: 'handoff_continuation', employeeId: args.targetEmployeeId, inputJson: { description: args.remainingWork, priorWork: args.completedWork, handoffReason: args.reason, taskRunId: newTaskRunId } }`, `update.handoffCount = state.handoffCount + 1`, and `update.currentStepOutputs` appends `{ employeeId, employeeName, sourceKind: 'employee', roleSlug, content: args.completedWork, taskRunId, isExternal, brandKey }` where `isExternal` and `brandKey` are derived from the handing-off employee's row (`is_external === 1` → `true`; `brand_key` passes through verbatim or `null`)
- **AND** all other fields are byte-identical to pre-refactor

#### Scenario: Citation extraction unchanged
- **WHEN** `extractUsedCitations(responseText, citationMap)` is called with the same inputs pre-refactor and post-refactor
- **THEN** the returned array of `CitationRef` is equal (same indices, same order preserved from `citationMap`)

## ADDED Requirements

### Requirement: Deliverable event carries contributor brand fields across all emit sites

When a materialized deliverable produces a `deliverable.created` event from any of the three emit sites (`boss-summary-node.emitDeliverable`, `employee-completion.ts` direct artifact emit, or `employee-a2a-executor.ts` direct artifact emit), the event payload's `contributingEmployees[]` SHALL include the new `isExternal` + `brandKey` fields for every contributor element, populated from the producing employee's row (`is_external` mapped to `boolean`; `brand_key` passing through verbatim or `null`).

#### Scenario: boss-summary multi-contributor emit carries fields
- **WHEN** the boss summary aggregates multiple `currentStepOutputs` into a single `deliverable.created`
- **THEN** every element in the emitted `contributingEmployees[]` carries `isExternal` + `brandKey` derived from the corresponding `StepTaskOutput`

#### Scenario: employee-completion direct artifact emit carries fields
- **WHEN** `employee-completion.ts` emits `deliverable.created` directly for a materialized artifact (bypassing boss-summary)
- **THEN** the single contributor element carries `isExternal` + `brandKey` derived from the producing employee's row

#### Scenario: employee-a2a-executor direct artifact emit carries fields
- **WHEN** `employee-a2a-executor.ts` emits `deliverable.created` directly for an external A2A artifact (bypassing boss-summary)
- **THEN** the single contributor element carries `isExternal: true` + `brandKey` from the external A2A employee's row (a registered brand key, or `null` for unknown / custom external)
