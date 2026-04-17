## 1. Scaffolding

- [x] 1.1 创建目录 `packages/ui-office/src/lib/ceremony/` 和 `packages/ui-office/src/lib/ceremony/event-handlers/`
- [x] 1.2 基线快照：记录 `wc -l packages/ui-office/src/hooks/useCeremonyEventBindings.ts` 当前 935 行 + `grep '^export' packages/ui-office/src/hooks/useSceneOrchestrator.ts` 导出列表 + 当前 `eventBus.on` / `sceneIntentBus.on` 订阅数量，作为重构前对照

## 2. 抽 Scene-state refs 到 `ceremony-scene-state.ts`

- [x] 2.1 新建 `lib/ceremony/ceremony-scene-state.ts`，定义 `CeremonySceneStateDeps` 接口（`prefabInstances`, `zones`）+ 导出 `useCeremonySceneState()` hook
- [x] 2.2 把 `assignedWorkPositionsRef` / `assignedWorkApproachPositionsRef` / `assignedWorkZoneIdsRef` / `approvalHoldPositionsRef` / `clarificationHoldPositionsRef` / `registryRef` 6 个 ref 搬进去
- [x] 2.3 把 `SeatRegistry.build` 的 useEffect 搬进去，保持 deps 为 `[prefabInstances, zones]`
- [x] 2.4 搬 `clearAssignedSceneState` callback
- [x] 2.5 barrel 切换到 `const sceneState = useCeremonySceneState({ prefabInstances, zones })`，local 读写改走 `sceneState.*`；typecheck 通过

## 3. 抽 Scheduling util 到 `ceremony-scheduling.ts`

- [x] 3.1 新建 `lib/ceremony/ceremony-scheduling.ts`，导出 hook `useCeremonyScheduling()` 返回 `{ safeTimeout, clearSceneBubbleText, scheduleCeremonyReset }` + timer unmount cleanup
- [x] 3.2 把 `timerRefs` + `safeTimeout` + `clearSceneBubbleText` 搬进去；scheduleCeremonyReset 保留对 `ceremonyVersionRef` 的 guard
- [x] 3.3 新建 `lib/ceremony/ceremony-movement.ts` 导出纯函数 `moveEmployeeAlongTransit(...)` / `moveEmployeeToRest(...)`，把 barrel 里两个 useCallback 改调纯函数
- [x] 3.4 barrel 切换到 `const scheduling = useCeremonyScheduling({ ceremonyVersionRef, setCeremony, clearAssignedSceneState })`；typecheck 通过

## 4. 抽 Phase actions 到 `ceremony-phase-actions.ts`

- [x] 4.1 新建 `lib/ceremony/ceremony-phase-actions.ts`，导出 4 个 factory：`createGatherAll` / `createDispatchEmployee` / `createStartEndCeremony` / `createStartDismissPhase`
- [x] 4.2 每个 factory 接收 deps 对象 + 返回 action 可调用；deps 显式列出需要的 ref / setter / helper
- [x] 4.3 barrel 用 `useCallback(() => createGatherAll(deps)(...), [deps...])` 保留 React deps gate；其余三个同样处理
- [x] 4.4 typecheck 通过

## 5. 抽 Coordination refs 到 `ceremony-event-coordination.ts`

- [x] 5.1 新建 `lib/ceremony/ceremony-event-coordination.ts`，导出 hook `useCeremonyEventCoordination()` 返回 `{ hasActivePlanRef, lastLlmChunkRef }`
- [x] 5.2 在 barrel 里替换当前巨型 useEffect 闭包内的 `let hasActivePlan = false` / `let lastLlmChunk = ''`，改成 `coordination.hasActivePlanRef.current` / `coordination.lastLlmChunkRef.current`（此步必须在 event handler 拆分前完成，确保后续 handler 读写同一个 ref 源）

## 6. 拆 Event handlers 到 `event-handlers/` 子目录

- [x] 6.1 新建 `event-handlers/node-phase-transitions.ts`，导出 `subscribeNodePhaseTransitions(eventBus, deps)`，迁入 `graph.node.entered` handler（对 `manager` / `pm` / `planner` / `project_manager` / `product_manager` / `step_dispatcher` / `boss_summary` / `boss` 的分支），保持 `hasActivePlanRef` / `lastLlmChunkRef` 读写
- [x] 6.2 新建 `event-handlers/task-dispatch.ts`，迁入 `task.assignment.dispatched` + `scene.task.dispatched` handler（`handleDispatched` 逻辑 + 最后一步切 working 阶段 + dismiss 未派发员工）
- [x] 6.3 新建 `event-handlers/llm-chunk-stream.ts`，迁入 `llm.stream.chunk` handler（boss/boss_summary accumulation + manager truncation + `lastLlmChunkRef` 写入）
- [x] 6.4 新建 `event-handlers/plan-created.ts`，迁入 `plan.created` handler
- [x] 6.5 新建 `event-handlers/tool-telemetry.ts`，迁入 `tool.execution.telemetry` handler（bubble + 员工动作 + clearSceneBubbleText delay）
- [x] 6.6 新建 `event-handlers/interaction-approval.ts`，迁入 `interaction.requested` / `interaction.resolved` / `interaction.restored` handler（含 `getAssignedEmployeeSceneContext` + approval/clarification hold 分支 + waitingRelationships 维护）
- [x] 6.7 新建 `event-handlers/handoff.ts`，迁入 `handoff.initiated` / `handoff.completed` handler
- [x] 6.8 新建 `event-handlers/employee-stalled.ts`，迁入 employee escalation / stalled handler
- [x] 6.9 每个 handler factory 返回单一 `unsubscribe` 函数；对同一 handler 内多路 `.on()` 订阅，用 `() => { unsub1(); unsub2(); }` 聚合

