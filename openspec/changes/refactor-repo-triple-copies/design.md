## Context

**Current state (as of commit `fcebe2c`)**:

- `packages/core/src/runtime/drizzle-repositories.ts` — 1731 total lines，35 个内联 `const <repo>: <Repo> = {...}` + `transact`，走 `BetterSQLite3Database<typeof schema>`
- `packages/core/src/runtime/memory-repositories.ts` — 1508 total lines，19 个 exported `Memory*Repository` class + 若干内联 factory + `MemoryRepositoriesSnapshot` / `MemoryRepositorySeed` 类型
- `apps/web/src/lib/tauri-repos.ts` — 1666 total lines，35 个内联 const repos（无 `transact`），走 `TauriDrizzleDb`（drizzle-orm proxy driver for Tauri SQL plugin）
- 共 4566 NBNC（non-blank non-comment）
- `packages/core/src/runtime/repositories.ts` — ~920 行契约文件，33+ repo interface + `RuntimeRepositories` aggregate

**Public exports（必须 byte-identical 保留）**:

| Symbol | 当前位置 | 被谁 import |
|---|---|---|
| `createDrizzleRepositories` | `packages/core/src/drizzle.ts:3` (re-export) → `runtime/drizzle-repositories.ts:119` | platform API + any Node consumer |
| `createMemoryRepositories` | `packages/core/src/{index,browser}.ts` → `runtime/memory-repositories.ts:163` | browser runtime + any memory consumer |
| `MemoryRepositoriesSnapshot` 类型 | `runtime/memory-repositories.ts:109` | `{index,browser}.ts:157/228` re-export |
| 19 个 `Memory*Repository` class | `runtime/memory-repositories.ts` | `{index,browser}.ts:156/227` named re-export |
| `createTauriRepositories` | `apps/web/src/lib/tauri-repos.ts:131` | `apps/web/src/lib/tauri-runtime{,-lite}.ts` |

**Known asymmetry across backends（runtime 真相，不改）**:

- `transact()` 只 drizzle 有（SQLite 事务 wrapper）；memory / tauri 未实现（`RuntimeRepositories.transact?` 可选）
- `userPreferences` 只 memory 有（目前仅 memory 暴露 19 个 class 其一 `MemoryUserPreferenceRepository` + 含 snapshot 支持）；drizzle / tauri `RuntimeRepositories.userPreferences?` 为 undefined
- `MemoryRepositoriesSnapshot` / `MemoryRepositorySeed` / 19 个 `Memory*Repository` class 是 memory 后端独有的 public export（用于 test harness 和浏览器 persistence）；drizzle / tauri 无对应 snapshot/seed

**Constraint**:

- 契约文件 `repositories.ts` 不动（本 change 只重组实现）
- 零行为变更（SQL 语句 / Map 操作 / JSON 处理 / dedupe 逻辑 byte-equivalent）
- 零 import path 破坏（所有外部消费者 `import { X } from 'foo/drizzle-repositories'` 等必须继续工作）
- D5 决策点已明确：file-size gate barrel ≤200 NBNC、家族文件 ≤250 NBNC

## Goals / Non-Goals

**Goals:**

1. 消除 1500-1700 行 god-file 三兄弟；三文件转为薄 barrel（≤200 NBNC）
2. 按 repo 家族（~8-11 个子目录）拆出实现；每个家族含 drizzle/memory/tauri 三个 ≤250 NBNC 薄文件
3. 未来加/改 repo interface 字段：打开同一家族目录下 drizzle.ts 或 memory.ts 或 tauri.ts 即刻对齐，不需要 scroll 1600 行
4. public API byte-identical：`createDrizzleRepositories` / `createMemoryRepositories` / `createTauriRepositories` / `MemoryRepositoriesSnapshot` / `MemoryRepositorySeed` / 19 个 `Memory*Repository` class
5. 对齐 D1/D2/D3 refactor 风格：boundary-first、zero behavior change、byte-identical live verification

**Non-Goals:**

1. DRY 压缩（不抽共享 row mapper、不引 `DbDriver` 抽象、不动 SQL 与 Map 语义）
2. 消除 `transact()` / `userPreferences` 三后端不对等（那是 runtime 真相，属于契约范畴）
3. 把 `tauri-repos` 迁入 `packages/core`（需要 `TauriDrizzleDb` 抽象化或 db-client 注入，属于策略 C/D 范畴；本 change 保持 `apps/web/src/lib/tauri-repos/` 子目录本地化）
4. 重写契约文件 `repositories.ts`
5. 回复自动 parity test（validation policy 已拒，未来靠目录共参或 pre-commit lint 等其它机制）
6. 删除或合并 19 个 `Memory*Repository` class（外部 re-export 依赖）
7. 改 browser / Node 条件导出边界（`@offisim/core` vs `@offisim/core/browser` 不动）

