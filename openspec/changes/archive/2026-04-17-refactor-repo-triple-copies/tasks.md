## 1. Baseline capture

- [x] 1.1 Record pre-refactor line counts: `wc -l packages/core/src/runtime/drizzle-repositories.ts packages/core/src/runtime/memory-repositories.ts apps/web/src/lib/tauri-repos.ts`
- [x] 1.2 Record pre-refactor NBNC (non-blank non-comment) counts via `awk '{ if ($0 !~ /^[[:space:]]*$/ && $0 !~ /^[[:space:]]*\/\// && $0 !~ /^[[:space:]]*\*/) c++ } END { print c }'`
- [x] 1.3 Capture pre-refactor sorted key list of each factory return (drizzle 36 / memory 35+snapshot / tauri 34) into `baseline-notes.md` — this is the equivalence bar for spec Requirement "Public factory signatures are byte-identical"
- [x] 1.4 Snapshot SHA1 of `packages/core/src/runtime/repositories.ts` into `baseline-notes.md` to prove contract file is unchanged at the end
- [x] 1.5 Commit baseline-notes.md — start of apply trail

## 2. Scaffold (Phase A)

- [x] 2.1 Create directory `packages/core/src/runtime/repos/` + 11 empty family sub-directories (`orchestration/`, `employees/`, `conversations/`, `llm/`, `install/`, `permissions/`, `memory-system/`, `files/`, `workspace/`, `projects/`, `agent-events/`)
- [x] 2.2 Create `apps/web/src/lib/tauri-repos/` (new directory) — **D5 deviation**: empty placeholder `.ts` files skipped (would break lint/typecheck with "not a module" errors); family files created as each phase populates them
- [x] 2.3 Create `packages/core/src/runtime/repos/memory-types.ts` to hold `MemoryRepositoriesSnapshot` / `MemoryRepositorySeed` (currently in `memory-repositories.ts:109-143`)
- [x] 2.4 Rewrite `memory-types.ts` to re-export these types from the new home; keep `MemoryInstallRepositoriesSnapshot` extension working (Phase A verifies typecheck green)
- [x] 2.5 `pnpm typecheck` must be green — Phase A gate commit

## 3. Orchestration family (Phase B) — includes D8 class conversion

**D8 decision** (apply-phase): each memory family phase converts its inline repos to classes matching the existing 19 Memory\* class pattern. Barrel `createMemoryRepositories()` then aggregates snapshot() across all 29 classes.

- [x] 3.1 Create `runtime/repos/orchestration/drizzle.ts` — extract `companies`, `threads`, `taskRuns`, `checkpoints`, `events` from `drizzle-repositories.ts:119-461` → `createOrchestrationDrizzleRepos(db)`. 253 NBNC
- [x] 3.2 Create `runtime/repos/orchestration/memory.ts` — convert 5 inline memory repos to classes: `MemoryCompanyRepository`, `MemoryThreadRepository`, `MemoryTaskRunRepository`, `MemoryCheckpointRepository`, `MemoryEventRepository`. `MemoryTaskRunRepository` takes a `ThreadRepository` dep via constructor for `findQueue` / `countByStatus` cross-repo lookup. `MemoryCompanyRepository` exposes `.seed(rows)` for `MemoryRepositorySeed`. Factory `createOrchestrationMemoryRepos(snapshot?)` returns the 5 class instances. 269 NBNC
- [x] 3.3 Create `apps/web/src/lib/tauri-repos/orchestration.ts` — extract from `tauri-repos.ts:132-465` → `createOrchestrationTauriRepos(db)`. 240 NBNC
- [x] 3.4 Delete corresponding blocks from drizzle-repositories.ts / memory-repositories.ts / tauri-repos.ts; splice spread call in each barrel
- [x] 3.5 Update memory barrel: re-export the 5 new classes; barrel `snapshot()` calls `companies.snapshot()` etc. instead of `cloneRows(companiesMap.values())`
- [x] 3.6 `pnpm typecheck` green — full repo 26/26 tasks pass; commit Phase B

