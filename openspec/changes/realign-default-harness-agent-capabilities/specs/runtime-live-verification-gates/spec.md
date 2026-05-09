## MODIFIED Requirements

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
