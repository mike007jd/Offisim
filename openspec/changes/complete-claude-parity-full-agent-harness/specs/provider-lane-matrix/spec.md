## ADDED Requirements

### Requirement: Provider lane matrix SHALL separate transport evidence from runtime-profile evidence

`openspec/provider-lane-matrix.md` SHALL record provider transport evidence and full-agent runtime-profile evidence as separate facts. A provider row that says `gateway`, `claude-agent-sdk`, or `openai-agents-sdk` transport is verified SHALL NOT imply that an employee full-agent profile, driver profile, or replacement profile is available.

For every promoted full-agent profile, the matrix or linked evidence report SHALL name provider product, access mode, transport, runtime profile id, host scope, credential destination class, supported task families, deterministic gate, benchmark gate, release `.app` evidence, and remaining blockers.

#### Scenario: Transport smoke cannot promote full-agent

- **WHEN** `openspec/provider-lane-matrix.md` records a successful SDK-backed model transport smoke
- **THEN** only the transport evidence column may become verified
- **AND** full-agent profile availability remains pending until profile, benchmark, and release evidence are recorded

#### Scenario: Full-agent row names task-family evidence

- **WHEN** a Claude, Codex, or OpenAI full-agent profile is promoted
- **THEN** the matrix or linked report records exactly which task families are verified, such as file/edit, shell/process, MCP, git/worktree, attachment, deliverable, memory/todo/skill, resume/fork, rollback, and cancellation
- **AND** unsupported task families remain unavailable rather than being inherited from provider transport
