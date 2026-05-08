## ADDED Requirements

### Requirement: Offisim core harness SHALL remain the default runtime owner
Offisim SHALL use its own `offisim-core` harness as the default runtime for boss, manager, employee, long-running, local-tool, and release verification flows. The default harness SHALL own planning, routing, permission policy, checkpoint state, task state, tool execution, MCP client lifecycle, cancellation, usage accounting, completion verification, and user-visible evidence.

Vendor SDKs, external A2A peers, and alternate agent runtimes MAY be configured as employee engines or main-harness control-plane modes only through explicit non-default configuration. Their existence SHALL NOT change the default runtime owner.

#### Scenario: Fresh installation uses Offisim core
- **WHEN** a fresh workspace starts a boss or employee task without any runtime override
- **THEN** the task executes through `offisim-core`
- **AND** no Claude Agent SDK, Codex Agent SDK, OpenAI Agents SDK, or external A2A runtime is selected as the main harness

#### Scenario: Local-tool task stays on Offisim-owned tool path
- **WHEN** a user asks an internal employee to read files, write files, run shell commands, use memory, use todo, use skills, or use MCP tools
- **THEN** the default harness routes execution through Offisim-owned gateway tools
- **AND** provider SDK lanes do not receive those Offisim tool definitions

### Requirement: Reference capabilities SHALL map to Offisim harness requirements
Offisim SHALL maintain a harness capability map that records which capabilities were absorbed from the two reference source trees and current SDK/protocol docs. The map MUST distinguish reference inspiration from shipped Offisim evidence.

The map SHALL cover at minimum: persistent conversation state, tool registry, permission filtering, streaming tool execution, missing tool-result recovery, stop hooks, usage and budget tracking, fallback/retry behavior, context compaction, session resume/fork, subagent or handoff semantics, MCP lifecycle, cancellation, and release evidence.

#### Scenario: Capability map blocks vague parity claims
- **WHEN** a maintainer claims Offisim has absorbed a reference runtime capability
- **THEN** the capability map identifies the Offisim module, scenario, or release gate proving it
- **AND** capabilities without evidence are marked pending rather than shipped

#### Scenario: SDK capability is not treated as Offisim capability
- **WHEN** Claude Agent SDK, OpenAI Agents JS, or MCP docs expose a feature such as hooks, handoffs, hosted tools, session resume, or resource notifications
- **THEN** Offisim marks the feature shipped only after Offisim-owned runtime behavior and evidence exist
- **AND** SDK documentation alone is not accepted as release proof

### Requirement: Harness conversation state SHALL persist across a run
The default harness SHALL maintain a run-scoped conversation state object across turns. The state SHALL include messages, pending tool calls, tool results, permission denials, discovered tool and MCP capability snapshots, active context, usage, budget state, retry state, cancellation state, and checkpoint identity.

State SHALL be serializable for checkpoint/resume and SHALL support forked subcontexts without polluting the parent transcript.

#### Scenario: Tool denial survives the next turn
- **WHEN** a tool call is denied by permission policy during a run
- **THEN** the denial is stored in run state
- **AND** the next model turn receives the denial context without rebuilding it from ad hoc UI state

#### Scenario: Forked subtask cannot pollute parent transcript
- **WHEN** the default harness forks a subcontext for a child task
- **THEN** the child receives only the scoped subtask context
- **AND** the parent receives a summary/result, not the full child transcript

### Requirement: Tool loop SHALL recover from protocol and model edge cases
The default harness SHALL support a bounded tool loop that can stream model output, execute permitted tools, attach tool results, recover from missing or malformed tool-result blocks, preserve reasoning/signature boundaries, retry retryable provider failures, and escalate or summarize when output/token limits are reached.

The loop SHALL stop only on terminal completion, blocked state, cancellation, budget exhaustion, or a typed unrecoverable error.

#### Scenario: Missing tool result is recovered before final response
- **WHEN** a model turn produces a tool use but the next request would omit the matching tool result
- **THEN** the harness inserts a typed recovery/tombstone result or blocks the run with a protocol error
- **AND** it does not silently continue to a fake completed answer

#### Scenario: Max-turn exhaustion keeps partial state
- **WHEN** the harness reaches the configured max turn limit during a multi-tool task
- **THEN** the run is marked blocked or needs-attention with partial state preserved
- **AND** the final output does not claim the task is complete

#### Scenario: Provider retry does not duplicate completed tools
- **WHEN** a retryable provider error occurs after a tool result has been recorded
- **THEN** the harness retries from a state that preserves the completed tool result
- **AND** the same side-effecting tool is not re-executed without explicit idempotency permission

### Requirement: Context survival SHALL be measurable and release-blocking
The default harness SHALL preserve the user's anchor objective and enough recent operational context across long sessions. It SHALL apply bounded tool-result trimming, micro-compact, synopsis/full compact, and prompt-too-long recovery before abandoning the run.

Context survival MUST be measured by deterministic scenarios and by a live or recorded long-session gate. The gate SHALL fail when required facts disappear, when anchor objective disappears, or when compaction removes required tool evidence.

#### Scenario: Long run retains anchor objective
- **WHEN** an 80-turn multi-step harness scenario runs with large tool outputs
- **THEN** the final model request still contains the original user objective or its pinned anchor
- **AND** required file/tool evidence remains available to the completion verifier

#### Scenario: Prompt-too-long triggers recovery path
- **WHEN** a provider rejects a request because the prompt is too long
- **THEN** the harness attempts the configured recovery path
- **AND** the run records whether recovery succeeded, blocked, or exhausted budget

### Requirement: MCP lifecycle SHALL be owned by the harness
The default harness SHALL implement MCP as a stateful client lifecycle, not as static tool definitions. For each configured MCP server, the harness SHALL initialize the connection, negotiate protocol version and capabilities, list tools/resources/prompts, respond to list-changed notifications, support cancellation for in-flight requests, and shut down cleanly.

MCP tools SHALL enter the same Offisim permission, audit, evidence, and completion-verification pipeline as other gateway tools.

#### Scenario: Tool list changes during a run
- **WHEN** an MCP server sends a tools-list-changed notification during a run
- **THEN** the harness refreshes the server's tool snapshot according to policy
- **AND** the next model turn sees the updated allowed tool surface

#### Scenario: MCP cancellation is recorded
- **WHEN** a user cancels a run while an MCP request is in flight
- **THEN** the harness sends or records cancellation for that request
- **AND** the run ends with a canceled or blocked state rather than a completed claim

### Requirement: Completion SHALL require product evidence, not model assertion
The default harness SHALL complete a task only when product evidence satisfies the task intent. For local file, shell, MCP, verification, or workspace tasks, successful relevant tool evidence SHALL be required. For ordinary text deliverables, the harness MAY complete without tool evidence only when the task intent does not require local or external proof.

#### Scenario: File task cannot complete from text-only claim
- **WHEN** an employee says it has edited a file but no successful write-file or equivalent gateway evidence exists
- **THEN** the task is marked review/blocked
- **AND** the final user-facing response explains the missing evidence

#### Scenario: Text handoff can complete without fake tool evidence
- **WHEN** a task only asks for a written plan or explanation
- **THEN** the harness may complete from a valid text deliverable
- **AND** it does not fabricate tool evidence to satisfy the verifier
