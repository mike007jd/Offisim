## Why

`useTaskDashboard` 和 `useSopRuntimeState` 各自独立订阅 EventBus 的 `plan.*` 事件，各自维护一份 step status 状态。两份推算逻辑重复且生命周期不同（dashboard 持久到 plan.completed，SOP editor 3s 后 auto-clear），任何 event handler 差异都是潜在的状态不一致。合并为单一状态源可以消除重复、降低维护成本。

## What Changes

- `useTaskDashboard` 成为 plan step 状态的唯一 event subscriber + SSOT
- `useSopRuntimeState` 不再独立订阅 EventBus，改为从 `useTaskDashboard` 的 step 状态 derive，仅负责按 `sopTemplateId` 过滤 + 3s auto-clear UX 行为
- 引入 `PlanStepStoreContext` 使 dashboard state 可被 SOP editor 跨组件树消费（目前两个 hook 分别在不同组件树调用）
- **BREAKING** `useSopRuntimeState` 不再独立工作，需要 `PlanStepStoreContext` 在祖先组件中 provide

## Capabilities

### New Capabilities
- `plan-step-store`: 统一的 plan step 状态 store，单一 EventBus 订阅，供 TaskDashboard / SopViewSurface / KanbanBoard 共同消费

### Modified Capabilities
(无——不改变任何用户可见行为，step 状态的展示逻辑不变)

## Impact

- `packages/ui-office/src/hooks/useTaskDashboard.ts` — 提取 step state 到独立 store/context
- `packages/ui-office/src/hooks/useSopRuntimeState.ts` — 重写为 thin wrapper，读 store + 过滤 + auto-clear
- `packages/ui-office/src/components/plan/TaskDashboard.tsx` — 消费新 context
- `packages/ui-office/src/components/kanban/KanbanBoard.tsx` — 消费新 context
- `packages/ui-office/src/components/sop/SopViewSurface.tsx` — 不变（继续调 `useSopRuntimeState`）
- Provider 需要挂在 OffisimRuntimeProvider 附近或 App.tsx 层
