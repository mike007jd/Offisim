## ADDED Requirements

### Requirement: Backend harness SHALL test parity invariants, not only completion

Backend harness suites SHALL include parity invariants for multi-turn loop behavior, streaming tool order, read/write concurrency, permission ask/deny, denied-path visibility, MCP lifecycle, context retention, resume/fork equivalence, cancellation propagation, budget exhaustion, checkpoint/rollback, usage/cost, and evidence classification.

A run that merely reaches a final assistant message SHALL NOT be considered a parity proof.

#### Scenario: Final text without tool evidence fails parity

- **WHEN** a task requires file, shell, MCP, workspace, or native tool execution
- **AND** the run only returns final text without accepted evidence
- **THEN** the parity assertion fails

#### Scenario: Cancellation path has state assertions

- **WHEN** a model turn, native tool, gateway tool, or MCP call is cancelled
- **THEN** the harness asserts task status, run conversation state, activity events, and absence of post-cancel side effects

### Requirement: Full-agent harness SHALL include live-provider and deterministic modes

Full-agent routes SHALL have deterministic fixtures for repeatable semantic gates and live-provider smoke/load/edge gates for actual runtime behavior when credentials are available. Missing credentials SHALL block live promotion but SHALL NOT weaken deterministic assertions.

#### Scenario: Deterministic profile gate catches semantic gap

- **WHEN** a full-agent adapter does not emit native tool, MCP, cancellation, or usage events
- **THEN** deterministic full-agent profile gates fail before release smoke is attempted

#### Scenario: Live provider gate is explicit

- **WHEN** provider credentials or local SDK host dependencies are missing
- **THEN** the live gate reports `blocked-missing-live-dependency`
- **AND** product availability remains disabled

