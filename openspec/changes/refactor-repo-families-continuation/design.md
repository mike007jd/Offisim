## Context

**Archive handoff state (commit `aeb2ef6`)**:

- `packages/core/src/runtime/repos/` scaffolded with 11 家族子目录 + `memory-types.ts`。目前只 `orchestration/{drizzle,memory}.ts` 有实现（其余 10 个目录空）
- `apps/web/src/lib/tauri-repos/` scaffolded；目前只 `orchestration.ts` 有实现
- Orchestration family 已落地（5 repo：`companies` / `threads` / `taskRuns` / `checkpoints` / `events`），memory 侧 5 class 已 re-export，drizzle 侧 spread assembly 已在 barrel 使用
- Barrel NBNC 现状：`drizzle-repositories.ts` 1402、`memory-repositories.ts` 1144、`tauri-repos.ts` 1353（三个都远超 ≤200 gate）
- Memory barrel 仍持有 5 个 inline repo：`employees` / `toolCalls` / `handoffs` / `meetings` / `llmCalls`（D8 未完成部分）
- Memory class 现状：5 orchestration (Phase B 完成) + 19 pre-existing = 24 class；终态需再加 5 class = 29

**Canonical spec baseline**：`openspec/specs/repository-backend-boundaries/spec.md`（Phase B 归档时写就）已定义好共 8 个 requirement，orchestration scenarios 已落。本 change 需要扩展 2 个 requirement（家族范围、memory class 清单）并新增 ~3 个 requirement（所有 11 家族落地、barrel ≤200、live verify）。

**Remaining public-export invariants**（must hold end of Phase M）：

- `createDrizzleRepositories(db)` 返回 36 entries（35 repo + `transact`）
- `createMemoryRepositories(seed?)` 返回 37 entries（35 repo + `userPreferences` + `snapshot` + `seed`）
- `createTauriRepositories(db)` 返回 34 entries（35 repo 减 `userPreferences`，无 `transact`）
- `packages/core/src/{index,browser}.ts` 的 named re-export 列表 29 个 Memory class（pre-existing 19 + orchestration 5 + 本 change 新增 5）
- `MemoryRepositoriesSnapshot` / `MemoryRepositorySeed` 类型仍从 `runtime/repos/memory-types.ts` 发出

## Goals / Non-Goals

**Goals:**

1. 完成 Phase C–L：10 个家族从 barrel 迁到独立家族文件，drizzle + memory + tauri 三后端同步
2. 完成 D8 收尾：memory 剩余 5 个 inline repo 转 class（total 29 class）
3. Phase M：三 barrel ≤200 NBNC 达标，纯 import + spread + transact/snapshot helper
4. Phase N：三 runtime（Drizzle / Memory / Tauri）live 验证成功
5. Canonical spec `repository-backend-boundaries` 扩展到覆盖全 11 家族
6. 保持 D1/D2/D3/D4 refactor 风格：boundary-first、zero behavior change、每 phase 独立 commit

**Non-Goals:**

1. DRY 压缩（`now()` / `normalizeMemoryDedupeKey()` 不抽 shared helper —— 沿用 archived D6）
2. 触发策略 C（把 `tauri-repos` 迁入 core）—— 沿用 archived D2
3. 补自动化 parity test —— 仓库已移除自动测试策略（CLAUDE.md Validation Policy）
4. 修改契约文件 `repositories.ts`
5. 调整 `transact` / `userPreferences` 后端不对等 —— 属于契约范畴
6. 删除或合并 29 个 `Memory*Repository` class

## Decisions

### D9. 家族迁移顺序：先简单后复杂

**选择**：按依赖量 + repo 数量升序迁，让每 phase 风险面可控：

1. Phase C `employees/` (2 repo，已有 `MemoryEmployeeVersionRepository` 模板)
2. Phase D `conversations/` (5 repo，已有 2 class + 3 inline)
3. Phase E `llm/` (2 repo，已有 `MemoryModelCostRateRepository` 模板)
4. Phase F `install/` (4 repo，依赖 `packages/core/src/repos/` 既有 class — 见 D10)
5. Phase G `permissions/` (4 repo，全 class，模式机械)
6. Phase H `memory-system/` (4 repo，含 memory-only `userPreferences` + `normalizeMemoryDedupeKey` helper — 见 D11)
7. Phase I `files/` (2 repo)
8. Phase J `workspace/` (4 repo，含 `prefabInstances` inline → class)
9. Phase K `projects/` (2 repo)
10. Phase L `agent-events/` (2 repo)

**Rationale**：

