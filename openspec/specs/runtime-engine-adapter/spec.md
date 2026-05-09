# runtime-engine-adapter Specification

## Purpose

Defines Offisim employee engine mode: a per-employee runtime binding that delegates one Offisim-dispatched employee task to a trusted external runtime adapter while Offisim retains ownership of SOP planning, DAG dispatch, approvals, knowledge orchestration, and global graph state.
## Requirements
### Requirement: Employee runtime binding SHALL be separate from provider binding

`ProviderConfig.executionLane` SHALL remain a provider leaf adapter choice. Employee engine mode SHALL be configured through employee runtime binding.

- Company runtime policy MAY define `employeeRuntimeDefault`
- Employee `config_json.runtimeBinding` SHALL override the company default
- Absence of both SHALL resolve to `{ mode: "provider" }`

#### Scenario: Company default provider
- **WHEN** no company default and no employee override exist
- **THEN** the employee executes through Offisim provider mode

#### Scenario: Employee override wins
- **WHEN** company default is `claude-engine` and employee config selects `codex-engine`
- **THEN** the employee executes through `codex-engine`

### Requirement: External A2A employee SHALL remain a separate branch

If `employee.is_external === 1`, employee execution SHALL route to A2A before reading employee runtime binding. A2A employees SHALL NOT be treated as local engine-mode employees.

#### Scenario: External ignores engine config
- **WHEN** an external employee row contains `config_json.runtimeBinding.mode = "engine"`
- **THEN** `employee-node` still invokes the A2A executor
- **AND** no local engine adapter is started

### Requirement: Engine adapter SHALL translate runtime activity into Offisim events

An `EngineAdapter` SHALL expose `startRun(taskEnvelope, context)` and `cancelRun(runId)`. A run handle SHALL include `runId`, `events: AsyncIterable<RuntimeActivityEvent>`, and a terminal result.

The employee engine executor SHALL map engine activity into Offisim event families. It SHALL NOT directly mutate `TaskPlan`, `pendingAssignments`, `currentStepOutputs` except by returning the normal employee completion state update after the assigned task finishes.

Unverified SDK-backed model transports SHALL NOT expose Offisim file, shell, memory, todo, skill, or MCP tools. SDK/native runtime activity MUST be truthful: placeholder activity such as “engine accepted the assigned task” MUST NOT be emitted when no real stream, tool, completion, or error event exists.

If a trusted sidecar host later emits legal tool lifecycle events, those events SHALL be serialized as JSON over the trusted IPC channel and consumed by `apps/web/src/lib/tauri-engine-adapters.ts`. The adapter SHALL yield `RuntimeActivityEvent` items with `kind: 'tool_started'` and `kind: 'tool_completed'`, using the same structural fields rendered for gateway lane tool activity.

#### Scenario: Stream and tool mapping
- **WHEN** an engine emits text, reasoning, tool-started, and tool-completed activity
- **THEN** Offisim emits `llm.stream.chunk` and `tool.execution.telemetry` events with employee/task context

#### Scenario: Unverified SDK transport does not expose Offisim tools
- **WHEN** a Claude Agent SDK or Codex Agent SDK transport runs under the Offisim model-calling boundary without a verified full-power runtime profile
- **THEN** it does not expose Offisim file, shell, memory, todo, skill, or MCP tools
- **AND** the activity stream does not imply those tools ran

#### Scenario: Trusted host tool event maps when legally emitted
- **WHEN** a trusted host emits a `ToolStarted` or `ToolCompleted` IPC event from a legal host-side tool path
- **THEN** `tauri-engine-adapters.ts` yields a `RuntimeActivityEvent` with `kind: 'tool_started'` or `kind: 'tool_completed'`
- **AND** provider-specific sidecar payload fields do not leak into the renderer contract

#### Scenario: Placeholder activity is removed
- **WHEN** SDK-backed transport or runtime accepts an assigned task but no real tool has started
- **THEN** the activity stream does not emit a synthetic “engine accepted the assigned task” row
- **AND** the activity feed waits for real stream, tool, completion, or error events

