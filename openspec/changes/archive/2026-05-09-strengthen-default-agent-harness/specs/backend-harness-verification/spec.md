## ADDED Requirements

### Requirement: Baseline red harness gates SHALL be entry blockers
Before this change can be marked implementation-ready or archived, the current baseline deterministic and context harness failures SHALL be fixed or explicitly recorded as blockers. `pnpm harness:deterministic` and `pnpm harness:context` SHALL pass before new default-harness parity claims are accepted.

#### Scenario: Deterministic replay remains red
- **WHEN** `pnpm harness:deterministic` fails on existing replay scenarios
- **THEN** this change remains unarchiveable
- **AND** no new harness parity task may be marked complete based only on unrelated passing smoke tests

#### Scenario: Context harness crashes
- **WHEN** `pnpm harness:context` crashes or produces zero retained-context metrics
- **THEN** context-survival requirements remain blocked
- **AND** the failure must be fixed before release sign-off

### Requirement: Backend harness SHALL include reference-parity suites
Backend harness verification SHALL include suites that prove Offisim-owned behavior for capabilities absorbed from the two reference implementations and Context7-verified SDK/protocol docs.

The suites SHALL cover at minimum: session resume/fork, multi-turn tool loop, permission denial, missing tool-result recovery, output/token limit recovery, context compaction, MCP initialize/list/call/cancel/shutdown, subagent/handoff proposals, cancellation, provider retry taxonomy, and completion evidence.

#### Scenario: Reference capability without suite is pending
- **WHEN** the capability map lists a reference capability but no deterministic, replay, backend, or release gate covers it
- **THEN** the capability is marked pending
- **AND** provider or product UI does not advertise it as production-ready

#### Scenario: MCP lifecycle suite runs without frontend
- **WHEN** the backend MCP lifecycle suite runs
- **THEN** it initializes a real or fixture MCP server, negotiates capabilities, lists tools/resources/prompts where supported, executes a permitted tool call, cancels an in-flight request, and shuts down
- **AND** the result records each lifecycle step separately

### Requirement: Harness reporting SHALL separate Offisim runtime failures from agent runtime failures
Harness reports SHALL classify failures by boundary: Offisim runtime, provider transport, SDK/agent runtime, MCP server, permission policy, context budget, cancellation, checkpoint, or release environment. Reports SHALL include runtime profile and harness mode when non-default agent engines are involved.

#### Scenario: SDK runtime failure is not blamed on Offisim core
- **WHEN** a configured employee agent engine fails inside its SDK runtime
- **THEN** the harness report classifies the failure as SDK/agent runtime
- **AND** it records whether Offisim core policy and checkpoint handling behaved correctly

#### Scenario: Offisim permission denial is not provider failure
- **WHEN** a tool call is denied by Offisim permission policy
- **THEN** the harness report classifies it as permission policy
- **AND** it is not counted as an upstream provider failure
