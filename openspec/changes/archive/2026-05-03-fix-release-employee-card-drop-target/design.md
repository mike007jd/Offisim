## Context

Office 2D canvas 的 employee→zone drop pipeline 是 Office workspace 主路径之一（用户在画布里把员工节点拖到目标 zone，emit `employee.workstation.drop-requested` event 让 scene-orchestrator 把员工调度到新 workstation）。当前实现链路：

- `Office2DCanvasView.tsx`：mount canvas，挂 pointer handlers，定义 `emitDropOnZone(employeeId, zoneId)` 通过 `eventBus.emit('employee.workstation.drop-requested', ...)` 落地。
- `useCanvasInteraction.ts`：pointer state machine（idle / pending / active），DRAG_THRESHOLD 触发 active phase，pointer-up 时检查 `zoneHit?.type === 'zone' && dropTargetZoneIds.includes(zoneHit.zoneId) && zoneHit.zoneId !== dragEmployee.sourceZoneId`，三条全过才调 `onDropOnZone`。
- `office-2d-hitmap.ts`：`hitTestZone` 用 `zone.x ≤ canvasX ≤ zone.x + zone.w` AABB 命中。
- `use-scene-snapshot.ts`：`dropTargetZoneIds = zones.filter(z => z.deskSlots > 0).map(z => z.zoneId)`。
- 反查 `sourceZoneId`：从 `zoneEmployees` Map（`Map<zoneId, employeeIds[]>`）里反查 employee 当前所在 zone。

2026-05-03 bucket 2a 在 Tauri release `.app` 上 live verify 时发现：dragging an employee node onto the canvas does not form a valid drop target——pan/zoom 视觉与 token 颜色都正常，但 PointerUp 没有触达 `emitDropOnZone`。dev / `vite dev` 模式同代码路径下交互正常。问题与 2D theme token 迁移无关（colors are fine），属于 release-only 行为回归。

三个候选根因（来自 backlog item，非排他）：

1. **DnD handler 注册 / Pointer event 在 Tauri release 下的语义**：`setPointerCapture` / `releasePointerCapture` 在 Tauri 2 webview 上是否丢失捕获导致 PointerUp 不触发，或 `containerRef.current` 在 release production build 下因为 React 19 / strict mode / build splitting 而不稳定。
2. **SeatRegistry / `zoneEmployees` 的 occupancy 数据**：release 端如果 `zoneEmployees` 没构建出来或形状不对，`sourceZoneId` 反查返回空字符串；如果目标 zone 也是空字符串（即所有员工都未在任何 zone），`zoneHit.zoneId !== ''` 仍然 true，理论上不影响；但如果 `dropTargetZoneIds` 因为另一处依赖空数据而为空，会过滤掉所有 drop。
3. **`dropTargetZoneIds` 的 `deskSlots > 0` 过滤**：如果 release 端持久化的 zone records 没有正确 hydrate `deskSlots`（例如 prefab spatial / company-template / migration 链路的某个差异），`zones.filter(z => z.deskSlots > 0)` 返回空数组，`dropTargetZoneIds.includes(...)` 永远 false。

不通过 instrumentation 直接看运行时数据，无法判断哪个是实际根因；盲修任意一个都不可靠（CLAUDE.md "深入追踪后再下结论" / "代码绿 ≠ runtime 绿"）。

## Goals / Non-Goals

**Goals:**

1. 在 release `.app` 上把 drop pipeline 的运行时数据采集进可导出的 diagnostic snapshot，让用户单次复现就能给出充分诊断证据（避免反复 ping-pong）。
2. 基于 snapshot 还原结果定位实际根因，并修到根上——不接受"加一个 fallback 让 drop 通过"的兜底修法。
3. 把 2D canvas employee→zone drop 这条契约固化成显式 capability spec（`scene-2d-employee-drop`），未来回归时有 invariant 兜住，不再依赖人工 live verify 捕捉。
4. release `.app` 上 dark+2D / light+2D 两个 theme 都做闭环 live verify（员工真从 source zone 拖到目标 zone + scene-orchestrator 真路由）。

**Non-Goals:**

