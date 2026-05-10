## ADDED Requirements

### Requirement: Full-agent SDK profile SHALL be implemented, not permanently parked

Each `sdk-native-full-power` profile SHALL be treated as an implementation target. The profile MAY remain unavailable while evidence is missing, but the implementation plan SHALL close native tool, MCP, session, resume/fork, hook/guardrail, subagent/handoff, cancellation, budget, usage/cost, sandbox, checkpoint/rollback, memory/todo/skill, artifact/deliverable, git/worktree, process-control, credential-boundary, and failure-taxonomy gaps.

#### Scenario: Missing evidence keeps task open

- **WHEN** a full-agent profile lacks any required release gate
- **THEN** the product profile remains unavailable
- **AND** the OpenSpec task for that missing gate remains unchecked

#### Scenario: Full-agent profile becomes selectable only after gates

- **WHEN** every required deterministic, benchmark, and release `.app` gate passes for a profile
- **THEN** the profile may be marked production available
- **AND** Personnel/runtime surfaces show the profile as available with evidence references

### Requirement: SDK-native adapter SHALL preserve native agent semantics

An SDK-native full-agent adapter SHALL preserve the selected runtime's real multi-turn loop and native capability model. It SHALL NOT force `maxTurns=1`, discard native tool events, hide MCP lifecycle, collapse subagents/handoffs into plain text, or strip typed errors into a generic failure.

#### Scenario: Native multi-turn loop survives

- **WHEN** the SDK runtime needs multiple model/tool turns to complete a task
- **THEN** the adapter allows the configured turn/budget policy to continue
- **AND** Offisim records each stream, tool, permission, and terminal event

#### Scenario: Native tool event is visible

- **WHEN** the SDK runtime performs a native file, shell, MCP, hosted, or custom tool action
- **THEN** Offisim records a typed SDK-native tool event with runtime profile, sandbox root, permission decision, task identity, and checkpoint identity
- **AND** completion verification accepts it only for task classes that profile has release evidence for

### Requirement: SDK-native denied path SHALL be first-class evidence

Full-agent SDK profiles SHALL prove denied-path behavior for native tools, gateway-bridged tools, MCP tools, hosted tools, memory/todo/skill operations, artifact/deliverable writes, git/worktree operations, process-control actions, credential access, sandbox escape attempts, and permission/guardrail denials. A denial SHALL be visible in activity, audit, completion verification, and benchmark output.

#### Scenario: Native denial does not disappear

- **WHEN** a SDK-native runtime attempts a denied file write, shell command, MCP call, or sandbox escape
- **THEN** Offisim records a denied-path event with reason and profile identity
- **AND** the task is blocked, retryable, or awaiting approval rather than falsely completed
