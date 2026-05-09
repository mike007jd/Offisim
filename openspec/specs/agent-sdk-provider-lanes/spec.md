# agent-sdk-provider-lanes Specification

## Purpose
Defines legacy execution-binding fields as model transport bindings so Offisim can call providers through gateway, Codex Agent SDK, Claude Agent SDK, OpenAI Agents SDK, or compatible adapters without bypassing Offisim orchestration. These bindings are provider-side model transport details; they are not employee engine modes or product-level SDK lanes.

## Requirements

### Requirement: Provider configuration SHALL declare a model transport binding

Offisim provider configuration SHALL carry an explicit model transport binding for every active provider binding. Legacy field names MAY still use `executionLane` for migration compatibility. Supported transport bindings include `gateway`, `codex-agent-sdk`, `claude-agent-sdk`, and `openai-agents-sdk`.

The selected transport binding SHALL be evaluated together with runtime execution mode. `browser-limited` runtimes MUST reject any non-`gateway` transport. `desktop-trusted` and backend harness runtimes MAY allow SDK-backed transports only when the selected preset explicitly advertises support.

#### Scenario: Browser-limited rejects unverified SDK transport

- **WHEN** a saved provider config selects `executionLane = "claude-agent-sdk"` and runtime execution mode resolves to `browser-limited`
- **THEN** runtime init rejects the config before chat execution starts
- **AND** the user is guided to the default Offisim harness / gateway path, or to a trusted runtime with a verified tool-capable employee profile

#### Scenario: Trusted runtime accepts verified transport

- **WHEN** a trusted runtime loads a preset whose supported transport set includes `gateway` and `claude-agent-sdk`
- **THEN** the user may select either transport
- **AND** runtime init binds exactly the selected transport, not both

#### Scenario: Execution binding is not engine mode

- **WHEN** a provider config selects `executionLane = "codex-agent-sdk"` or `executionLane = "claude-agent-sdk"`
- **THEN** Offisim still treats it as model transport for Offisim-owned harness calls
- **AND** employee engine mode is not enabled unless the employee runtime binding explicitly selects `codex-engine` or `claude-engine`

### Requirement: Provider presets SHALL advertise verified lane support explicitly

Provider compatibility labels such as `anthropic-compatible` and `openai-compatible` SHALL NOT, by themselves, imply agent SDK support. Each preset SHALL declare an explicit supported-transport set based on real verification evidence.

Custom or manually-entered provider configs MUST default to `gateway` transport until another transport is explicitly verified and added to preset metadata.

#### Scenario: Verified preset exposes multiple lanes

- **WHEN** a preset has been validated against Offisim harness evidence for both raw gateway calls and Claude Agent SDK execution
- **THEN** the preset advertises both `gateway` and `claude-agent-sdk` transports
- **AND** Settings UI offers both choices as model transport options, not employee runtime routes

#### Scenario: Custom anthropic-compatible endpoint stays gateway-only

- **WHEN** a user manually enters an Anthropic-compatible `baseURL` that has no preset verification record
- **THEN** Offisim exposes only the `gateway` transport
- **AND** no `claude-agent-sdk` choice appears by default

### Requirement: Offisim LangGraph SHALL remain the top-level orchestrator

Model transport bindings are leaf-level model execution mechanisms. They SHALL NOT replace Offisim's top-level LangGraph orchestration, runtime policy evaluation, checkpoint ownership, tool-permission policy, employee runtime binding, or thread queueing model.

Every boss / manager / employee / system-service call path SHALL reach the currently active transport through one Offisim-owned execution abstraction. Per-node direct vendor SDK instantiation is forbidden.

#### Scenario: Claude transport does not bypass LangGraph

- **WHEN** a runtime selects `claude-agent-sdk`
- **THEN** boss, manager, and employee work still enter through Offisim orchestration services and graph nodes
- **AND** Claude Agent SDK is used only inside the active execution adapter

#### Scenario: OpenAI transport preserves Offisim policy hooks

- **WHEN** a runtime selects `openai-agents-sdk`
- **THEN** Offisim runtime policy, tool permission, and checkpoint hooks still execute at the Offisim layer
- **AND** the vendor transport does not take ownership of global workflow state

### Requirement: SDK-backed transports SHALL NOT expose Offisim runtime tools

`claude-agent-sdk`, `codex-agent-sdk`, and `openai-agents-sdk` SHALL NOT expose or execute Offisim file, shell, memory, todo, skill, MCP, builtin, or workspace tools. Any task that requires those tools SHALL fail closed or be routed to the `gateway` lane before model execution.

Harness coverage SHALL prove this per adapter: Claude Agent SDK and OpenAI Agents SDK reject tool-bearing calls before spawning/fetching, and Codex Agent SDK remains unavailable from the generic core adapter factory unless the trusted desktop host supplies the text-only bridge.

#### Scenario: SDK transport adapter rejects Offisim tools before provider execution

- **WHEN** a `claude-agent-sdk` or `openai-agents-sdk` adapter receives a request with Offisim tool definitions
- **THEN** it fails with the unverified-transport tool-denial message
- **AND** no provider process or HTTP call is attempted

#### Scenario: Codex SDK is not exposed by the generic core factory

- **WHEN** `createExecutionAdapter` is asked for `codex-agent-sdk`
- **THEN** it fails closed with guidance that Codex requires the trusted desktop host
- **AND** generic runtime code cannot silently construct a tool-capable Codex lane

#### Scenario: Trusted Codex host instructions preserve model-transport boundary

- **WHEN** the Codex desktop host bridge builds its developer instructions
- **THEN** the instructions state that model transport is not a tool-capable runtime
- **AND** they tell the model to use the default Offisim harness / gateway tools or a verified tool-capable employee profile rather than executing local file, shell, memory, todo, skill, MCP, or builtin tools through an unverified SDK-backed transport
