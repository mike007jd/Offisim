## ADDED Requirements

### Requirement: MCP parity SHALL state supported transport scope

Claude-parity and full-agent gates SHALL state which MCP transport scope they verify: desktop stdio bridge, trusted-host native SDK MCP, gateway-bridged MCP, or future remote Streamable HTTP MCP. Passing one transport scope SHALL NOT imply support for another.

If this change does not migrate remote MCP transport, the parity ledger and protocol ledger SHALL explicitly keep remote MCP as unavailable or future-scoped, while still requiring current stdio/native/bridge MCP lifecycle evidence for promoted profiles.

#### Scenario: Stdio MCP evidence does not imply remote MCP

- **WHEN** default harness or full-agent release evidence proves local stdio MCP lifecycle
- **THEN** the parity ledger marks only that MCP transport scope as verified
- **AND** remote MCP remains pending unless Streamable HTTP/auth/header/health evidence exists

#### Scenario: Native SDK MCP is evidence-classified

- **WHEN** a SDK-native full-agent profile uses its native MCP client
- **THEN** Offisim records native MCP evidence with profile identity, server status, tool/resource list, call result, cancellation/failure, and shutdown
- **AND** it is not mislabeled as Offisim gateway MCP evidence unless a verified bridge executed the boundary

#### Scenario: Protocol ledger names migration trigger

- **WHEN** this parity change updates MCP-related truth sources
- **THEN** `openspec/protocols-ledger.md` and the MCP transport decision identify whether remote MCP is unchanged, migrated, or blocked
- **AND** they name the trigger that would require a future remote MCP migration
