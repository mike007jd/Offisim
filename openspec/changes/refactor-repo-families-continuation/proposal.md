## Why

Archived change `refactor-repo-triple-copies`（apply `216eb82` / archive `aeb2ef6`）只完成了 Phase A (scaffold) + Phase B (orchestration family)；剩余 10 个家族 + barrel ≤200 NBNC 终态 + 三后端 live verification 作为"orchestration 先行"策略显式 defer。当前 barrel 仍在 1144–1481 行 NBNC 区间（目标 ≤200），"edit 三后端同步"体验只在 orchestration 一个家族生效，其余 30 repo 仍住在 god-file 内。本 change 承接收尾，让 D4 refactor 真正落到产品形态。

## What Changes

**策略延续 B：纯结构化重组，零行为变更。按 D1 决策的家族划分把剩余 10 家族迁到 `runtime/repos/<family>/` + `apps/web/src/lib/tauri-repos/<family>.ts`；barrel 收到 ≤200 NBNC；三后端 live verify 收官。**

- **MIGRATE**: 10 家族逐阶段迁出（每家族独立 phase + commit）
  - Phase C `employees/`: `employees`, `employeeVersions`
  - Phase D `conversations/`: `toolCalls`, `handoffs`, `meetings`, `activeInteractions`, `interactionHistory`
  - Phase E `llm/`: `llmCalls`, `costRates`
  - Phase F `install/`: `installTransactions`, `installedPackages`, `installedAssets`, `assetBindings`
  - Phase G `permissions/`: `racks`, `slots`, `workstationRacks`, `mcpAudit`
  - Phase H `memory-system/`: `memories`, `userPreferences`, `nodeSummaries`, `compactSummaries`
  - Phase I `files/`: `fileHistory`, `libraryDocuments`
  - Phase J `workspace/`: `sopTemplates`, `officeLayouts`, `prefabInstances`, `zones`
  - Phase K `projects/`: `projects`, `projectAssignments`
  - Phase L `agent-events/`: `agentEvents`, `recoveryKnowledge`
- **D8 continuation**: memory barrel 剩余 5 个 inline repo（`employees` / `toolCalls` / `handoffs` / `meetings` / `llmCalls`）升级为 class，对齐已有 24 class 模式（19 pre-existing + 5 orchestration），完工后 memory 后端总计 29 class，零 inline
- **Phase M barrel finalization**: 三 barrel（`runtime/drizzle-repositories.ts` / `runtime/memory-repositories.ts` / `apps/web/src/lib/tauri-repos.ts`）收到 ≤200 NBNC，纯 import + spread assembly + `transact` helper (drizzle) / `snapshot()` aggregation helper (memory)
- **Phase N live verification**: Drizzle smoke (platform API) + Memory smoke (web SPA) + Tauri smoke (desktop) 三个 runtime 各触发一次实际 repo 写入；把 `Object.keys(factory)` 与 baseline 对比 sorted-equal；写 `live-verification-report.md` 留存
- **KEEP**: 契约文件 `packages/core/src/runtime/repositories.ts` byte-identical
- **KEEP**: 三 public factory 签名 byte-identical（`createDrizzleRepositories` / `createMemoryRepositories` / `createTauriRepositories`）
- **KEEP**: 19 pre-existing + 5 orchestration Memory class symbol 的 `{index,browser}.ts` named re-export 路径不动，新增 5 个 memory class（employees/toolCalls/handoffs/meetings/llmCalls）加入 memory barrel re-export 清单
- **KEEP**: runtime asymmetry 不变（`transact` only drizzle / `userPreferences` only memory / `snapshot` + `seed` only memory）
- **NOT CHANGED**: 任何 SQL 语句、Map 操作、JSON 序列化策略、dedupe 逻辑、`now()` 时间戳
- **FILE SIZE GATE**: 家族文件 ≤320 NBNC（沿用 archived D5 现实值）；barrel ≤200 NBNC（本 change 必须达成）；contract 文件 `repositories.ts` 不入 gate

## Capabilities

### New Capabilities

（无 — 本 change 扩展现有 `repository-backend-boundaries` canonical spec，不引入新 capability）

### Modified Capabilities

- `repository-backend-boundaries`: 把"仅 orchestration 家族落地"的现有要求扩展为"全 11 家族落地 + barrel ≤200 NBNC + 三后端 live verified"。需要 delta spec 文件标注 `MODIFIED` / `ADDED` requirement

## Impact

- **Affected code**:
  - `packages/core/src/runtime/drizzle-repositories.ts`（god barrel 收到 ≤200 NBNC）
  - `packages/core/src/runtime/memory-repositories.ts`（god barrel 收到 ≤200 NBNC + 新增 5 class 搬迁 + re-export）
  - `apps/web/src/lib/tauri-repos.ts`（god barrel 收到 ≤200 NBNC）
  - `packages/core/src/runtime/repos/{employees,conversations,llm,install,permissions,memory-system,files,workspace,projects,agent-events}/{drizzle,memory}.ts`（20 个新文件）
  - `apps/web/src/lib/tauri-repos/{employees,conversations,llm,install,permissions,memory-system,files,workspace,projects,agent-events}.ts`（10 个新文件）
- **Not affected**:
  - `packages/core/src/runtime/repositories.ts`（契约文件，byte-identical）
  - `packages/core/src/{index,browser,drizzle}.ts` 三个 public entry point（re-export 列表有 5 个新增 class 但 path 不变）
  - `apps/web/src/lib/tauri-runtime{,-lite}.ts`（import `./tauri-repos` 路径不变）
  - 所有 repo 消费者（services / graph nodes / UI hooks）
  - orchestration 家族已迁出文件（byte-identical 保留）
- **Risk**:
  - 低（零行为变更，纯移动与 re-export，已有 orchestration 模板可抄）
  - 主要风险面：install/ 家族需处理 `packages/core/src/repos/install-transaction-repository.ts` 等既有 class 的 re-use（不重复实现），memory-system/ 家族需保留 `MemoryUserPreferenceRepository` memory-only 语义且保留 `normalizeMemoryDedupeKey` helper 在原 locality
  - Phase H `normalizeMemoryDedupeKey` 的就地复制 vs 抽 helper 二选一，沿用 D6 "不做 DRY" 策略（就地复制）
- **Verification**:
  - `pnpm typecheck`（16 packages）每 phase commit 前必须绿
  - Phase M NBNC 静态 gate：三 barrel ≤200 + 所有家族文件 ≤320
  - Phase N live verification：三 runtime 各跑一次真实 repo 写入 + `Object.keys` sorted-equal 对比 baseline
  - 静态断言：`git diff <pre-refactor-sha> HEAD -- packages/core/src/runtime/repositories.ts` 空 diff
