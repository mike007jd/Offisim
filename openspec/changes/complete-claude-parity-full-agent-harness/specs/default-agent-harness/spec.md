## ADDED Requirements

### Requirement: Default harness parity SHALL be release-blocking

The default `offisim-core` harness SHALL meet the Claude-class agent floor for Offisim's local productivity workflows before the product claims harness parity. The floor includes bounded multi-turn loop, streaming text/reasoning/tool activity, safe tool orchestration, permission/audit, context retention and compaction, session resume/checkpoint, cancellation, MCP lifecycle, sandbox enforcement, completion evidence, usage/cost reporting, and typed failure taxonomy.

The local productivity floor SHALL explicitly cover file tree, read/write/edit/patch, grep/search, shell/process lifecycle, git/worktree, artifact/deliverable, memory/todo/skill, browser/desktop boundary where supported, secret redaction, and provider credential boundary behavior.

Backend deterministic gates SHALL prove semantics. Release `.app` gates SHALL prove user-visible local execution, denied path, cancellation, resume/checkpoint, and evidence surfaces in the desktop product.

#### Scenario: Backend-only evidence is insufficient for parity claim

- **WHEN** deterministic harness gates pass for a default-harness capability
- **AND** the capability affects release desktop interaction or local execution
- **THEN** release `.app` verification is still required before marking that capability release-shipped

#### Scenario: Offisim owns the loop

- **WHEN** a normal employee task runs without explicit verified override
- **THEN** `offisim-core` owns planning, tool selection, permissions, checkpoints, task state, telemetry, and completion evidence
- **AND** vendor SDK/model transport code is not treated as the product runtime owner

#### Scenario: File edit plus git proof requires matching evidence

- **WHEN** a task asks a normal employee to edit files and show the resulting diff
- **THEN** default harness gates require file/edit and git/worktree evidence under the same task-run identity
- **AND** a final text summary without accepted evidence cannot satisfy parity

### Requirement: Default harness SHALL absorb reference outcomes without copying ownership

Offisim SHALL use ClaudeSource and ClaudeRust as reference baselines for behavior, but SHALL implement or verify Offisim-owned equivalents rather than copying reference ownership. Reference mechanisms such as streaming tool execution, tool-pool stability, permission hooks, compact/resume, CLI tool policies, and mock parity harnesses SHALL map to Offisim modules and evidence.

#### Scenario: ClaudeSource behavior maps to Offisim module

- **WHEN** the parity ledger lists a ClaudeSource behavior such as early read-only tool execution or session restore
- **THEN** it identifies the Offisim module and gate that provides the same product outcome
- **AND** a missing mapping remains a release blocker

#### Scenario: ClaudeRust tool policy maps to Offisim boundary

- **WHEN** the parity ledger lists a ClaudeRust behavior such as workspace-bounded file write or permission-mode enforcement
- **THEN** Offisim proves the equivalent through gateway/builtin tool gates or a verified full-agent profile
- **AND** the product does not claim parity from ClaudeRust documentation alone
