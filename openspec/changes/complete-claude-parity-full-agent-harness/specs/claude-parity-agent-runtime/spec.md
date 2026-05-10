## ADDED Requirements

### Requirement: Parity ledger SHALL be the release contract

Offisim SHALL maintain a Claude-parity agent runtime ledger that maps reference capabilities from ClaudeSource, ClaudeRust, Claude Agent SDK, Codex/OpenAI agent runtimes, MCP, and external employee protocols to explicit Offisim modules, evidence gates, and release status.

Each row SHALL include reference source, Offisim owner, required behavior, deterministic/backend gate, release `.app` gate when user-visible, evidence class, task family, current status, and remaining blocker. A capability SHALL NOT be marked shipped from documentation, SDK availability, external-agent health, or source reference alone.

#### Scenario: Reference capability cannot self-promote

- **WHEN** ClaudeSource, ClaudeRust, or an SDK exposes a capability such as session resume, MCP lifecycle, hooks, subagents, or tool streaming
- **THEN** the parity ledger records it as reference or pending until Offisim has a named module and gate
- **AND** product docs do not call it shipped without Offisim evidence

#### Scenario: Release claim requires ledger closure

- **WHEN** a release candidate claims Claude-class harness parity
- **THEN** every parity-ledger row is `shipped`, `verified-lower-scope`, or `explicitly-unavailable`
- **AND** any `pending`, `backend-only`, or `release-blocked` row prevents archive or product availability claims

### Requirement: Cross-route benchmark SHALL compare default and full-agent routes

Offisim SHALL provide a benchmark matrix that runs equivalent tasks through the default `offisim-core` harness and every candidate full-agent route. The matrix SHALL compare task completion, tool correctness, denied-path behavior, context retention, cancellation, resume/fork, MCP behavior, rollback/checkpoint, process cleanup, cost/usage, latency, telemetry, and evidence quality.

The benchmark SHALL include at least one file read/write/edit/patch task, grep/search task, shell/process task, git/worktree task, MCP tool task, artifact/deliverable task, memory/todo/skill task, long-context task, subagent/handoff task, cancellation task, denied sandbox escape task, credential-boundary task, budget exhaustion task, rollback task, and pure text task.

#### Scenario: Full-agent promotion runs same task set

- **WHEN** a Claude/Codex/OpenAI full-agent profile is proposed for production availability
- **THEN** the benchmark runs the same task set through `offisim-core` and that profile
- **AND** promotion is blocked if the profile lacks evidence for a required task class

#### Scenario: Default harness regression blocks parity

- **WHEN** the benchmark shows `offisim-core` materially weaker than the verified full-agent route for an Offisim core workflow
- **THEN** the release report records the gap as a default-harness blocker or an explicit product trade-off
- **AND** the change cannot archive with a vague "SDK route covers it" explanation

### Requirement: Parity completion SHALL be a single integrated scope

The parity change SHALL NOT be considered complete by landing only a small subset such as one more replay scenario, one adapter text path, or one UI availability label. Completion SHALL require default harness gates, full-agent profile gates, benchmark evidence, release `.app` verification, and stale truth-source cleanup.

#### Scenario: Partial gate does not complete the change

- **WHEN** deterministic backend gates pass but release `.app` full-agent evidence is missing
- **THEN** tasks for release verification remain unchecked
- **AND** the full-agent profile remains unavailable

#### Scenario: Blocked profile is not a completion state

- **WHEN** `sdk-native-full-power` remains blocked due to missing native tools, MCP, resume, cancellation, rollback, sandbox, or telemetry evidence
- **THEN** the implementation task remains open
- **AND** the blocked state is recorded as a blocker, not a delivered outcome

### Requirement: Source-backed feature map SHALL govern parity scope

Offisim SHALL maintain a source-backed feature map for this change. Each feature row SHALL document
the user/business logic, ClaudeSource anchors, ClaudeRust anchors or an explicit missing-counterpart
note, Offisim target behavior, required gates, and non-copy decisions.

#### Scenario: Adding a parity feature

- **WHEN** a feature, task, benchmark scenario, or release claim is added to this change
- **THEN** it SHALL reference a row in `reference-feature-map.md`
- **AND** the row SHALL include source anchors and Offisim gate criteria before the work is marked complete

#### Scenario: Reference sources diverge

- **WHEN** ClaudeSource and ClaudeRust imply different implementation shape or coverage
- **THEN** Offisim SHALL record the product decision in the feature map
- **AND** missing source coverage SHALL be explicit rather than implied

#### Scenario: Stale docs or memory contradict the feature map

- **WHEN** stale docs, memory, or previous task notes claim a feature is blocked, text-only, backend-only, or already satisfied by model transport
- **THEN** the feature map SHALL be treated as the current parity contract
- **AND** the stale claim SHALL be removed or marked unavailable with evidence