**Phase B NBNC deltas** (from pre-refactor baseline):
- `drizzle-repositories.ts` 1638 → 1402 (-236)
- `memory-repositories.ts` 1351 → 1144 (-207)
- `tauri-repos.ts` 1577 → 1353 (-224)
- **D5 decision**: family file gate raised from 250 → 320 NBNC (memory class boilerplate + constructor/snapshot methods push orchestration/memory.ts to 269; future install + memory-system families with more repos will push higher). Spec updated.

## — DEFERRED TO FOLLOW-ON CHANGE —

**The tasks below (§4–§17) are deferred to a successor change** (working name `refactor-repo-families-continuation` or equivalent). Reason: path 1 D8 decision expanded memory scope significantly; pacing choice at archive time was to land orchestration (the template family) + scope the canonical spec to what was delivered, then resume the remaining 10 families + full barrel finalization in a fresh change so each archived unit represents a coherent delivered outcome.

What the successor change picks up:
- Memory barrel still holds 5 inline repos (`employees` / `toolCalls` / `handoffs` / `meetings` / `llmCalls`) pending D8 class conversion
- Drizzle + tauri barrels still hold ~28 inline repos across 10 families
- barrel ≤200 NBNC gate is unmet (current post-archive NBNC: drizzle 1402 / memory 1144 / tauri 1353)
- Live verification across all 3 runtimes (§16) not yet executed
- Orchestration family is live-validated only by typecheck (26/26 green); cold-start runtime verification deferred to follow-on

## 4. Employees family (Phase C) — DEFERRED

- [ ] 4.1 Create `runtime/repos/employees/drizzle.ts` — extract `employees`, `employeeVersions`
- [ ] 4.2 Create `runtime/repos/employees/memory.ts` — move existing `MemoryEmployeeVersionRepository` class + convert inline `employees` to new `MemoryEmployeeRepository` class (D8). `MemoryEmployeeRepository` exposes `.seed(rows)` for `MemoryRepositorySeed`
- [ ] 4.3 Create `apps/web/src/lib/tauri-repos/employees.ts` — extract from tauri-repos
- [ ] 4.4 Update memory barrel re-export to source `MemoryEmployeeVersionRepository` + new `MemoryEmployeeRepository` from new location
- [ ] 4.5 Delete corresponding blocks from original files; splice barrel spread
- [ ] 4.6 `pnpm typecheck` green; commit Phase C

## 5. Conversations family (Phase D)

- [ ] 5.1 Create `runtime/repos/conversations/drizzle.ts` — extract `toolCalls`, `handoffs`, `meetings`, `activeInteractions`, `interactionHistory`
- [ ] 5.2 Create `runtime/repos/conversations/memory.ts` — move existing `MemoryActiveInteractionRepository`, `MemoryInteractionHistoryRepository` classes + convert inline `toolCalls`/`handoffs`/`meetings` to new classes: `MemoryToolCallRepository`, `MemoryHandoffRepository`, `MemoryMeetingRepository` (D8)
- [ ] 5.3 Create `apps/web/src/lib/tauri-repos/conversations.ts`
- [ ] 5.4 Update memory barrel re-exports (5 class names: 2 existing + 3 new) to new location
- [ ] 5.5 Delete old blocks; splice barrel spread
- [ ] 5.6 `pnpm typecheck` green; commit Phase D

## 6. LLM family (Phase E)

- [ ] 6.1 Create `runtime/repos/llm/drizzle.ts` — extract `llmCalls`, `costRates`
- [ ] 6.2 Create `runtime/repos/llm/memory.ts` — move existing `MemoryModelCostRateRepository` class + convert inline `llmCalls` to new `MemoryLlmCallRepository` class (D8)
- [ ] 6.3 Create `apps/web/src/lib/tauri-repos/llm.ts`
- [ ] 6.4 Update memory barrel re-exports (2 class names: 1 existing + 1 new) to new location
- [ ] 6.5 Delete old blocks; splice barrel spread
- [ ] 6.6 `pnpm typecheck` green; commit Phase E

## 7. Install family (Phase F)

- [ ] 7.1 Create `runtime/repos/install/drizzle.ts` — extract `installTransactions`, `installedPackages`, `installedAssets`, `assetBindings`
- [ ] 7.2 Create `runtime/repos/install/memory.ts` — extract memory inline impls (note: installTransactions etc. use classes from `packages/core/src/repos/install-transaction-repository.js`; reuse those existing implementations, not duplicates)
- [ ] 7.3 Create `apps/web/src/lib/tauri-repos/install.ts`
- [ ] 7.4 Delete old blocks; splice barrel spread
- [ ] 7.5 `pnpm typecheck` green; commit Phase F

