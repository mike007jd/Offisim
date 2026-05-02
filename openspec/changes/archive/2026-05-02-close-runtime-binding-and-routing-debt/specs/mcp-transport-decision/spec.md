## ADDED Requirements

### Requirement: MCP transport decision SHALL record the current SDK posture

Offisim SHALL maintain `openspec/specs/mcp-transport-decision.md` as the durable decision record for MCP remote transport. The document MUST cite the current `@modelcontextprotocol/sdk` documentation snapshot gathered through Context7 during implementation, compare Offisim's current `SSEClientTransport` usage with `StreamableHTTPClientTransport`, and state whether this change migrates code or intentionally defers migration.

#### Scenario: Decision cites current SDK documentation
- **WHEN** the MCP transport decision document is written
- **THEN** it includes the Context7 lookup date for `@modelcontextprotocol/sdk`
- **AND** it summarizes the current official remote transport recommendation

#### Scenario: SSE and Streamable HTTP are compared
- **WHEN** reading the decision document
- **THEN** it lists the implementation cost of moving from `SSEClientTransport` to `StreamableHTTPClientTransport`
- **AND** it identifies affected client setup, server expectations, auth, reconnect, and compatibility behavior

### Requirement: MCP transport migration rule SHALL be explicit

The MCP transport decision SHALL define why Offisim does or does not migrate transport in this change and SHALL define the trigger that requires a future migration. The result MUST be reflected back into `openspec/protocols-ledger.md` so the ledger row is no longer a vague open question.

#### Scenario: This-change decision is unambiguous
- **WHEN** a future maintainer reads `openspec/specs/mcp-transport-decision.md`
- **THEN** they can tell whether this change intentionally kept SSE or migrated to Streamable HTTP
- **AND** they can see the concrete reason for that decision

#### Scenario: Future migration trigger is documented
- **WHEN** upstream SDK or product needs make SSE unsuitable
- **THEN** the decision document names the condition that turns migration from observation into required work
- **AND** `openspec/protocols-ledger.md` references that trigger instead of only saying “explore”
