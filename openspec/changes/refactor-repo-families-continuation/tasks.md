## 1. Pre-flight baseline

- [x] 1.1 Confirm archived baseline still valid: re-read `openspec/changes/archive/2026-04-17-refactor-repo-triple-copies/baseline-notes.md`, capture pre-refactor sorted key list (drizzle 36 / memory 37 / tauri 34) into local `baseline-notes-continuation.md`
- [x] 1.2 Capture current barrel NBNC counts as continuation starting point: drizzle 1402 / memory 1144 / tauri 1353
- [x] 1.3 Snapshot SHA1 of `packages/core/src/runtime/repositories.ts` HEAD to assert it stays byte-identical at end
- [x] 1.4 Verify Phase B orchestration outputs intact: `packages/core/src/runtime/repos/orchestration/{drizzle,memory}.ts` + `apps/web/src/lib/tauri-repos/orchestration.ts` exist and pass typecheck on current main
- [x] 1.5 Commit `baseline-notes-continuation.md` — start of apply trail

## 2. Phase C — employees family

- [x] 2.1 Create `packages/core/src/runtime/repos/employees/drizzle.ts` — extract `employees`, `employeeVersions` from `drizzle-repositories.ts` into `createEmployeesDrizzleRepos(db): EmployeesDrizzleRepos`
- [x] 2.2 Create `packages/core/src/runtime/repos/employees/memory.ts` — move existing `MemoryEmployeeVersionRepository` class + convert inline `employees` to new `MemoryEmployeeRepository` class (D8). `MemoryEmployeeRepository` exposes `.snapshot()` and `.seed(rows)`. Factory `createEmployeesMemoryRepos(snapshot?)` returns the 2 class instances
- [x] 2.3 Create `apps/web/src/lib/tauri-repos/employees.ts` — extract from `tauri-repos.ts` into `createEmployeesTauriRepos(db): EmployeesTauriRepos`
- [x] 2.4 Splice each barrel: spread the new family factory into `createDrizzleRepositories` / `createMemoryRepositories` / `createTauriRepositories`; delete the corresponding inline blocks from each barrel; update memory barrel to re-export `MemoryEmployeeRepository` + `MemoryEmployeeVersionRepository` from the new location
- [x] 2.5 `pnpm typecheck` green; commit `refactor(core): repo-families Phase C — employees`

## 3. Phase D — conversations family

- [x] 3.1 Create `runtime/repos/conversations/drizzle.ts` — extract `toolCalls`, `handoffs`, `meetings`, `activeInteractions`, `interactionHistory` into `createConversationsDrizzleRepos(db)`
- [x] 3.2 Create `runtime/repos/conversations/memory.ts` — move existing `MemoryActiveInteractionRepository`, `MemoryInteractionHistoryRepository` classes + convert inline `toolCalls`/`handoffs`/`meetings` into new classes `MemoryToolCallRepository`, `MemoryHandoffRepository`, `MemoryMeetingRepository` (D8). Each new class owns its `Map<string, Row>` and exposes `.snapshot()`. Factory `createConversationsMemoryRepos(snapshot?)` returns the 5 class instances
- [x] 3.3 Create `apps/web/src/lib/tauri-repos/conversations.ts`
- [x] 3.4 Splice barrels; update memory barrel re-exports for 5 class symbols (2 existing + 3 new); delete inline blocks
- [x] 3.5 `pnpm typecheck` green; commit `refactor(core): repo-families Phase D — conversations`

## 4. Phase E — llm family

- [x] 4.1 Create `runtime/repos/llm/drizzle.ts` — extract `llmCalls`, `costRates`
- [x] 4.2 Create `runtime/repos/llm/memory.ts` — move existing `MemoryModelCostRateRepository` class + convert inline `llmCalls` to new `MemoryLlmCallRepository` class (D8)
- [x] 4.3 Create `apps/web/src/lib/tauri-repos/llm.ts`
- [x] 4.4 Splice barrels; update memory barrel re-exports (1 existing + 1 new); delete inline blocks
- [x] 4.5 `pnpm typecheck` green; commit `refactor(core): repo-families Phase E — llm`

## 5. Phase F — install family (D10 re-use existing class files)

- [x] 5.1 Create `runtime/repos/install/drizzle.ts` — re-export from `packages/core/src/repos/install-transaction-repository.ts` etc.; factory wires `new DrizzleInstallTransactionRepository(db)` etc. (no class duplication — D10)
- [x] 5.2 Create `runtime/repos/install/memory.ts` — re-export memory variants from same source files; factory wires `new MemoryInstallTransactionRepository()` etc. with seed plumbing
- [x] 5.3 Create `apps/web/src/lib/tauri-repos/install.ts` — extract tauri install impls (no class duplication if tauri install already class-shaped; otherwise inline factory shape matching other tauri family files)
- [x] 5.4 Confirm `MemoryInstallRepositoriesSnapshot` extension to `MemoryRepositoriesSnapshot` still typechecks (R9)
- [x] 5.5 Splice barrels; delete inline blocks
- [x] 5.6 `pnpm typecheck` green; commit `refactor(core): repo-families Phase F — install`

