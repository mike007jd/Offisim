## Context

`packages/ui-office/src/hooks/useCeremonyEventBindings.ts` 是 D 系列 "跨层事件拼装" 重构的未收残留。之前 `refactor-scene-orchestrator-boundaries` 已经把 `useSceneOrchestrator` 拆成 thin barrel + `useCeremonyState` / `useCeremonyEventBindings` / `movement-handle-registry` / `zone-slot-counter` / `ceremony-descriptions` 五个模块，并规定 event binding hook 本身不对外暴露（Requirement: Event bindings hook is internal）。

但 event bindings 的内部结构没有被约束——它吸收了原 orchestrator 里所有 event 订阅职责，长到 935 行，单 useEffect 闭包 580 行。当前结构：

```
useCeremonyEventBindings (935 行)
├─ Section A: deps + 5 个 scene-state refs + SeatRegistry build       ~40 行
├─ Section B: scheduling & movement utils (safeTimeout / moveToRest)  ~100 行
├─ Section C: phase actions (gatherAll / dispatch / endCeremony)      ~150 行
└─ Section D: 一个巨型 useEffect                                      ~580 行
              ├─ D1 graph.node.entered (phase transitions)
              ├─ D2 task.assignment.dispatched
              ├─ D3 llm.stream.chunk (boss/manager streaming)
              ├─ D4 plan.created
              ├─ D5 tool.execution.telemetry
              ├─ D6 interaction.requested/resolved/restored
              ├─ D7 handoff.initiated/completed
              └─ D8 employee escalated/stalled
```

D 系列既有 canonical spec 作为参照模板：
- `scene-orchestrator-boundaries`: 150 行 barrel + module-level mutable state 只住 registry 模块
- `employee-node-boundaries`: 200 行 barrel + preflight/prompt/tool-kit/turn-runner/tool-round/completion/error-finalize 7 个 single-responsibility sibling

该 change 按同样的模式收 `useCeremonyEventBindings`。

## Goals / Non-Goals

**Goals:**

- `useCeremonyEventBindings.ts` 压到 ≤ 150 非空非注释行的 thin composition hook。
- 8 条 event 业务线各自落到独立 handler 文件，一事一文件。
- phase action（gather / dispatch / endCeremony / dismiss）、scene-state refs、scheduling util 三类内部结构各自独立模块。
- 跨 handler 的 shared mutable state（`hasActivePlan` / `lastLlmChunk`）从闭包内联改成显式 ref 传递。
- `ceremonyVersionRef.current !== version` 中断 guard 在每个异步回调保留。
- 可观测行为（phase 序列 / bubble text / 员工移动 / manager presence / interaction hold / handoff 视觉）byte-identical。
- `useSceneOrchestrator.ts` 的 public export 列表不变；消费者 import path 无改动。

**Non-Goals:**

- 不重新设计 ceremony phase 模型或 bubble text 产生逻辑——纯结构拆分。
- 不动 `SceneIntentBus` / `EventBus` 的 transport 契约。
- 不改 `SeatRegistry` / `movement-handle-registry` / `zone-slot-counter` 的 API。
- 不改 `ceremony-visuals.ts` / `scene-behavior.ts` / `scene-nav.ts` 的公共 helper。
- 不引入测试——按项目纪律，验证走 live runtime。

## Decisions

### D1. 目录定位：`lib/ceremony/` 而不是 `hooks/ceremony/` 或 `runtime/`

**选择**: `packages/ui-office/src/lib/ceremony/`。

**理由**:
- 新模块绝大多数是纯函数 + factory（`createGather`、`subscribeNodePhaseTransitions`），不是 React hook，放 `hooks/` 语义不准。
- `runtime/` 已被 module-level singleton registry 占用（`movement-handle-registry` / `zone-slot-counter`），ceremony 里的 refs 全是 per-hook-instance 不是 singleton，不属于 runtime 语义。
- `lib/` 里已经有 `ceremony-visuals.ts` / `ceremony-descriptions.ts` 两个既有 ceremony 相关文件，新增 `ceremony/` 子目录保持聚合性。

**不选**:
- `hooks/ceremony/`: 内部模块不是 hook，放这里误导。
- `runtime/ceremony/`: singleton 语义不匹配。
- 平摊到 `lib/`（不建子目录）: ceremony 相关文件会超过 10 个，需要子目录聚合。

### D2. Event handler 签名：`subscribe(bus, deps) => unsubscribe` factory

