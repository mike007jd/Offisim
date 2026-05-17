## ADDED Requirements

### Requirement: MCP truth-source state SHALL reflect the shipped client (G10)

Truth sources SHALL NOT state a bare `MCP ❌`. The MCP client is materially implemented (stdio via the Rust bridge, SSE via the official SDK, tool bridging, audit, and permission gating). `openspec/protocols-ledger.md`, `openspec/harness-capability-map.md`, and the repo-local root `CLAUDE.md` memory index SHALL state `client ✓; resources/prompts surfacing + Streamable HTTP + OAuth pending`. The correction SHALL be spot-checked against the code before any durable doc is rewritten — a subagent/audit claim SHALL NOT be propagated into a truth source unverified. System-level Codex memory SHALL NOT be modified by this change unless the user explicitly requests a memory update.

#### Scenario: Stale MCP claim is corrected and grep-clean

- **WHEN** the change is applied
- **THEN** no truth source still carries a bare `MCP ❌` claim
- **AND** the corrected entry distinguishes the shipped client from the pending resources/prompts/HTTP/OAuth work

#### Scenario: Correction is code-verified, not audit-quoted

- **WHEN** the MCP ledger line is rewritten
- **THEN** the implementer has confirmed the client implementation against `packages/core/src/mcp/` before editing
- **AND** the rewrite cites the verified state, not only the audit finding
