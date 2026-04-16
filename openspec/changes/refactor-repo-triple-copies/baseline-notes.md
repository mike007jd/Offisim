# Baseline notes — refactor-repo-triple-copies

**Captured at commit**: `db99c97` (proposal commit)
**Date**: 2026-04-17

## Line counts (pre-refactor)

| File | Total lines | NBNC |
|---|---:|---:|
| `packages/core/src/runtime/drizzle-repositories.ts` | 1731 | 1638 |
| `packages/core/src/runtime/memory-repositories.ts` | 1508 | 1351 |
| `apps/web/src/lib/tauri-repos.ts` | 1666 | 1577 |
| **Total** | **4905** | **4566** |

NBNC counted via:
```
awk '{ if ($0 !~ /^[[:space:]]*$/ && $0 !~ /^[[:space:]]*\/\// && $0 !~ /^[[:space:]]*\*/) c++ } END { print c }'
```

## Contract file SHA1 (must be unchanged post-refactor)

```
be1465975eaf4bd9a6427bed700b086d4b7f10fb  packages/core/src/runtime/repositories.ts
```

## Factory return keys (equivalence bar)

### `createDrizzleRepositories(db)` — 36 keys

```
activeInteractions, agentEvents, assetBindings, checkpoints, compactSummaries,
companies, costRates, employees, employeeVersions, events, fileHistory,
handoffs, installedAssets, installedPackages, installTransactions,
interactionHistory, libraryDocuments, llmCalls, mcpAudit, meetings, memories,
nodeSummaries, officeLayouts, prefabInstances, projectAssignments, projects,
racks, recoveryKnowledge, slots, sopTemplates, taskRuns, threads, toolCalls,
transact, workstationRacks, zones
```

### `createMemoryRepositories(snapshot?)` — 35 keys + `seed` + `snapshot()` method

Return type: `RuntimeRepositories & { seed: MemoryRepositorySeed; snapshot(): MemoryRepositoriesSnapshot }`.

Repo keys (33 base + `userPreferences` memory-only = 34, note that `install*` 4 come via `...installRepos` spread):
```
activeInteractions, agentEvents, assetBindings, checkpoints, compactSummaries,
companies, costRates, employees, employeeVersions, events, fileHistory,
handoffs, installedAssets, installedPackages, installTransactions,
interactionHistory, libraryDocuments, llmCalls, mcpAudit, meetings, memories,
nodeSummaries, officeLayouts, prefabInstances, projectAssignments, projects,
racks, recoveryKnowledge, slots, sopTemplates, taskRuns, threads, toolCalls,
userPreferences, workstationRacks, zones
```

Plus the two non-repo entries the factory adds:
- `seed: MemoryRepositorySeed` — `{ employees(rows), companies(rows) }` mutation helpers for tests
- `snapshot(): MemoryRepositoriesSnapshot` — clone everything to plain rows

### `createTauriRepositories(db)` — 34 keys (no `transact`, no `userPreferences`)

```
activeInteractions, agentEvents, assetBindings, checkpoints, compactSummaries,
companies, costRates, employees, employeeVersions, events, fileHistory,
handoffs, installedAssets, installedPackages, installTransactions,
interactionHistory, libraryDocuments, llmCalls, mcpAudit, meetings, memories,
nodeSummaries, officeLayouts, prefabInstances, projectAssignments, projects,
racks, recoveryKnowledge, slots, sopTemplates, taskRuns, threads, toolCalls,
workstationRacks, zones
```

## Backend asymmetry (must be preserved)

| Field | Drizzle | Memory | Tauri |
|---|:---:|:---:|:---:|
| `transact?` | ✓ (callable) | absent | absent |
| `userPreferences?` | absent | ✓ | absent |
| `seed` | N/A | ✓ | N/A |
| `snapshot()` | N/A | ✓ | N/A |

## 19 Memory* class exports (pre-refactor location)

All from `packages/core/src/runtime/memory-repositories.ts` — must continue to export from barrel:

- `MemoryActiveInteractionRepository` (line 573)
- `MemoryInteractionHistoryRepository` (line 602)
- `MemoryEmployeeVersionRepository` (line 631)
- `MemoryModelCostRateRepository` (line 676)
- `MemorySopTemplateRepository` (line 729)
- `MemoryRackRepository` (line 779)
- `MemorySlotRepository` (line 817)
- `MemoryWorkstationRackRepository` (line 852)
- `MemoryLibraryDocumentRepository` (line 883)
- `MemoryOfficeLayoutRepository` (line 938)
- `MemoryZoneRepository` (line 995)
- `MemoryMcpAuditRepository` (line 1054)
- `MemoryNodeSummaryRepository` (line 1092)
- `MemoryCompactSummaryRepository` (line 1142)
- `MemoryFileHistoryRepository` (line 1175)
- `MemoryProjectRepository` (line 1214)
- `MemoryProjectAssignmentRepository` (line 1280)
- `MemoryAgentEventRepository` (line 1331)
- `MemoryRecoveryKnowledgeRepository` (line 1417)

**Note**: `MemoryUserPreferenceRepository` (memory-only) is implemented in `packages/core/src/repositories/memory-memory-repository.ts` and re-exported. Its 19 public Memory* classes list EXCLUDES this one since it's not inline in `memory-repositories.ts`.

## External consumer imports (must remain unchanged)

```
packages/core/src/drizzle.ts:3
  export { createDrizzleRepositories } from './runtime/drizzle-repositories.js';

packages/core/src/index.ts:156-157
  } from './runtime/memory-repositories.js';
  export type { MemoryRepositoriesSnapshot } from './runtime/memory-repositories.js';

packages/core/src/browser.ts:227-228
  } from './runtime/memory-repositories.js';
  export type { MemoryRepositoriesSnapshot } from './runtime/memory-repositories.js';

apps/web/src/lib/tauri-runtime-lite.ts:12
  import { createTauriRepositories } from './tauri-repos';

apps/web/src/lib/tauri-runtime.ts:52
  import { createTauriRepositories } from './tauri-repos';
```

Post-refactor: git diff on these files vs baseline SHA must be **empty**.

## Post-refactor targets

- Barrel NBNC ≤200 each (3 files)
- Family file NBNC ≤250 each (~33 files: 11 families × 3 backends)
- `repositories.ts` byte-identical (diff empty)
- Factory return key lists `sort -u` equal to pre-refactor
- 19 class symbols still resolve from `@offisim/core`
- `MemoryRepositoriesSnapshot` / `MemoryRepositorySeed` types still exported
