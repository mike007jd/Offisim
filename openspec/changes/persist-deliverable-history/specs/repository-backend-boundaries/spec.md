## MODIFIED Requirements

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