- 先把"只 existing class 搬位置"的家族（Phases C/E/G/I/K/L）跑完，证明搬位置节奏；再啃"含 inline→class 转换"的 Phases D/F/H/J
- archived change §4-§17 已铺好每 phase 的任务模板，继续用这个模板不用重新设计
- Phase 之间独立 commit，任何单 phase 回滚不影响其他

**Alternative considered**:

- 按 repo 数量倒序（先做 conversations 5 repo 探模式）：被拒，orchestration 已是模式探针，再做一个大家族没增量信息
- 一个 big-bang commit（全部 10 家族一起）：违反 archived D7 phased apply 决策，review 成本爆炸，单点回滚不可行

### D10. Install 家族的既有 class 复用策略

**背景**：`packages/core/src/repos/install-transaction-repository.ts` 等 4 个文件已存在独立的 `Memory*Repository` 和 `Drizzle*Repository` class（这些是 install-core 生态早于本 refactor 的产物）。当前 `drizzle-repositories.ts` 和 `memory-repositories.ts` 通过 `new MemoryInstallTransactionRepository()` 等实例化它们。

**选择**：Phase F 的家族文件**只做 re-export + factory**，不重复实现 install 家族任何 repo。

```ts
// packages/core/src/runtime/repos/install/memory.ts
import { MemoryInstallTransactionRepository } from '../../../repos/install-transaction-repository.js';
// ... 其他 3 个
export function createInstallMemoryRepos(snapshot?): InstallMemoryRepos {
  const installTransactions = new MemoryInstallTransactionRepository();
  if (snapshot) installTransactions.seed(snapshot.installTransactions);
  // ... 3 个同样
  return { installTransactions, installedPackages, installedAssets, assetBindings };
}
```

```ts
// packages/core/src/runtime/repos/install/drizzle.ts
import { DrizzleInstallTransactionRepository } from '../../../repos/install-transaction-repository.js';
// ... 3 个
export function createInstallDrizzleRepos(db: Db): InstallDrizzleRepos {
  return {
    installTransactions: new DrizzleInstallTransactionRepository(db),
    // ... 3 个
  };
}
```

**Rationale**：

- install-core 的 class-based 模式是早于本 refactor 的稳定资产
- 复制一份等同于双重维护；re-export 则是纯结构归位
- 既保留原 class 文件作为 single source of truth，也让 install/ 家族在 family tree 里 "looks the same" as 其他家族

**Trade-off**：

- install/ 家族的 `<family>/{drizzle,memory}.ts` 比其他家族薄很多（纯 re-export + factory）；尺寸 ≤100 NBNC，低于 320 gate 无压力
- 未来若 install 家族再加 repo，加法路径仍清晰（要么在 `packages/core/src/repos/` 加 class 文件，要么 inline 后升级）

### D11. `normalizeMemoryDedupeKey` helper 位置（Phase H）

**选择**：helper 就地复制到 `memory-system/memory.ts` + `memory-system/drizzle.ts`（仅 drizzle 版本）+ `apps/web/src/lib/tauri-repos/memory-system.ts`，不抽 shared module。

**Rationale**：

- 沿用 archived D6 "本 change 不做 DRY" 原则
- helper 只被 `memories` repo 使用，locality 天然在 memory-system 家族内部
- 三份各 5-7 行，总成本可控
- 若未来策略 A 抽 DRY，这是 scope-narrow 独立 change（与本 change 正交）

**Alternative considered**:

- 抽到 `runtime/repos/_helpers.ts`：违反"零行为变更"紧约束（module 间接导入算行为边缘）
- 抽到 `memory-system/shared.ts`：把一个 family 内部私有 helper 升级为跨文件模块，3 份小文件搞复杂度不划算

### D12. Phase M barrel 形态（终态样板）

**三 barrel 最终形状**（全部 ≤200 NBNC）：

```ts
// drizzle-repositories.ts (target ≤200 NBNC)
import type { RuntimeRepositories } from './repositories.js';
import type { Db } from '../drizzle-schema.js';
import { createOrchestrationDrizzleRepos } from './repos/orchestration/drizzle.js';
import { createEmployeesDrizzleRepos } from './repos/employees/drizzle.js';
// ... 9 more
export function createDrizzleRepositories(db: Db): RuntimeRepositories {
  return {
    ...createOrchestrationDrizzleRepos(db),
    ...createEmployeesDrizzleRepos(db),
    // ... 9 more
    transact: <T>(fn: () => T): T => db.transaction(fn as any)() as T,
  };
}
```