## Decisions

### D1. 按 repo 家族拆目录（~8-11 个家族）而非"一 repo 一目录"

**选择**: 家族分组 `runtime/repos/<family>/{drizzle,memory,tauri}.ts`

**Rationale**:

- 35 repos × 3 backends = 105 文件过碎；IDE 侧栏爆炸
- 家族分组后 ~30-33 文件，每文件 60-250 NBNC，单屏可读
- 家族边界与契约文件 `repositories.ts` 已有的 section comments 一致（`// Memory system` / `// Rack / Slot` / `// Projects` 等已是家族分组的自然证据）
- D2 决策节奏：同家族 repo 往往一起被 edit（加字段、改 JSON schema、调 dedupe 策略）

**Alternatives**:

- "一 repo 一目录"：35 dirs × 3 files = 105，过碎
- "不拆，只抽 helper"（策略 A）：不解决 god-file 主症状
- "collapse into single backend driver"（策略 D）：触发 SQL vs Map 抽象协议设计，超出 B 范畴

**Family grouping（初定，apply 阶段可微调）**:

| Family dir | Repos | 契约 section |
|---|---|---|
| `orchestration/` | companies, threads, taskRuns, checkpoints, events | (无 section, 位于 repositories.ts 头部) |
| `employees/` | employees, employeeVersions | "Employee version history" |
| `conversations/` | toolCalls, handoffs, meetings, activeInteractions, interactionHistory | "Durable interactions" |
| `llm/` | llmCalls, costRates | "Model cost rates" |
| `install/` | installTransactions, installedPackages, installedAssets, assetBindings | (跨 runtime/repos) |
| `permissions/` | racks, slots, workstationRacks, mcpAudit | "Rack / Slot (MCP permissions)" + "MCP Audit" |
| `memory-system/` | memories, userPreferences, nodeSummaries, compactSummaries | "Memory system" + "Node summaries" + "Compact summaries" |
| `files/` | fileHistory, libraryDocuments | "File history" + "Library documents" |
| `workspace/` | sopTemplates, officeLayouts, prefabInstances, zones | "SOP Templates" + "Office layouts" |
| `projects/` | projects, projectAssignments | "Projects" + "Project assignments" |
| `agent-events/` | agentEvents, recoveryKnowledge | "Agent events" + "Recovery knowledge" |

共 **11 个家族**，覆盖 33 个 core repo + `install/` 4 个（合共 37 repo object，因 `installTransactions` / `installedPackages` / `installedAssets` / `assetBindings` 已在 `packages/core/src/repos/` 有独立 interface 文件，可作 install/ 家族 re-export 源）。

### D2. tauri-repos 保留在 `apps/web/`，不迁入 core

**选择**: `apps/web/src/lib/tauri-repos/<family>.ts` 镜像 `packages/core/src/runtime/repos/<family>/tauri.ts` 的家族结构，但路径独立

**Rationale**:

- `TauriDrizzleDb` 类型定义在 `apps/web/src/lib/tauri-drizzle.ts`，依赖 `@tauri-apps/*` runtime（web-only）
- 迁入 core 需要抽象 `DbClient` interface（策略 C/D 范畴）；本 change 明确 Non-Goal #3
- 保留原路径 `apps/web/src/lib/tauri-repos.ts` 作为 barrel，import 路径零破坏

**Trade-off 显式声明**:

- 开发者"edit 三后端同步"时，drizzle + memory 在同家族目录并排（benefit），tauri 在另一 package 平行镜像（cost）
- 在 design `## Open Questions` 记录：后续若推动策略 C，把 tauri 收进 `runtime/repos/<family>/tauri.ts` 是自然演进路径

### D3. Barrel 文件职责

**三个 barrel**（保留原路径）:

- `packages/core/src/runtime/drizzle-repositories.ts` — 导出 `createDrizzleRepositories(db: Db): RuntimeRepositories`，内部 import 各家族 `./repos/<family>/drizzle.js` 的 factory，聚合返回
- `packages/core/src/runtime/memory-repositories.ts` — 导出 `createMemoryRepositories(seed?)` + `MemoryRepositoriesSnapshot` + `MemoryRepositorySeed` 类型 + 19 个 `Memory*Repository` class（全部从新位置 re-export）
- `apps/web/src/lib/tauri-repos.ts` — 导出 `createTauriRepositories(db)`，内部 import 各家族 `./tauri-repos/<family>.js` 的 factory