#### Scenario: SDK tool parity is not faked
- **WHEN** no legal SDK-backed tool path exists
- **THEN** replay and live verification do not fabricate gateway-vs-SDK tool parity
- **AND** local file or shell tasks continue to route through the current verified default harness / gateway path unless a separate tool-capable employee profile has release evidence

#### Scenario: Artifact completion
- **WHEN** an engine returns an artifact
- **THEN** employee finalization emits `deliverable.created`
- **AND** the final step output contains the artifact as a normal employee deliverable

### Requirement: Engine proposals SHALL protect global SOP state

Engines SHALL NOT directly change global plan, pending assignment queue, step outputs, or cross-employee dispatch. Plan-affecting or permission-affecting intents SHALL be emitted as `EngineProposal`.

#### Scenario: Handoff proposal does not create handoff event
- **WHEN** an engine proposes a cross-employee handoff
- **THEN** Offisim emits `engine.proposal.created`
- **AND** no `handoff.initiated` or `handoff.completed` event is emitted until Offisim approves and applies the transfer through the existing handoff mechanism

### Requirement: Engine internal subagents SHALL be employee-internal activity

Engine internal subagents, handoffs, or micro-plans SHALL be displayed as runtime activity under the assigned employee. They SHALL NOT create formal office employees or drive the existing `handoff.*` event contract in the first version.

#### Scenario: Internal subagent display
- **WHEN** `codex-engine` starts an internal worker
- **THEN** Offisim emits `engine.activity` with `kind = "subagent"`
- **AND** the office route planner does not add a new formal employee path

### Requirement: Browser-limited runtimes SHALL fail closed

Trusted engine adapters SHALL be available only in trusted desktop/backend runtimes. Browser-limited runtimes SHALL not silently downgrade engine mode into provider mode.

#### Scenario: Browser runtime has no adapter
- **WHEN** an employee selects `codex-engine` in browser-limited runtime
- **THEN** employee execution fails closed with an unavailable-engine error
- **AND** Offisim does not run the task through a different engine or provider path without explicit configuration

### Requirement: Runtime context SHALL surface available engine adapters to the UI layer

`OffisimRuntimeContext` SHALL expose the set of currently registered engine adapter IDs as a `ReadonlySet<EngineId>` named `availableEngineAdapters`. UI surfaces that gate engine binding choices SHALL read from this set rather than branching on platform identity.

#### Scenario: Available set reflects empty registry
- **WHEN** runtime initialization registers no engine adapters
- **THEN** `availableEngineAdapters` SHALL be an empty `ReadonlySet<EngineId>`
- **AND** the UI binding control SHALL render `claude-engine` and `codex-engine` choices as disabled

#### Scenario: Available set reflects partial registry
- **WHEN** runtime initialization registers only `claude-engine`
- **THEN** `availableEngineAdapters` SHALL contain exactly `{ 'claude-engine' }`
- **AND** the UI binding control SHALL render `codex-engine` as disabled while `claude-engine` is enabled

#### Scenario: Available set reflects full trusted desktop registry
- **WHEN** trusted desktop runtime registers both `claude-engine` and `codex-engine`
- **THEN** `availableEngineAdapters` SHALL contain both IDs
- **AND** the UI binding control SHALL render both engines as enabled

### Requirement: Trusted desktop runtime SHALL register engine adapters by default

The Tauri-backed runtime initialization in `apps/web/src/lib/tauri-runtime.ts` SHALL invoke `createTauriEngineAdapterRegistry({ enableProviderHostPreviewAdapters: true })`, registering both `claude-engine` and `codex-engine` adapters by default. The browser runtime SHALL continue to receive an empty engine adapter map.

#### Scenario: Tauri runtime registers both engines
- **WHEN** the Tauri runtime initializes via `createTauriRuntimeInit(...)`
- **THEN** `runtimeCtx.engineAdapters` SHALL contain entries for both `'claude-engine'` and `'codex-engine'`

#### Scenario: Browser runtime registers no engines
- **WHEN** the browser runtime initializes
- **THEN** `runtimeCtx.engineAdapters` SHALL be empty (or `undefined`)

### Requirement: Engine mode UI surfaces SHALL render a preview disclosure

