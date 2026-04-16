## ADDED Requirements

### Requirement: Per-family sub-directory pattern is established

`RuntimeRepositories` backend implementations SHALL be reorganizable into repo-family sub-directories. Once a repo family is migrated, its drizzle + memory implementations live under `packages/core/src/runtime/repos/<family>/{drizzle,memory}.ts`, its tauri implementation lives under `apps/web/src/lib/tauri-repos/<family>.ts`, and any memory-backend snapshot/seed types shared across families live in `packages/core/src/runtime/repos/memory-types.ts`. The barrel files `packages/core/src/runtime/drizzle-repositories.ts`, `packages/core/src/runtime/memory-repositories.ts`, and `apps/web/src/lib/tauri-repos.ts` SHALL retain their existing repository paths and act as aggregation points for migrated families.

Each migrated family SHALL export exactly one factory function per backend (e.g. `createOrchestrationDrizzleRepos(db)`, `createOrchestrationMemoryRepos(snapshot?)`, `createOrchestrationTauriRepos(db)`) whose return type is a typed slice of `RuntimeRepositories` containing only that family's repos.

#### Scenario: Family sub-directories exist
- **WHEN** inspecting the repository tree post-refactor
- **THEN** `packages/core/src/runtime/repos/` exists with a dedicated sub-directory per migrated family, and `apps/web/src/lib/tauri-repos/` exists with parallel `<family>.ts` files for migrated families

#### Scenario: memory-types.ts owns shared snapshot/seed types
- **WHEN** inspecting `packages/core/src/runtime/repos/memory-types.ts`
- **THEN** it exports `MemoryRepositorySeed` and `MemoryRepositoriesSnapshot`, and `packages/core/src/runtime/memory-repositories.ts` re-exports both types from this location

#### Scenario: Family factory signature uniformity
- **WHEN** inspecting a migrated family's `drizzle.ts`, `memory.ts`, and tauri `<family>.ts`
- **THEN** each exports a single `create<Family><Backend>Repos` factory whose return type is a `Pick<RuntimeRepositories, …>` slice matching that family's repo keys

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

The memory barrel `packages/core/src/runtime/memory-repositories.ts` SHALL continue to export every `Memory*Repository` class symbol for downstream consumers that import from `@offisim/core` or `@offisim/core/browser`. This covers:

- 19 pre-existing class symbols (retained from pre-refactor)
- Each newly-added class created under D8 for a migrated family (5 classes from orchestration family: `MemoryCompanyRepository`, `MemoryThreadRepository`, `MemoryTaskRunRepository`, `MemoryCheckpointRepository`, `MemoryEventRepository`)

Each export SHALL originate from the new family file location (`packages/core/src/runtime/repos/<family>/memory.ts`) via `export { … } from …` re-export in the barrel.

#### Scenario: 19 pre-existing classes still resolve
- **WHEN** importing all 19 pre-existing `Memory*Repository` symbols from `@offisim/core` post-refactor
- **THEN** every import resolves and is constructable

#### Scenario: 5 orchestration classes are re-exported
- **WHEN** importing `{ MemoryCompanyRepository, MemoryThreadRepository, MemoryTaskRunRepository, MemoryCheckpointRepository, MemoryEventRepository }` from `@offisim/core`
- **THEN** all 5 symbols resolve, each instance implements its `*Repository` contract, and each exposes `.snapshot()`

#### Scenario: MemoryRepositoriesSnapshot type still exported
- **WHEN** importing `MemoryRepositoriesSnapshot` as a type from both `@offisim/core` (`index.ts`) and `@offisim/core/browser` (`browser.ts`) post-refactor
- **THEN** both imports resolve to the same type now originating from `runtime/repos/memory-types.ts`

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
