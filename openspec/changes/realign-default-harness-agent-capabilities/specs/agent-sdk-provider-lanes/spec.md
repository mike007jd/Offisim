## MODIFIED Requirements

### Requirement: Legacy agent SDK lane wording SHALL be transport-only

`claude-agent-sdk`, `codex-agent-sdk`, and `openai-agents-sdk` names that appear in legacy provider config, migration fields, or adapter code SHALL be interpreted as model transport bindings under Offisim harness ownership. They SHALL NOT be documented or exposed as ordinary product lanes.

This requirement SHALL NOT be interpreted as a ban on verified employee agent profiles or main-harness control-plane modes. Full agent capability belongs to runtime engine capability profiles or the harness control plane, not to model transport selection.

#### Scenario: SDK transport rejects Offisim tools before unmanaged execution

- **WHEN** a SDK-backed model transport receives Offisim-local tool definitions or a local-tool task without a verified bridge/runtime profile
- **THEN** it fails closed before model/tool execution
- **AND** the user-facing message points to the default Offisim harness/gateway tools or a verified tool-capable employee profile

#### Scenario: Employee engine profile uses a different contract

- **WHEN** an admin wants an SDK-backed employee to use native or gateway-bridged tools
- **THEN** the admin configures an employee runtime capability profile
- **AND** model transport selection alone remains insufficient
