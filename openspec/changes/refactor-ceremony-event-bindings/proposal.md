## Why

`useCeremonyEventBindings.ts` 935 行是 D 系列 "跨层事件拼装" 重构未收的残留——之前拆了 `useSceneOrchestrator` / `employee-node` / repo triple-copies，但 ceremony 事件绑定这一层的 14 种 payload × 8 种 event prefix 仍堆在单个 hook 里。单 useEffect 580 行闭包内联 8 条独立业务线（phase 切换 / dispatch / LLM stream / plan 更新 / tool 动画 / approval hold / handoff / stalled），修任何一条都要读完整个 hook 才敢动。借现在的稳定 canonical spec 锚（`scene-orchestrator-boundaries` / `employee-node-boundaries`），按同样的"thin barrel + 单责 sibling module"模式收尾。

## What Changes

- **Thin barrel**: `useCeremonyEventBindings.ts` 压到 ≤ 150 非空非注释行，只做 deps 接收 + 调用 sub-hook + 订阅 handlers，不再承载 state / util / action / event dispatch 的实现。
- **Phase action 抽模块**: `gatherAll` / `dispatchEmployee` / `startEndCeremony` / `startDismissPhase` 三个 ceremony phase 编排动作落到 `lib/ceremony/ceremony-phase-actions.ts`。
- **Scene state refs 抽模块**: `assignedWorkPositionsRef` / `assignedWorkApproachPositionsRef` / `assignedWorkZoneIdsRef` / `approvalHoldPositionsRef` / `clarificationHoldPositionsRef` 五个 scene-state ref + SeatRegistry build 逻辑落到 `lib/ceremony/ceremony-scene-state.ts`。
- **Scheduling 抽模块**: `safeTimeout` / `clearSceneBubbleText` / `scheduleCeremonyReset` / `moveEmployeeAlongTransit` / `moveEmployeeToRest` 落到 `lib/ceremony/ceremony-scheduling.ts`。
- **Event handlers 按 event prefix 拆**: 580 行的巨型 useEffect 拆成 8 个 handler 模块，每个 handler 是一个 `subscribe(bus, deps) => unsubscribe` 函数，落到 `lib/ceremony/event-handlers/` 子目录：
  - `node-phase-transitions.ts` (graph.node.entered)
  - `task-dispatch.ts` (task.assignment.dispatched / scene.task.dispatched)
  - `llm-chunk-stream.ts` (llm.stream.chunk)
  - `plan-created.ts` (plan.created)
  - `tool-telemetry.ts` (tool.execution.telemetry)
  - `interaction-approval.ts` (interaction.requested / resolved / restored)
  - `handoff.ts` (handoff.initiated / completed)
  - `employee-stalled.ts` (employee escalated / stalled)
- **Shared mutable state 上浮**: 当前巨型 useEffect 闭包内的 `hasActivePlan` / `lastLlmChunk` / `accumulatedBossText` / `currentStreamNode` 改用显式 `useRef` 传给相关 handler，不再是闭包隐式共享。
- **可观测行为不变**：phase 切换序列、bubble text、员工移动路径、manager presence、interaction hold 位置、handoff 视觉全部 byte-identical。重构不改产品表现。

## Capabilities

### New Capabilities

（无）

### Modified Capabilities

- `scene-orchestrator-boundaries`: 新增 5 条 requirement，约束 `useCeremonyEventBindings.ts` 本身必须拆成 thin barrel + sibling modules；明确 event handler 的 single-responsibility 颗粒度；要求 shared handler state 通过 ref 显式传递；保留可观测行为不变契约。

## Impact

- **目录新增**: `packages/ui-office/src/lib/ceremony/`（3 个模块文件 + `event-handlers/` 子目录 8 个 handler 文件）。
- **文件重写**: `packages/ui-office/src/hooks/useCeremonyEventBindings.ts` 从 935 行压到 ≤ 150 行。
- **public API 不变**: `useSceneOrchestrator.ts` 对外导出的符号列表不变；`useCeremonyEventBindings` 本身仍是 `useSceneOrchestrator` 内部调用，不是 public export。
- **消费者无改动**: `Office3DView` / `CeremonyHost` 等调用方 import path 无变化。
- **验证**: live runtime 跑真实 MiniMax 任务，对比 phase 序列 / bubble text / 移动路径 / interaction hold / handoff 视觉。无自动测试，全靠 live 验证。
- **无依赖升级 / 无 API 断裂 / 无 DB migration**。
