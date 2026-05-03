## Why

2026-05-03 bucket 2a release verify (Tauri release `.app`, light theme, 2D office canvas) 暴露：在画布里把员工节点拖动到目标 zone 不形成有效 drop target —— pan/drag 视觉与 token 颜色都正常，但 PointerUp 没有触发 `employee.workstation.drop-requested`。这条交互是 Office 工作区的核心员工调度入口（用户拖员工到不同 zone 即把员工分配到对应 workstation），release 端坏掉等于 Office 主路径的一条主要直接操作不可用。dev / vite 模式下走得通，所以是 release-only 回归；问题与 2D theme token 迁移无关，已在 `scene-2d-theme-tokens` archive Section 9.7 记录为 deferred 并拆出独立 change。

当前没有任何 spec 显式拥有「2D canvas 员工→zone drop」这条契约（`office-2d-canvas-viewport` 只在尾部一句"pan/zoom/DnD 行为不被尺寸 fix 改动"里捎带；employee 节点 / SeatRegistry / prefab spatial 各自的 spec 也没承接 drop pipeline），所以这次回归没有被任何契约层断言拦下。修复同时要把这条契约固化成显式 capability，未来再回归时有 invariant 兜住。

## What Changes

- 新建 capability `scene-2d-employee-drop`，把 2D canvas 上「pointer-down 起拖一个 employee node → pointer-move 超过 DRAG_THRESHOLD → pointer-up 落在合法 zone (deskSlots > 0 且非 sourceZone) → emit `employee.workstation.drop-requested`」这条 pipeline 显式定义为契约：每个 phase 的状态、合法 drop target 的过滤条件、release 与 dev 端行为等价、以及 release-app 内可导出的 drop diagnostic snapshot。
- 在 `Office2DCanvasView` / `useCanvasInteraction` / `office-2d-hitmap` / `useSceneSnapshot` 链路上加 release-app 内可导出的 **drop diagnostic snapshot**：单次拖拽尝试落地后，把 PointerEvent 流（down/move/up 时间戳、screen→canvas 坐标、phase 转换）、`hitTestZone` 命中结果、`dropTargetZoneIds` 当时取值、`sourceZoneId` 反查结果、最终是否 emit drop event 这一组数据收集进 ring buffer，用户在 release app 里点一下"Export drop diagnostic"就能拿到 JSON 证据贴回 issue。这是 root-cause 调查环节的产出物，也是 fix 完成后 invariant 巩固的运行时观测点。**遵循"诊断是产品能力，不是临时调试 print"——instrumentation 落地，不在 fix 完成后删掉**。
- 基于 diagnostic 还原结果，定位到三个候选根因里实际的那一个并修复：(a) DnD handler 注册 / pointer event 在 Tauri release 下的捕获/释放语义；(b) SeatRegistry / `zoneEmployees` 在 release 端的 occupancy 数据导致 `sourceZoneId` 反查或 `zoneId !== sourceZoneId` 比较失效；(c) `dropTargetZoneIds = zones.filter(z => z.deskSlots > 0)` 在 release 端因 prefab spatial / 持久化 deskSlots 数据为空而过滤掉所有 zone。修复要走根因，不接受"加一行兜底就放过去"。
- 修复后做 release `.app` live verify 闭环：dark+2D / light+2D 都能把员工从 source zone 拖到目标 zone，drop event 真触达后端、scene-orchestrator 真路由员工到新 workstation；diagnostic snapshot 显示 phase 链路完整。

## Capabilities

### New Capabilities
- `scene-2d-employee-drop`: 2D canvas employee→zone drop interaction 的端到端契约——pointer phase 状态机、合法 drop target 过滤规则、`employee.workstation.drop-requested` event payload 形状、release 端与 dev 端行为等价、release-app 内可导出 diagnostic snapshot 的存在与字段。

### Modified Capabilities
<!-- 不修改现有 capability：office-2d-canvas-viewport 仅是顺带保证 DnD 不被尺寸 fix 弄坏，不承接 drop pipeline 契约；本 change 把契约落到独立新 capability，避免冲淡 viewport spec 的 scope。 -->

## Impact

- **Code**:
  - `packages/ui-office/src/components/scene/Office2DCanvasView.tsx`（drop event emit 仍走 `eventBus.emit('employee.workstation.drop-requested')`）
  - `packages/ui-office/src/components/scene/hooks/useCanvasInteraction.ts`（pointer state machine + diagnostic 写入）
  - `packages/ui-office/src/components/scene/office-2d-hitmap.ts`（`hitTestZone` 是 release verify 的关键命中函数，diagnostic 要采它的输出）
  - `packages/ui-office/src/components/scene/use-scene-snapshot.ts`（`dropTargetZoneIds = zones.filter(z => z.deskSlots > 0)` 是嫌疑过滤点）
  - `packages/ui-office/src/lib/seat-registry.ts` / `prefab-spatial.ts`（如根因落在 occupancy / prefab footprint 一侧需要修）
  - 新建一个轻量 `office-2d-drop-diagnostic.ts`（ring buffer + export helper），由 `Office2DCanvasView` 注入进 `useCanvasInteraction`
  - Settings → Runtime（或 Activity Log workspace 一行小入口）暴露 "Export 2D drop diagnostic" 按钮，点击导出最近一次拖拽尝试的 JSON snapshot
- **Events**: `employee.workstation.drop-requested` payload shape 不变；diagnostic snapshot 是新内部观测，不是新外部 event
- **Tests / verify**: 仓库已无产品级自动测试；闭环走 release `.app` live verify（dark+2D + light+2D，每个 theme 至少一次"员工从 zone A 拖到 zone B"成功路径 + diagnostic JSON 导出验证）
- **Dependencies**: 无新外部依赖；不动协议台账（A2A / MCP / Better Auth / Tauri / LangGraph 都不沾）
- **Data / migration**: 不动 schema、不写 migration（沿用 single-baseline schema 口径）
- **CLAUDE.md / MEMORY.md**: archive 时把 backlog "fix-release-employee-card-drop-target（待 propose）" 这条移除；`packages/ui-office/CLAUDE.md` 在 "UI / Scene / 3D" 段新增一行点出 2D drop 契约 SSOT 在 `scene-2d-employee-drop` capability