1. **不引入员工 list-card → canvas 的跨组件 DnD**：现版本只支持 canvas 内部 employee node drag；外部 list-card drop 是另外的 scope，不在本 change 内做。
2. **不修 3D drop pipeline**：3D 走 `office3d-employees.tsx` + `office3d-sections.tsx` 的 `DragState3D`，是独立代码路径；如果同款回归也存在，单独 change 处理。
3. **不重建产品级自动化测试**：CLAUDE.md Validation Policy 明确不再用 vitest/Playwright/smoke 做产品验收。验证走 live agent 手测 + diagnostic snapshot。
4. **不改 `employee.workstation.drop-requested` 的 event payload shape**：下游 listener 已经吃这个 shape，不动外部契约。
5. **不动 schema / 不写 migration**：沿用 single-baseline schema 口径；如果根因在持久化数据形状，处理路径是修 hydrate 逻辑或 seed，不是改 schema。
6. **不在 Activity Log workspace 持续 log drop attempts**：Activity Log 是 product event timeline，不是 debug telemetry；diagnostic 走独立 ring buffer + 显式 export。

## Decisions

### Decision 1: 在内存 ring buffer + 显式 export，不走 Activity Log / 不持久化 / 不跑网络

**Choice**: 在 `useCanvasInteraction` 内挂一个 module-level ring buffer（cap 10 条），每次拖拽尝试在 PointerDown 创建一条 `DropAttemptDiagnostic` record，PointerMove / PointerUp / cancel 路径增量写入字段，attempt 完结时 freeze。Settings → Runtime tab 加一个 section "2D scene diagnostics"，按钮 "Export last drag attempts as JSON" 调 `office-2d-drop-diagnostic.exportLatest()` 把 buffer 序列化成 JSON 弹出 save dialog（Tauri：`@tauri-apps/plugin-dialog` save → write file；web：`Blob` + `<a download>` fallback）。

**Why**:
- BYO-key + no backend：没有外部上报路径。
- Activity Log 是 product event 流，不是 debug 流；混进 PointerEvent / hitTest 这类细粒度数据会污染 product 视图。
- 用户反馈"诊断要做成 release app 内可导出的证据"——一键导出 JSON 是最低摩擦诊断面。
- Ring buffer 上限 10 条 × 每条 ≤ 4KB = 40KB 内存上限，可忽略。

**Alternatives considered**:
- `console.log` 走 webview devtools：release `.app` 用户开 devtools 摩擦高（mac：右键 inspect 没默认开），且不能复制贴回 issue。
- 持久化到 `appLocalDataDir` 文件：增加 fs 写路径、需要清理；不必要。
- 跑独立 telemetry 端点：违反 BYO-key + no backend 原则。

### Decision 2: Diagnostic instrumentation 是产品能力，fix 完成后保留

**Choice**: 不在修复完成后删 instrumentation。Ring buffer + export button 留在产品里。

**Why**:
- "诊断是产品能力，不是临时调试 print"——下次 drop pipeline 再回归（或被新代码无意改坏）时立即可用。
- 与 superpowers 的 deterministic harness 不重叠：harness 是离线 trace replay 不变量，diagnostic 是线上单次复现的运行时观测。
- 成本极低（~50 LOC + 1 个 settings section）。

**Alternatives considered**:
- 用环境变量门禁（`OFFISIM_DEBUG_DROP=1` 才采集）：用户复现回归时还要先开 flag → 摩擦高、容易漏开。

### Decision 3: 根因调查走"diagnostic → reproduce → fix"，不并行盲修三个候选

**Choice**: 先把 instrumentation 做出来；让用户在 release `.app` 上复现一次（dark+2D 与 light+2D 各一次），导出 JSON；读 JSON 定位实际根因；只修那一条。

**Why**:
- "深入追踪后再下结论"——三个候选都改一遍可能过度修，可能引入新问题。
- "代码绿 ≠ runtime 绿"——三个候选的"修复"如果不靠根因证据，改完还是不能证明问题不在第四处。
- diagnostic JSON 的字段（PointerEvent 流、hitTestZone 命中、`dropTargetZoneIds` 当时值、`sourceZoneId` 反查结果、是否触达 `onDropOnZone`）可以排他性指向某一根因。

**Alternatives considered**:
- "三个都加防御 + tests"：违反"不接受兜底修法"；且没自动测试可加。
- "在 dev tools 远程调试 release `.app`"：可行但需要 webview inspector 开关，且不能给非开发人员复用。

### Decision 4: 新建 capability `scene-2d-employee-drop`，不修改 `office-2d-canvas-viewport`

**Choice**: drop pipeline 契约落到独立新 capability。`office-2d-canvas-viewport` spec 现有的"pan/zoom/DnD 不被尺寸 fix 弄坏"那一句不动，scope 仍只是 viewport sizing。