**File-size gate**:

- barrel ≤200 NBNC（纯 import + 聚合，没有理由超）
- 家族文件 ≤250 NBNC（参考当前最大单 repo：drizzle `memories` 144 行、`recoveryKnowledge` 100 行，家族含 2-5 repo 也不会超 250）

### D4. 家族文件 export 约定

**每个家族文件导出一个 factory**:

```ts
// packages/core/src/runtime/repos/orchestration/drizzle.ts
export interface OrchestrationDrizzleRepos {
  companies: CompanyRepository;
  threads: ThreadRepository;
  taskRuns: TaskRunRepository;
  checkpoints: CheckpointRepository;
  events: EventRepository;
}
export function createOrchestrationDrizzleRepos(db: Db): OrchestrationDrizzleRepos {
  const companies: CompanyRepository = { /* ... */ };
  // ...
  return { companies, threads, taskRuns, checkpoints, events };
}
```

**Barrel 使用**:

```ts
// packages/core/src/runtime/drizzle-repositories.ts
import { createOrchestrationDrizzleRepos } from './repos/orchestration/drizzle.js';
import { createEmployeesDrizzleRepos } from './repos/employees/drizzle.js';
// ...
export function createDrizzleRepositories(db: Db): RuntimeRepositories {
  return {
    ...createOrchestrationDrizzleRepos(db),
    ...createEmployeesDrizzleRepos(db),
    // ...
    transact: <T>(fn: () => T): T => db.transaction(fn as any)() as T,
  };
}
```

**Rationale**:

- spread assembly 让 barrel 是声明式（家族 + transact + done）
- 每个家族 factory 独立可测 / 独立 git blame
- 新增 repo：加到对应家族文件的三 backend 实现 + RuntimeRepositories interface（契约文件本就一行）

### D5. Memory 后端的 19 class 处理

**选择**: 19 个 `Memory*Repository` class 迁入各家族 `memory.ts`，barrel re-export

```ts
// packages/core/src/runtime/repos/conversations/memory.ts
export class MemoryActiveInteractionRepository implements ActiveInteractionRepository { /* ... */ }
export class MemoryInteractionHistoryRepository implements InteractionHistoryRepository { /* ... */ }
export function createConversationsMemoryRepos(seed?): { /* ... */ } { /* 用上面两个 class 实例化 */ }
```

```ts
// packages/core/src/runtime/memory-repositories.ts (barrel)
export {
  MemoryActiveInteractionRepository,
  MemoryInteractionHistoryRepository,
} from './repos/conversations/memory.js';
// ... 所有 19 个
export type { MemoryRepositoriesSnapshot, MemoryRepositorySeed } from './repos/memory-types.js';
```

**Rationale**:

- `packages/core/src/{index,browser}.ts` 已对这 19 个 class 做 named re-export；barrel 作中转层零影响
- snapshot/seed 类型放 `runtime/repos/memory-types.ts`（因为跨家族使用）

### D6. Helper 去留（本 change 不做 DRY）

**选择**: 保留当前三文件各自的 `now()` / `normalizeMemoryDedupeKey()` 局部 helper 不抽

**Rationale**:

- 抽 helper 属于策略 A（DRY），与策略 B（pure structural）正交
- 每个家族 drizzle.ts 内 `function now()` 复制 1 行，成本极低
- 若未来做策略 A，可以后续独立 change 统一抽到 `runtime/repos/shared.ts`

**Alternative considered**:

- 把 `now()` / `normalizeMemoryDedupeKey()` 抽 `runtime/repos/_helpers.ts`：
  - Pro: 消除 6 处小 helper 重复（drizzle 2 + memory 若干 + tauri 2）
  - Con: 算行为改动边缘（helper 是 pure function，但引入 module-level import），与 B"零行为变更"紧约束冲突
  - Decision: 不做，留给后续 change 或 D5 决策

### D7. Phased apply 顺序

按家族从简单到复杂分阶段提交，每个 phase 独立 commit（同 D3 employee-node 节奏）：

1. **Phase A**: 目录树 scaffold + barrel frame（空 barrel 引入，断言三 factory 返回 shape 仍全）— gate point
2. **Phase B**: `orchestration/` 家族迁出
3. **Phase C**: `employees/` 家族迁出
4. **Phase D**: `conversations/` 家族迁出
5. **Phase E**: `llm/` 家族迁出
6. **Phase F**: `install/` 家族迁出
7. **Phase G**: `permissions/` 家族迁出
8. **Phase H**: `memory-system/` 家族迁出（含 `userPreferences` memory-only + snapshot 类型）
9. **Phase I**: `files/` 家族迁出
10. **Phase J**: `workspace/` 家族迁出
11. **Phase K**: `projects/` 家族迁出
12. **Phase L**: `agent-events/` 家族迁出
13. **Phase M**: Barrel 最终化（保留 `transact` on drizzle、确认 19 class re-export 齐全、barrel ≤200 NBNC gate）
14. **Phase N**: Verification + canonical spec sync

