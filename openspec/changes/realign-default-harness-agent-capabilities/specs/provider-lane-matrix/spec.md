## MODIFIED Requirements

### Requirement: Provider lane matrix SHALL record empirical lane status

`openspec/provider-lane-matrix.md` SHALL remain the durable evidence matrix for provider × lane exposure. Its host exposure rule SHALL avoid broad global statements such as "Offisim tool execution remains gateway-only" unless scoped to current provider SDK lanes and currently verified profiles.

The matrix SHALL distinguish:

- provider SDK lane evidence for text/reasoning transport
- default Offisim harness/gateway tool evidence
- employee runtime capability profile evidence
- main-harness driver/replacement evidence

#### Scenario: Matrix language does not poison future agent routes

- **WHEN** a maintainer reads the host exposure rule
- **THEN** it is clear that provider SDK lanes are text/reasoning-only
- **AND** it is also clear that verified tool-capable employee profiles may exist through a different capability path

#### Scenario: Provider evidence is not full-agent evidence

- **WHEN** a provider row marks `claude-agent-sdk` or `openai-agents-sdk` as verified
- **THEN** the evidence is understood as text/reasoning lane evidence unless a separate employee/runtime profile evidence row exists
- **AND** product UI does not advertise full-agent support from provider lane evidence alone
