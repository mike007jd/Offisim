## ADDED Requirements

### Requirement: Full-agent promotion SHALL require explicit control-plane policy

A full-agent employee, main-harness driver, or main-harness replacement SHALL become active only through explicit control-plane policy. SDK availability, model transport health, employee binding defaults, or discovered peer agents SHALL NOT self-promote into control of local tools, task state, or main harness ownership.

#### Scenario: SDK host health does not change owner

- **WHEN** Claude/Codex/OpenAI SDK host health checks pass
- **THEN** the main owner remains `offisim-core` unless explicit policy selects a verified profile
- **AND** runtime status shows health separately from availability

#### Scenario: Driver proposal keeps Offisim approval

- **WHEN** a verified driver profile proposes a file edit, command, handoff, or plan mutation
- **THEN** Offisim records the proposal and applies it only through Offisim permission, checkpoint, and evidence paths
- **AND** no global plan or task state mutates directly from the driver

### Requirement: Replacement mode SHALL prove rollback and equivalence

Main-harness replacement mode SHALL remain unavailable until it proves equivalent or superior behavior for default harness tasks, rollback to `offisim-core`, checkpoint handoff, failure containment, and user-visible recovery.

#### Scenario: Replacement without rollback is blocked

- **WHEN** a replacement runtime lacks checkpoint handoff or rollback proof
- **THEN** control-plane policy refuses production replacement mode
- **AND** the default harness remains active

#### Scenario: Replacement failure returns to default harness

- **WHEN** an active replacement runtime fails a health, permission, or task-state gate
- **THEN** Offisim records the failure and switches back to `offisim-core` through the rollback policy
- **AND** prior audit and task evidence remain readable