```ts
// memory-repositories.ts (target ≤200 NBNC)
import type { RuntimeRepositories } from './repositories.js';
import type { MemoryRepositoriesSnapshot, MemoryRepositorySeed } from './repos/memory-types.js';
export type { MemoryRepositoriesSnapshot, MemoryRepositorySeed } from './repos/memory-types.js';
export { MemoryCompanyRepository, ... } from './repos/orchestration/memory.js';
export { MemoryEmployeeRepository, MemoryEmployeeVersionRepository } from './repos/employees/memory.js';
// ... 9 more family re-exports, 29 class total
import { createOrchestrationMemoryRepos } from './repos/orchestration/memory.js';
// ... 9 more factory imports
export function createMemoryRepositories(seed?): ... {
  const orch = createOrchestrationMemoryRepos(seed);
  const emp = createEmployeesMemoryRepos(seed);
  // ... 9 more
  return {
    ...orch, ...emp, /* ... */,
    userPreferences: memSystem.userPreferences,  // memory-only attach
    seed: { /* aggregate seed spec */ },
    snapshot: () => ({
      ...orch.snapshot(),
      ...emp.snapshot(),
      // ... 11 family snapshots merged
    }),
  };
}
```

```ts
// apps/web/src/lib/tauri-repos.ts (target ≤200 NBNC)
import type { RuntimeRepositories } from '@offisim/core';
import type { TauriDrizzleDb } from './tauri-drizzle.js';
import { createOrchestrationTauriRepos } from './tauri-repos/orchestration.js';
// ... 10 more
export function createTauriRepositories(db: TauriDrizzleDb): RuntimeRepositories {
  return {
    ...createOrchestrationTauriRepos(db),
    // ... 10 more
  };
}
```

**Gate check**：`awk 'NF && !/^[[:space:]]*\/\// && !/^[[:space:]]*\*/ { c++ } END { print c }' <file>` 每 barrel 输出 ≤200。

**Risk**：memory barrel 的 29 class re-export 行 + 11 family factory import + snapshot aggregation 可能压 200 边界。Mitigation：每个 family snapshot 用 spread 合并（`...fam.snapshot()`）而非逐字段列，class re-export 允许 one-line 多 symbol。预估 180–195 NBNC 可控。若超 200，D13 决策点：放宽到 ≤230 并在 spec 里明确，而非塞 shared helper 拖复杂度。

### D13. Live verification 最小触发动作

**选择**：三 runtime 各跑一次覆盖多家族的真实写入，写 `live-verification-report.md` 留证。

- **Drizzle smoke (platform API)**: 启 `apps/platform` → POST 一个 company create 请求（如果 platform 有该 endpoint；否则观察 boot log 里的 `RuntimeRepositories.Object.keys` 断言 + 跑一次 memory fallback cold-boot）
- **Memory smoke (web SPA)**: 启 web dev (port 5176) → 浏览器真实开一个 company → 发一个 chat task → 观察 `boss → manager → employee → boss_summary` 全流程跑完 → 确认控制台无 "repo method not implemented" / "undefined is not a function"
- **Tauri smoke (desktop)**: 启 `pnpm --filter @offisim/desktop dev` → 真实桌面 app 打开 → 开一个 company → 至少触发一次 SQL 写入（例如发一个消息）→ 观察无 Tauri SQL plugin 报错

**Verification captured**：每 runtime 在 DevTools / console 截一个 `Object.keys(repos).sort().join(',')` 输出贴到 report；与 baseline sorted key list 对比。

**Rationale**：

- 覆盖 orchestration (companies/threads/taskRuns)、employees (create employee)、conversations (boss message) 三大家族，对其他 8 家族做"编译 + 读 key 列" proxy（repo 启动时 sorted keys 必须 match baseline，说明 family factory spread 正确）
- 不追求 33 repo 每个都手点一遍 —— 跨 family 的"hello world workflow" 已能证伪绝大多数 regression

**Non-Goal**：不做自动化 smoke test 产物；只写人类可读 live-verification-report.md（参考 D3 `employee-node` 归档体例）

### D14. Phase 之间的 typecheck 约束

沿用 archived 决策：每 phase commit 前必须 `pnpm typecheck` 全 16 package 绿（如果本地 turbo cache 污染，先 `pnpm clean && pnpm build` baseline 再 typecheck）。

**关键点**：每 phase 删 barrel 中旧 inline 块 + splice spread 必须同 commit 完成；不允许"先加新文件下 commit，再删旧块下 commit"—— 中间态 barrel 会引用旧 closure + 新 spread 双源，是 runtime 悄悄破坏点。

