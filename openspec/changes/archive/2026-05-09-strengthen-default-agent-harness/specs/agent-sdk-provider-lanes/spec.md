## ADDED Requirements

### Requirement: Agent SDK provider lanes SHALL NOT imply agent engine authority
Selecting `claude-agent-sdk`, `codex-agent-sdk`, or `openai-agents-sdk` as a provider execution lane SHALL continue to mean leaf model/reasoning transport only. It SHALL NOT enable employee agent-engine mode, main-harness driver mode, replacement mode, SDK-native tools, local file access, shell access, memory, todo, skill, MCP, or workspace tools.

Full agent capability MAY exist only through `runtime-engine-adapter` or `harness-agent-control-plane` capability profiles, not through provider lane selection.

#### Scenario: Provider lane selection remains text-only
- **WHEN** a provider config selects `claude-agent-sdk`, `codex-agent-sdk`, or `openai-agents-sdk`
- **THEN** Offisim treats the lane as a leaf execution adapter for text/reasoning
- **AND** no Offisim builtin tools are exposed through that lane

#### Scenario: Full agent employee uses a different config path
- **WHEN** an admin wants an employee to own a richer SDK-backed agent runtime
- **THEN** the admin configures an employee engine capability profile
- **AND** the provider lane selector alone is insufficient

### Requirement: SDK lane errors SHALL guide users to the correct runtime concept
When a SDK provider lane rejects a local-tool or workspace task, the typed failure SHALL explain that the lane is text/reasoning-only and that tool-capable work must use the Offisim gateway/default harness or a verified employee agent engine profile.

#### Scenario: Local-tool request on SDK provider lane fails with correct guidance
- **WHEN** a user asks a SDK provider lane to run a local file, shell, memory, todo, skill, MCP, or workspace tool task
- **THEN** the request fails before model execution
- **AND** the user-visible guidance points to the gateway/default harness or a verified employee agent profile
