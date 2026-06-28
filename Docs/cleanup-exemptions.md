# Cleanup Exemptions

Checked at: 2026-06-29 NZST.

This file records dead-code/dead-doc candidates that were reviewed and should not
be re-opened as deletion targets without new evidence.

## Dead Code Tool Hints

| Candidate | Decision | Evidence |
|---|---|---|
| `.gitnexus/run.cjs` in `knip.json` | Keep | GitNexus project rules in `AGENTS.md` / `CLAUDE.md` point humans to this runner when the index needs refresh. Knip reports only a configuration hint because the file is ignored by the source graph and may be absent in some worktrees. |
| `PI_WIRE_CONTRACT_EXAMPLES` binding | Converted, not deleted | The export was dead, but the examples are still valuable as a renderer-side `satisfies PiAgentHostEvent` compile guard. It is now a no-binding typecheck expression so `tsc` keeps the guard and `knip` no longer sees an exported API. |

## Public/Internal Export Cleanup

The 2026-06-29 cleanup removed only unused export surfaces or truly unreferenced
fixtures after monorepo, docs, scripts, dynamic-string, and GitNexus checks.
Remaining package `exports` in `packages/*/package.json` are treated as public
API until a separate downstream review proves otherwise.