每 phase 完成：drizzle/memory/tauri 三文件对应家族代码 **删除**，从新位置 re-export 或直接从 barrel 聚合。每 phase `pnpm typecheck` 绿。最终 barrel 全部 ≤200 NBNC，原文件总 NBNC 从 4566 降到 barrel + 家族合计（预估 barrel ~3×180=540，家族 ~4000，因重构不压缩 logic，总 NBNC 基本守恒，收益在单文件 span）。

## Risks / Trade-offs

**[R1] Memory repos 的 19 class export 破坏消费者** → 在 Phase A scaffold 即验证 `{index,browser}.ts` 的 named re-export 全绿，失败立即回滚单 phase

**[R2] tauri-repos 跨 package 保留会让"三后端同步"开发体验不完美** → 显式 Non-Goal；记 Open Question 作为未来演进路径

**[R3] MemoryInstallRepositoriesSnapshot extend 关系（见 `memory-repositories.ts:109`）让 snapshot 类型跨家族** → Phase A scaffold 把 snapshot/seed 集中到 `runtime/repos/memory-types.ts`，各家族 memory.ts 只 implement class，class 侧暴露 `.snapshot()` 方法

**[R4] Barrel 的 spread assembly 可能因家族名冲突（同名 repo key 双 spread）触发 linter 警告** → 家族划分确保零 key 重叠；Phase M 加 `RuntimeRepositories` 返回处类型断言验证

**[R5] Phase 之间某个家族 drizzle.ts 发现编写错误但 memory.ts/tauri.ts 已同步** → 每 phase commit 前 `pnpm typecheck`；若错过，回 phase commit 即可（phase 边界明确）

**[R6] Live verification 成本**：三后端都要 live 跑一遍才能断言行为不变
- drizzle runtime: platform API (Node/Hono)
- memory runtime: web browser + 任意一个 repo 写入（e.g. 创建员工）
- tauri runtime: 真实桌面 app boot + 任意一个 repo 写入
- Mitigation: verification phase 列出具体最小动作（如 "start a company + send 1 task + 1 tool call" 覆盖至少 6 个 repo），不需要穷举 33 个

**[R7] `repositories.ts` 契约文件膨胀无边界** → 明确"contract 不在 file-size gate"，随契约自然增长；若未来 >1000 NBNC 时再拆 contract 是独立话题

## Migration Plan

**不需要 data migration**（文件重组，无 DB schema / 存储格式变化）。

**Rollout**: 单分支 `main` 线性推进，每 phase 独立 commit。回滚 = `git revert <phase SHA>`，互不依赖。

**Verification gates**:

- 每 phase: `pnpm typecheck` 绿
- Phase M (barrel final): 三 barrel `wc -l` 对比，确认 NBNC ≤200
- Phase N (verification): `pnpm build` 全量成功 + live runtime 三后端各触发一次实际 repo 写入（见 spec scenarios）

**Rollback strategy**: phase 之间完全独立，任何一 phase revert 不影响其他。全部 revert 等同于 `git revert 4dc5fef..HEAD` 区间（apply commit 往后）。

## Open Questions

1. **策略 C 延伸（未来 change，不是本 change）**: 若后续推动抽象 `DbClient` 使 drizzle + tauri 真正共享实现，tauri-repos 可收进 core `runtime/repos/<family>/tauri.ts`。本 change 保留并列结构为这条演进路径铺好入口。

2. **helper extraction 未来 change**: `now()` / `normalizeMemoryDedupeKey()` 抽到 `runtime/repos/_helpers.ts` 属策略 A 延伸，本 change Non-Goal #1 拒掉，但 Phase 完成后可起独立小 change 做。

3. **Memory-only `userPreferences` 是否应晋升 optional-on-all-backends**: runtime 真相目前只 memory 有；若 drizzle/tauri 未来要支持 cross-session user preference 持久化，契约 `RuntimeRepositories.userPreferences` 保持 `?:` optional 不变，各后端按需补。不在本 change scope。

4. **19 个 `Memory*Repository` class 是否可合并成 factory function 返回匿名 class**: 理论可行但会破坏 `{index,browser}.ts` named re-export 契约。保留 19 class 是零破坏约束。
