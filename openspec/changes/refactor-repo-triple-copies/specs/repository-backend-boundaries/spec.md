## ADDED Requirements

### Requirement: Repository implementations live in per-family sub-directories

`RuntimeRepositories` backend implementations SHALL be organized into repo-family sub-directories under `packages/core/src/runtime/repos/<family>/` (for drizzle + memory) and `apps/web/src/lib/tauri-repos/<family>.ts` (for tauri). Each family sub-directory under `packages/core/` SHALL contain exactly three files: `drizzle.ts`, `memory.ts`, and `memory-types.ts` when the family owns exported snapshot/seed types; tauri family files SHALL live in parallel under `apps/web/`. Each family file SHALL export a single factory function (e.g. `createOrchestrationDrizzleRepos(db)`) that returns a partial slice of `RuntimeRepositories` containing only that family's repos.

#### Scenario: Family factory signature uniformity
- **WHEN** inspecting `runtime/repos/<family>/drizzle.ts` and `runtime/repos/<family>/memory.ts` and `apps/web/src/lib/tauri-repos/<family>.ts` for any family
- **THEN** each file exports exactly one `create<Family><Backend>Repos` factory whose return type is `Pick<RuntimeRepositories, <family's repo keys>>` — the three signatures differ only by input db parameter type

#### Scenario: No family holds a repo owned by another family
- **WHEN** grepping for `companies:` or `threads:` or any other repo key across `runtime/repos/<family>/*.ts` and `apps/web/src/lib/tauri-repos/*.ts`
- **THEN** each key appears in exactly one family across all backend files — no overlap

### Requirement: Barrel files remain at original paths and are thin

The three barrel files SHALL keep their existing repository paths unchanged:
- `packages/core/src/runtime/drizzle-repositories.ts`
- `packages/core/src/runtime/memory-repositories.ts`
- `apps/web/src/lib/tauri-repos.ts`

Each barrel SHALL contain at most 200 non-blank, non-comment (NBNC) lines. A barrel SHALL only: (a) import family factories and (when applicable) memory class/type re-exports, (b) export the public factory (`createDrizzleRepositories` / `createMemoryRepositories` / `createTauriRepositories`) whose body uses spread assembly (`{ ...createOrchestrationDrizzleRepos(db), ...createEmployeesDrizzleRepos(db), ... }`) to aggregate family slices into `RuntimeRepositories`, (c) for the memory barrel only, re-export the 19 `Memory*Repository` class symbols and the `MemoryRepositoriesSnapshot` / `MemoryRepositorySeed` types.

#### Scenario: Drizzle barrel size gate
- **WHEN** counting NBNC lines of `packages/core/src/runtime/drizzle-repositories.ts`
- **THEN** the count is at most 200

#### Scenario: Memory barrel size gate
- **WHEN** counting NBNC lines of `packages/core/src/runtime/memory-repositories.ts`
- **THEN** the count is at most 200

#### Scenario: Tauri barrel size gate
- **WHEN** counting NBNC lines of `apps/web/src/lib/tauri-repos.ts`
- **THEN** the count is at most 200

#### Scenario: Barrel only contains import + aggregate + re-export
- **WHEN** grepping barrel files for inline repo object bodies — `^\s+async (findById|findAll|create|update|delete|findByCompany)`
- **THEN** zero matches — barrels own no repo method bodies

### Requirement: Family files respect size gate

Each family implementation file under `packages/core/src/runtime/repos/<family>/<backend>.ts` and `apps/web/src/lib/tauri-repos/<family>.ts` SHALL contain at most 320 NBNC lines (D5 decision — raised from initial proposal of 250 once memory class boilerplate + large SQL surface for specific families like `install` / `memory-system` was measured during Phase B / early phases).

#### Scenario: All family drizzle files ≤320 NBNC
- **WHEN** counting NBNC lines of every `packages/core/src/runtime/repos/*/drizzle.ts`
- **THEN** no file exceeds 320

