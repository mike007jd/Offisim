## Context

当前有两个 hook 独立订阅 EventBus 的 `plan.*` 事件来推算 step 状态：

| Hook | 订阅 events | 维护的 state | 消费者 |
|------|------------|-------------|--------|
| `useTaskDashboard` | plan.created/step.started/step.completed/completed + task.state/assignment | steps[].status + tasks[] + currentStepIndex + stats | TaskDashboard, KanbanBoard |
| `useSopRuntimeState` | plan.created/step.started/step.completed/completed | steps[].status (简化版) | SopViewSurface → SopDagCanvas |

`useTaskDashboard` 是 superset（它同时跟踪 task 级别状态），`useSopRuntimeState` 是 subset（只跟踪 step 状态）。两者都被独立调用：TaskDashboard 和 KanbanBoard 各自 `new` 一个 `useTaskDashboard`（也是两个独立 subscriber），SopViewSurface `new` 一个 `useSopRuntimeState`。

## Goals / Non-Goals

**Goals:**
- plan step 状态只有一个 EventBus subscriber
- `useSopRuntimeState` 从这个 SSOT 读取而非独立推算
- TaskDashboard 和 KanbanBoard 也从同一个 store 读取（消除它们之间的重复订阅）

**Non-Goals:**
- 不改 kernel graph state（Source 1 不动）
- 不改 EventBus event 结构
- 不改 UI 组件的渲染逻辑或外观
- 不增加 event 可靠性保障（当前同进程 EventBus 不丢 event，够用）

## Decisions

### D1: 提取 `usePlanStepStore` hook + Context

**选择**: 从 `useTaskDashboard` 中提取一个新的 `usePlanStepStore` hook，它负责：
1. 订阅所有 `plan.*` 和 `task.*` events（单一 subscriber）
2. 维护 `InternalState`（planId, steps, currentStepIndex, isComplete, stats）
3. 通过 `PlanStepStoreContext` 向下游 provide

**备选**: 让 `useTaskDashboard` 直接成为 context provider。否决理由：`useTaskDashboard` 包含 UI 逻辑（`toggleStep`、`expanded` 状态），这些不应该泄露到 SOP editor 的消费路径。

**备选**: 用 zustand 或 jotai 等外部 store。否决理由：项目不依赖这些库，且 React Context 已足够——state 变化频率有限（每个 step transition 一次，不是 per-frame）。

### D2: `useTaskDashboard` 改为消费 `usePlanStepStore`

**选择**: `useTaskDashboard` 不再自己订阅 events，而是从 `PlanStepStoreContext` 读取 step 状态，自己只管 `toggleStep` / `expanded` 等 UI 交互状态。

这意味着 TaskDashboard 和 KanbanBoard 共享同一份 step 数据（之前各自 new 一个 hook，各自维护独立的 step 状态）。

### D3: `useSopRuntimeState` 改为 thin wrapper

**选择**: `useSopRuntimeState` 从 `PlanStepStoreContext` 读取 step 状态，按 `sopTemplateId` 过滤（通过比对 store 中的 `sopTemplateId` 字段），保留 3s auto-clear timer。不再自己订阅任何 event。

### D4: Provider 挂载位置

**选择**: `PlanStepStoreProvider` 挂在 `OffisimRuntimeProvider` 内部（它已经 provide eventBus）。这样所有 `useTaskDashboard` / `useSopRuntimeState` 消费者自动能访问。

**备选**: 挂在 App.tsx。否决理由：store 依赖 eventBus，挂在 OffisimRuntimeProvider 内部更符合依赖关系。

### D5: PlanCreatedPayload 需要携带 sopTemplateId

**现状**: `PlanCreatedPayload` 已包含 `sopTemplateId?: string` 字段（在 `shared-types/src/events.ts`）。`useSopRuntimeState` 用它来做过滤。store 需要把 `sopTemplateId` 存在 state 中，供 wrapper hook 读取。

## Risks / Trade-offs

- **[风险] TaskDashboard 和 KanbanBoard 共享 step state 后，expanded 状态互相影响** → expanded 是 `useTaskDashboard` 本地的 UI state，不在 store 中，不受影响。
- **[风险] Provider 新增一层 context，增加 re-render 范围** → store state 变化频率低（每个 step transition），不会造成性能问题。可以用 `useMemo` 稳定 context value。
- **[风险] useSopRuntimeState 的 3s auto-clear 行为是否与 store 冲突** → 不冲突。auto-clear 是 wrapper 本地的 derived state（对外返回 null），不影响 store 本身。store 的 step data 保持直到下一个 plan.created 覆盖。
