# harness-model-transport-boundary Specification

## Purpose
TBD - created by archiving change realign-default-harness-agent-capabilities. Update Purpose after archive.
## Requirements
### Requirement: Default harness SHALL own direct model calling

Offisim SHALL treat model calling as an `offisim-core` harness capability, not as a separate product lane. The harness MAY use HTTP gateway clients, vendor SDKs, sidecar adapters, or other provider transports to call a model, but those transports SHALL remain implementation details unless an explicit employee runtime or harness-control profile is selected.

The model transport boundary SHALL preserve Offisim ownership of planning, routing, permissions, tool registry, checkpoint identity, telemetry, usage accounting, audit evidence, and completion verification.

#### Scenario: SDK transport does not change product route

- **WHEN** the default harness uses Claude, Codex, OpenAI, Anthropic-compatible, OpenAI-compatible, or custom SDK/client code to send a model request
- **THEN** the active product route remains `offisim-core`
- **AND** runtime telemetry records the provider transport without labeling it as an employee agent runtime

#### Scenario: Transport cannot silently claim tools

- **WHEN** a model transport has no verified Offisim tool bridge or SDK-native employee runtime profile
- **THEN** it SHALL NOT receive Offisim file, shell, memory, todo, skill, MCP, workspace, or builtin tool authority
- **AND** any local-tool request fails closed before unmanaged execution

### Requirement: SDK SHALL have exactly two supported identities

Offisim SHALL support SDKs only as:

- internal model transport/provider-adapter implementation details owned by `offisim-core`
- verified SDK-native employee runtimes with explicit profile, sandbox, audit, checkpoint/rollback, telemetry, and release evidence

Offisim SHALL NOT expose or document a third "ordinary SDK lane" product route.

#### Scenario: UI does not offer ordinary SDK lane

- **WHEN** a user configures a model provider or employee runtime
- **THEN** UI copy distinguishes provider transport from employee runtime profile
- **AND** it does not present `claude-agent-sdk`, `codex-agent-sdk`, or `openai-agents-sdk` as standalone product lanes

#### Scenario: Implementation naming is not product truth

- **WHEN** legacy code, config, or migration fields still contain names such as `executionLane`
- **THEN** docs and validation describe them as model transport bindings
- **AND** release notes do not claim that a transport field is equivalent to a harness, employee agent, or tool-capable runtime

