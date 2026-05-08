## ADDED Requirements

### Requirement: Full agent employee support SHALL be complete before production availability
Employee agent engines SHALL be production-available only after their capability profile proves the full tier being advertised. A full agent employee tier SHALL include session continuity, context retention, native or gateway-bridged tool model, permission handling, denied-path behavior, MCP or subagent capability when advertised, cancellation, checkpoint/resume, telemetry, completion evidence, and failure taxonomy.

Partial support SHALL be exposed as a lower tier or blocked/preview state, not as full agent employee support.

#### Scenario: Success-only SDK employee is not production full-agent
- **WHEN** an SDK-backed employee can complete a happy-path text task but lacks denied-path, cancellation, resume, telemetry, or evidence coverage
- **THEN** Offisim does not mark it as production full-agent support
- **AND** the employee profile remains lower-tier or preview-blocked

#### Scenario: Full-agent employee passes non-happy-path gates
- **WHEN** an employee agent profile is advertised as full-agent production support
- **THEN** release evidence includes success, denied permission, cancellation, resume/checkpoint, telemetry, and failure classification
- **AND** the profile can be selected only in trusted runtime contexts that match its sandbox and tool model

### Requirement: Employee agent engines SHALL declare capability profiles
An employee engine adapter that exposes richer agent behavior SHALL declare a capability profile before it can be selected. The profile SHALL state whether the engine supports text only, native SDK tools, gateway-bridged Offisim tools, MCP, subagents, handoffs, session resume, cancellation, checkpointing, sandboxing, and telemetry.

Offisim SHALL select the adapter only when the employee task intent fits the declared and verified capability profile.

#### Scenario: Tool-capable employee profile is explicit
- **WHEN** an internal employee is configured with a SDK-backed agent engine that can use native tools inside its sandbox
- **THEN** the employee's runtime binding references a capability profile that names those native capabilities
- **AND** Offisim records that they are employee-runtime capabilities, not provider lane capabilities

#### Scenario: Task intent exceeds profile
- **WHEN** an employee profile is text-only but the task requires workspace file edits
- **THEN** employee execution fails fast or routes to an explicitly configured gateway-capable employee
- **AND** the text-only engine does not attempt the task

#### Scenario: Capability gap cannot silently downgrade execution
- **WHEN** the selected employee agent profile cannot satisfy the task intent
- **THEN** Offisim blocks or asks for an explicit runtime change
- **AND** it does not silently downgrade to provider mode, gateway mode, or another employee engine

### Requirement: Agent engine telemetry SHALL be normalized into Offisim evidence
Employee agent engines SHALL stream activity into Offisim's runtime event model. Text, reasoning, tool start, tool completion, subagent activity, handoff proposals, permission denials, errors, and cancellation SHALL be normalized into auditable events with employee, task-run, and runtime-profile identifiers.

Telemetry SHALL distinguish native agent tool activity from Offisim gateway tool activity.

#### Scenario: Native SDK tool event is not mislabeled as Offisim gateway tool
- **WHEN** a configured employee agent engine runs a native SDK tool inside its own sandbox
- **THEN** Offisim records the event as native engine activity
- **AND** completion verifier does not count it as Offisim file/shell evidence unless the profile declares and proves an equivalent gateway bridge

#### Scenario: Gateway-bridged tool event counts as Offisim evidence
- **WHEN** a configured employee agent engine invokes a verified gateway bridge for a file or shell task
- **THEN** Offisim records gateway tool evidence with task-run identity
- **AND** the completion verifier may count it for the relevant task intent

### Requirement: Employee agent handoffs SHALL become proposals unless Offisim applies them
If an employee agent runtime proposes handoff, delegation, or global plan changes, Offisim SHALL record those as proposals. The runtime SHALL NOT mutate global plan state, pending assignments, or formal office employee routing directly.

#### Scenario: Agent handoff proposal does not reroute automatically
- **WHEN** an employee agent engine proposes handing work to another internal or external employee
- **THEN** Offisim records an engine proposal
- **AND** no formal handoff event is emitted until Offisim approves and applies the proposal