**选择**: 每个 handler 模块导出一个 factory 函数，接收 `eventBus` / `sceneIntentBus` / 共享 refs，返回 `unsubscribe`。

**签名示例**:
```ts
export function subscribeNodePhaseTransitions(
  eventBus: EventBus,
  deps: NodePhaseTransitionsDeps,
): () => void;
```

**理由**:
- Factory 返回 unsubscribe 是 EventBus 既有契约（`eventBus.on` 返回 unsubscribe），一致。
- barrel hook 里只要 `cleanup.push(subscribe...(bus, deps))`，组装成本低。
- deps 显式化，handler 内部无隐藏 module-level state。

**不选**:
- React custom hook 形式（`useNodePhaseTransitions`): 会引入额外 deps 追踪成本，hook rules 约束反而比 factory 更复杂；且 8 个 hook 会让 barrel 的 React tree 依赖图变厚。
- Class 形式: ui-office 全仓无 class 编程风格，不打破。
- 单文件 `eventHandlers` 对象字面量: 失去单一职责隔离，本次重构的核心目标就是按 event prefix 分文件。

### D3. Shared mutable state：显式 ref 而非 closure

**选择**: 创建 `ceremony-event-coordination.ts` 导出一个 factory 返回以下 ref 集合：
```ts
export interface CeremonyEventCoordinationRefs {
  hasActivePlanRef: MutableRefObject<boolean>;
  lastLlmChunkRef: MutableRefObject<string>;
  // 其他跨 handler 需要共享的 mutable state
}
```

**理由**:
- 当前代码里这些变量是 useEffect 闭包内的 `let`，拆分后必须跨文件共享。
- 用 ref 而不是 state：这些是 "update 不应触发重渲染" 的协调标记，useState 会引入无意义的 re-render。
- 用 factory 而不是 module-level：每个 hook instance 独立 refs，避免多公司切换时污染。

**不选**:
- React context: 重量级，只为 hook 内部协调不值。
- `useReducer`: 这些 state 没有 reducer 语义，就是 "最新写入赢"。
- module-level variable: 违反 scene-orchestrator-boundaries 既有 "module-level mutable state 只住 registry" 原则。

### D4. Scene-state refs（assignedWork*）的所有权

**选择**: `ceremony-scene-state.ts` 导出一个 hook `useCeremonySceneState()` 返回 refs + `clearAssignedSceneState` + SeatRegistry refresh effect。

```ts
export function useCeremonySceneState(deps: {...}): {
  assignedWorkPositionsRef: MutableRefObject<Map<string, Position3>>;
  assignedWorkApproachPositionsRef: MutableRefObject<Map<string, Position3>>;
  assignedWorkZoneIdsRef: MutableRefObject<Map<string, string>>;
  approvalHoldPositionsRef: MutableRefObject<Map<string, Position3>>;
  clarificationHoldPositionsRef: MutableRefObject<Map<string, Position3>>;
  registryRef: MutableRefObject<SeatRegistry | null>;
  clearAssignedSceneState: () => void;
};
```

**理由**:
- refs 的生命周期跟随 hook instance（不是 module singleton），必须是 hook 返回值。
- SeatRegistry build effect 依赖 `prefabInstances` / `zones`，是 refs 的合法 owner。
- `clearAssignedSceneState` 是 5 个 refs 的协同清理，放在同一模块保持封装。

### D5. Phase actions 的抽象层

**选择**: `ceremony-phase-actions.ts` 导出 4 个 `useCallback`-ready factories：

```ts
export function createGatherAll(deps: GatherAllDeps): () => void;
export function createDispatchEmployee(deps: DispatchDeps): (id, role, version) => void;
export function createStartEndCeremony(deps: EndCeremonyDeps): (summary, version) => void;
export function createStartDismissPhase(deps: DismissDeps): (ids, version) => void;
```

**理由**:
- 这些 action 需要捕获 `setCeremony` / `ceremonyVersionRef` / `agentsRef` / `zonesRef` 等 dep，factory 模式对齐 barrel 里的 `useCallback` 用法。
- barrel 里用 `useCallback(() => createGatherAll(deps)(...), [...])`，保留 React deps gate。

**不选**:
- 直接导出 fully-baked callback: 会把 hook state 拖到模块层；拒绝。
- 导出 class methods: 不符合项目风格。

### D6. 不拆 Scheduling util

