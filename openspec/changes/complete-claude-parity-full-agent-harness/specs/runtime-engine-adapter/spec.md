## ADDED Requirements

### Requirement: Full-agent adapters SHALL emit normalized native runtime activity

Full-agent engine adapters SHALL emit a normalized activity stream for native runtime events, including text, reasoning, tool start/completion/failure, file/edit/patch, shell/process, git/worktree, MCP server status, memory/todo/skill, artifact/deliverable, permission requests, guardrail decisions, subagent/handoff lifecycle, session resume/fork, checkpoint/rollback, usage/cost, budget exhaustion, cancellation, credential-boundary decisions, and terminal results.

Provider-specific payloads MAY be stored for debug/audit, but renderer and completion-verifier contracts SHALL use Offisim's normalized event envelope.

#### Scenario: MCP lifecycle is normalized

- **WHEN** a native SDK runtime connects to MCP, lists tools/resources, calls a tool, receives list-changed, fails, cancels, or shuts down
- **THEN** the adapter emits normalized MCP activity with profile and task identity
- **AND** raw provider-specific MCP payload shape does not leak into the renderer contract

#### Scenario: Guardrail denial is normalized

- **WHEN** a native runtime hook or guardrail blocks an action
- **THEN** Offisim records a normalized denial with reason, hook/guardrail identity, and task/run context
- **AND** the employee task cannot complete as if the action succeeded

#### Scenario: Process and git events preserve cleanup evidence

- **WHEN** a native runtime starts a shell/process or performs git/worktree work
- **THEN** the adapter emits normalized start, output, completion, timeout/cancellation, and cleanup evidence with task/run/checkpoint identity
- **AND** completion verification can distinguish successful evidence from orphaned or cancelled work

### Requirement: Text-only adapters SHALL not masquerade as full-agent adapters

Adapters that only return final text, one-shot text streams, or generic accepted/completed status SHALL remain text-only preview adapters. They SHALL NOT be used to satisfy full-agent tasks, full-agent release gates, or parity benchmark rows.

#### Scenario: One-shot text host is rejected for full-agent gate

- **WHEN** a candidate full-agent adapter returns final text but no native tool, MCP, session, permission, checkpoint, or cancellation activity
- **THEN** the full-agent gate fails
- **AND** the profile remains text-only or unavailable
