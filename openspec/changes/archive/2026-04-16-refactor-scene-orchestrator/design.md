## Context

`useSceneOrchestrator.ts` 1199 行，职责混杂如下（基于 commit `f472060` 当时 grep 结果）：

| 段落 | 行号范围（约） | 职责 |
|---|---|---|
| `getRestSlotKey` / `getRestPos` | 75-92 | Zone slot 分配辅助 |
| `createIdleCeremonyState` / `IDLE_CEREMONY` | 94-108 | ceremony idle state 初始化 |
| `CeremonyPhase` / `WaitingRelationship` / `CeremonyState` | 110-139 | 类型定义 |
| `describeWorkingToolActivity` 等 4 个 describe 函数 | 141-222 | ceremony bubble 文本构造 |
| `companyHandles` / `getHandleMap` / `getMovementHandles` | 224-238 | 全局 movement handle registry |
| `getMovementHandle` / `registerMovementHandle` / `unregisterMovementHandle` / `getMovementDebugInfo` | 240-299 | registry public API |
| `zoneSlotCounters` / `getNextSlot` / `resetSlotCounters` | 301-312 | zone slot counter |
| `clearCompanyState` | 314-335 | company 切换清理 |
| `useSceneOrchestrator` hook | 337-1199 | 消费 eventBus / 写 ceremony state / 管 movement |

这 7 段里真正属于 "ceremony orchestrator" 核心业务的是最后一段 hook，其他 6 段都是 **被 hook 消费、但不应该和 hook 住同一文件**的基础设施：
- movement handle registry 是 module-level mutable state，被 `office3d-*` 组件通过 public re-export 访问
- zone slot counter 同理
- describe 辅助函数纯静态
- ceremony state 类型 + idle 常量是跨模块契约

拆分**不是引入新行为**，是把已有代码按职责搬家，减少文件长度 / 消除"改 ceremony 要 scroll 过 movement handle"的认知负担。

**风险核心**：移动 module-level state（companyHandles / zoneSlotCounters）会改变 import 图；importer 必须继续能访问同一个单例，不能让两个模块各持一份。design 靠 **单点 re-export** 保证 importer 透明。

## Goals / Non-Goals

**Goals:**

- `useSceneOrchestrator.ts` ≤ 150 行，只做 hook 组装 + public re-export
- 新模块每个单一职责、可独立 audit
- public API 签名零变：`useSceneOrchestrator({...})` 返回 `CeremonyState` 不变；`CeremonyState` / `CeremonyPhase` / `IDLE_CEREMONY` / `createIdleCeremonyState` / `registerMovementHandle` / `unregisterMovementHandle` / `getMovementHandle` / `getMovementDebugInfo` / `clearCompanyState` 全部从原路径（`hooks/useSceneOrchestrator`）可 import
- 行为零回归：ceremony 8 phase 文本 / 转换时序 / movement handle 注册时序全部不变
- 拆分后一次性 commit，不拆多轮

**Non-Goals:**

- 不改 ceremony phase 语义
- 不改 event payload schema
- 不改 `useCeremonyState` 和 plan-step-store 的职责边界（plan 事件 plan-step-store 管；ceremony 事件 ceremony 管）
- 不动 `scene-behavior.ts` / `seat-registry.ts` / `prefab-spatial.ts`
- 不动 3D/2D view 组件（它们从 `useSceneOrchestrator` 导入 CeremonyState / CeremonyPhase 类型，路径不变）
- 不做全局事件订阅重构（订阅数量 = 12，仍保留）

## Decisions

### D1: public surface 保持在原路径 `hooks/useSceneOrchestrator.ts`

**选择**：`useSceneOrchestrator.ts` 即使缩短到 150 行，仍是 public barrel：
```ts
// useSceneOrchestrator.ts (new)
export type { CeremonyState, CeremonyPhase, WaitingRelationship } from './useCeremonyState';
export { createIdleCeremonyState, IDLE_CEREMONY } from './useCeremonyState';
export {
  registerMovementHandle,
  unregisterMovementHandle,
  getMovementHandle,
  getMovementDebugInfo,
  clearCompanyState,
} from '../runtime/movement-handle-registry';
// ...
export function useSceneOrchestrator(deps: OrchestratorDeps): CeremonyState { ... }
```