**Why**:
- viewport spec 的 scope 是 sizing/dpr/pan/zoom，扩到 drop pipeline 会冲淡它的契约边界；下次只想找 drop 契约的人会 confused。
- 新 capability 的 scope 紧凑（pointer state machine + drop event emission + diagnostic），便于未来再扩展（比如 3D drop、外部 list card drop）时分别加 capability，不挤进同一个 spec。

**Alternatives considered**:
- 修改 `office-2d-canvas-viewport` 加 drop 段：scope 漂移。
- 修改 `scene-orchestrator-boundaries`：scene-orchestrator 是 drop event 的下游消费者，不是 emit 链路本身；不应该被牵连。

### Decision 5: Diagnostic snapshot 字段最小化 + employee 名称 redaction

**Choice**: snapshot 仅采用 `employeeId` / `zoneId` / `phase` / `timestamp` / `screenXY` / `canvasXY` / `hitResult` / `dropTargetZoneIds` snapshot / `sourceZoneId` / `emittedDropEvent: boolean`。**不**采集 employee 真实姓名 / persona / appearance。

**Why**:
- 用户可能贴 JSON 到第三方 issue tracker；最小化 PII。
- 根因调查只需要 ID 级数据；姓名对定位无帮助。

## Risks / Trade-offs

- **[Diagnostic snapshot 在 fix 后忘记真正用上]** → Mitigation: tasks.md 把"用 diagnostic 还原"作为强制 task；不直接跳到"修候选 1/2/3"。
- **[Tauri export save dialog 与 web Blob fallback 行为不一致]** → Mitigation: 共享一个 `exportJsonText(filename, json)` helper，Tauri 路径用 `tauri-plugin-dialog` 的 `save()` + `tauri-plugin-fs` 的 `writeTextFile`；web 走 `Blob + URL.createObjectURL + <a download>`。两条都是已经在 repo 里用过的模式（参考 deliverable export 路径）。如果 Tauri capabilities 没开 `dialog:save` 或 `fs:write`，要在 `apps/desktop/src-tauri/capabilities/default.json` 同 change 内补；同款 fs/dialog/opener 三件套 gotcha。
- **[根因实际跨多处（不止一个）]** → Mitigation: spec 用「pipeline 全链路最终行为」断言（drop event SHALL emit 当且仅当条件满足），不是单点断言；如果实际有两条根因 co-conspire，fix 都改，spec scenarios 的 union of conditions 都覆盖。
- **[release 端 vs dev 端的 PointerEvent 行为差异不再可重现]** → Mitigation: 修复完成后保留 diagnostic instrumentation；下次回归直接复用，不需要重建一套观测层。
- **[新 capability spec 与既有 spec 文案重叠]** → Mitigation: 在 `scene-2d-employee-drop` spec 顶部明确指出 "viewport sizing 由 `office-2d-canvas-viewport` 管，drop pipeline 由本 capability 管"，避免读者迷路。
- **[diagnostic instrumentation 引入新 bug，反而干扰 drop pipeline]** → Mitigation: ring buffer 写入是纯副作用（不影响 phase 判断、不影响 emit 决策），phase machine 已有逻辑保持原样；instrumentation 在 try/catch 包裹（采集失败不影响主路径）。

## Migration Plan

- 无 DB migration（沿用 single-baseline schema）。
- 无外部协议同步（不动 A2A / MCP / Better Auth / Tauri / LangGraph 协议台账）。
- 部署：build → release `.app` 验证 → 无问题即可。
- Rollback：commit revert（diagnostic + fix 都是新增/修改文件，无 destructive 改动）。

## Open Questions

1. **dark+2D 是否同步回归？** bucket 2a archive 只确认 light+2D 失败，dark+2D 没显式拖。**Resolution**: 在 instrumentation 落地后，让用户在 dark+2D 也跑一次复现 → 两条 JSON 都给出。如果 dark 路径正常，缩窄根因到 light theme path（不太可能因为 colors 与 drop 逻辑无关，但要确认）。
2. **是否需要在 2D canvas 表面提示 "drop 失败" 用户态？** 当前实现 PointerUp 静默 cancel——用户不知道为什么没生效。**Resolution**: 不在本 change 内加用户提示（scope 控制）；先把根因定掉。如果未来需要 surface "drop 不允许（zone 满 / zone 同 source）" 提示，开新 change。
3. **diagnostic export 按钮最终位置**：默认放 Settings → Runtime → "2D scene diagnostics" section。如果 user 觉得藏太深，可挪到 Activity Log workspace 顶部 utility bar。**Resolution**: 先 Settings → Runtime；archive 时基于 verify 反馈定。
