## ADDED Requirements

### Requirement: SDK provider lanes SHALL remain transport-only while full-agent profiles use separate contracts

`claude-agent-sdk`, `codex-agent-sdk`, and `openai-agents-sdk` provider bindings SHALL continue to mean model transport/provider adapter selection under Offisim harness ownership. They SHALL NOT become employee full-agent routes, main-harness driver routes, or replacement routes by name reuse.

Verified full-agent behavior SHALL live in runtime engine capability profiles or harness control-plane policy. Any UI, task runner, provider matrix, or doc that exposes SDK-backed model transport SHALL also distinguish whether a separate full-agent profile is unavailable, gateway-bridged, SDK-native, driver, or replacement.

#### Scenario: Transport evidence does not satisfy full-agent gate

- **WHEN** a provider lane has smoke evidence for `claude-agent-sdk` or `openai-agents-sdk` model transport
- **THEN** that evidence can mark only the transport row as verified
- **AND** it cannot mark the SDK-native full-agent profile available without the runtime profile, benchmark, and release `.app` gates

#### Scenario: Full-agent profile does not loosen transport fail-closed behavior

- **WHEN** an unverified SDK-backed model transport receives local file, shell, memory, todo, skill, MCP, workspace, or builtin tool definitions
- **THEN** it still fails closed before provider execution
- **AND** the user-facing message points to the default Offisim harness/gateway tools or a separately verified full-agent profile

#### Scenario: Runtime selection uses profile identity

- **WHEN** an admin selects a verified Claude, Codex, or OpenAI full-agent employee route
- **THEN** the persisted selection records runtime profile identity and evidence references
- **AND** the provider `executionLane` field alone is insufficient to reproduce that authority