#### Scenario: All family memory files ≤320 NBNC
- **WHEN** counting NBNC lines of every `packages/core/src/runtime/repos/*/memory.ts`
- **THEN** no file exceeds 320

#### Scenario: All family tauri files ≤320 NBNC
- **WHEN** counting NBNC lines of every `apps/web/src/lib/tauri-repos/*.ts`
- **THEN** no file exceeds 320

### Requirement: Contract file `repositories.ts` is unchanged

`packages/core/src/runtime/repositories.ts` SHALL remain byte-identical to the pre-refactor state for this change. No type definition, interface signature, Row/New/Update type, or `RuntimeRepositories` aggregate shape is altered. No new symbol is added and no existing symbol is removed, renamed, or re-ordered.

#### Scenario: Contract file diff is empty
- **WHEN** running `git diff <pre-refactor-sha> HEAD -- packages/core/src/runtime/repositories.ts`
- **THEN** the diff output is empty

### Requirement: Public factory signatures are byte-identical

The three public factory signatures and their runtime returned shape SHALL be byte-identical to pre-refactor:

- `createDrizzleRepositories(db: Db): RuntimeRepositories` — returns 35 repo keys + `transact`
- `createMemoryRepositories(seed?: MemoryRepositorySeed): RuntimeRepositories & { snapshot(): MemoryRepositoriesSnapshot }` — returns 35 repo keys + `userPreferences` + `snapshot()`
- `createTauriRepositories(db: TauriDrizzleDb): RuntimeRepositories` — returns 34 repo keys (no `transact`, no `userPreferences`)

Each factory's returned object SHALL contain exactly the same set of keys and the same type-compatible methods as the pre-refactor implementation.

#### Scenario: Drizzle factory returns same keys
- **WHEN** `Object.keys(createDrizzleRepositories(db))` is computed post-refactor
- **THEN** the sorted key list equals the sorted key list from pre-refactor (35 repo keys + `transact` = 36 entries)

#### Scenario: Memory factory returns same keys + snapshot
- **WHEN** `Object.keys(createMemoryRepositories())` is computed post-refactor
- **THEN** the sorted key list equals the pre-refactor sorted key list and includes both `userPreferences` and a callable `snapshot()` method

#### Scenario: Tauri factory returns same keys
- **WHEN** `Object.keys(createTauriRepositories(db))` is computed post-refactor
- **THEN** the sorted key list equals the pre-refactor sorted key list (34 entries, no `transact`, no `userPreferences`)

### Requirement: Memory-only exports continue to re-export from new location

The memory barrel `packages/core/src/runtime/memory-repositories.ts` SHALL continue to export the following symbols for downstream consumers that import from `@offisim/core` or `@offisim/core/browser`:

- 19 pre-existing class symbols matching the pattern `Memory*Repository` — all 19 implementing their respective `*Repository` interface from `runtime/repositories.ts`
- 10 newly-added class symbols (D8 decision — converted from pre-refactor inline repos): `MemoryCompanyRepository`, `MemoryThreadRepository`, `MemoryTaskRunRepository`, `MemoryEmployeeRepository`, `MemoryToolCallRepository`, `MemoryHandoffRepository`, `MemoryMeetingRepository`, `MemoryCheckpointRepository`, `MemoryEventRepository`, `MemoryLlmCallRepository` — each owning its backing Map (or Array for events), implementing `.snapshot()`, and (where used by `MemoryRepositorySeed`) `.seed(rows)`
- `MemoryRepositoriesSnapshot` type
- `MemoryRepositorySeed` type
- `createMemoryRepositories` function

Implementations of these 29 classes SHALL live in `packages/core/src/runtime/repos/<family>/memory.ts` files; the barrel SHALL only re-export them.

