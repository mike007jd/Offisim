## ADDED Requirements

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
