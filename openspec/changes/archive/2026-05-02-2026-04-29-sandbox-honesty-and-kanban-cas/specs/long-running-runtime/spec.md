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

### Requirement: Completion evidence requirements match task intent

Employee completion SHALL require tool evidence only when the task itself requires evidence, local filesystem work, or shell work. File and workspace-read tasks SHALL require successful `read_file` evidence; file-create/write tasks SHALL require successful `write_file` evidence; shell/command tasks SHALL require successful `bash` evidence; explicit verification tasks SHALL require default verification evidence tools.

Plain SOP text-deliverable tasks SHALL NOT be blocked solely because no tool ran, and they SHALL NOT be padded with fake file, shell, or harness evidence.

The evidence classifier SHALL recognize the same local-tool intent in Chinese user/task wording as in English wording, so Chinese file or shell requests cannot pass on a text-only claim.

#### Scenario: File task requires file evidence
- **WHEN** an employee declares completion for a task that asks to read or write a workspace file
- **THEN** completion requires a successful matching `read_file` or `write_file` tool result in the recent evidence window
- **AND** a text-only claim does not complete the task.

#### Scenario: Text SOP deliverable does not require fake tool evidence
- **WHEN** an employee completes an ordinary SOP text handoff step that does not request file, shell, or verification evidence
- **THEN** the task may complete without any tool result
- **AND** no harness or mock-content assertion is accepted as substitute evidence.

#### Scenario: Chinese file request requires file evidence
- **WHEN** an employee declares completion for a Chinese task that asks to read or write a workspace file
- **THEN** completion requires a successful matching file tool result
- **AND** a Chinese text-only claim does not complete the task.
