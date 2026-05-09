## ADDED Requirements

### Requirement: SDK-native employee runtime SHALL preserve full agent capability

Offisim SHALL support a distinct SDK-native employee runtime profile for Claude, Codex, and OpenAI agent SDKs. This profile SHALL be separate from internal model transport/provider-adapter use. When selected and verified, it SHALL run the SDK as a full agent runtime rather than reducing it to final text output.

The profile SHALL preserve the SDK's declared capabilities where available: native tools, custom tools, MCP servers, hosted tools, permission callbacks, hooks, guardrails, handoffs/subagents, streaming partial messages, sessions, resume, fork, checkpoint/file checkpointing, interrupt/cancel, model/fallback selection, budget/max-turn controls, sandbox settings, tracing, cost/usage, structured output, and typed error/partial-state recovery.

#### Scenario: SDK full-power profile is not one-shot text

- **WHEN** an employee is assigned to a verified SDK-native full-power profile
- **THEN** Offisim does not force `maxTurns=1`, discard native tool events, hide MCP status, or collapse the result to final text only
- **AND** the activity stream includes model, tool, permission/guardrail, handoff/subagent, cancellation, checkpoint, usage, and error events that the SDK exposes

#### Scenario: SDK full-power profile has scoped authority

- **WHEN** the SDK runtime requests native file, shell, MCP, hosted, or custom tool access
- **THEN** Offisim maps that request to the profile's sandbox, allow/deny policy, budget, workspace scope, and audit ledger
- **AND** a denied request is visible as a denied-path event rather than disappearing inside the SDK

### Requirement: SDK-native runtime SHALL integrate with Offisim evidence without pretending to be gateway

Native SDK tool activity SHALL be recorded as SDK-native evidence. It SHALL NOT be mislabeled as Offisim gateway evidence unless the profile declares a verified gateway bridge for that tool class.

Completion verification SHALL understand the evidence class required by the task. A task that requires Offisim-local workspace mutation SHALL require gateway evidence or an explicitly verified SDK-native/gateway-bridge equivalence record.

#### Scenario: Native SDK tool evidence is typed

- **WHEN** a full-power SDK runtime edits a file through its native tool model
- **THEN** Offisim records the tool event as SDK-native file evidence with runtime profile, sandbox root, permission decision, and checkpoint identity
- **AND** the completion verifier accepts it only if the runtime profile has release evidence for that task class

#### Scenario: Gateway bridge evidence remains distinct

- **WHEN** a SDK runtime invokes an Offisim gateway-bridged tool
- **THEN** Offisim records gateway evidence with task-run identity
- **AND** the activity feed shows that the SDK agent proposed or initiated the bridge while Offisim executed the tool boundary

### Requirement: SDK-native runtime SHALL pass full-power release gates before product availability

Each SDK-native full-power runtime profile SHALL pass release `.app` gates before it can be advertised as available. The gates SHALL cover:

- text-only success and multi-turn tool success
- native tool success and denied native tool path
- MCP/server listing, MCP tool call, MCP failure, MCP cancellation, and MCP status reporting
- session resume and session fork
- checkpoint or file checkpoint rollback
- hook/guardrail allow and deny behavior
- handoff/subagent telemetry
- interrupt/cancel during model turn and during tool execution
- max-turn/budget exhaustion with partial state preserved
- tracing/cost/usage reporting
- sandbox escape denial
- final completion evidence classification

#### Scenario: Missing release gate blocks full-power label

- **WHEN** a SDK-native profile lacks any required non-happy-path release gate
- **THEN** the profile remains preview-blocked or lower-tier
- **AND** product UI, docs, and provider matrix do not call it "full-power", "full-agent", or production available

#### Scenario: Full-power SDK benchmark compares against default harness

- **WHEN** a SDK-native full-power profile is release-tested
- **THEN** the same benchmark task runs through `offisim-core` and the SDK-native profile
- **AND** the report compares completion quality, tool correctness, context retention, cancellation behavior, cost/latency, and audit evidence
