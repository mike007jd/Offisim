## MODIFIED Requirements

### Requirement: Provider matrix SHALL record empirical transport and runtime status

`openspec/provider-lane-matrix.md` SHALL remain the durable evidence matrix for provider transport and runtime-profile exposure. Its host exposure rule SHALL avoid broad global statements such as "calling this provider means SDK lane" or "Offisim tool execution remains gateway-only."

The matrix SHALL distinguish:

- model transport evidence
- default Offisim harness/gateway tool evidence
- employee runtime capability profile evidence
- main-harness driver/replacement evidence

#### Scenario: Matrix language does not poison future agent routes

- **WHEN** a maintainer reads the host exposure rule
- **THEN** it is clear that provider transport is not an employee runtime or product lane
- **AND** it is also clear that verified tool-capable employee profiles may exist through a different capability path

#### Scenario: Provider evidence is not full-agent evidence

- **WHEN** a provider row marks a SDK-backed transport as verified
- **THEN** the evidence is understood as model transport evidence unless a separate employee/runtime profile evidence row exists
- **AND** product UI does not advertise full-agent support from transport evidence alone
