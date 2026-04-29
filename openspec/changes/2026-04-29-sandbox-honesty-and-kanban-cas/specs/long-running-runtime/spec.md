## MODIFIED Requirements

### Requirement: Deterministic harness scenarios cannot self-attest LLM mock text

The harness contract SHALL reject any scenario where a `finalOutputContains` assertion exactly equals an LLM fixture response. Structural assertions and product-generated final strings SHALL be used instead.

#### Scenario: Self-attest scenario fails during load
- **WHEN** a scenario asserts that final output contains text exactly equal to an `llmTurns[].content` value
- **THEN** `scripts/harness-contract.mjs` exits non-zero during load

### Requirement: Long-running runtime hot paths remain bounded

Soak execution SHALL aggregate leak and latency results without retaining every trace report in memory. PM heartbeat SHALL skip database scans when the plan progress snapshot has not changed. Plan persistence SHALL create task-run rows and kanban rows in bounded parallel batches rather than serial per-step awaits.

#### Scenario: Soak leak samples are bounded
- **WHEN** soak runs multiple iterations with concurrency
- **THEN** the retained sample failure list is capped
- **AND** memory growth remains bounded for the configured run

#### Scenario: Heartbeat no-op does not scan task runs
- **WHEN** dispatched, completed, blocked, and plan signatures are unchanged since the last heartbeat
- **THEN** the heartbeat returns without scanning task-run or agent-event repositories
