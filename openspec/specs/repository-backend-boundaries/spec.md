# repository-backend-boundaries Specification

## Purpose

`RuntimeRepositories` 三后端实现（better-sqlite3 drizzle / Map-based memory / Tauri SQL plugin drizzle）按 repo 家族拆分的边界规范。每个家族落在独立子目录 `packages/core/src/runtime/repos/<family>/{drizzle,memory}.ts` + `apps/web/src/lib/tauri-repos/<family>.ts`，三 barrel 文件（`runtime/drizzle-repositories.ts` / `runtime/memory-repositories.ts` / `apps/web/src/lib/tauri-repos.ts`）保留原路径作为聚合点。首批迁移的 `orchestration/` 家族（`companies` / `threads` / `taskRuns` / `checkpoints` / `events`）证实模式可行：drizzle 薄 factory、memory class-based（D8 path-1 消除 inline repo），tauri 镜像 drizzle 带 `await`。contract 文件 `repositories.ts` / 三个 public factory 签名 / 19 个 pre-existing Memory class export / 所有外部 consumer import 路径全部 byte-identical。剩余 10 家族迁移 + barrel ≤200 NBNC 最终化由 successor change 承接。
## Requirements
### Requirement: Per-family sub-directory pattern is established

All **12** repo families SHALL be migrated to the family sub-directory pattern defined by `repository-backend-boundaries`. Each family SHALL have its drizzle + memory implementations under `packages/core/src/runtime/repos/<family>/{drizzle,memory}.ts` and its tauri implementation under `apps/web/src/lib/tauri-repos/<family>.ts`. Each family file SHALL export exactly one factory per backend returning a typed slice of `RuntimeRepositories`.

The 12 families and their repo keys:

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
| `deliverables` | `deliverables` |

Each family file SHALL contain at most 320 NBNC lines (D5 decision retained from the archived change).

**Note** — replaces the previous "Orchestration family is migrated first" requirement now that all migrated families follow the uniform rule; orchestration remains the first-in-pattern historical precedent. The `deliverables` family is added in `persist-deliverable-history` and follows the same contract as the existing 11.

#### Scenario: All 12 family sub-directories exist
- **WHEN** inspecting `packages/core/src/runtime/repos/` and `apps/web/src/lib/tauri-repos/`
- **THEN** both directories contain all 12 family children (11 subdirectories + `memory-types.ts` in core; 12 `<family>.ts` files in tauri-repos)

#### Scenario: Each family's drizzle factory returns its repo slice
- **WHEN** calling `create<Family>DrizzleRepos(db)` for any of the 12 families
- **THEN** the returned object's keys match exactly the repo keys listed for that family in the table above

#### Scenario: Each family's memory factory returns its repo slice
- **WHEN** calling `create<Family>MemoryRepos(snapshot?)` for any of the 12 families
- **THEN** the returned object's keys match exactly the repo keys listed for that family in the table above

#### Scenario: Each family's tauri factory returns its repo slice
- **WHEN** calling `create<Family>TauriRepos(db)` for any of the 12 families
- **THEN** the returned object's keys match exactly the repo keys listed for that family in the table above (note: `memory-system` tauri factory excludes `userPreferences` — runtime asymmetry preserved)

#### Scenario: Family file size gate
- **WHEN** running NBNC count on every file under `packages/core/src/runtime/repos/**/*.ts` and `apps/web/src/lib/tauri-repos/*.ts`
- **THEN** no file exceeds 320 NBNC

### Requirement: Orchestration family is migrated first

The `orchestration/` family SHALL be the first family extracted under the new pattern, covering these 5 repos: `companies`, `threads`, `taskRuns`, `checkpoints`, `events`.

- `packages/core/src/runtime/repos/orchestration/drizzle.ts` exports `createOrchestrationDrizzleRepos(db: Db): OrchestrationDrizzleRepos`
- `packages/core/src/runtime/repos/orchestration/memory.ts` exports 5 new `Memory*Repository` classes and `createOrchestrationMemoryRepos(snapshot?): OrchestrationMemoryRepos`
- `apps/web/src/lib/tauri-repos/orchestration.ts` exports `createOrchestrationTauriRepos(db: TauriDrizzleDb): OrchestrationTauriRepos`

