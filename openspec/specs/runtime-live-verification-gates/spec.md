# runtime-live-verification-gates Specification

## Purpose
TBD - created by archiving change verify-post-overhaul-runtime-live-gaps. Update Purpose after archive.
## Requirements
### Requirement: Residual live gates require direct evidence
The runtime verification process SHALL require direct web or desktop evidence before residual gates from a runtime overhaul are marked complete.

#### Scenario: Web gate verified
- **WHEN** a residual gate is scoped to the web runtime
- **THEN** the verifier MUST run the path in a real browser against the local desktop renderer and record the observable UI or log evidence.

#### Scenario: Desktop gate verified
- **WHEN** a residual gate is scoped to desktop behavior
- **THEN** the verifier MUST build and launch the release `.app` and record evidence from the release desktop runtime.

#### Scenario: Negative path verified
- **WHEN** a residual gate requires a failure path that cannot be reached through normal UI controls
- **THEN** the verifier MUST use the smallest controlled fault-injection path possible and document that it is not a production behavior change.

### Requirement: Residual gates remain separate from archived implementation
The runtime verification process SHALL keep unresolved live verification work in a follow-up change rather than marking archived implementation tasks as complete without proof.

#### Scenario: Archived change has incomplete live gates
- **WHEN** an implementation change is archived with incomplete live verification tasks
- **THEN** the follow-up change MUST list the remaining gates, their required evidence, and any known blockers.

#### Scenario: Verification uncovers a real regression
- **WHEN** a follow-up live gate reproduces a product-impacting regression
- **THEN** the change MAY include the minimal fix required for that regression and MUST include the live evidence that proves the fix.

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

### Requirement: Alternate agent engines SHALL require release evidence before being advertised

Any employee agent engine, main-harness driver, or main-harness replacement mode SHALL have release `.app` evidence before product UI, docs, or marketing can call it available. The evidence SHALL include success, denied/blocked behavior, cancellation, checkpoint/resume, telemetry, failure classification, and rollback where applicable for the exact runtime profile.

Model transport smoke evidence SHALL NOT satisfy this gate.

#### Scenario: Transport evidence does not advertise full-agent employee

- **WHEN** a SDK-backed model transport has successful text/reasoning smoke evidence
- **THEN** Offisim may mark that transport verified for model calling
- **AND** it does not mark any full-agent, gateway-bridged employee, driver, or replacement route production-ready without separate release `.app` evidence

#### Scenario: Release evidence names the owner

- **WHEN** release verification records a successful tool-capable task
- **THEN** the evidence names whether the owner was default `offisim-core`, a gateway-bridged employee profile, a native employee agent profile, a driver, or a replacement runtime
- **AND** archive is blocked if the evidence cannot distinguish those owners

### Requirement: Full-power SDK release verification SHALL prove native capability preservation

Release verification for a SDK-native full-power profile SHALL prove that native SDK capabilities are preserved end to end. Evidence SHALL include the SDK runtime options/profile, available native tools or hosted tools, MCP server status, permission/guardrail decisions, session identity, resume/fork identity, cancellation result, checkpoint/rollback artifact, usage/cost, and normalized Offisim activity events.

#### Scenario: SDK full-power live evidence is complete

- **WHEN** a release `.app` verifies a SDK-native full-power employee profile
- **THEN** the evidence includes success, denied path, cancellation, resume/fork, MCP lifecycle, native tool telemetry, guardrail/hook behavior, budget/max-turn exhaustion, and rollback
- **AND** the evidence proves the runtime was not reduced to model-transport text-only behavior

#### Scenario: Main harness parity and SDK full-power are both required

- **WHEN** a release candidate advertises both a stronger default harness and SDK-native full-power employees
- **THEN** release evidence includes a comparable benchmark for both routes
- **AND** neither route can be advertised from the other route's evidence alone

