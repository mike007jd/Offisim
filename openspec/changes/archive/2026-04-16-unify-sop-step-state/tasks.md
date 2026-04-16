## 1. 提取 PlanStepStore

- [x] 1.1 创建 `packages/ui-office/src/hooks/plan-step-store.ts`：定义 `PlanStepState` 接口（planId, summary, sopTemplateId, steps[], currentStepIndex, isComplete, stats）
- [x] 1.2 实现 `usePlanStepStoreInternal` hook：从 `useTaskDashboard` 迁移所有 EventBus 订阅逻辑（plan.created/step.started/step.completed/completed + task.state/assignment）
- [x] 1.3 创建 `PlanStepStoreContext` + `PlanStepStoreProvider` 组件
- [x] 1.4 导出 `usePlanStepStore()` consumer hook（从 context 读取）

## 2. 挂载 Provider

- [x] 2.1 在 `OffisimRuntimeProvider` 内部包裹 `PlanStepStoreProvider`（或在其 children 外层）
- [x] 2.2 确认 `PlanStepStoreProvider` 能访问 `eventBus`（通过 `useOffisimRuntime`）

## 3. 改造 useTaskDashboard

- [x] 3.1 `useTaskDashboard` 改为从 `usePlanStepStore()` 读取 step 数据
- [x] 3.2 保留 `toggleStep` / `expanded` 等本地 UI 状态
- [x] 3.3 删除 `useTaskDashboard` 中所有 EventBus 订阅代码
- [x] 3.4 保留 `TaskDashboardState` 接口不变（对外 API 兼容）

## 4. 改造 useSopRuntimeState

- [x] 4.1 `useSopRuntimeState` 改为从 `usePlanStepStore()` 读取 step 数据
- [x] 4.2 按 `sopTemplateId` 过滤（比对 store 中的 `sopTemplateId` 字段）
- [x] 4.3 保留 3s auto-clear timer 逻辑（wrapper 本地管理）
- [x] 4.4 删除所有 EventBus 订阅代码
- [x] 4.5 保留 `SopRuntimeStepState` 接口不变（对外 API 兼容）

## 5. 清理 + 导出

- [x] 5.1 从 `packages/ui-office/src/index.ts` 和 `web.ts` 导出新的 `PlanStepStoreProvider` 和 `usePlanStepStore`
- [x] 5.2 确认 `useTaskDashboard` 和 `useSopRuntimeState` 的导出接口不变
- [x] 5.3 确认无 unused import 残留

## 6. 验证

- [x] 6.1 `pnpm --filter @offisim/ui-office build && pnpm --filter @offisim/web typecheck` 全绿
- [x] 6.2 浏览器 dev 验证：发一个任务，TaskDashboard 显示 step 进度正常
- [x] 6.3 浏览器 dev 验证：SOP editor 在任务执行时 DAG node 颜色变化正常
- [x] 6.4 浏览器 dev 验证：KanbanBoard 显示 task 状态正常
- [x] 6.5 确认只有一个 EventBus subscriber（grep 验证无其他 `plan.created` 订阅）