#### Scenario: All 19 pre-existing Memory*Repository classes remain exported
- **WHEN** importing `{ MemoryActiveInteractionRepository, MemoryInteractionHistoryRepository, MemoryEmployeeVersionRepository, MemoryModelCostRateRepository, MemorySopTemplateRepository, MemoryRackRepository, MemorySlotRepository, MemoryWorkstationRackRepository, MemoryLibraryDocumentRepository, MemoryOfficeLayoutRepository, MemoryZoneRepository, MemoryMcpAuditRepository, MemoryNodeSummaryRepository, MemoryCompactSummaryRepository, MemoryFileHistoryRepository, MemoryProjectRepository, MemoryProjectAssignmentRepository, MemoryAgentEventRepository, MemoryRecoveryKnowledgeRepository }` from `@offisim/core` post-refactor
- **THEN** all 19 symbols resolve and are constructable (no undefined imports)

#### Scenario: 10 newly-added Memory*Repository classes exported
- **WHEN** importing `{ MemoryCompanyRepository, MemoryThreadRepository, MemoryTaskRunRepository, MemoryEmployeeRepository, MemoryToolCallRepository, MemoryHandoffRepository, MemoryMeetingRepository, MemoryCheckpointRepository, MemoryEventRepository, MemoryLlmCallRepository }` from `@offisim/core` post-refactor
- **THEN** all 10 symbols resolve and are constructable; each instance exposes `.snapshot()` returning an array matching the corresponding field of `MemoryRepositoriesSnapshot`

#### Scenario: MemoryRepositoriesSnapshot type re-exported
- **WHEN** importing `{ MemoryRepositoriesSnapshot }` as a type from both `@offisim/core` (`index.ts`) and `@offisim/core/browser` (`browser.ts`) post-refactor
- **THEN** both imports resolve to the same type

### Requirement: Backend asymmetry is preserved verbatim

Runtime asymmetry between backends SHALL remain exactly as pre-refactor:

- `transact?<T>(fn: () => T): T` SHALL be present on `createDrizzleRepositories` result AND absent on both memory and tauri results
- `userPreferences?: UserPreferenceRepository` SHALL be present on `createMemoryRepositories` result AND absent on both drizzle and tauri results
- `MemoryRepositoriesSnapshot` / `MemoryRepositorySeed` / `snapshot()` method SHALL be memory-only

No refactor phase SHALL add a missing field to a backend or remove an asymmetric field from the backend that owns it.

#### Scenario: Drizzle factory transact behavior identical
- **WHEN** `const repos = createDrizzleRepositories(db)` and `repos.transact(() => { /* multiple repo writes */ })` is invoked post-refactor
- **THEN** all writes execute within a single SQLite transaction (same behavior as pre-refactor), and `repos.transact` is a callable function

#### Scenario: Memory factory transact is undefined
- **WHEN** inspecting `createMemoryRepositories().transact` post-refactor
- **THEN** the value is `undefined` (pre-refactor behavior preserved)

#### Scenario: Tauri factory transact is undefined
- **WHEN** inspecting `createTauriRepositories(db).transact` post-refactor
- **THEN** the value is `undefined` (pre-refactor behavior preserved)

#### Scenario: userPreferences only on memory
- **WHEN** inspecting `createDrizzleRepositories(db).userPreferences` and `createTauriRepositories(db).userPreferences` post-refactor
- **THEN** both are `undefined`; `createMemoryRepositories().userPreferences` is a defined `UserPreferenceRepository` implementation

### Requirement: Zero behavior change in repo methods

Every repo method implementation SHALL be byte-equivalent to its pre-refactor source for SQL statements (drizzle / tauri), for Map operations (memory), and for JSON serialization / deserialization. Any SQL query clause, `ORDER BY`, `WHERE` predicate, `JOIN`, column list, `.run()` vs `.all()` call, dedupe key normalization, `now()` timestamp generation, or `MemoryRepositoriesSnapshot.clone()` behavior SHALL be preserved exactly.

