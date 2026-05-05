## ADDED Requirements

### Requirement: Release-session active-context snapshot equivalence SHALL be a verification gate

Release-app live verify SHALL include an explicit gate confirming
that the active-{project, company, employee, workspace_root,
providerConfig} snapshot read at session-start is byte-equivalent
across every chat lane the release `.app` ships (gateway,
claude-agent-sdk, codex-agent-sdk, openai-agents-sdk). A release
SHALL NOT be considered verified if the snapshot diverges between
lanes for the same active-context input.

#### Scenario: Snapshot equivalence verified across all lanes

- **GIVEN** a release `.app` build with active project P, active
  company C, active employee E
- **WHEN** the verifier opens chat sessions on E across each engine
  the build supports
- **THEN** the snapshot read at session-start on each lane SHALL be
  byte-equivalent on the active-{project, company, employee,
  workspace_root, providerConfig} fields
- **AND** the verify gate SHALL be marked PASS only when this holds
  on the release `.app` lane (not only on dev builds)

#### Scenario: Snapshot divergence blocks archive

- **WHEN** the verify gate detects any field divergence between
  lanes' session-start snapshots
- **THEN** the gate SHALL be marked FAIL
- **AND** the corresponding OpenSpec change SHALL NOT proceed to
  archive until the divergence is resolved

### Requirement: Step advancement SHALL preserve blocked task state across thread aliases

The runtime SHALL classify a dispatched plan step as blocked when any
task run referenced by that step is blocked, even if the persisted
`task_runs.thread_id` uses a storage/root-thread id while the graph
state uses a UI-scoped thread id. Step advancement SHALL resolve
terminal task state by `taskRunId`, not only by `thread_id`, so blocked
verification tasks cannot be reported as completed steps.

#### Scenario: Blocked task run with storage thread id blocks the UI-scoped step

- **GIVEN** a plan step references task run `T`
- **AND** `T.status = 'blocked'`
- **AND** `T.thread_id` differs from the graph state's current
  thread id because one side is UI-scoped and one side is storage-scoped
- **WHEN** `step_advance` runs
- **THEN** the step SHALL be added to `blockedStepIndices`
- **AND** the step SHALL NOT be added to `completedStepIndices`

#### Scenario: Blocked dependency stops without a dispatcher error

- **GIVEN** step `A` is blocked
- **AND** a later step `B` depends on `A`
- **WHEN** the dispatcher cannot queue `B`
- **THEN** the workflow SHALL summarize the plan as blocked and incomplete
- **AND** it SHALL NOT raise a generic "SOP dispatcher could not advance" error
