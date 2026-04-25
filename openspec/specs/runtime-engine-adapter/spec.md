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

#### Scenario: Stream and tool mapping
- **WHEN** an engine emits text, reasoning, tool-started, and tool-completed activity
- **THEN** Offisim emits `llm.stream.chunk` and `tool.execution.telemetry` events with employee/task context

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