While engine adapters surface only partial runtime activity (text, reasoning, run completion) and lack tool execution telemetry and engine-handoff proposal events, any UI surface that displays the resolved binding as engine mode SHALL render a visible "Preview · limited tool telemetry" disclosure adjacent to the binding indicator.

#### Scenario: Personnel Runtime tab shows preview disclosure when engine resolved
- **WHEN** the resolved employee runtime binding is engine mode
- **THEN** the Personnel Runtime tab card SHALL render the preview disclosure

#### Scenario: Provider mode never shows preview disclosure
- **WHEN** the resolved binding is `{ mode: 'provider' }`
- **THEN** the Personnel Runtime tab card SHALL NOT render the preview disclosure

### Requirement: SDK-backed model transports SHALL fail closed for local tools

SDK-backed model transport bindings SHALL NOT receive Offisim builtin tools unless a separate verified employee runtime or gateway bridge profile grants that authority.
This covers `claude-agent-sdk`, `codex-agent-sdk`, and
`openai-agents-sdk`, including file / shell / memory / todo / skill /
MCP tools. These transports are not employee agent profiles and do not
create an ordinary SDK product lane. Tool-capable work uses the default
Offisim harness / gateway path today, or a separately verified
tool-capable employee profile once such a profile has release evidence.
SDK-backed transport adapters that receive a tool request from the model SHALL fail
closed (return an error result, not silently route to a side channel).
When the user request itself is classified as requiring local Offisim
tools, SDK-backed transports SHALL fail fast before any model call with a
typed, chat-visible outcome explaining the required runtime switch.

#### Scenario: claude-agent-sdk transport has no builtin tools in its kit

- **WHEN** an Offisim-owned model call is bound to `claude-agent-sdk` transport
- **AND** a chat session starts on that employee
- **THEN** the assembled tool kit for that session SHALL NOT include
  `read_file`, `write_file`, `bash`, memory, todo, skill, or MCP tools

#### Scenario: codex-agent-sdk transport fails closed on tool request

- **WHEN** an Offisim-owned model call is bound to `codex-agent-sdk` transport
- **AND** the model returns a tool-call request anyway
- **THEN** the adapter SHALL return an error result identifying the
  request as out of transport authority
- **AND** SHALL NOT route the request to the gateway lane's builtin
  sandbox

#### Scenario: SDK transport local-tool request short-circuits before model

- **WHEN** a boss, direct employee, or YOLO chat session would call a model through
  `claude-agent-sdk`, `codex-agent-sdk`, or `openai-agents-sdk` transport
- **AND** the user asks to read files, write files, run shell commands,
  access workspace tools, memory, todo, skills, or MCP tools
- **THEN** the graph SHALL return a typed chat outcome before any model
  call
- **AND** it SHALL NOT create task runs, execute tools, or write MCP
  audit rows
- **AND** the user-visible follow-up SHALL tell the user to use the
  default Offisim harness/gateway tool path or a verified tool-capable employee profile

### Requirement: Every chat transport SHALL receive the same active-context snapshot at session-start

Every chat transport SHALL read the same active-context snapshot at session-start.
This covers gateway, claude-agent-sdk, codex-agent-sdk, and
openai-agents-sdk. The snapshot includes active-{project, company,
employee, workspace_root, providerConfig} from the same canonical
resolver. Transports SHALL NOT carry their own divergent init path that
forks from the canonical resolver under any platform (release `.app` /
desktop dev / web dev).

#### Scenario: Snapshot equivalence across transports

- **GIVEN** an active project P, active company C, and active
  employee E with engine ∈ {gateway, claude-agent-sdk,
  codex-agent-sdk, openai-agents-sdk}
- **WHEN** a chat session starts on E
- **THEN** the session-start snapshot SHALL be byte-equivalent to
  what the gateway lane would have read for the same E (excluding
  tool-kit fields, which are transport/profile-specific per the
  model transport boundary)

#### Scenario: Release `.app` transport has no fork from dev transport

- **WHEN** a release `.app` session starts on any transport
- **THEN** the resolver path consulted at session-start SHALL be the
  same module / function as in desktop dev
- **AND** SHALL NOT have a release-only branch that bypasses the
  canonical resolver

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
