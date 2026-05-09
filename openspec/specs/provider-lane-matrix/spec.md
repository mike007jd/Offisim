# provider-lane-matrix Specification

## Purpose
TBD - created by archiving change close-runtime-binding-and-routing-debt. Update Purpose after archive.
## Requirements
### Requirement: Provider matrix SHALL record empirical transport and runtime status

`openspec/provider-lane-matrix.md` SHALL remain the durable evidence matrix for provider transport and runtime-profile exposure. Its host exposure rule SHALL avoid broad global statements such as "calling this provider means SDK lane" or "Offisim tool execution remains gateway-only."

The matrix SHALL distinguish:

- model transport evidence
- default Offisim harness/gateway tool evidence
- employee runtime capability profile evidence
- main-harness driver/replacement evidence

#### Scenario: Matrix language does not poison future agent routes

- **WHEN** a maintainer reads the host exposure rule
- **THEN** it is clear that provider transport is not an employee runtime or product lane
- **AND** it is also clear that verified tool-capable employee profiles may exist through a different capability path

#### Scenario: Provider evidence is not full-agent evidence

- **WHEN** a provider row marks a SDK-backed transport as verified
- **THEN** the evidence is understood as model transport evidence unless a separate employee/runtime profile evidence row exists
- **AND** product UI does not advertise full-agent support from transport evidence alone

### Requirement: Provider matrix SHALL include smoke entry points

Each provider row or section in `openspec/provider-lane-matrix.md` SHALL include the smoke-script or harness entry point needed to refresh that row's evidence. If credentials are unavailable, the row MUST say credentials are unavailable instead of recommending a provider swap or key change.

#### Scenario: Smoke refresh path is visible
- **WHEN** a maintainer wants to refresh Kimi, Qwen, DeepSeek, OpenAI native, or OpenRouter transport/runtime evidence
- **THEN** the matrix points to the command or harness path for that smoke
- **AND** identifies required environment variables or credential availability

#### Scenario: MiniMax 401 is triaged through env injection
- **WHEN** a MiniMax live verify hits 401
- **THEN** the matrix or related task notes direct the implementer to check `.env.local` `MINIMAX_*` injection into `VITE_MINIMAX_*`
- **AND** they SHALL NOT treat “switch provider” or “set a different key” as the first remediation

### Requirement: Protocol ledger SHALL reflect provider transport truth

After provider matrix updates, `openspec/protocols-ledger.md` SHALL summarize the current Claude Agent SDK and OpenAI Agents SDK transport/runtime posture and link the detailed evidence back to `openspec/provider-lane-matrix.md`.

#### Scenario: Ledger no longer duplicates the full matrix
- **WHEN** provider transport or runtime profile evidence changes
- **THEN** `openspec/protocols-ledger.md` summarizes the status and points to the matrix
- **AND** the detailed provider-by-provider evidence remains in `openspec/provider-lane-matrix.md`