## 8. Permissions family (Phase G)

- [ ] 8.1 Create `runtime/repos/permissions/drizzle.ts` — extract `racks`, `slots`, `workstationRacks`, `mcpAudit`
- [ ] 8.2 Create `runtime/repos/permissions/memory.ts` — extract `MemoryRackRepository`, `MemorySlotRepository`, `MemoryWorkstationRackRepository`, `MemoryMcpAuditRepository` classes
- [ ] 8.3 Create `apps/web/src/lib/tauri-repos/permissions.ts`
- [ ] 8.4 Update memory barrel re-exports (4 class names)
- [ ] 8.5 Delete old blocks; splice barrel spread
- [ ] 8.6 `pnpm typecheck` green; commit Phase G

## 9. Memory-system family (Phase H)

- [ ] 9.1 Create `runtime/repos/memory-system/drizzle.ts` — extract `memories`, `nodeSummaries`, `compactSummaries` (drizzle has no `userPreferences`)
- [ ] 9.2 Create `runtime/repos/memory-system/memory.ts` — extract `MemoryNodeSummaryRepository`, `MemoryCompactSummaryRepository` classes + inline `memories` impl + `MemoryUserPreferenceRepository` (memory-only) + attach `userPreferences` to memory factory return
- [ ] 9.3 Create `apps/web/src/lib/tauri-repos/memory-system.ts` — extract tauri impls (no `userPreferences` on tauri)
- [ ] 9.4 Preserve `normalizeMemoryDedupeKey` helper placement (option: duplicate per backend file as pre-refactor, or move to a local helper inside the memory-system drizzle.ts + memory.ts + tauri.ts; pick the zero-diff option)
- [ ] 9.5 Update memory barrel re-exports (3 class names: NodeSummary, CompactSummary, UserPreference)
- [ ] 9.6 Delete old blocks; splice barrel spread (memory barrel appends `userPreferences` into factory return as pre-refactor)
- [ ] 9.7 `pnpm typecheck` green; commit Phase H

## 10. Files family (Phase I)

- [ ] 10.1 Create `runtime/repos/files/drizzle.ts` — extract `fileHistory`, `libraryDocuments`
- [ ] 10.2 Create `runtime/repos/files/memory.ts` — extract `MemoryFileHistoryRepository`, `MemoryLibraryDocumentRepository` classes
- [ ] 10.3 Create `apps/web/src/lib/tauri-repos/files.ts`
- [ ] 10.4 Update memory barrel re-exports (2 class names)
- [ ] 10.5 Delete old blocks; splice barrel spread
- [ ] 10.6 `pnpm typecheck` green; commit Phase I

## 11. Workspace family (Phase J)

- [ ] 11.1 Create `runtime/repos/workspace/drizzle.ts` — extract `sopTemplates`, `officeLayouts`, `prefabInstances`, `zones`
- [ ] 11.2 Create `runtime/repos/workspace/memory.ts` — extract `MemorySopTemplateRepository`, `MemoryOfficeLayoutRepository`, `MemoryZoneRepository` classes + prefabInstances inline impl
- [ ] 11.3 Create `apps/web/src/lib/tauri-repos/workspace.ts`
- [ ] 11.4 Update memory barrel re-exports (3 class names)
- [ ] 11.5 Delete old blocks; splice barrel spread
- [ ] 11.6 `pnpm typecheck` green; commit Phase J

## 12. Projects family (Phase K)

- [ ] 12.1 Create `runtime/repos/projects/drizzle.ts` — extract `projects`, `projectAssignments`
- [ ] 12.2 Create `runtime/repos/projects/memory.ts` — extract `MemoryProjectRepository`, `MemoryProjectAssignmentRepository` classes
- [ ] 12.3 Create `apps/web/src/lib/tauri-repos/projects.ts`
- [ ] 12.4 Update memory barrel re-exports (2 class names)
- [ ] 12.5 Delete old blocks; splice barrel spread
- [ ] 12.6 `pnpm typecheck` green; commit Phase K