## Risks / Trade-offs

**[R8] Memory barrel re-export + snapshot aggregation 越过 200 NBNC**
- 推断 180–195 NBNC 可达，但 snapshot aggregation 若需要处理 `MemoryInstallRepositoriesSnapshot` extension 关系（install-core 的独立 snapshot shape）可能突变
- Mitigation：Phase H 完成后就跑一次 barrel NBNC 预览；若势头不可控，提前触发 D13（放宽到 ≤230）而非 Phase M 发现翻车

**[R9] Install 家族 snapshot 与 MemoryInstallRepositoriesSnapshot extension 关系**
- `memory-types.ts:109` 附近定义的 `MemoryRepositoriesSnapshot` 已 extend install-core 的 snapshot shape；Phase F 迁 install family 时需确认这个 extend 仍通过（类型文件不变，但 install 家族 factory 的 snapshot return shape 必须和 extend 约定一致）
- Mitigation：Phase F 典型 failure 模式是 typecheck 报 "property X missing"；回 Phase F commit 即解

**[R10] Live verification 在 Tauri runtime 代价高**
- 需真实 macOS 桌面 boot + vault 真实落盘（不能抢前台但要看到 log）
- Mitigation：如果当前 session 无法跑 Tauri smoke（macOS 环境不允许），允许 Phase N 分两次：platform + web 先跑，Tauri smoke 在下一 session 补；archive 在两个都通过之后

**[R11] Phase C-L 10 次 commit 累积 git history 噪声**
- 优势：按 phase 回滚粒度可控，git blame 清晰
- 劣势：main 线出现 10+ `refactor(core): Phase X` commit
- Mitigation：commit message 统一前缀 `refactor(core): repo-families Phase <letter> — <family>`，可搜可合并视图

**[R12] 契约文件 `repositories.ts` 被动改动**
- 如果 Phase 迁移过程发现需要 export 新类型（如 `<Family><Backend>Repos` interface），一定只加在家族文件内部，不污染契约文件
- Mitigation：Phase 结束用 `git diff <baseline-sha> HEAD -- packages/core/src/runtime/repositories.ts` 断空

**[R13] orchestration 的 5 class 已 re-export from `./repos/orchestration/memory.js`；如果 Phase M barrel 大改可能遗漏 symbol**
- Mitigation：Phase M 前跑一次 `grep -r "from '.*repos/.*/memory" packages/core/src/runtime/memory-repositories.ts` 列出所有 class source，和 29 名单对照

## Migration Plan

**不需要 data migration**（纯文件重组）。

**Rollout**：单分支 `main` 线性推进，Phase C → D → E → F → G → H → I → J → K → L → M → N，每 phase 独立 commit。

**Rollback strategy**：`git revert <phase SHA>`，phase 之间完全独立。如需整体回滚到本 change 前：`git revert <apply-commit>..HEAD`。

**Verification gates**：

- 每 phase commit 前：`pnpm typecheck` 全绿
- Phase M commit 前：NBNC gate（三 barrel ≤200、家族文件 ≤320）
- Phase N commit 前：三 runtime live smoke + `Object.keys` sorted-equal vs baseline
- Canonical spec sync：archive 后立即把 delta spec merge 到 `openspec/specs/repository-backend-boundaries/spec.md`

## Open Questions

1. **D13 升级（未来 change）**: 若 Phase M barrel 实测无法 ≤200 且放宽到 230 仍不够，说明 class re-export 数量本身是边界压力源。届时可考虑把 memory 29 class 的 re-export 抽到 `memory-class-exports.ts` 汇总文件，barrel 只 `export * from ...`。不在本 change scope。

2. **策略 C 演进**：完成本 change 后，`tauri-repos/` 与 `runtime/repos/<family>/tauri.ts` 的不对称依然存在（`TauriDrizzleDb` 类型锁 apps/web）。若 `DbClient` 抽象化真有价值，可作为后续独立 change 的 hook；本 change 保留当前并列结构。

3. **`userPreferences` 是否应升格**：runtime 现状仍 memory-only。本 change 不改这条语义；若未来 drizzle/tauri 要支持跨 session 持久化 user preference，另起 change（契约文件 `?:` optional 已经支持）。

4. **自动化 parity gate 的未来**：CLAUDE.md validation policy 已否定自动化 smoke；本 change 完结后，"三后端同步"只靠 family directory 视觉对称 + typecheck + live verify 三重人肉 gate。如果 drift 反复出现，可考虑 lint-level 约束（如 eslint rule 检查 family 文件 export key set 对齐），但不在本 change scope。
