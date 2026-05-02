## Context

`openspec list --json` is currently clear of active product changes, but roadmap reviews are still using raw unchecked archive tasks as a proxy for backlog. That raw count folds together cancelled scope, explicitly deferred follow-on work, superseded verification notes, and repo hygiene. Separately, several canonical specs and package-level `CLAUDE.md` files still describe legacy skill contracts (`runtimeSkill`, activation tools, old App workspace state) that no longer match the implementation.

## Goals / Non-Goals

**Goals:**
- create a single roadmap debt rollup document with explicit classification rules
- patch the most misleading canonical spec drift so future implementers read current contracts
- annotate the few archived task files that are repeatedly misread as open roadmap debt

**Non-Goals:**
- do not change provider/Codex implementation behavior or reclassify true capability gaps away
- do not rewrite every archived change in the repo
- do not archive or reopen historical feature work just to make backlog counts look cleaner

## Decisions

- Add a standalone markdown ledger under `openspec/` rather than mutating currently hot provider docs. This keeps the debt rollup separate from the provider/Codex worktree in progress.
- Patch canonical specs and package `CLAUDE.md` files directly now. Leaving known drift in place until a later archive would continue to mislead implementers during current work.
- Add targeted historical notes only to the archived task files that are known to overstate roadmap debt. This preserves original task history while making classification explicit.

## Risks / Trade-offs

- [Risk] The ledger can drift again if later reviews go back to using raw unchecked counts. → Mitigation: the ledger explicitly bans that metric and standardizes the wording for excluded historical items.
- [Risk] Historical notes could be read as deleting prior work. → Mitigation: notes preserve the original task lists and point to successor/superseding context instead of removing history.