## 6. Phase G — permissions family

- [x] 6.1 Create `runtime/repos/permissions/drizzle.ts` — extract `racks`, `slots`, `workstationRacks`, `mcpAudit`
- [x] 6.2 Create `runtime/repos/permissions/memory.ts` — move `MemoryRackRepository`, `MemorySlotRepository`, `MemoryWorkstationRackRepository`, `MemoryMcpAuditRepository` classes
- [x] 6.3 Create `apps/web/src/lib/tauri-repos/permissions.ts`
- [x] 6.4 Splice barrels; update memory barrel re-exports (4 class symbols); delete inline blocks
- [x] 6.5 `pnpm typecheck` green; commit `refactor(core): repo-families Phase G — permissions`

## 7. Phase H — memory-system family (D11 normalizeMemoryDedupeKey local copy)

- [x] 7.1 Create `runtime/repos/memory-system/drizzle.ts` — extract `memories`, `nodeSummaries`, `compactSummaries` (drizzle has no `userPreferences`); copy `normalizeMemoryDedupeKey` helper inline
- [x] 7.2 Create `runtime/repos/memory-system/memory.ts` — move `MemoryNodeSummaryRepository`, `MemoryCompactSummaryRepository` + wrap existing `InMemoryMemoryRepository` + `MemoryUserPreferenceRepository` (re-imported from `/repositories/` path); expose `userPreferences` as memory-only attach point in factory return
- [x] 7.3 Create `apps/web/src/lib/tauri-repos/memory-system.ts` — extract tauri impls (no `userPreferences` on tauri); copy `normalizeMemoryDedupeKey` helper inline
- [x] 7.4 Splice barrels; update memory barrel re-exports (2 class symbols: NodeSummary, CompactSummary — `InMemoryMemoryRepository` + `MemoryUserPreferenceRepository` remain re-exported directly from `/repositories/` path via index.ts/browser.ts, not through memory-system); memory barrel continues to attach `userPreferences` into factory return
- [x] 7.5 `pnpm typecheck` green; commit `refactor(core): repo-families Phase H — memory-system`

## 8. Phase I — files family

- [x] 8.1 Create `runtime/repos/files/drizzle.ts` — extract `fileHistory`, `libraryDocuments`
- [x] 8.2 Create `runtime/repos/files/memory.ts` — move `MemoryFileHistoryRepository`, `MemoryLibraryDocumentRepository` classes
- [x] 8.3 Create `apps/web/src/lib/tauri-repos/files.ts`
- [x] 8.4 Splice barrels; update memory barrel re-exports (2 class symbols); delete inline blocks
- [x] 8.5 `pnpm typecheck` green; commit `refactor(core): repo-families Phase I — files`

## 9. Phase J — workspace family

- [ ] 9.1 Create `runtime/repos/workspace/drizzle.ts` — extract `sopTemplates`, `officeLayouts`, `prefabInstances`, `zones`
- [ ] 9.2 Create `runtime/repos/workspace/memory.ts` — move `MemorySopTemplateRepository`, `MemoryOfficeLayoutRepository`, `MemoryZoneRepository` classes + handle `prefabInstances` (already class-based per memory barrel snapshot line) — re-use existing class if present, otherwise convert per D8
- [ ] 9.3 Create `apps/web/src/lib/tauri-repos/workspace.ts`
- [ ] 9.4 Splice barrels; update memory barrel re-exports; delete inline blocks
- [ ] 9.5 `pnpm typecheck` green; commit `refactor(core): repo-families Phase J — workspace`

## 10. Phase K — projects family

- [ ] 10.1 Create `runtime/repos/projects/drizzle.ts` — extract `projects`, `projectAssignments`
- [ ] 10.2 Create `runtime/repos/projects/memory.ts` — move `MemoryProjectRepository`, `MemoryProjectAssignmentRepository` classes
- [ ] 10.3 Create `apps/web/src/lib/tauri-repos/projects.ts`
- [ ] 10.4 Splice barrels; update memory barrel re-exports (2 class symbols); delete inline blocks
- [ ] 10.5 `pnpm typecheck` green; commit `refactor(core): repo-families Phase K — projects`

## 11. Phase L — agent-events family

