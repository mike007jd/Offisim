# openspec-docs-alignment

## Purpose

The human-maintained truth docs (`CLAUDE.md` at the repo root and the per-user `MEMORY.md` under `~/.claude/projects/.../memory/`) describe `openspec/specs/` and the openspec workflow. Those descriptions must match the real state of the `openspec/` tree — otherwise a fresh session reading the docs acts on a stale mental model. This capability defines the alignment contract: what the docs may claim, how session-history entries are dated, and a grep-checkable gate that forbids specific stale phrases.
## Requirements
### Requirement: Truth docs reflect openspec state
`CLAUDE.md` and the user's `MEMORY.md` SHALL describe `openspec/specs/` and the openspec workflow in terms that match the actual current state of the `openspec/` tree. Descriptions such as `"openspec/specs/ 重建中 / 空"`, `"spec 不要提前写"`, or `"先屎山再写 spec"` SHALL NOT appear verbatim when `openspec/specs/` already contains canonical capability specs.

#### Scenario: specs populated, docs honest
- **WHEN** `openspec/specs/` contains one or more `<capability>/spec.md` files
- **THEN** `CLAUDE.md` Ground Truth / Truth-source priority sections describe specs as "populated as refactors land" (or equivalent), not as "rebuilding / empty"
- **AND** `MEMORY.md` Current State section lists the current canonical spec names (or explicitly says "see `ls openspec/specs/`") rather than `"Spec home is now openspec/specs/ (重建中，空)"`

#### Scenario: refactor-first-then-spec principle preserved
- **WHEN** docs describe the workflow for writing specs
- **THEN** they SHALL state that canonical specs are authored **after** the corresponding code has been refactored out of its shit-mountain state, not that specs should be deferred indefinitely

### Requirement: MEMORY.md records absolute dates
Session-history entries in the user's `MEMORY.md` that reference `openspec/` workflow events SHALL use absolute `YYYY-MM-DD` dates, never relative dates like `今天` / `本次` / `recent`.

#### Scenario: new session-history line
- **WHEN** adding a new Session History entry for an openspec workflow event
- **THEN** the entry begins with `YYYY-MM-DD —` (e.g. `2026-04-16 —`)

### Requirement: Stale openspec claims are grep-checkable
The phrases `重建中`, `屎山再写 spec`, `先屎山再`, and `openspec/specs/ .* 空` SHALL NOT appear in `CLAUDE.md` or in the user's `MEMORY.md`. A grep for any of them SHALL return zero matches in those two files.

#### Scenario: grep gate
- **WHEN** running `grep -nE '重建中|屎山再|先屎山|openspec/specs/.*空' CLAUDE.md MEMORY.md`
- **THEN** no matches are returned

### Requirement: Runtime architecture changes SHALL include stale truth-source cleanup

Any OpenSpec change that touches model transport, employee runtime engines, default harness ownership, or external agent control SHALL include a stale truth-source cleanup pass before commit. The pass SHALL scan active specs, archived changes likely to be found by search, protocol ledgers, provider matrices, AGENTS/CLAUDE guidance, user-facing runtime copy, and relevant memory notes.

When historical memory is misleading but cannot be edited directly, the implementer SHALL add an allowed ad hoc correction note that states the current truth and identifies the stale interpretation to avoid.

#### Scenario: Stale SDK-lane wording is found

- **WHEN** a sweep finds wording that implies direct model calling means using an ordinary SDK lane, or all future tool-capable work must always use one fixed gateway route
- **THEN** the wording is narrowed to current model-transport/current-profile truth or marked superseded
- **AND** verified employee agent profiles remain allowed by the architecture

#### Scenario: Memory is corrected additively

- **WHEN** memory contains older notes that future agents may over-apply
- **THEN** a newer ad hoc correction note is added instead of editing historical memory files
- **AND** the note says model transport is not an ordinary SDK product lane and must not be generalized into a global ban on agent-capable employees or harness control-plane routes
