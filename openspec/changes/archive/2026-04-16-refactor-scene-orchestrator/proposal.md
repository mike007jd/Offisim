## Why

`packages/ui-office/src/hooks/useSceneOrchestrator.ts`（1199 行）是 memory 里明确标注的**屎山热点之一**（`Current hygiene hotspots`）。它在单一文件里同时承担：

1. **Ceremony state machine**（8 阶段 phase + bubble text + phase timing）
2. **Movement handle 全局 registry**（`companyHandles: Map<companyId, Map<employeeId, handle>>` + 导出 `registerMovementHandle` / `unregisterMovementHandle` / `getMovementHandle` / `getMovementDebugInfo`）
3. **Zone slot counter**（`zoneSlotCounters` 全局 map + `getRestPos` / `getRestSlotKey`）
4. **EventBus 订阅**：至少 12 处 `eventBus.on`（`plan.created` / `task.*` / `employee.*` / `graph.node.*` / `execution.*` / `llm.stream.chunk` 等），每处逻辑都往 ceremony state 写
5. **Waiting relationship + interaction scene 辅助函数**（describeWorkingToolActivity / describeInteractionSceneRequest / describeInteractionSceneResolution / describeEmployeeEscalation）
6. **Tool call scene bubble formatting**（plan created、node entered、chunk、tool telemetry）
7. **Scene idle reset + phase reset helpers**

这些职责串在一起，导致：
- 新增一个 ceremony phase 触发 → 要在多个 eventBus 订阅里同时改，漏改就让 bubble 和 phase 脱节
- movement registry 是 module-level global，和 ceremony hook 生命周期耦合，company 切换时已经踩过问题
- 文件 1199 行，任何局部修改都要 scroll 过所有不相关的面
- 35 处 `useEffect/useRef/useState/useCallback/useMemo` 混在一起，状态流不可追溯

Memory 里 "3 个 volatile / 5 个 evolving" capability 里就含 "ceremony 与 seat-registry 坐标耦合"——这和本文件 movement handle + zone slot 部分直接相关。**屎山不先拆，后续任何 ceremony/scene 相关 capability 的 canonical spec 都会固化当前的耦合**。

## What Changes

- 把 `useSceneOrchestrator.ts` 按职责拆成 5 个模块：
  1. `hooks/scene-ceremony-state.ts`（或 `useCeremonyState.ts`）：phase / bubble text state + reset helpers + `createIdleCeremonyState` / `IDLE_CEREMONY` 常量
  2. `hooks/scene-event-bindings.ts`（或内部 `useCeremonyEventBindings.ts`）：12 处 eventBus 订阅 → ceremony state 的 reducer-ish 逻辑
  3. `runtime/movement-handle-registry.ts`：全局 `companyHandles` map + register/unregister/get/debug API
  4. `runtime/zone-slot-counter.ts`：`zoneSlotCounters` + `getNextSlot` / `resetSlotCounters`
  5. `lib/ceremony-descriptions.ts`：`describeWorkingToolActivity` / `describeInteractionScene*` / `describeEmployeeEscalation` 纯描述函数（或合并进 `ceremony-visuals.ts`）
- `useSceneOrchestrator` 本身保留为**组装 hook**，只做：读 deps（companyId / eventBus / agents / zones / prefabs）→ 调拆出的子 hook → 返回 `CeremonyState`。预期 < 150 行
- **行为零变**：拆分后 ceremony bubble text、phase 转换、movement registry 行为在 live runtime 必须逐条对齐；acceptance = pre/post snapshot 视觉对比
- **scope 锁定在文件拆分**：不改 event payload schema、不改订阅事件清单、不改全局 companyHandles 的生命周期语义

## Capabilities

### New Capabilities
- `scene-orchestrator-boundaries`: useSceneOrchestrator 的职责边界规范——ceremony state 与 movement registry / zone slot counter / 事件订阅彼此解耦，任一子模块可独立 audit / 替换

### Modified Capabilities
(无 — 不改任何已有 canonical spec。尤其不触 `plan-step-store`：它已单独订阅 plan events，本拆分不动它)

## Impact

- **拆分目标文件**（全部在 `packages/ui-office/src/`）：
  - `hooks/useSceneOrchestrator.ts`（1199 行 → ≤ 150 行）
  - 新 `hooks/useCeremonyState.ts`（~150-200 行）
  - 新 `hooks/useCeremonyEventBindings.ts`（~300-400 行）
  - 新 `runtime/movement-handle-registry.ts`（~60 行）
  - 新 `runtime/zone-slot-counter.ts`（~30 行）
  - 扩 `lib/ceremony-visuals.ts` 或新 `lib/ceremony-descriptions.ts`（~80 行）
- **importer 兼容**：`useSceneOrchestrator` 作为 public export 的函数签名保持不变；所有现有 importer（13+ 文件，见 `grep -rn useSceneOrchestrator packages/ apps/`）无需改动。`CeremonyState` / `CeremonyPhase` / `IDLE_CEREMONY` / `createIdleCeremonyState` / movement-handle API（`registerMovementHandle` 等）仍从 `useSceneOrchestrator.ts` re-export 以维持兼容，新模块是实现细节
- **验证**：
  - typecheck + build 绿（串行跑）
  - Live Playwright 三项回归：
    1. 发任务观察 ceremony 8 phase（gathering → analyzing → planning → dispatching → working → reporting → dismissing → idle）文字都出现
    2. employee 移动（scene-behavior routes）仍然有效（movement handle registry 未 regress）
    3. 多 company 切换后 clearCompanyState 仍清理 handles + slot counters
- **不触**：scene-behavior.ts（路由）、seat-registry.ts（座位分配）、useSceneCeremony context（消费端）、scene-ceremony-context.tsx、office3d-* 组件
