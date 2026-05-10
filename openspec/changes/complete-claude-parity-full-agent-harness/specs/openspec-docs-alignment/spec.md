## ADDED Requirements

### Requirement: Harness truth cleanup SHALL include toxic memory correction

Any change that modifies default harness ownership, SDK-native runtime status, full-agent availability, or parity claims SHALL include a stale truth-source cleanup pass. The pass SHALL cover active specs, active changes, archived changes likely to be found by search, `openspec/harness-capability-map.md`, `openspec/protocols-ledger.md`, `openspec/provider-lane-matrix.md`, root `CLAUDE.md`, root `AGENTS.md`, user-visible runtime copy, and memory notes.

Historical memory files SHALL NOT be edited directly. If a memory entry would mislead future agents into stopping at the old blocked/text-only framing, the implementer SHALL add an ad hoc correction note under `~/.codex/memories/extensions/ad_hoc/notes/` that states the new current truth and lists the stale interpretation to ignore.

#### Scenario: Toxic memory is superseded

- **WHEN** prior memory says full-agent work should stop at `sdk-native-full-power` being blocked or that SDK routes are only text-only forever
- **THEN** a newer ad hoc correction note states that the current OpenSpec change requires implementation and release gates
- **AND** the final report cites that correction note path

#### Scenario: Grep report proves cleanup scope

- **WHEN** the change is ready for completion
- **THEN** the implementer runs a grep/report over active truth sources for stale terms such as `ordinary SDK lane`, `text-only only`, `permanently blocked`, `blocked until evidence` without a corresponding implementation task, and fake SDK parity claims
- **AND** any stale hit is corrected or explicitly documented as historical-only

### Requirement: Root guidance SHALL not make blocked state look final

Root guidance may state that unverified model transports are not tool-capable and that profiles stay unavailable until release evidence exists. It SHALL NOT imply that full-agent implementation is outside product scope or that the blocked state itself is the desired end state.

#### Scenario: Root guidance points to implementation target

- **WHEN** `CLAUDE.md` or `AGENTS.md` discusses SDK-native full-agent profiles
- **THEN** it states that they are implementation targets gated by release evidence
- **AND** it distinguishes that from unverified model transport fail-closed behavior