Each file SHALL contain at most 320 NBNC lines (D5 decision — raised from initial proposal of 250 after measuring memory class boilerplate + SQL surface overhead).

#### Scenario: Orchestration drizzle file exists and is ≤320 NBNC
- **WHEN** counting NBNC lines of `packages/core/src/runtime/repos/orchestration/drizzle.ts`
- **THEN** the count is at most 320

#### Scenario: Orchestration memory file exists and is ≤320 NBNC
- **WHEN** counting NBNC lines of `packages/core/src/runtime/repos/orchestration/memory.ts`
- **THEN** the count is at most 320

#### Scenario: Orchestration tauri file exists and is ≤320 NBNC
- **WHEN** counting NBNC lines of `apps/web/src/lib/tauri-repos/orchestration.ts`
- **THEN** the count is at most 320

### Requirement: Memory inline repos in migrated families become classes (D8)

When a family is migrated, any of its pre-refactor inline memory repos in `createMemoryRepositories()` SHALL be converted to exported `Memory*Repository` classes matching the existing 19-class pattern. Each new class owns its backing state (`Map<string, Row>` or `Array<Row>` for append-only events), implements the corresponding `*Repository` interface from `runtime/repositories.ts`, and exposes `.snapshot(): Row[]`. Classes whose rows are mutable via `MemoryRepositorySeed` SHALL also expose `.seed(rows: Row[]): void`.

Cross-class dependencies (e.g. `MemoryTaskRunRepository.findQueue` reading `MemoryThreadRepository` state) SHALL be injected via constructor parameters, not via shared closure state.

#### Scenario: Orchestration inline repos converted to 5 classes
- **WHEN** inspecting `packages/core/src/runtime/repos/orchestration/memory.ts`
- **THEN** the module exports 5 classes — `MemoryCompanyRepository`, `MemoryThreadRepository`, `MemoryTaskRunRepository`, `MemoryCheckpointRepository`, `MemoryEventRepository` — each implementing its respective `*Repository` interface with `.snapshot()` and (for `MemoryCompanyRepository`) `.seed(rows)`

#### Scenario: MemoryTaskRunRepository cross-class dep via constructor
- **WHEN** inspecting the `MemoryTaskRunRepository` constructor signature
- **THEN** it accepts a second parameter typed as `ThreadRepository` (or compatible) used for `findQueue` / `countByStatus` company-scoped lookups — not closure-captured state

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

### Requirement: Contract file `repositories.ts` is unchanged

`packages/core/src/runtime/repositories.ts` SHALL remain byte-identical to the pre-refactor state for this change. No type definition, interface signature, Row/New/Update type, or `RuntimeRepositories` aggregate shape is altered.

#### Scenario: Contract file diff is empty
- **WHEN** running `git diff <pre-refactor-sha> HEAD -- packages/core/src/runtime/repositories.ts`
- **THEN** the diff output is empty

### Requirement: Public factory signatures are byte-identical

The three public factory signatures and their runtime returned shape SHALL be byte-identical to pre-refactor:

- `createDrizzleRepositories(db: Db): RuntimeRepositories` — returns 35 repo keys + `transact`
- `createMemoryRepositories(seed?: MemoryRepositorySeed): RuntimeRepositories & { seed: MemoryRepositorySeed; snapshot(): MemoryRepositoriesSnapshot }` — returns 35 repo keys + `userPreferences` + `seed` + `snapshot()`
- `createTauriRepositories(db: TauriDrizzleDb): RuntimeRepositories` — returns 34 repo keys (no `transact`, no `userPreferences`)

#### Scenario: Drizzle factory returns same keys
- **WHEN** `Object.keys(createDrizzleRepositories(db))` is computed post-refactor
- **THEN** the sorted key list equals the pre-refactor sorted key list (35 repo keys + `transact` = 36 entries)

