## MODIFIED Requirements

### Requirement: Per-family sub-directory pattern is established

All 11 repo families identified in the archived `refactor-repo-triple-copies` D1 decision SHALL be migrated to the family sub-directory pattern defined by `repository-backend-boundaries`. Each family SHALL have its drizzle + memory implementations under `packages/core/src/runtime/repos/<family>/{drizzle,memory}.ts` and its tauri implementation under `apps/web/src/lib/tauri-repos/<family>.ts`. Each family file SHALL export exactly one factory per backend returning a typed slice of `RuntimeRepositories`.

The 11 families and their repo keys:

| Family | Repo keys |
|---|---|
| `orchestration` | `companies`, `threads`, `taskRuns`, `checkpoints`, `events` |
| `employees` | `employees`, `employeeVersions` |
| `conversations` | `toolCalls`, `handoffs`, `meetings`, `activeInteractions`, `interactionHistory` |
| `llm` | `llmCalls`, `costRates` |
| `install` | `installTransactions`, `installedPackages`, `installedAssets`, `assetBindings` |
| `permissions` | `racks`, `slots`, `workstationRacks`, `mcpAudit` |
| `memory-system` | `memories`, `userPreferences`, `nodeSummaries`, `compactSummaries` |
| `files` | `fileHistory`, `libraryDocuments` |
| `workspace` | `sopTemplates`, `officeLayouts`, `prefabInstances`, `zones` |
| `projects` | `projects`, `projectAssignments` |
| `agent-events` | `agentEvents`, `recoveryKnowledge` |

Each family file SHALL contain at most 320 NBNC lines (D5 decision retained from the archived change).

**Note** — replaces the previous "Orchestration family is migrated first" requirement now that all 11 families are migrated; orchestration remains the first-in-pattern historical precedent but the per-family rule is uniform.

#### Scenario: All 11 family sub-directories exist
- **WHEN** inspecting `packages/core/src/runtime/repos/` and `apps/web/src/lib/tauri-repos/`
- **THEN** both directories contain all 11 family children (10 subdirectories + `memory-types.ts` in core; 11 `<family>.ts` files in tauri-repos)

#### Scenario: Each family's drizzle factory returns its repo slice
- **WHEN** calling `create<Family>DrizzleRepos(db)` for any of the 11 families
- **THEN** the returned object's keys match exactly the repo keys listed for that family in the table above

#### Scenario: Each family's memory factory returns its repo slice
- **WHEN** calling `create<Family>MemoryRepos(snapshot?)` for any of the 11 families
- **THEN** the returned object's keys match exactly the repo keys listed for that family in the table above

#### Scenario: Each family's tauri factory returns its repo slice
- **WHEN** calling `create<Family>TauriRepos(db)` for any of the 11 families
- **THEN** the returned object's keys match exactly the repo keys listed for that family in the table above (note: `memory-system` tauri factory excludes `userPreferences` — runtime asymmetry preserved)

#### Scenario: Family file size gate
- **WHEN** running NBNC count on every file under `packages/core/src/runtime/repos/**/*.ts` and `apps/web/src/lib/tauri-repos/*.ts`
- **THEN** no file exceeds 320 NBNC

### Requirement: Migrated Memory class exports survive through the barrel

The memory barrel `packages/core/src/runtime/memory-repositories.ts` SHALL re-export every `Memory*Repository` class, covering all 29 classes after full migration:

- 19 pre-existing classes (retained from pre-refactor): `MemoryActiveInteractionRepository`, `MemoryInteractionHistoryRepository`, `MemoryEmployeeVersionRepository`, `MemoryModelCostRateRepository`, `MemorySopTemplateRepository`, `MemoryRackRepository`, `MemorySlotRepository`, `MemoryWorkstationRackRepository`, `MemoryLibraryDocumentRepository`, `MemoryOfficeLayoutRepository`, `MemoryZoneRepository`, `MemoryMcpAuditRepository`, `MemoryNodeSummaryRepository`, `MemoryCompactSummaryRepository`, `MemoryFileHistoryRepository`, `MemoryProjectRepository`, `MemoryProjectAssignmentRepository`, `MemoryAgentEventRepository`, `MemoryRecoveryKnowledgeRepository`, plus `MemoryUserPreferenceRepository` (counts as one of the 19)
- 5 orchestration classes added in Phase B of the archived change: `MemoryCompanyRepository`, `MemoryThreadRepository`, `MemoryTaskRunRepository`, `MemoryCheckpointRepository`, `MemoryEventRepository`
- 5 new classes added under this continuation via D8 path-1 conversion: `MemoryEmployeeRepository` (employees family), `MemoryToolCallRepository` / `MemoryHandoffRepository` / `MemoryMeetingRepository` (conversations family), `MemoryLlmCallRepository` (llm family)

Each class SHALL be exported from its family's `memory.ts` file, re-exported from the barrel, and re-exported once more through `packages/core/src/{index,browser}.ts`. All 29 classes SHALL remain constructable by downstream consumers without import-path changes.

**Note** — extends the previous requirement (which only listed 24 classes) to cover the 5 additional classes from D8 continuation.

#### Scenario: 29 Memory class symbols resolve from @offisim/core
- **WHEN** importing all 29 `Memory*Repository` symbols named above from `@offisim/core`
- **THEN** every import resolves and is constructable

