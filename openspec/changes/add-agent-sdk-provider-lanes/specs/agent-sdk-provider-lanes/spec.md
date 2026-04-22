## ADDED Requirements

### Requirement: Provider configuration SHALL declare an execution lane

Offisim provider configuration SHALL carry an explicit execution lane for every active provider binding. Supported lanes are `gateway`, `claude-agent-sdk`, and `openai-agents-sdk`.

The selected lane SHALL be evaluated together with runtime execution mode. `browser-limited` runtimes MUST reject any non-`gateway` lane. `desktop-trusted` and backend harness runtimes MAY allow agent SDK lanes only when the selected preset explicitly advertises support.

#### Scenario: Browser-limited rejects agent SDK lane

- **WHEN** a saved provider config selects `executionLane = "claude-agent-sdk"` and runtime execution mode resolves to `browser-limited`
- **THEN** runtime init rejects the config before chat execution starts
- **AND** the user is guided to switch back to `gateway` or move to a trusted runtime

#### Scenario: Trusted runtime accepts verified lane

- **WHEN** a trusted runtime loads a preset whose supported lane set includes `gateway` and `claude-agent-sdk`
- **THEN** the user may select either lane
- **AND** runtime init binds exactly the selected lane, not both

### Requirement: Provider presets SHALL advertise verified lane support explicitly

Provider compatibility labels such as `anthropic-compatible` and `openai-compatible` SHALL NOT, by themselves, imply agent SDK support. Each preset SHALL declare an explicit supported-lane set based on real verification evidence.

Custom or manually-entered provider configs MUST default to `gateway`-only until a higher lane is explicitly verified and added to preset metadata.

#### Scenario: Verified preset exposes multiple lanes

- **WHEN** a preset has been validated against Offisim harness evidence for both raw gateway calls and Claude Agent SDK execution
- **THEN** the preset advertises both `gateway` and `claude-agent-sdk`
- **AND** Settings UI offers both choices

#### Scenario: Custom anthropic-compatible endpoint stays gateway-only

- **WHEN** a user manually enters an Anthropic-compatible `baseURL` that has no preset verification record
- **THEN** Offisim exposes only the `gateway` lane
- **AND** no `claude-agent-sdk` choice appears by default

### Requirement: Offisim LangGraph SHALL remain the top-level orchestrator

Execution lanes are leaf-level model execution mechanisms. They SHALL NOT replace Offisim's top-level LangGraph orchestration, runtime policy evaluation, checkpoint ownership, tool-permission policy, or thread queueing model.

Every boss / manager / employee / system-service call path SHALL reach the currently active lane through one Offisim-owned execution abstraction. Per-node direct vendor SDK instantiation is forbidden.

#### Scenario: Claude lane does not bypass LangGraph

- **WHEN** a runtime selects `claude-agent-sdk`
- **THEN** boss, manager, and employee work still enter through Offisim orchestration services and graph nodes
- **AND** Claude Agent SDK is used only inside the active execution adapter

#### Scenario: OpenAI lane preserves Offisim policy hooks

- **WHEN** a runtime selects `openai-agents-sdk`
- **THEN** Offisim runtime policy, tool permission, and checkpoint hooks still execute at the Offisim layer
- **AND** the vendor lane does not take ownership of global workflow state
