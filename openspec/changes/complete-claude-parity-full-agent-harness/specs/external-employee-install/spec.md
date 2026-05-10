## ADDED Requirements

### Requirement: External employees SHALL NOT count as parity without full gates

External employee discovery, install, health, or A2A compatibility SHALL NOT count as Claude-parity or full-agent runtime evidence by itself. An external employee may become a verified route only if it declares a runtime profile and passes the same task-family evidence, permission, sandbox, checkpoint, rollback, benchmark, and release `.app` gates as native full-agent profiles.

#### Scenario: Healthy external employee remains non-parity

- **WHEN** an external employee card validates and its health check passes
- **THEN** Offisim may show it as discoverable or installed
- **AND** it does not satisfy any Claude-parity/full-agent ledger row until profile evidence exists

#### Scenario: External route cannot bypass Offisim policy

- **WHEN** an external employee proposes file, shell, MCP, git, artifact, memory, todo, skill, handoff, or plan mutation work
- **THEN** Offisim applies the same permission, checkpoint, task-run identity, evidence, and rollback rules as other non-default routes
- **AND** the external route cannot directly mutate global state outside the approved boundary

#### Scenario: External full-agent availability names host scope

- **WHEN** an external employee passes full-agent gates for a limited host, workspace, or tool family
- **THEN** the runtime profile records that scope explicitly
- **AND** Personnel/runtime UI does not generalize the evidence to unsupported hosts, workspaces, or tool families
