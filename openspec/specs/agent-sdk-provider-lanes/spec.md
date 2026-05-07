# agent-sdk-provider-lanes Specification

## Purpose
Defines execution lanes as verified leaf adapters for provider bindings so Offisim can expose gateway, Codex Agent SDK, Claude Agent SDK, and OpenAI Agents SDK without bypassing LangGraph orchestration. These lanes are provider-side model/transport bindings; they are not employee engine mode.

## Requirements

### Requirement: Provider configuration SHALL declare an execution lane

Offisim provider configuration SHALL carry an explicit execution lane for every active provider binding. Supported lanes are `gateway`, `codex-agent-sdk`, `claude-agent-sdk`, and `openai-agents-sdk`.

The selected lane SHALL be evaluated together with runtime execution mode. `browser-limited` runtimes MUST reject any non-`gateway` lane. `desktop-trusted` and backend harness runtimes MAY allow agent SDK lanes only when the selected preset explicitly advertises support.

#### Scenario: Browser-limited rejects agent SDK lane

- **WHEN** a saved provider config selects `executionLane = "claude-agent-sdk"` and runtime execution mode resolves to `browser-limited`
- **THEN** runtime init rejects the config before chat execution starts
- **AND** the user is guided to switch back to `gateway` or move to a trusted runtime

#### Scenario: Trusted runtime accepts verified lane

- **WHEN** a trusted runtime loads a preset whose supported lane set includes `gateway` and `claude-agent-sdk`
- **THEN** the user may select either lane
- **AND** runtime init binds exactly the selected lane, not both

#### Scenario: Execution lane is not engine mode

- **WHEN** a provider config selects `executionLane = "codex-agent-sdk"` or `executionLane = "claude-agent-sdk"`
- **THEN** Offisim still treats it as the leaf LLM execution adapter for Offisim-owned graph nodes
- **AND** employee engine mode is not enabled unless the employee runtime binding explicitly selects `codex-engine` or `claude-engine`

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

Execution lanes are leaf-level model execution mechanisms. They SHALL NOT replace Offisim's top-level LangGraph orchestration, runtime policy evaluation, checkpoint ownership, tool-permission policy, employee runtime binding, or thread queueing model.

Every boss / manager / employee / system-service call path SHALL reach the currently active lane through one Offisim-owned execution abstraction. Per-node direct vendor SDK instantiation is forbidden.

#### Scenario: Claude lane does not bypass LangGraph

- **WHEN** a runtime selects `claude-agent-sdk`
- **THEN** boss, manager, and employee work still enter through Offisim orchestration services and graph nodes
- **AND** Claude Agent SDK is used only inside the active execution adapter

#### Scenario: OpenAI lane preserves Offisim policy hooks

- **WHEN** a runtime selects `openai-agents-sdk`
- **THEN** Offisim runtime policy, tool permission, and checkpoint hooks still execute at the Offisim layer
- **AND** the vendor lane does not take ownership of global workflow state

### Requirement: Agent SDK lanes SHALL remain text/reasoning-only

`claude-agent-sdk`, `codex-agent-sdk`, and `openai-agents-sdk` SHALL NOT expose or execute Offisim file, shell, memory, todo, skill, MCP, builtin, or workspace tools. Any task that requires those tools SHALL fail closed or be routed to the `gateway` lane before model execution.

Harness coverage SHALL prove this per adapter: Claude Agent SDK and OpenAI Agents SDK reject tool-bearing calls before spawning/fetching, and Codex Agent SDK remains unavailable from the generic core adapter factory unless the trusted desktop host supplies the text-only bridge.

#### Scenario: Agent SDK adapter rejects Offisim tools before provider execution

- **WHEN** a `claude-agent-sdk` or `openai-agents-sdk` adapter receives a request with Offisim tool definitions
- **THEN** it fails with the text-only SDK-lane message
- **AND** no provider process or HTTP call is attempted

#### Scenario: Codex SDK is not exposed by the generic core factory

- **WHEN** `createExecutionAdapter` is asked for `codex-agent-sdk`
- **THEN** it fails closed with guidance that Codex requires the trusted desktop host
- **AND** generic runtime code cannot silently construct a tool-capable Codex lane

#### Scenario: Trusted Codex host instructions stay text-only

- **WHEN** the Codex desktop host bridge builds its developer instructions
- **THEN** the instructions state that SDK lanes are text/reasoning-only
- **AND** they tell the model to switch to `gateway` for Offisim tools rather than executing local file, shell, memory, todo, skill, MCP, or builtin tools