#### Scenario: Memory factory returns same keys + snapshot + seed
- **WHEN** `Object.keys(createMemoryRepositories())` is computed post-refactor
- **THEN** the sorted key list equals the pre-refactor sorted key list, includes both `userPreferences` and a callable `snapshot()` method and a `seed` object

#### Scenario: Tauri factory returns same keys
- **WHEN** `Object.keys(createTauriRepositories(db))` is computed post-refactor
- **THEN** the sorted key list equals the pre-refactor sorted key list (34 entries, no `transact`, no `userPreferences`)

### Requirement: Backend asymmetry is preserved verbatim

Runtime asymmetry between backends SHALL remain exactly as pre-refactor:

- `transact?<T>(fn: () => T): T` SHALL be present on `createDrizzleRepositories` result AND absent on both memory and tauri results
- `userPreferences?: UserPreferenceRepository` SHALL be present on `createMemoryRepositories` result AND absent on both drizzle and tauri results
- `MemoryRepositoriesSnapshot` / `MemoryRepositorySeed` / `snapshot()` method SHALL be memory-only

#### Scenario: Drizzle factory transact behavior preserved
- **WHEN** `const repos = createDrizzleRepositories(db)` and `repos.transact(() => { /* multiple repo writes */ })` is invoked post-refactor
- **THEN** all writes execute within a single SQLite transaction and `repos.transact` is callable

#### Scenario: Memory + tauri factory transact is undefined
- **WHEN** inspecting `createMemoryRepositories().transact` and `createTauriRepositories(db).transact` post-refactor
- **THEN** both values are `undefined`

#### Scenario: userPreferences only on memory
- **WHEN** inspecting `createDrizzleRepositories(db).userPreferences` and `createTauriRepositories(db).userPreferences` post-refactor
- **THEN** both are `undefined`; `createMemoryRepositories().userPreferences` is a defined `UserPreferenceRepository` implementation

### Requirement: Zero behavior change in migrated repo methods

Every repo method migrated under this pattern SHALL be byte-equivalent in logic to its pre-refactor source: SQL statements (drizzle / tauri), Map/Array operations (memory), JSON serialization / deserialization, and `now()` timestamp generation. Any SQL `ORDER BY`, `WHERE` predicate, `JOIN`, column list, `.run()` vs `.all()` call, or dedupe key normalization SHALL be preserved exactly.

#### Scenario: Orchestration drizzle SQL preserved
- **WHEN** grepping `runtime/repos/orchestration/drizzle.ts` for SQL patterns present in the pre-refactor drizzle-repositories.ts (`eq(schema.companies.company_id`, `orderBy(desc(schema.graphThreads.created_at))`, `inArray(schema.taskRuns.thread_id`)
- **THEN** every pattern appears in the new location with identical column, operator, and ordering

#### Scenario: Orchestration memory class logic preserved
- **WHEN** comparing `MemoryThreadRepository.findByCompany` logic post-refactor vs the pre-refactor inline implementation
- **THEN** the map → filter → sort → slice pipeline produces equivalent results for identical seeded state

### Requirement: Import paths for external consumers remain unchanged

External consumers SHALL continue to import from the pre-refactor paths with zero modifications:

- `packages/core/src/drizzle.ts` imports `createDrizzleRepositories` from `./runtime/drizzle-repositories.js`
- `packages/core/src/{index,browser}.ts` imports `createMemoryRepositories` + all Memory class symbols + `MemoryRepositoriesSnapshot` type from `./runtime/memory-repositories.js`
- `apps/web/src/lib/tauri-runtime.ts` and `tauri-runtime-lite.ts` import `createTauriRepositories` from `./tauri-repos`

#### Scenario: External consumer imports survive
- **WHEN** running `pnpm typecheck` across all 16 workspace packages post-refactor without editing any consumer's `import` statements
- **THEN** all typecheck tasks succeed

#### Scenario: index.ts / browser.ts / drizzle.ts diffs are empty
- **WHEN** running `git diff <pre-refactor-sha> HEAD -- packages/core/src/index.ts packages/core/src/browser.ts packages/core/src/drizzle.ts`
- **THEN** the diff output is empty

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

