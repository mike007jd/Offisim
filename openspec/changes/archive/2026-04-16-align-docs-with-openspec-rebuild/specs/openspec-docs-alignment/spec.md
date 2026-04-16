## ADDED Requirements

### Requirement: Truth docs reflect openspec state
`CLAUDE.md` and the user's `MEMORY.md` SHALL describe `openspec/specs/` and the openspec workflow in terms that match the actual current state of the `openspec/` tree. Descriptions such as "openspec/specs/ 重建中 / 空", "spec 不要提前写", or "先屎山再写 spec" SHALL NOT appear verbatim when `openspec/specs/` already contains canonical capability specs.

#### Scenario: specs populated, docs honest
- **WHEN** `openspec/specs/` contains one or more `<capability>/spec.md` files
- **THEN** `CLAUDE.md` Ground Truth / Truth-source priority sections describe specs as "populated as refactors land" (or equivalent), not as "rebuilding / empty"
- **AND** `MEMORY.md` Current State section lists the current canonical spec names (or explicitly says "see `ls openspec/specs/`") rather than "Spec home is now openspec/specs/ (重建中，空)"

#### Scenario: refactor-first-then-spec principle preserved
- **WHEN** docs describe the workflow for writing specs
- **THEN** they SHALL state that canonical specs are authored **after** the corresponding code has been refactored out of its shit-mountain state, not that specs should be deferred indefinitely

### Requirement: MEMORY.md records absolute dates
Session-history entries in the user's `MEMORY.md` that reference `openspec/` workflow events SHALL use absolute `YYYY-MM-DD` dates, never relative dates like "今天" / "本次" / "recent".

#### Scenario: new session-history line
- **WHEN** adding a new Session History entry for an openspec workflow event
- **THEN** the entry begins with `YYYY-MM-DD —` (e.g. `2026-04-16 —`)

### Requirement: Stale openspec claims are grep-checkable
The phrases `重建中`, `屎山再写 spec`, `先屎山再`, and `openspec/specs/ .* 空` SHALL NOT appear in `CLAUDE.md` or in the user's `MEMORY.md` after alignment. A grep for any of them SHALL return zero matches in those two files.

#### Scenario: grep gate
- **WHEN** running `grep -nE '重建中|屎山再|先屎山|openspec/specs/.*空' CLAUDE.md MEMORY.md`
- **THEN** no matches are returned