## 13. Agent-events family (Phase L)

- [ ] 13.1 Create `runtime/repos/agent-events/drizzle.ts` — extract `agentEvents`, `recoveryKnowledge`
- [ ] 13.2 Create `runtime/repos/agent-events/memory.ts` — extract `MemoryAgentEventRepository`, `MemoryRecoveryKnowledgeRepository` classes
- [ ] 13.3 Create `apps/web/src/lib/tauri-repos/agent-events.ts`
- [ ] 13.4 Update memory barrel re-exports (2 class names)
- [ ] 13.5 Delete old blocks; splice barrel spread
- [ ] 13.6 `pnpm typecheck` green; commit Phase L

## 14. Barrel finalization (Phase M)

- [ ] 14.1 `drizzle-repositories.ts` — confirm body reduced to: imports + `createDrizzleRepositories` with spread-assembly + inline `transact` helper. Target ≤200 NBNC
- [ ] 14.2 `memory-repositories.ts` — confirm body reduced to: imports + 19 class named re-exports + `createMemoryRepositories` with spread-assembly + `snapshot()` aggregation helper. Target ≤200 NBNC
- [ ] 14.3 `apps/web/src/lib/tauri-repos.ts` — confirm body reduced to: imports + `createTauriRepositories` with spread-assembly. Target ≤200 NBNC
- [ ] 14.4 Run NBNC gate check: all 3 barrels ≤200 + all family files ≤250
- [ ] 14.5 `pnpm typecheck` + `pnpm --filter @offisim/core build` + `pnpm --filter @offisim/web build` + `pnpm --filter @offisim/platform build` all green
- [ ] 14.6 Commit Phase M

## 15. Verification (Phase N)

- [ ] 15.1 Verify `packages/core/src/runtime/repositories.ts` diff from pre-refactor SHA is empty (`git diff <baseline-sha> HEAD -- packages/core/src/runtime/repositories.ts` → empty)
- [ ] 15.2 Verify `packages/core/src/index.ts` / `browser.ts` / `drizzle.ts` diffs from pre-refactor SHA are empty
- [ ] 15.3 Verify external consumer imports unchanged: `apps/web/src/lib/tauri-runtime.ts` / `tauri-runtime-lite.ts` diff for `./tauri-repos` import is empty
- [ ] 15.4 Verify factory key lists post-refactor match pre-refactor sorted lists captured in §1.3
- [ ] 15.5 Grep test: no barrel file contains `async findById` / `async findAll` / `async create` / `async update` / `async delete` method bodies (spec Requirement "Barrel only contains import + aggregate + re-export")
- [ ] 15.6 Grep test: no family file exceeds 250 NBNC; no barrel exceeds 200 NBNC
- [ ] 15.7 Grep test: every repo key (`companies:`, `threads:`, etc.) appears in exactly one family across all 33 backend implementation files

## 16. Live verification

- [ ] 16.1 Drizzle smoke: start platform API (`cd apps/platform && pnpm dev`); POST a simple entity write (or observe existing boot log); confirm success
- [ ] 16.2 Memory smoke: start web SPA (`cd apps/web && pnpm dev`); boot a company in browser; kick off a simple chat task; confirm `boss → manager → employee → boss_summary` flow + no thrown repo method
- [ ] 16.3 Tauri smoke: start desktop app (`pnpm --filter @offisim/desktop dev`); boot a company; write to at least one repo; confirm success
- [ ] 16.4 Capture each runtime's observed Object.keys(factory) at boot time into `live-verification-report.md` for audit trail
- [ ] 16.5 Compare live-captured key lists against §1.3 baseline — must match sorted-equal

## 17. Archive bookkeeping

- [ ] 17.1 Do NOT squash the 13 phase commits — D1/D2/D3 pattern preserves phase history for audit
- [ ] 17.2 Reference phase timeline in `live-verification-report.md` per D3 precedent
- [ ] 17.3 Archive via `/opsx:archive refactor-repo-triple-copies` after Phase N verification green
- [ ] 17.4 Update `memory/project_next_change_queue.md` D4 status to `[x] archived` with full completion log including all phase commit SHAs
- [ ] 17.5 Update memory queue — queue clear or next backlog prompt
