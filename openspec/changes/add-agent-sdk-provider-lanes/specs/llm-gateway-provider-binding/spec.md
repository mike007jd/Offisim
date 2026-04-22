## MODIFIED Requirements

### Requirement: A runtime has exactly one active model execution binding bound to its ProviderConfig

Each `RuntimeContext` SHALL hold a single active model execution binding constructed once during runtime init from the active `ProviderConfig`, including its selected execution lane. The active binding MAY be:

- a `gateway` lane backed by `createGateway(...)`, or
- an agent SDK lane backed by a single Offisim-owned execution adapter (`claude-agent-sdk` or `openai-agents-sdk`)

All LLM-calling nodes and services — `boss-node`, `manager-node`, `hr-node`, `pm-planner-node`, `employee-node` (direct + team chat paths), `RecordedSystemLlmCaller`, and middleware — SHALL reach the active binding through one Offisim-owned execution abstraction. Per-scope execution-binding rebuilding is forbidden.

#### Scenario: Gateway lane creates one gateway per runtime init

- **WHEN** a runtime selects `executionLane = "gateway"`
- **THEN** exactly one `createGateway(...)` invocation per runtime-bundle-init exists
- **AND** no node / service / middleware file directly instantiates provider SDK clients outside the active Offisim execution binding

#### Scenario: Agent SDK lane creates one execution adapter per runtime init

- **WHEN** a runtime selects `executionLane = "claude-agent-sdk"` or `executionLane = "openai-agents-sdk"`
- **THEN** runtime init creates exactly one active execution adapter for that lane
- **AND** no node / service / middleware file instantiates a second vendor runtime for the same thread

#### Scenario: Boss, manager, employee all hit the same active binding

- **WHEN** a chat turn triggers `boss-node` → `manager-node` → `employee-node`
- **THEN** all three nodes' model calls go through the same active execution binding instance within that runtime
- **AND** switching provider or lane requires a full runtime reinit before subsequent turns use the new binding
