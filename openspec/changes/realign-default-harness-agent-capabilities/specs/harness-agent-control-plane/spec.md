## ADDED Requirements

### Requirement: Non-default agent routes SHALL be complete by tier

Offisim SHALL model non-default agent routes as explicit capability tiers. The minimum tiers are text-only, sandbox-native tools, gateway-bridged tools, full-agent employee, main-harness driver, and main-harness replacement.

Each tier SHALL declare supported tasks, unsupported tasks, permission behavior, denied-path behavior, telemetry, cancellation, checkpoint/resume, rollback, failure taxonomy, and release evidence. A route missing evidence for a tier SHALL remain lower-tier or preview-blocked.

#### Scenario: Partial SDK employee is not advertised as full agent

- **WHEN** an SDK-backed employee can answer text but lacks verified denied-path, cancellation, checkpoint/resume, telemetry, or rollback evidence
- **THEN** Offisim advertises it only as text-only or preview-blocked
- **AND** it is not selectable as a production full-agent employee

#### Scenario: Gateway-bridged profile has evidence

- **WHEN** an employee profile claims gateway-bridged file or shell work
- **THEN** release evidence includes successful work, denied-path behavior, cancellation, checkpoint/resume, and completion evidence through Offisim task-run identity
- **AND** native SDK tool telemetry is not counted as Offisim gateway evidence unless the bridge proves equivalence

### Requirement: Main harness driver and replacement SHALL be explicit and reversible

Main harness driver or replacement mode SHALL resolve only from an explicit trusted policy. The policy SHALL include scope, actor, reason, previous mode, next mode, runtime profile, verification status, timestamp, and rollback checkpoint.

Provider lane selection, employee binding, SDK availability, and external peer discovery SHALL NOT self-promote into main harness driver or replacement mode.

#### Scenario: Driver proposes, Offisim executes

- **WHEN** a non-default driver proposes a file edit, shell command, handoff, or plan mutation
- **THEN** Offisim records a proposal with runtime-profile identity
- **AND** approved actions execute through Offisim's permission, checkpoint, task-state, and evidence paths

#### Scenario: Replacement stays blocked without rollback

- **WHEN** a replacement runtime lacks current rollback or checkpoint-handoff evidence
- **THEN** Offisim refuses to select it as production replacement
- **AND** the default `offisim-core` harness remains active