- [ ] 11.1 Create `runtime/repos/agent-events/drizzle.ts` — extract `agentEvents`, `recoveryKnowledge`
- [ ] 11.2 Create `runtime/repos/agent-events/memory.ts` — move `MemoryAgentEventRepository`, `MemoryRecoveryKnowledgeRepository` classes
- [ ] 11.3 Create `apps/web/src/lib/tauri-repos/agent-events.ts`
- [ ] 11.4 Splice barrels; update memory barrel re-exports (2 class symbols); delete inline blocks
- [ ] 11.5 `pnpm typecheck` green; commit `refactor(core): repo-families Phase L — agent-events`

## 12. Phase M — barrel finalization (NBNC ≤200 gate)

- [ ] 12.1 `drizzle-repositories.ts` final shape: import + spread-assembly + inline `transact` helper. Run NBNC check; target ≤200
- [ ] 12.2 `memory-repositories.ts` final shape: import + 29 class re-exports + spread-assembly + `snapshot()` aggregation + `seed` aggregation + `userPreferences` attach. Run NBNC check; target ≤200 (allowed up to 230 if class re-export count + snapshot pipeline genuinely needs it — document in live-verification-report.md)
- [ ] 12.3 `apps/web/src/lib/tauri-repos.ts` final shape: import + spread-assembly. Run NBNC check; target ≤200
- [ ] 12.4 Family file size gate: every file under `packages/core/src/runtime/repos/**/*.ts` and `apps/web/src/lib/tauri-repos/*.ts` ≤320 NBNC
- [ ] 12.5 Grep test: zero `async findById\|async findAll\|async create\|async update\|async delete\|async upsert` matches across all 3 barrels
- [ ] 12.6 Grep test: zero `const \w+\s*:\s*\w+Repository\s*=\s*\{` matches in `memory-repositories.ts` (no inline memory repo remains)
- [ ] 12.7 `pnpm typecheck` + `pnpm --filter @offisim/core build` + `pnpm --filter @offisim/web build` + `pnpm --filter @offisim/platform build` all green; commit `refactor(core): repo-families Phase M — barrel finalization`

## 13. Phase N — live verification (3 runtimes)

- [ ] 13.1 Drizzle smoke: `cd apps/platform && pnpm dev` → trigger one repo write through HTTP endpoint OR observe boot log; capture `Object.keys(repos).sort().join(',')` and confirm equals baseline (36 entries)
- [ ] 13.2 Memory smoke: `cd apps/web && pnpm dev` → real browser → boot a company → kick off a chat task → observe full `boss → manager → employee → boss_summary`; capture `Object.keys(repos).sort().join(',')` from devtools and confirm equals baseline (37 entries)
- [ ] 13.3 Tauri smoke: `pnpm --filter @offisim/desktop dev` → real desktop boot → boot a company → trigger one SQL write (e.g. send a message); capture `Object.keys(repos).sort().join(',')` and confirm equals baseline (34 entries)
- [ ] 13.4 Static contract diffs: confirm `git diff <pre-refactor-sha> HEAD -- packages/core/src/runtime/repositories.ts` is empty
- [ ] 13.5 Static contract diffs: confirm `git diff <pre-refactor-sha> HEAD -- packages/core/src/index.ts packages/core/src/browser.ts packages/core/src/drizzle.ts` shows only the 5 new memory class symbols added to existing re-export lists
- [ ] 13.6 Static contract diffs: confirm `apps/web/src/lib/tauri-runtime.ts` and `tauri-runtime-lite.ts` import paths for `./tauri-repos` are unchanged
- [ ] 13.7 Write `live-verification-report.md` at change directory root: timeline of all phase commits, per-runtime smoke evidence, captured `Object.keys` strings, NBNC gate readings, any documented exception (e.g. memory barrel ≤230 if exceeded 200)
- [ ] 13.8 Commit `refactor(core): repo-families Phase N — live verification + report`

## 14. Archive bookkeeping

- [ ] 14.1 Run `openspec validate refactor-repo-families-continuation --strict` — must pass
- [ ] 14.2 Archive via `/opsx:archive refactor-repo-families-continuation` after Phase N green
- [ ] 14.3 Sync canonical spec `openspec/specs/repository-backend-boundaries/spec.md` with the modified + added requirements (RENAMED + MODIFIED + ADDED merged into canonical)
- [ ] 14.4 Run `openspec validate --specs` to confirm canonical spec passes
- [ ] 14.5 Update `memory/MEMORY.md` + `memory/project_next_change_queue.md`: mark continuation `[x] archived` with apply / archive commit SHAs and full phase commit timeline (D4 closeout)
- [ ] 14.6 Prompt next backlog item per CLAUDE.md hard-constraint (D1/D2/D3/D4 D-queue is now empty after this; surface what's next from MEMORY.md hygiene hotspots or open closure gaps)
