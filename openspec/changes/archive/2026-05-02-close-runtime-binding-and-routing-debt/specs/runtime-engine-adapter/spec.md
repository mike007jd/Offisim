## MODIFIED Requirements

### Requirement: Engine adapter SHALL translate runtime activity into Offisim events

An `EngineAdapter` SHALL expose `startRun(taskEnvelope, context)` and `cancelRun(runId)`. A run handle SHALL include `runId`, `events: AsyncIterable<RuntimeActivityEvent>`, and a terminal result.

The employee engine executor SHALL map engine activity into Offisim event families. It SHALL NOT directly mutate `TaskPlan`, `pendingAssignments`, `currentStepOutputs` except by returning the normal employee completion state update after the assigned task finishes.

Offisim 1.0 SDK lanes SHALL remain text/reasoning-only and SHALL NOT expose Offisim file, shell, memory, todo, skill, or MCP tools. SDK activity MUST be truthful: placeholder activity such as “engine accepted the assigned task” MUST NOT be emitted when no real stream, tool, completion, or error event exists.

If a trusted sidecar host later emits legal tool lifecycle events, those events SHALL be serialized as JSON over the trusted IPC channel and consumed by `apps/web/src/lib/tauri-engine-adapters.ts`. The adapter SHALL yield `RuntimeActivityEvent` items with `kind: 'tool_started'` and `kind: 'tool_completed'`, using the same structural fields rendered for gateway lane tool activity.

#### Scenario: Stream and tool mapping
- **WHEN** an engine emits text, reasoning, tool-started, and tool-completed activity
- **THEN** Offisim emits `llm.stream.chunk` and `tool.execution.telemetry` events with employee/task context

#### Scenario: SDK lane does not expose Offisim tools
- **WHEN** a Claude Agent SDK or Codex Agent SDK lane runs under the Offisim 1.0 product boundary
- **THEN** it does not expose Offisim file, shell, memory, todo, skill, or MCP tools
- **AND** the activity stream does not imply those tools ran

#### Scenario: Trusted host tool event maps when legally emitted
- **WHEN** a trusted host emits a `ToolStarted` or `ToolCompleted` IPC event from a legal host-side tool path
- **THEN** `tauri-engine-adapters.ts` yields a `RuntimeActivityEvent` with `kind: 'tool_started'` or `kind: 'tool_completed'`
- **AND** provider-specific sidecar payload fields do not leak into the renderer contract

#### Scenario: Placeholder activity is removed
- **WHEN** SDK lane accepts an assigned task but no real tool has started
- **THEN** the activity stream does not emit a synthetic “engine accepted the assigned task” row
- **AND** the activity feed waits for real stream, tool, completion, or error events

#### Scenario: SDK tool parity is not faked
- **WHEN** no legal SDK lane tool path exists
- **THEN** replay and live verification do not fabricate gateway-vs-SDK tool parity
- **AND** local file or shell tasks continue to route through the gateway lane

#### Scenario: Artifact completion
- **WHEN** an engine returns an artifact
- **THEN** employee finalization emits `deliverable.created`
- **AND** the final step output contains the artifact as a normal employee deliverable
