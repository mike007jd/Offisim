## MODIFIED Requirements

### Requirement: Runtime architecture changes SHALL include stale truth-source cleanup

Any OpenSpec change that touches provider lanes, employee runtime engines, default harness ownership, or external agent control SHALL include a stale truth-source cleanup pass before commit. The pass SHALL scan active specs, archived changes likely to be found by search, protocol ledgers, provider matrices, AGENTS/CLAUDE guidance, user-facing runtime copy, and relevant memory notes.

When historical memory is misleading but cannot be edited directly, the implementer SHALL add an allowed ad hoc correction note that states the current truth and identifies the stale interpretation to avoid.

#### Scenario: Stale gateway-only wording is found

- **WHEN** a sweep finds wording that implies all future tool-capable work must always use gateway
- **THEN** the wording is narrowed to provider SDK lane/current-profile truth or marked superseded
- **AND** verified employee agent profiles remain allowed by the architecture

#### Scenario: Memory is corrected additively

- **WHEN** memory contains older notes that future agents may over-apply
- **THEN** a newer ad hoc correction note is added instead of editing historical memory files
- **AND** the note says provider SDK lane fail-closed must not be generalized into a global ban on agent-capable employees or harness control-plane routes