#### Scenario: Drizzle repo SQL strings preserved
- **WHEN** grepping `runtime/repos/*/drizzle.ts` for SQL patterns present in the pre-refactor drizzle-repositories.ts (sample: `eq(schema.taskRuns.thread_id`, `orderBy(desc(schema.graphThreads.created_at))`, `inArray(schema.threads.thread_id`)
- **THEN** every pattern appears in the new location with identical column, operator, and ordering

#### Scenario: Memory cloneRows / createRowMap helpers preserved
- **WHEN** grepping `runtime/repos/*/memory.ts` for the helpers `cloneRows` and `createRowMap`
- **THEN** each memory family file imports or inlines these helpers with byte-equivalent logic to pre-refactor `memory-repositories.ts:144-161`

#### Scenario: normalizeMemoryDedupeKey preserved across backends
- **WHEN** grepping for the `normalizeMemoryDedupeKey` function body (or its NFKC normalization + punctuation stripping logic) in drizzle and tauri memory implementations post-refactor
- **THEN** the body is byte-equivalent to pre-refactor `drizzle-repositories.ts:110-117` and `tauri-repos.ts:108-118`

### Requirement: Import paths for external consumers remain unchanged

External consumers SHALL continue to import from the pre-refactor paths with zero modifications:

- `packages/core/src/drizzle.ts` imports `createDrizzleRepositories` from `./runtime/drizzle-repositories.js`
- `packages/core/src/{index,browser}.ts` imports `createMemoryRepositories` + 19 Memory class + `MemoryRepositoriesSnapshot` type from `./runtime/memory-repositories.js`
- `apps/web/src/lib/tauri-runtime.ts` and `tauri-runtime-lite.ts` import `createTauriRepositories` from `./tauri-repos`

No new import path is required for any existing consumer. No existing import statement is modified.

#### Scenario: All external consumers compile without import edits
- **WHEN** `pnpm --filter @offisim/core build && pnpm --filter @offisim/web build && pnpm --filter @offisim/platform build` runs post-refactor without editing any consumer's `import` statements
- **THEN** all three builds succeed

#### Scenario: index.ts / browser.ts diff is empty
- **WHEN** running `git diff <pre-refactor-sha> HEAD -- packages/core/src/index.ts packages/core/src/browser.ts packages/core/src/drizzle.ts`
- **THEN** the diff output is empty

### Requirement: Live runtime proves three-backend contract equivalence

Post-refactor verification SHALL exercise each of the three backends in a live runtime execution path:

- **Drizzle runtime**: platform API (`apps/platform/src/routes/`) boots and handles at least one request that writes to a core repo (e.g. `companies.create`, `threads.create`, or `taskRuns.create`)
- **Memory runtime**: web browser (`apps/web`) SPA boots, instantiates a company via `createMemoryRepositories`, and persists state through at least one full `boss → manager → employee → boss_summary` flow
- **Tauri runtime**: Tauri desktop app (`apps/desktop`) boots, `createTauriRepositories` returns valid repos, and at least one repo write (e.g. sending a chat message or creating a company) succeeds

Each runtime SHALL produce byte-identical event sequences for the exercised flow compared to pre-refactor (matching the `workspace-state-management` / `web-app-shell-boundaries` / `employee-node-boundaries` canonical specs where applicable).

#### Scenario: Drizzle runtime smoke
- **WHEN** the platform API is started and a POST creates or updates a core entity
- **THEN** the request completes successfully and `Object.keys(createDrizzleRepositories(db))` matches the pre-refactor sorted key list

#### Scenario: Memory runtime smoke
- **WHEN** the web SPA boots and a chat task kicks off `boss → manager → employee → boss_summary`
- **THEN** the full node sequence fires with the same event payloads as pre-refactor and no repo method throws `undefined is not a function`

#### Scenario: Tauri runtime smoke
- **WHEN** the Tauri desktop app boots and at least one repo write is triggered
- **THEN** the write completes and `Object.keys(createTauriRepositories(db))` matches the pre-refactor sorted key list (34 keys, no `transact`, no `userPreferences`)