**理由**：13+ importers 不用改。`clearCompanyState` 实际要同时清理 handle registry + zone slot counter，保持它住在 orchestrator barrel 也更契合语义（一行入口管两件事）。

**备选**：把 type 和 registry 分别从新路径 import，每个 importer 改 import 语句。否决：动 13+ 文件的 import，且未来改路径又要追一遍，成本高。

### D2: 全局 mutable state 搬家但保持单例

**选择**：`companyHandles` / `zoneSlotCounters` 搬到各自新 module，以 module-level `Map` 单例存在。新 module 里不 export 这俩 Map 本身，只 export 其上的操作函数（`registerMovementHandle` 等）。

**理由**：module-level singleton 在 ES module 系统下按 module URL 唯一化，**只要 import 路径统一走一个 module，就不会拆出两个实例**。

**关键验证**：搬完后全仓 grep `companyHandles\|zoneSlotCounters` 必须只出现在新 module 内部。

### D3: `useCeremonyEventBindings` 作为 hook-local 实现细节，不 public export

**选择**：这个新 hook 只在 `useSceneOrchestrator.ts` 内部调用，不 export 给其他文件。接受 `{ eventBus, ceremonyDispatch, companyId, agents, zones }` 返回 void（副作用 hook）。

**理由**：event binding 的订阅列表是 orchestrator 的内部实现，暴露反而让 plan-step-store 类其他订阅者误用。

### D4: ceremony state 用 reducer 还是 setState？

**选择**：保持现状 `useState<CeremonyState>` + setter（不引入 useReducer）。拆分只搬代码，不变模式。

**理由**：本 change scope 是"搬家不装修"。Reducer 化是另一轮的事，等对当前 setter 调用集有完整 audit 再考虑。

### D5: 回归验证靠 Playwright 视觉回归，不靠自动测试

**选择**：符合仓库 validation policy（live agent 手测）。pre / post 各跑一次相同 live 任务（简单任务 → ceremony 8 phase 全跑一遍），截图对比 phase 文本。

**备选**：写 unit test 对 `useCeremonyState` 做 reducer-style 测试。否决：仓库已删 vitest 生态，不重新引入。

## Risks / Trade-offs

- **[风险] 搬 module-level state 时不小心拆出双实例** → Mitigation: D2 明确单 module；Task 里要求全仓 `grep companyHandles\|zoneSlotCounters` 确认只在新 module 内出现。
- **[风险] public re-export 遗漏某个符号** → Mitigation: Task 1 先列 pre-change public surface（grep `from '.*useSceneOrchestrator'`）→ Task 2 拆完后逐一对齐 → Task 3 build + typecheck 会扫出任何缺口。
- **[风险] 行为漂移**：event binding 里某条 effect 被错误分组导致 setter 调用时序变化 → Mitigation: Task 2 要求搬事件订阅时**逐条 copy-paste**，不合并/简化。拆完先跑 typecheck + build，再对比 pre/post 12 处 `eventBus.on` 列表一致（grep `eventBus.on` 两边对齐）。
- **[风险] 13+ importer 中某个路径是 `from '../hooks/useSceneOrchestrator.js'` 带 .js 扩展** → Mitigation: 新 module 文件路径用 `.ts`，re-export barrel 路径保持 `useSceneOrchestrator.ts` 不变，importer 不动。
- **[风险] 文件改动量大（~1000 行搬家），commit 乱** → Mitigation: 一次性搬 + 一次性 commit；commit body 详细说拆分映射；不拆中间 commit。

## Open Questions

- **`clearCompanyState` 该不该同时清 ceremony state？** 当前它只清 handles + slot counters，不清 ceremony。保持不变（本 change 不改语义）。若 live 回归发现 company 切换后 ceremony 残留，列 follow-up。
- **`describe*` 辅助函数放 `ceremony-visuals.ts` 还是新 `ceremony-descriptions.ts`？** 倾向前者（ceremony-visuals 已是颜色 + manager presence + bubble text 的归口），Task 阶段确认。
