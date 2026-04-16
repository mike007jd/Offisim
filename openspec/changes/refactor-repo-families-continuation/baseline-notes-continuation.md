# Baseline notes — refactor-repo-families-continuation

Captured at start of apply phase to anchor zero-behavior-change verification.

## Anchor commit

- HEAD before any apply work: `aeb2ef6adb52bfa294142179a64b6ed5ec615cb0` (chore(openspec): archive refactor-repo-triple-copies — orchestration pattern landed, 10 families deferred)
- Pre-refactor reference (whole D4 starting point): see archived `openspec/changes/archive/2026-04-17-refactor-repo-triple-copies/baseline-notes.md`

## Contract file (must remain byte-identical at end)

- `packages/core/src/runtime/repositories.ts` SHA1: `be1465975eaf4bd9a6427bed700b086d4b7f10fb`

## Barrel NBNC starting point (continuation entry)

| File | NBNC |
|---|---|
| `packages/core/src/runtime/drizzle-repositories.ts` | 1402 |
| `packages/core/src/runtime/memory-repositories.ts` | 1144 |
| `apps/web/src/lib/tauri-repos.ts` | 1353 |
| **Total** | **3899** |

Target end-state per spec `repository-backend-boundaries`:
- 3 barrels each ≤200 NBNC (memory allowed up to 230 NBNC if 29 class re-exports + snapshot pipeline genuinely needs it, documented in live-verification-report.md)
- All family files ≤320 NBNC

## Factory key baselines (from archived baseline-notes.md)

- `createDrizzleRepositories(db)` returns 36 entries (35 repo keys + `transact`)
- `createMemoryRepositories(seed?)` returns 37 entries (35 repo keys + `userPreferences` + `snapshot` + `seed`)
- `createTauriRepositories(db)` returns 34 entries (35 repo keys minus `userPreferences`, no `transact`)

## Memory class baseline

- 19 pre-existing `Memory*Repository` classes still in `memory-repositories.ts` (lines 359–1294)
- 5 orchestration classes already extracted to `runtime/repos/orchestration/memory.ts` and re-exported from barrel (Phase B work, archived)
- 5 inline memory repos remaining (D8 path-1 conversion targets):
  - `employees` (line 134)
  - `toolCalls` (line 177)
  - `handoffs` (line 191)
  - `meetings` (line 202)
  - `llmCalls` (line 224)
- Total Memory class count after this change: **29** (19 pre-existing + 5 orchestration + 5 new)

## Orchestration scaffold (Phase A + B archived)

- `packages/core/src/runtime/repos/orchestration/{drizzle,memory}.ts` exists
- `apps/web/src/lib/tauri-repos/orchestration.ts` exists
- 9 empty subdirectories under `packages/core/src/runtime/repos/` waiting for population: `employees/`, `conversations/`, `llm/`, `install/`, `permissions/`, `memory-system/`, `files/`, `workspace/`, `projects/`, `agent-events/`

## Verification plan

- Each of Phases C-L commits with `pnpm typecheck` green
- Phase M barrel finalization commits with NBNC gate met
- Phase N live verification recorded in `live-verification-report.md` (this directory)
- Spec `repository-backend-boundaries` updated via archive sync after Phase N
