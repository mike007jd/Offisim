## MODIFIED Requirements

### Requirement: Alternate agent engines SHALL require release evidence before being advertised

Any employee agent engine, main-harness driver, or main-harness replacement mode SHALL have release `.app` evidence before product UI, docs, or marketing can call it available. The evidence SHALL include success, denied/blocked behavior, cancellation, checkpoint/resume, telemetry, failure classification, and rollback where applicable for the exact runtime profile.

Provider SDK lane text/reasoning evidence SHALL NOT satisfy this gate.

#### Scenario: Provider SDK evidence does not advertise full-agent employee

- **WHEN** a provider SDK lane has successful text/reasoning smoke evidence
- **THEN** Offisim may mark that provider lane verified for text/reasoning
- **AND** it does not mark any full-agent, gateway-bridged employee, driver, or replacement route production-ready without separate release `.app` evidence

#### Scenario: Release evidence names the owner

- **WHEN** release verification records a successful tool-capable task
- **THEN** the evidence names whether the owner was default `offisim-core`, a gateway-bridged employee profile, a native employee agent profile, a driver, or a replacement runtime
- **AND** archive is blocked if the evidence cannot distinguish those owners
