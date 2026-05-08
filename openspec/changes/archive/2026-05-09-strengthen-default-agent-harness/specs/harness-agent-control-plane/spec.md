## ADDED Requirements

### Requirement: Non-default agent routes SHALL be production-grade by capability tier
Alternate agent routes SHALL be treated as production-grade optional routes, not thin preview coverage, once they are advertised as available. Each route SHALL declare a capability tier and SHALL pass the evidence gates for that tier before users can select it outside blocked/preview UI.

The tier model SHALL cover at minimum: text-only reasoning, sandbox-native tools, gateway-bridged Offisim tools, employee-agent runtime, main-harness driver, and main-harness replacement. Each tier SHALL state supported task classes, unsupported task classes, telemetry coverage, permission model, cancellation, resume/checkpoint support, rollback behavior, and release evidence.

#### Scenario: Advertised route has a complete tier record
- **WHEN** a non-default route is shown as selectable
- **THEN** its capability tier record includes supported tasks, unsupported tasks, telemetry, permissions, cancellation, resume/checkpoint, rollback, and evidence status
- **AND** missing capability fields block production availability

#### Scenario: Partial route is blocked rather than oversold
- **WHEN** an alternate runtime can answer text but lacks verified cancellation, checkpoint, or denied-path evidence for a higher tier
- **THEN** Offisim marks it text-only or preview-blocked for that tier
- **AND** it does not advertise full employee-agent, driver, or replacement support

### Requirement: Main harness mode SHALL default to offisim-core
Offisim SHALL define a main harness mode policy whose default value is `offisim-core`. Any alternate driver or replacement mode SHALL require explicit trusted runtime configuration and SHALL be unavailable in browser-limited runtime unless a trusted backend/desktop bridge is present.

#### Scenario: No override means offisim-core
- **WHEN** no main harness mode override exists
- **THEN** boss, manager, and internal employee orchestration uses `offisim-core`
- **AND** no alternate agent driver or replacement runtime is initialized

#### Scenario: Browser-limited runtime rejects replacement mode
- **WHEN** browser-limited runtime loads a policy selecting a replacement agent runtime
- **THEN** runtime initialization fails closed with an unavailable-trusted-runtime error
- **AND** Offisim does not silently fall back to an unverified agent path

### Requirement: Harness override SHALL be explicit, scoped, and auditable
Main harness override SHALL resolve only from an explicit policy decision. The policy SHALL record scope, actor, reason, previous mode, next mode, runtime profile, verification status, timestamp, and rollback checkpoint. Provider lane selection, employee runtime binding, SDK availability, or external peer discovery SHALL NOT implicitly override the main harness mode.

The resolution order SHALL be deterministic and visible: system default `offisim-core`, then explicit trusted policy at the configured scope. The most specific valid policy wins only if it passes trust and verification checks.

#### Scenario: Provider lane cannot override main harness
- **WHEN** a provider config selects `claude-agent-sdk`, `codex-agent-sdk`, or `openai-agents-sdk`
- **THEN** main harness mode remains `offisim-core` unless a separate explicit harness policy selects another mode
- **AND** no SDK lane can self-promote into driver or replacement mode

#### Scenario: Override audit record is required
- **WHEN** an admin changes main harness mode from `offisim-core` to driver or replacement mode
- **THEN** Offisim records actor, reason, scope, previous mode, next mode, runtime profile, timestamp, and rollback checkpoint
- **AND** the change is rejected if any required audit field is missing

#### Scenario: Invalid override rolls back cleanly
- **WHEN** an override policy fails trust, verification, or runtime availability checks
- **THEN** Offisim keeps or restores `offisim-core`
- **AND** records the failed override as blocked rather than silently selecting another runtime

### Requirement: Agent driver mode SHALL propose actions rather than execute Offisim tools directly
In driver mode, an external or SDK-backed agent MAY inspect the assigned context and propose harness actions, but Offisim SHALL execute approved actions through its own planner, tool, permission, checkpoint, and task-state pipeline.

Driver mode SHALL NOT grant the driver direct access to Offisim file, shell, memory, todo, skill, MCP, or workspace tools.

#### Scenario: Driver proposes a file edit
- **WHEN** an agent driver proposes a file edit for a task
- **THEN** Offisim records an `agent.proposal.created` event
- **AND** the actual edit, if approved, executes through the Offisim gateway tool path

#### Scenario: Denied proposal does not mutate task state
- **WHEN** permission policy denies an agent driver's proposed action
- **THEN** no tool execution occurs
- **AND** task state records the denial without marking the task completed

### Requirement: Agent replacement mode SHALL pass equivalence gates before release
Replacement mode SHALL delegate a run segment to a trusted agent runtime only when that runtime profile passes equivalence gates for active context, permissions, audit events, cancellation, checkpoint handoff, completion evidence, and rollback.

Replacement mode SHALL remain disabled by default until those gates pass for the exact runtime profile.

#### Scenario: Replacement without equivalence evidence is blocked
- **WHEN** a runtime profile lacks current equivalence evidence
- **THEN** the main harness policy refuses to select it as replacement mode
- **AND** release verification reports the profile as blocked

#### Scenario: Replacement run returns checkpoint handoff
- **WHEN** a trusted replacement runtime completes or blocks a run segment
- **THEN** it returns a checkpoint handoff shape that Offisim can replay or roll back
- **AND** Offisim persists the terminal state through its own checkpoint store

#### Scenario: Replacement cannot skip denied-path evidence
- **WHEN** a replacement runtime profile lacks release evidence for denied tool use, cancellation, resume, or rollback
- **THEN** the profile cannot be selected as production replacement mode
- **AND** Offisim keeps the route blocked even if the success path works

### Requirement: Control plane SHALL expose auditable capability profiles
Every non-default agent driver or replacement runtime SHALL declare a capability profile. The profile SHALL include identity, trust tier, allowed task classes, available tools or native agent capabilities, sandbox boundary, permission callback behavior, context retention model, cancellation support, checkpoint support, telemetry stream, and failure taxonomy.

#### Scenario: Runtime profile is visible before selection
- **WHEN** an admin views an alternate main harness runtime
- **THEN** the UI/API exposes its capability profile and verification status
- **AND** unverified capabilities are marked pending or blocked

#### Scenario: Profile mismatch fails fast
- **WHEN** a task requires local shell access and the selected runtime profile lacks a verified shell-capable gateway bridge
- **THEN** Offisim rejects the runtime selection for that task before model execution
- **AND** it recommends the default Offisim core or a verified gateway-capable profile

### Requirement: Agent employees SHALL remain employees, not hidden harness owners
When a configured employee uses a rich agent runtime, that runtime SHALL be scoped to the assigned employee task. It MAY run internal subagents or native handoffs inside the employee runtime, but those internal activities SHALL appear as employee runtime activity and SHALL NOT create formal Offisim employee handoffs unless Offisim approves and applies a proposal.

#### Scenario: Employee-native subagent is displayed as activity
- **WHEN** a configured agent employee starts an internal SDK subagent
- **THEN** Offisim records employee runtime activity
- **AND** the office route planner does not create a new formal employee path

#### Scenario: Employee agent cannot complete global plan directly
- **WHEN** a configured agent employee reports that downstream plan steps are complete
- **THEN** Offisim treats that as a proposal or evidence candidate
- **AND** global plan advancement still runs through Offisim's step and completion logic
