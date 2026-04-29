# kanban-data-pipeline Specification

## Purpose

Defines kanban card persistence and state transitions created by PM planning and employee execution.

## Requirements

### Requirement: Kanban cards SHALL enforce a state transition whitelist

Kanban persistence SHALL reject invalid state transitions instead of blindly updating the card state.

Allowed transitions are:

- `todo` -> `doing`, `blocked`, `review`, `done`
- `doing` -> `todo`, `blocked`, `review`, `done`
- `blocked` -> `todo`, `doing`, `review`
- `review` -> `doing`, `blocked`, `done`
- `done` -> no outward transitions

#### Scenario: Done card cannot return to todo

- **WHEN** a kanban card is already in `done`
- **AND** a caller requests transition to `todo`
- **THEN** the repository rejects the transition
- **AND** the card remains `done`.

### Requirement: Employee completion SHALL reflect completion truth on kanban cards

Employee completion SHALL move linked kanban cards to `done` only when completion verification succeeds. If verifier blocks completion, linked cards SHALL move to `review` with the blocked reason.

#### Scenario: Verifier-blocked task moves card to review

- **WHEN** an employee response lacks accepted verification evidence
- **THEN** the task run is persisted as `blocked`
- **AND** the linked kanban card transitions to `review`
- **AND** the card records the verifier-blocked reason.

### Requirement: Kanban event assertions SHALL include transition details

Deterministic harness assertions for kanban event order SHALL be able to verify operation, state, card identity when required, and blocked reason when required. Assertions SHALL NOT pass only because an `op:state` string was emitted.

#### Scenario: Event sequence checks blocked reason

- **WHEN** a kanban transition is expected to be blocked or review-ready
- **THEN** the deterministic harness can assert the emitted `blocked_reason` value.
