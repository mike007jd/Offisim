# provider-lane-matrix Specification

## Purpose
TBD - created by archiving change close-runtime-binding-and-routing-debt. Update Purpose after archive.
## Requirements
### Requirement: Provider matrix SHALL record empirical transport and runtime status

`openspec/provider-lane-matrix.md` SHALL be the durable evidence matrix for each provider transport and runtime-profile combination. Each row MUST record provider variant, product, endpoint family, gateway transport status, Claude Agent SDK transport status, OpenAI Agents SDK transport status, employee runtime profile evidence where applicable, and notes. Status values SHALL distinguish verified evidence from pending work and unsupported combinations.

#### Scenario: Verified providers show evidence
- **WHEN** MiniMax and Z.AI have successful gateway and Claude Agent SDK evidence
- **THEN** their matrix rows are marked verified only for the transports or runtime profiles that have real Offisim smoke or runtime evidence
- **AND** the MiniMax row names the current MiniMax product/model truth without using stale `highspeed` wording

#### Scenario: Pending providers are not advertised as verified
- **WHEN** Kimi, Qwen, DeepSeek, OpenAI native, or OpenRouter lacks current evidence for a lane
- **THEN** that transport or runtime profile is marked pending or unsupported rather than verified
- **AND** product UI or taxonomy MUST NOT expose it as production-supported solely because an adapter exists

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
