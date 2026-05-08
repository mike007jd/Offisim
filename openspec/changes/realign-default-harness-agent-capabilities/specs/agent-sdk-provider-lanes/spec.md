## MODIFIED Requirements

### Requirement: Agent SDK lanes SHALL remain text/reasoning-only

`claude-agent-sdk`, `codex-agent-sdk`, and `openai-agents-sdk` provider lanes SHALL remain leaf text/reasoning execution adapters for Offisim graph nodes. They SHALL NOT expose or execute Offisim file, shell, memory, todo, skill, MCP, builtin, or workspace tools.

This requirement SHALL NOT be interpreted as a ban on verified employee agent profiles or main-harness control-plane modes. Full agent capability belongs to runtime engine capability profiles or the harness control plane, not to provider lane selection.

#### Scenario: SDK provider lane rejects Offisim tools before provider execution

- **WHEN** an SDK provider lane receives Offisim-local tool definitions or a local-tool task
- **THEN** it fails closed before model/tool execution
- **AND** the user-facing message points to the default Offisim harness/gateway tools or a verified tool-capable employee profile

#### Scenario: Employee engine profile uses a different contract

- **WHEN** an admin wants an SDK-backed employee to use native or gateway-bridged tools
- **THEN** the admin configures an employee runtime capability profile
- **AND** provider lane selection alone remains insufficient
