# long-running-runtime Specification

## Purpose

Defines long-running graph execution invariants for Offisim employee work, especially completion truth, blocked work propagation, stale checkpoint isolation, and deterministic harness coverage.

## Requirements

### Requirement: Boss summary SHALL NOT mark empty or blocked work as completed

Boss summary SHALL mark a thread completed only when the active plan has terminal success for all steps. Empty employee outputs, pending steps, blocked steps, or stale checkpoint state SHALL keep the thread non-completed and expose an actionable interruption reason.

#### Scenario: Empty stale plan output is not completed

- **WHEN** boss summary receives no employee output while the active plan still has pending or blocked work
- **THEN** the thread remains non-completed
- **AND** the final response does not use the fallback `Task processing complete.` copy.

#### Scenario: Idle thread with no plan is not fake-completed

- **WHEN** boss summary runs without an executable plan and without employee output
- **THEN** it reports that no executable work was completed
- **AND** it does not mutate thread status to completed.

### Requirement: Blocked steps SHALL remain separate from completed steps

Step advancement SHALL treat completed and blocked task runs as different terminal states. A blocked task run SHALL add its step index to `blockedStepIndices`, SHALL NOT add that index to `completedStepIndices`, and SHALL route to boss summary only after all plan steps are terminal.

#### Scenario: Mixed completed and blocked batch

- **WHEN** one dispatched step has completed task runs and another dispatched step has blocked task runs
- **THEN** the completed step appears only in `completedStepIndices`
- **AND** the blocked step appears only in `blockedStepIndices`
- **AND** boss summary does not report all work as successful.

### Requirement: Plan-scoped graph state SHALL reset before new execution plans

Planner, preflight short-circuit, direct assignment, and YOLO assignment paths SHALL clear stale plan-scoped state before starting a new execution plan or direct employee turn.

The reset SHALL include prior pending assignments, dispatched step indices, completed step indices, blocked step indices, step results, current step outputs, recent tool results, current employee/task-run ids, interrupt reason, and completion flag.

#### Scenario: New plan cannot inherit stale dispatch state

- **WHEN** a previous checkpoint contains completed or dispatched step indices
- **AND** PM planner creates a new plan
- **THEN** the new execution starts with empty blocked/completed/dispatch state
- **AND** completion requires fresh employee work and evidence.

### Requirement: Employee completion SHALL block when taskRunId is missing

Employee success finalization SHALL default to blocked when no `taskRunId` is available, unless a caller explicitly uses an internal skip-verification path.

#### Scenario: Missing taskRunId does not return hardcoded ok

- **WHEN** employee completion is called without `taskRunId`
- **THEN** it records a blocked completion reason
- **AND** it does not emit hardcoded success.

### Requirement: Heartbeat SHALL surface verifier-blocked work

PM heartbeat SHALL classify blocked task runs as needing attention and include the blocked reason in its event payload.

#### Scenario: Verifier-blocked task appears in heartbeat

- **WHEN** a task run is blocked by completion verification
- **THEN** heartbeat reports that the plan needs attention
- **AND** the payload includes `verifier-blocked`.