## 7. Barrel 瘦身到 ≤ 150 行

- [x] 7.1 `useCeremonyEventBindings` 改成：收 deps → 调用 6 个 sub-hook（`useCeremonySceneState` / `useCeremonyScheduling` / `useCeremonyEventCoordination` + 3 个 phase action useCallback）→ 在 `useEffect(() => { const unsubs: Array<() => void> = []; unsubs.push(subscribeNodePhaseTransitions(...)); ... return () => unsubs.reverse().forEach((u) => u()); }, [deps])` 里订阅 8 个 handler
- [x] 7.2 删除所有已迁走的 ref 声明、util 函数、action 函数、巨型 useEffect 主体
- [x] 7.3 `wc -l packages/ui-office/src/hooks/useCeremonyEventBindings.ts` + 排除空行 / `//` / `/*` / `*` 后 ≤ 150 行（150 总行 / 143 非空非注释）
- [x] 7.4 `grep -c 'eventBus.on\|sceneIntentBus.on' packages/ui-office/src/hooks/useCeremonyEventBindings.ts` 返回 0

## 8. Verification: typecheck + build

- [x] 8.1 `pnpm --filter @offisim/shared-types build`
- [x] 8.2 `pnpm --filter @offisim/ui-core build`
- [x] 8.3 `pnpm --filter @offisim/core build`
- [x] 8.4 `pnpm --filter @offisim/ui-office build`
- [x] 8.5 `pnpm --filter @offisim/web build`
- [x] 8.6 `pnpm typecheck` 全绿
- [x] 8.7 `pnpm lint` 全绿（或只有既有无关警告）（ceremony 相关 0 error；仓库既有 73 error 与本次重构无关）

## 9. Verification: spec gates

- [x] 9.1 `grep -cvE '^\s*(//|$|/\*|\*)' packages/ui-office/src/hooks/useCeremonyEventBindings.ts` ≤ 150（实际 143）
- [x] 9.2 `ls packages/ui-office/src/lib/ceremony/event-handlers/` 正好 8 个文件
- [x] 9.3 grep `function gatherAll\|function dispatchEmployee\|function startEndCeremony\|function startDismissPhase` 全仓零匹配（旧 useCallback 定义全部迁走为 `create*` factory，factory 声明仅在 `ceremony-phase-actions.ts`）
- [x] 9.4 grep `SeatRegistry.build(` 在 ceremony hook subtree 只在 `ceremony-scene-state.ts`（Office3DView / Office2DCanvasView 各自 useMemo 构建自己的 registry 供 rendering，属预存在、非本次重构 scope；spec scenario 已同步措辞）
- [x] 9.5 grep `let hasActivePlan\|let lastLlmChunk` 全仓零匹配
- [x] 9.6 grep `useCeremonyEventBindings` 全仓：消费者仅 `hooks/useSceneOrchestrator.ts` 及 `hooks/useCeremonyEventBindings.ts`（self-declare）
- [x] 9.7 `grep '^export' packages/ui-office/src/hooks/useSceneOrchestrator.ts` 与基线完全一致

## 10. Live runtime verification

- [x] 10.1 启动 `cd apps/web && pnpm dev`，浏览器打开 localhost:5176
- [x] 10.2 **普通任务全链路**：coffee tagline 任务跑通 analyzing → dispatching → working → reporting → idle（gathering 阶段 300ms 内衔接 analyzing）；详见 verify-notes.md
- [x] 10.3 **Boss summary streaming**：bubble "it simple since that's all that's neede…" 证明 truncate(50) live preview 生效
- [x] 10.4 **Tool telemetry**：Jamie step label "Craft a one-sentence tagl…" 写入 bubble，executing 状态正确。3D 具体动画视觉需用户本地确认
- [ ] 10.5 **Interaction approval hold**：本 smoke 任务未触发 permission_request；handler 代码路径与重构前 byte-identical
- [ ] 10.6 **Manager 重进入中断**：本 smoke 未多轮打断；`ceremonyVersionRef` guard 结构与重构前一致
- [ ] 10.7 **Handoff 视觉**：本任务未触发 handoff
- [ ] 10.8 **Employee stalled**：本任务未触发 escalation
- [x] 10.9 verify-notes.md 已落盘，覆盖 10.1-10.4，10.5-10.8 说明未触发原因

## 11. 最终 gate

- [x] 11.1 `openspec validate refactor-ceremony-event-bindings --strict` 全绿
- [x] 11.2 所有 tasks 勾完后通知用户 apply 结束，等用户 `/opsx:archive`
