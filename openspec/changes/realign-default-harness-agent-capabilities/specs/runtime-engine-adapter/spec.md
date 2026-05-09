## MODIFIED Requirements

### Requirement: Employee runtime binding SHALL be separate from model transport binding

Employee runtime binding SHALL configure which runtime owns an assigned employee task. Model transport/provider binding SHALL configure how Offisim-owned graph nodes call a model. These two concepts SHALL remain separate in storage, docs, UI copy, and runtime guidance.

An employee runtime profile MAY become a full agent route only when its capability tier and evidence gates are satisfied. The runtime SHALL fail fast or request an explicit profile change when task intent exceeds the selected profile; it SHALL NOT silently downgrade to provider mode, gateway mode, or another employee engine.

#### Scenario: Text-only employee profile blocks local tools

- **WHEN** an employee runtime profile is text-only
- **AND** the task requires local files, shell, memory, todo, skills, MCP, or workspace tools
- **THEN** Offisim blocks before execution with a typed outcome
- **AND** the guidance points to the default Offisim harness/gateway tools or a verified tool-capable employee profile

#### Scenario: Full-agent employee profile is explicit

- **WHEN** an employee uses a verified SDK-backed full-agent runtime
- **THEN** its profile declares native tools, gateway-bridged tools, MCP, subagents, handoffs, session resume, cancellation, checkpointing, sandboxing, telemetry, and failure taxonomy as applicable
- **AND** Offisim records that these are employee-runtime capabilities, not model transport capabilities

### Requirement: SDK-backed full-agent adapters SHALL not strip native runtime semantics

An SDK-backed full-agent adapter SHALL preserve the selected SDK runtime's native execution semantics where the profile declares them. The adapter SHALL stream or poll activity for native tool calls, MCP status, handoffs/subagents, guardrails/hooks, sessions, resume/fork, cancellation, usage, budget, and typed errors. It SHALL normalize those events into Offisim activity without forcing the runtime into one-shot text execution.

#### Scenario: Adapter preserves multi-turn SDK loop

- **WHEN** the SDK runtime needs multiple model/tool turns to complete a task
- **THEN** the adapter allows the declared max-turn/budget policy to run
- **AND** it does not terminate after the first assistant text response unless the SDK reports terminal completion

#### Scenario: Adapter maps SDK errors with partial state

- **WHEN** the SDK runtime returns max-turn, guardrail, tool-timeout, model-behavior, provider, or cancellation errors with partial state
- **THEN** Offisim records a typed failure classification and any recoverable partial state
- **AND** the task is blocked/retryable rather than falsely completed
