## MODIFIED Requirements

### Requirement: Employee runtime binding SHALL be separate from provider binding

Employee runtime binding SHALL configure which runtime owns an assigned employee task. Provider binding SHALL configure the leaf model/transport used by Offisim-owned graph nodes. These two concepts SHALL remain separate in storage, docs, UI copy, and runtime guidance.

An employee runtime profile MAY become a full agent route only when its capability tier and evidence gates are satisfied. The runtime SHALL fail fast or request an explicit profile change when task intent exceeds the selected profile; it SHALL NOT silently downgrade to provider mode, gateway mode, or another employee engine.

#### Scenario: Text-only employee profile blocks local tools

- **WHEN** an employee runtime profile is text-only
- **AND** the task requires local files, shell, memory, todo, skills, MCP, or workspace tools
- **THEN** Offisim blocks before execution with a typed outcome
- **AND** the guidance points to the default Offisim harness/gateway tools or a verified tool-capable employee profile

#### Scenario: Full-agent employee profile is explicit

- **WHEN** an employee uses a verified SDK-backed full-agent runtime
- **THEN** its profile declares native tools, gateway-bridged tools, MCP, subagents, handoffs, session resume, cancellation, checkpointing, sandboxing, telemetry, and failure taxonomy as applicable
- **AND** Offisim records that these are employee-runtime capabilities, not provider lane capabilities
