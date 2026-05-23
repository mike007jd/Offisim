## ADDED Requirements

### Requirement: SOP run request carries typed SOP identity
When a SOP run is invoked, the runtime request SHALL carry `sopTemplateId`, active company id, active thread id or conversation key, and a stable SOP definition/version snapshot reference. The displayed user/chat text MAY include the SOP name, but dispatch MUST NOT rely on name-only text parsing.

#### Scenario: Run includes sopTemplateId
- **WHEN** the user invokes Run for SOP `sop_123`
- **THEN** the runtime request SHALL include `sopTemplateId = 'sop_123'`
- **AND** the PM planner SHALL resolve the SOP from typed metadata before considering free-text command parsing

#### Scenario: Duplicate names remain unambiguous
- **WHEN** two SOP templates have the same name
- **AND** the user runs one selected SOP by id
- **THEN** the runtime SHALL use the selected SOP id
- **AND** it SHALL NOT pick another SOP by matching name text

## MODIFIED Requirements

### Requirement: Surface boundary against dispatch and persistence

This capability SHALL introduce typed SOP run metadata but SHALL preserve Boss / PM planner / dispatcher ownership of execution. The Run action MUST dispatch through the existing runtime send-message path with structured metadata that includes `sopTemplateId` and a SOP definition/version snapshot reference. The Run action MUST NOT rely solely on `sendMessage(formatRunCommand(selectedSop.name))` for runtime semantics.

All run-status reads MUST flow through `usePlanStepStore` / `useSopRuntimeState`. The persistent on-graph state MUST NOT diverge from the store — there is no parallel UI state of "what the SOP run looks like."

#### Scenario: Run dispatch carries structured metadata
- **WHEN** the user clicks Run on the SOP toolbar
- **THEN** the dispatch call includes typed SOP metadata with `sopTemplateId`
- **AND** chat-facing text is treated as display/context, not as the only source of SOP identity

#### Scenario: No new persistent storage for run state
- **WHEN** any run-related visual state is rendered (progress strip, failed chip, role gap chip, inspector last-error)
- **THEN** the source is one of: `usePlanStepStore` (plan / step / task derived state), `useSopRuntimeState` (filtered view), `useAgentStates` (employee map), or the parsed `definition_json` already in scope; NO additional API or table is queried

#### Scenario: Run history is out of scope
- **WHEN** the user wants to inspect previous runs of the SOP
- **THEN** the SOP surface defers to existing surfaces (Activity Feed, chat thread); this capability does NOT add a SOP-scoped history list
