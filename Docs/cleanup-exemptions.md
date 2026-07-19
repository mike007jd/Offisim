# Cleanup Exemptions

Checked at: 2026-07-16 NZST.

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

## 2026-07-01 Hygiene Pass

| Candidate | Decision | Evidence |
|---|---|---|
| Tauri command names, permission allowlists, and renderer `invoke(commandName)` paths | Keep | These are runtime string contracts rather than import graph edges; deleting by grep would miss registered commands and permission entries. |
| `apps/desktop/src-tauri/resources/**` and engine sidecar binaries | Keep | Generated API host resources and the pinned Codex sidecar are bundled by Tauri release config and verified by engine-specific harnesses; `knip.json` intentionally ignores generated release artifacts. |
| DB schema baseline | Keep | `local_db.rs` uses `include_str!` for `schema.sql`; historical local migration SQL was removed after confirming Offisim has no launched user-data upgrade contract. |
| `packages/prefab` | Keep | It is pure shared prefab logic used by desktop renderer and platform, not a standalone web product or shared visual UI package. |
| `packages/dramaturgy` | Keep | It owns deterministic Office projection logic outside the shared type contracts. |
| Historical second-runtime scorecard and inert-storage ledger | Archive/keep | The scorecard is historical NO-GO evidence and was moved out of the active architecture path. Inert SQLite tables remain documented until a deliberate baseline cleanup removes or rewires them. |
