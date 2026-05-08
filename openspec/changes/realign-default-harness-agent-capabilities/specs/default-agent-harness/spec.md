## ADDED Requirements

### Requirement: Default harness strengthening SHALL be the primary release path

Offisim SHALL keep `offisim-core` as the default runtime harness. The default harness SHALL own planning, routing, permission policy, checkpoint state, task state, MCP client lifecycle, cancellation, usage accounting, completion verification, and user-visible evidence unless an explicit verified non-default harness policy is selected.

Reference agent implementations, Claude Agent SDK, OpenAI Agents SDK, MCP docs, and Context7 research SHALL be used as capability targets for strengthening Offisim's own harness. They SHALL NOT be treated as automatic replacement of the default harness.

#### Scenario: Reference capability becomes Offisim evidence only after implementation

- **WHEN** a reference implementation or SDK exposes a capability such as tool-loop recovery, session resume, MCP lifecycle, or subagent handoff
- **THEN** Offisim marks that capability shipped only after an Offisim-owned module and gate prove the behavior
- **AND** reference source or SDK documentation alone is not release evidence

#### Scenario: Fresh runtime keeps Offisim as owner

- **WHEN** a fresh internal employee task runs without an explicit verified override
- **THEN** the runtime owner is `offisim-core`
- **AND** provider SDK availability or external agent discovery does not change the main harness owner

### Requirement: Gateway-only wording SHALL be scoped to current provider SDK lanes

Docs, specs, code comments, and user-facing copy SHALL NOT state that all future tool-capable work must always use the gateway lane. They SHALL state the narrower current truth: provider SDK lanes are text/reasoning leaf lanes and cannot execute Offisim-local file, shell, memory, todo, skill, MCP, workspace, or builtin tools.

Tool-capable work MAY use the default Offisim gateway harness or a verified tool-capable employee profile once that profile has the required evidence.

#### Scenario: Provider lane warning points to both valid concepts

- **WHEN** a provider SDK lane rejects a local-tool task
- **THEN** the warning says the provider SDK lane is text/reasoning-only
- **AND** it points to the default Offisim harness/gateway tools or a verified tool-capable employee profile

#### Scenario: Future full-agent route is not forbidden by old wording

- **WHEN** an employee agent profile later passes full-agent or gateway-bridged release gates
- **THEN** existing docs and runtime messages do not contradict that product route
- **AND** they still preserve provider SDK lane fail-closed behavior