#### Scenario: 29 Memory class symbols resolve from @offisim/core/browser
- **WHEN** importing all 29 `Memory*Repository` symbols named above from `@offisim/core/browser`
- **THEN** every import resolves and is constructable

#### Scenario: No inline memory repo remains in the barrel
- **WHEN** grepping `packages/core/src/runtime/memory-repositories.ts` for the pattern `const \w+\s*:\s*\w+Repository\s*=\s*\{`
- **THEN** zero matches — all memory repo implementations have moved to class form in family files

## ADDED Requirements

### Requirement: Barrel files are thin aggregators ≤200 NBNC

The three barrel files SHALL be reduced to thin aggregators that contain only imports, family factory spread assembly, the `transact` helper (drizzle only), and the `snapshot` / `seed` aggregation (memory only). No `async findById` / `async findAll` / `async create` / `async update` / `async delete` method body SHALL appear in any barrel file.

- `packages/core/src/runtime/drizzle-repositories.ts` SHALL be ≤200 NBNC
- `packages/core/src/runtime/memory-repositories.ts` SHALL be ≤200 NBNC
- `apps/web/src/lib/tauri-repos.ts` SHALL be ≤200 NBNC

If the memory barrel exceeds 200 NBNC due to the 29 class re-exports + 11 family factory imports + snapshot aggregation, the gate MAY be relaxed to ≤230 NBNC with an explicit note in `live-verification-report.md` documenting the measured count and the reason. Above 230 NBNC is a hard failure requiring scope reassessment.

#### Scenario: Drizzle barrel size
- **WHEN** running `awk 'NF && !/^[[:space:]]*\/\// && !/^[[:space:]]*\*/ { c++ } END { print c }' packages/core/src/runtime/drizzle-repositories.ts`
- **THEN** the output is ≤200

#### Scenario: Tauri barrel size
- **WHEN** running the same awk NBNC command against `apps/web/src/lib/tauri-repos.ts`
- **THEN** the output is ≤200

#### Scenario: Memory barrel size
- **WHEN** running the same awk NBNC command against `packages/core/src/runtime/memory-repositories.ts`
- **THEN** the output is ≤230 (target ≤200, documented exception allowed up to 230)

#### Scenario: No repo method bodies in barrels
- **WHEN** grepping each barrel file for `async findById\|async findAll\|async create\|async update\|async delete\|async upsert`
- **THEN** no matches in any of the three barrels

### Requirement: Runtime behavior is verified on all three backends

After all 11 families are migrated and the barrels are finalized, the three runtime backends (drizzle, memory, tauri) SHALL each be verified by executing at least one real repo write and capturing the observed `Object.keys(repos).sort()` key list. The captured key list SHALL equal the pre-refactor baseline captured in the archived change's `baseline-notes.md`.

Observations SHALL be recorded in `live-verification-report.md` at the change directory root, including:

- The runtime (drizzle / memory / tauri)
- The trigger action taken (e.g. "web SPA: created company 'ACME', sent chat message, observed boss → manager → employee → boss_summary")
- The captured `Object.keys(repos).sort().join(',')` string
- The result (pass / fail)

#### Scenario: Drizzle live smoke passes
- **WHEN** starting the platform API (`apps/platform`) and triggering at least one repo write via its HTTP endpoints, then reading `Object.keys(createDrizzleRepositories(db)).sort()`
- **THEN** the sorted key list equals the baseline (36 entries: 35 repo keys + `transact`) and the write succeeds without thrown `TypeError`

#### Scenario: Memory live smoke passes
- **WHEN** starting the web SPA (`apps/web` dev) and executing a full `boss → manager → employee → boss_summary` conversation flow in the browser
- **THEN** the flow completes with no console error referencing undefined repo methods, and the captured `Object.keys(createMemoryRepositories()).sort()` matches baseline (37 entries: 35 repo keys + `userPreferences` + `snapshot` + `seed`)

#### Scenario: Tauri live smoke passes
- **WHEN** starting the desktop app (`apps/desktop` tauri dev) and triggering at least one SQL write via user interaction
- **THEN** the write succeeds against the real Tauri SQL plugin and the captured `Object.keys(createTauriRepositories(db)).sort()` matches baseline (34 entries: 35 repo keys minus `userPreferences`, no `transact`)

#### Scenario: live-verification-report.md exists in change directory
- **WHEN** inspecting the change directory post Phase N
- **THEN** `openspec/changes/refactor-repo-families-continuation/live-verification-report.md` exists and documents all three runtime observations

### Requirement: Phase migration history preserved in git log

The 10 family migration phases + Phase M barrel finalization + Phase N live verification SHALL each land as a separate commit on `main` (not squashed), matching the D1/D2/D3 precedent. Commit messages SHALL carry the prefix `refactor(core): repo-families Phase <letter> — <family>` so that bisect and reviewer navigation works.

#### Scenario: Phase commits exist and are individually revertable
- **WHEN** running `git log --oneline main --since="refactor-repo-families-continuation apply"` at archive time
- **THEN** at least 10 phase commits (Phase C–L) plus Phase M + Phase N commits appear in order, each with an identifiable family name in the subject line

#### Scenario: Any single phase revert leaves the tree compilable
- **WHEN** running `git revert <phase-commit-sha>` for any single Phase C–L commit (for audit / rollback testing)
- **THEN** `pnpm typecheck` remains green at the reverted state (phase boundaries are independent)
