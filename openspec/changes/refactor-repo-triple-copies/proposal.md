## Why

三副本 repo 文件（`drizzle-repositories.ts` 1731 行 / `memory-repositories.ts` 1508 行 / `tauri-repos.ts` 1666 行，共 4566 NBNC）是当前仓库最大的"god file 三兄弟"。每个都实现完全相同的 `RuntimeRepositories` 契约（33+ repo interface、~35 个 repo object、transact 可选），但落在三个不同后端（better-sqlite3 drizzle / in-memory Map / Tauri SQL plugin）。

`packages/core/CLAUDE.md` 已明确记录："任何 repo 接口变更必须三处同步"，自动 parity test 在 2026-04-14 validation policy 切换后已删。代价是：

- 加一个 interface 字段需要人工在三个 1500+ 行文件之间逐个 scroll 对齐，漏一处就是 runtime 发现的静默缺失
- 每个文件都超过 IDE 舒适阅读的 god-file 门槛；Cmd-F 一次只能看一个后端的这个 repo
- 新人 onboarding 需要同时打开三个 tab 才能理解"这个 repo 对这个 company 做什么"

D1/D2/D3 已经用"boundary-first, zero behavior change"节奏解了三个 god-file（`useSceneOrchestrator` 1199→83、`App.tsx` 794→311 NBNC、`employee-node.ts` 980→137 NBNC）。D4 是 queue 最后一条，走同样节奏把 4566 NBNC 的屎山山头收掉。

## What Changes

**策略 B：纯结构化重组，按 repo 家族拆目录，零行为变更。**

- **NEW**: `packages/core/src/runtime/repos/` 目录树，按 repo 家族分 ~8-10 个子目录，每个子目录下含 `drizzle.ts` / `memory.ts` / `tauri.ts` 三个薄文件（后者位于 `apps/web/src/lib/` 保留一份 re-export 为兼容 path，实际实现迁移到 core）
- **NEW**: 每个子目录可选 `shared.ts` 只放纯 helper（例如 `normalizeMemoryDedupeKey`、`now`、JSON wrap/unwrap）；行为保持 byte-identical
- **KEEP**: `packages/core/src/runtime/drizzle-repositories.ts` / `memory-repositories.ts` 与 `apps/web/src/lib/tauri-repos.ts` 文件路径不消失，转为 re-export barrel（保留所有现有 import 路径零修改）
- **KEEP**: `packages/core/src/runtime/repositories.ts` 契约文件（33+ interface、`RuntimeRepositories`、所有 Row/New/Update 类型）byte-identical 不动
- **KEEP**: `createDrizzleRepositories(db)` / `createMemoryRepositories(seed?)` / `createTauriRepositories(db)` 三个工厂签名与返回 shape byte-identical
- **KEEP**: memory-repositories 的 19 个 exported `Memory*Repository` class 与 `MemoryRepositoriesSnapshot` / `MemoryRepositorySeed` 类型从新位置继续 re-export，现有消费者零修改
- **NOT CHANGED**: 任何 SQL 语句、Map 操作、JSON 序列化策略、transact 行为、dedupe 规则
- **NOT CHANGED**: `userPreferences` 只 memory 有、`transact` 只 drizzle 有这两条既有 runtime 真相
- **FILE SIZE GATE**: barrel 文件 ≤200 NBNC；每个家族子文件 ≤250 NBNC；contract 文件 `repositories.ts` 不在 gate 内（纯 interface 聚合，仅随契约增长）

## Capabilities

### New Capabilities

- `repository-backend-boundaries`: 定义 `RuntimeRepositories` 三后端实现的模块边界、每个后端的 export 契约、三后端对同一 repo interface 的行为等价性与差异性约束（transact / userPreferences）、barrel 文件在保留 import path 兼容下的职责

### Modified Capabilities

（无 — 本 change 只重组文件，不改任何已 canonical 的 capability 行为）

## Impact

- **Affected code**:
  - `packages/core/src/runtime/drizzle-repositories.ts`（god-file 拆成 barrel）
  - `packages/core/src/runtime/memory-repositories.ts`（god-file 拆成 barrel，19 class 从新位置 re-export）
  - `apps/web/src/lib/tauri-repos.ts`（god-file 拆成 barrel，实际实现 sub-path 迁移到 core 侧保证三后端同目录树）
  - `packages/core/src/runtime/repos/**`（新增目录树）
- **Not affected**:
  - `packages/core/src/runtime/repositories.ts`（契约文件，byte-identical）
  - `packages/core/src/browser.ts` / `packages/core/src/index.ts` / `packages/core/src/drizzle.ts` 三个 public entry point（保留现有 re-export）
  - `apps/web/src/lib/tauri-runtime.ts` / `tauri-runtime-lite.ts`（import `createTauriRepositories` from `./tauri-repos` 路径不变）
  - 所有 repo 消费者（services / graph nodes / UI hooks）
- **Risk**:
  - 低（零行为变更，纯移动与 re-export）
  - 唯一风险面：tauri-repos.ts 迁移跨 package（apps/web → packages/core），若被 `@offisim/core/browser` 非公开路径引用需验证
- **Verification**:
  - `pnpm typecheck`（16 packages）全绿
  - `pnpm build` 顺序构建无产物差异
  - Live verification: 真实浏览器启动 + 真实 Tauri 桌面启动 + 至少一次 boss→manager→employee→boss_summary 完整跑通（证实三后端 runtime 契约一致）
  - 静态检查：`grep -r "from.*runtime/repos"` 所有 importer 路径符合分层策略
