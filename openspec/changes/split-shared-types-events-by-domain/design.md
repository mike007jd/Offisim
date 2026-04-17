## Context

`packages/shared-types/src/events.ts` 是零依赖 `shared-types` 包里唯一超 400 行的文件。其他 module（`roles.ts` / `interactions.ts` / `install.ts` / `states.ts`）都已按 domain 切好。events.ts 没切是历史原因——最初只有十几种 event，随 product 增长堆到 690 行 + 20+ domain。

Round 2 B 级热点里这条相对"轻"：types-only 文件，拆分对运行时零风险（任何编译 error 都会被 typecheck 抓住）；但拆完带来的持续收益大——每新加一个 event family 只改一个 domain 文件。

## Goals / Non-Goals

**Goals:**

- `events.ts` ≤ 60 NBNC barrel
- 每个 domain 文件 ≤ 120 NBNC，按业务 domain 分
- 消费者零修改（`import type X from '@offisim/shared-types'` 保持可用）
- typecheck / build 全绿

**Non-Goals:**

- 不改任何 type 字段（只迁文件不改 schema）
- 不重命名任何 interface / type
- 不引入新 domain（只按现有字段组织）
- 不做 runtime 层改动
- 不引入测试

## Decisions

### D1. 目录定位：`shared-types/src/events/`

**选择**：`packages/shared-types/src/events/` 子目录，与 `interactions.ts` / `roles.ts` 等 sibling module 同级。

**理由**：events 是 domain 聚合（多个 payload），天然需要子目录；其他 domain（roles / install 等）单文件足够。

### D2. Domain 划分粒度：17 个文件

**选择**：按 event name prefix 分——`task.*` / `graph.*` / `llm.*` / `interaction.*` / `handoff.*` / `memory.*` / `workspace.*` / `execution.*` / `conversation.*` / `deliverable.*` / `plan.*` / `tool.*` 等。核心 envelope 放 `core.ts`。

**理由**：对齐 `refactor-ceremony-event-bindings` 的 8 handler 文件命名——event prefix = domain 边界。方便 payload 作者和 handler 作者一一对应找文件。

**不选**：按"大 domain" 合并成 5-6 个文件——task+plan+tool 合并 etc。会再次出现单文件 200+ 行，拆分意义缩水。

### D3. Barrel `events.ts` 继续是 public API 入口

**选择**：`events.ts` 瘦成

```ts
// events.ts (barrel)
export * from './events/core.js';
export * from './events/employee.js';
export * from './events/task.js';
// ... 17 re-exports
```

**理由**：消费者已经 `import type { X } from '@offisim/shared-types'` 或 `import type { X } from '@offisim/shared-types/events'`。barrel 继续做第二种路径的入口，保持 backward-compat。

### D4. `RuntimeEvent<P>` 和 `EventFamily` union 留在 `core.ts`

**选择**：`events/core.ts` 承载 envelope + `EventFamily` 联合 + 基础 import（`RuntimeEntityType` 等）。其他 payload 文件 import `RuntimeEvent` 自 core。

**理由**：envelope 是所有 event 的基底，单独文件 highlight 其特殊地位。

### D5. 不动 `shared-types/src/index.ts`

**选择**：`index.ts` 保持 `export * from './events.js'`。

**理由**：消费者从 `@offisim/shared-types` 顶级 import 任何 type 仍然工作。本 change 纯结构拆分，不动 public API。

## Risks / Trade-offs

- **风险：循环 import**→ `events/core.ts` 可能被其他 domain 文件 import（`RuntimeEvent<P>` 作为泛型参数的时候不需要 import `RuntimeEvent`，只有 union type 需要），按 domain 拆后 import graph 仍是 DAG（domain → core，domain 之间无依赖）。
- **风险：index.ts 的 re-export 顺序**→ TypeScript 处理 `export *` 冲突时需要 explicit reconcile。拆分前后 events.ts 里 type 名无重复（所有 payload 唯一命名），不会冲突。
- **风险：消费者 bundler 性能下降**→ 17 个小文件 vs 1 个大文件，tree-shaking 反而更好（types 只编译期不打 bundle，运行时零影响）。
- **Trade-off：文件数增加 17 个**→ 接受。types-only 文件 review 成本低，按 domain 找 payload 是 ergonomic 净赚。