**选择**: `safeTimeout` + timer refs + `clearSceneBubbleText` + `scheduleCeremonyReset` 落到 `ceremony-scheduling.ts` 的单 hook `useCeremonyScheduling()`。`moveEmployeeAlongTransit` / `moveEmployeeToRest` 作为纯函数 helper（接收 registryRef / zonesRef / companyId 作参）。

**理由**:
- `safeTimeout` 的 timer cleanup 必须在 hook unmount 触发，所以 scheduling 是 hook 不是纯函数。
- `moveEmployeeAlongTransit` 是无状态纯计算（读 refs 不写），作为纯函数 helper 更清晰。

### D7. handler 颗粒度：8 个而不是合并到 3 个

**选择**: 按 event prefix 一事一文件：
- `node-phase-transitions.ts` (graph.node.entered)
- `task-dispatch.ts` (task.assignment.dispatched / scene.task.dispatched)
- `llm-chunk-stream.ts` (llm.stream.chunk)
- `plan-created.ts` (plan.created)
- `tool-telemetry.ts` (tool.execution.telemetry)
- `interaction-approval.ts` (interaction.requested / resolved / restored)
- `handoff.ts` (handoff.initiated / completed)
- `employee-stalled.ts` (employee escalated / stalled)

**理由**:
- `employee-node-boundaries` spec 的 7 个 sibling 模块已证明这个颗粒度在 agent 层可运行。
- 每个 event prefix 的业务含义独立：node-phase-transitions 关心 phase lifecycle；tool-telemetry 只负责 working 阶段视觉。
- 单 handler 文件 50-120 行，单文件可读。
- 如果合并成 3 块（node+dispatch / stream+telemetry / interaction+handoff），每块 200+ 行，基本复刻当前大 useEffect 的可读性问题。

### D8. ceremonyVersionRef guard 契约

**契约**: 每个 handler factory 在 `subscribe(bus, deps)` 的 deps 里必须接收 `ceremonyVersionRef`，并在任何 `safeTimeout` / 异步回调里调用 `if (ceremonyVersionRef.current !== version) return`。重构前后这个 guard 模式 byte-identical。

**理由**: 该 guard 是 ceremony 可中断性的核心——manager 重进入会 bump version，所有旧回调必须短路。拆分时最容易丢，显式写进 spec requirement。

### D9. 消费者 API 不动

`useSceneOrchestrator.ts` 的 public export 列表不变，`useCeremonyEventBindings` 继续 internal-only，不加新 public surface。该 change 是纯结构重构。

## Risks / Trade-offs

- [**风险：跨 handler shared state 丢同步**] → 通过 `ceremony-event-coordination.ts` 的显式 ref 契约固化；live verify 覆盖 manager 重进入（触发 `hasActivePlanRef` 复位）和 boss summary streaming（触发 `lastLlmChunkRef` 同步）两条链路。
- [**风险：SeatRegistry build 时序漂移**] → SeatRegistry build effect 留在 `ceremony-scene-state.ts`，deps 锁死 `prefabInstances` + `zones`，不因 hook 拆分改变触发时机。
- [**风险：setTimeout cleanup 泄漏**] → `ceremony-scheduling.ts` 的 `useCeremonyScheduling` unmount effect 继续 `clearTimeout` 所有 timerRefs 里的 id，拆分前后一致。
- [**风险：event subscription cleanup 顺序**] → barrel 里用 array 收集所有 unsubscribe，cleanup 时反序调用（LIFO），和当前 useEffect return cleanup 的行为一致。
- [**风险：live verify 覆盖不够**] → tasks.md 强制要求跑以下 live scenarios：
  1. 普通任务 one-shot: gathering→analyzing→planning→dispatching→working→reporting→dismissing 完整序列。
  2. Boss summary streaming: bubble text 实时增长。
  3. Tool telemetry: working 阶段员工做工动画 + bubble label 出现/消失。
  4. Interaction approval: permission_request 场景下员工移动到 approval hold。
  5. Handoff: handoff.initiated / completed 视觉。
  6. Manager 重进入: 中断当前 ceremony，所有 movement 停止 + 回 rest + 新 gathering。
- [**Trade-off：文件数增加**] → ceremony/ 子目录新增 3 + 8 = 11 个文件。换来单文件 ≤ 150 行的可读性。对齐 `employee-node-boundaries` 的 7 文件模式，团队已熟悉。
