## Context

2026-04-14 起 2D scene 主路径从 SVG 切 canvas（SVG 路径已删）。当前 `Office2DCanvasView` + `office-2d-canvas-renderer` 是 canvas 主渲染的唯一实现。MEMORY 里 "2D canvas polish" 在 defer 段——原因之一就是 963+753 行双文件改任何一处都要读完整个渲染回路。Round 1 D 系列清掉了 `useSceneOrchestrator` 的 orchestrator 层，但 canvas 绘制这一层从未按责拆。

既有 canonical spec `office-2d-canvas-viewport`（5 requirement / 10 scenario）锁定了：canvas fills container / Retina dpr 补偿 / resize 重绘 / 单 rAF / drawScene 入口。本 change 是 **MODIFY**——在 5 条基础上新增 3 条关于"分层 + 拆 view"的 requirement，不改已有契约。

## Goals / Non-Goals

**Goals:**

- renderer 按 draw order 拆 7 个 layer 文件，每层 ≤ 200 NBNC
- `office-2d-canvas-renderer.ts` 变 thin orchestrator，≤ 200 NBNC
- `Office2DCanvasView.tsx` 变 composition barrel，≤ 250 NBNC
- 3 个 view hook 各自单一责任
- 所有可观测视觉 byte-identical

**Non-Goals:**

- 不改 draw order（back-to-front 7 层顺序保持）
- 不改 Retina dpr / fills container / single rAF 既有 5 条 requirement
- 不做 layer-level dirty tracking 优化（留给 "2D canvas polish" 独立 change）
- 不动 `office-2d-canvas-geometry.ts` / `office-2d-render-registry.ts` / `office-2d-avatar-cache.ts` 既有辅助

## Decisions

### D1. Layer 目录：`components/scene/canvas-layers/`

**选择**：7 个 layer 文件落 `components/scene/canvas-layers/`。

**理由**：现有 `components/scene/` 已有 `office-2d-canvas-renderer.ts` / `office-2d-canvas-geometry.ts` / `office-2d-render-registry.ts` / `office-2d-avatar-cache.ts` 四个 canvas 辅助文件，再加 7 个 layer 平摊会让目录膨胀；`canvas-layers/` 子目录聚合 drawing-only 文件，语义清晰。

**不选**：平摊进 `components/scene/`——文件数过多；`lib/canvas-layers/`——drawing 贴着 scene 组件，跨包移位增加 import 深度。

### D2. Layer 函数签名统一：`drawLayer(ctx, snapshot, transform)`

**选择**：每个 layer 导出 `drawBackground(ctx, snapshot, transform)` / `drawZones(ctx, snapshot, transform)` / ... 统一签名。`SceneSnapshot` / `ViewportTransform` 仍然从 renderer 导出（renderer orchestrator re-export 给消费者）。

**理由**：统一签名让 orchestrator 的 7 行 dispatch `drawBackground(ctx, s, t); drawZones(ctx, s, t); ...` 顺序清晰；每 layer 独立可 benchmark / 独立 skip（如果将来做 dirty tracking）。

**不选**：factory pattern `createBackgroundDrawer(opts)`——每帧重建 closure 有开销；当前无 layer-level state。

### D3. `drawScene` 保留为 orchestrator 的唯一 public API

**选择**：renderer 文件继续导出 `drawScene(ctx, snapshot, transform)`，函数体变成顺序调用 7 个 layer。`STATUS_COLORS` / `getStatusColor` / type exports 继续从 renderer 出。

**理由**：消费者只 import `drawScene`，orchestrator 变化对外不可见；内部拆分不破坏 consumer contract。

### D4. View hook 划分：viewport / redraw / interaction

**选择**：
- `useCanvasViewport()` — pan + zoom + transform matrix（拥有 `{ transform, setTransform, onZoomIn/Out, onReset, onPan }`）
- `useCanvasRedrawLoop({ canvasRef, snapshotRef, transform })` — 单 rAF + `needsRedraw` ref + drawScene 调用
- `useCanvasInteraction({ canvasRef, snapshot, transform, onSelect, onDragStart/Move/End })` — pointer events → hit test

`Office2DCanvasView` barrel：`const viewport = useCanvasViewport()` → `const snapshot = useMemo(() => build(...), [...])` → `useCanvasRedrawLoop({ canvasRef, snapshotRef, transform: viewport.transform })` → `useCanvasInteraction({ canvasRef, snapshot, transform: viewport.transform, ... })`。

**理由**：redraw loop 只需要 snapshot + transform 的 ref 快照；interaction 只需要当前 snapshot + 事件回调；viewport transform 独立可测。三 hook 无互相 import。

### D5. Snapshot 构建留在 barrel

**选择**：`SceneSnapshot`（zones + prefabs + employees + ceremony + manager + interactions）构建仍在 `Office2DCanvasView` 的 `useMemo` 里，入 barrel 的 ≤ 250 NBNC 预算。

**理由**：snapshot 构建需要 `useCompanyZones` / `useAgentStates` / `usePrefabInstances` / `useOffisimRuntime` 多个 context 读取——这些 React hook 必须住组件 body。抽成独立 hook 等于换个名字，没减低复杂度。

### D6. Canvas ref 挂载保持现状

**选择**：`<canvas ref={canvasRef}>` JSX 保持在 barrel；redraw loop 通过 `canvasRef.current?.getContext('2d')` 拿 ctx，不抽额外 canvas-provider component。

**理由**：canvas ref 是 barrel 的 root 资源，跨 hook 传 ref 足够；引 provider component 反增 JSX 层级和 ref forward 成本。

## Risks / Trade-offs

- **风险：层间共享常量漂移**→ `STATUS_COLORS` / `EMPLOYEE_RADIUS` 等常量从 renderer 或 geometry 模块导出，每层 import 同源，不在 layer 内内联 magic number。
- **风险：dpr 补偿被拆散**→ dpr scaling 在 orchestrator `drawScene` 入口做一次（`ctx.save() + ctx.scale(dpr, dpr)`），layer 内不感知 dpr。既有 `office-2d-canvas-viewport` spec 的 dpr scenario 保证不漏。
- **风险：interaction hit-test 精度**→ hit test 用 snapshot 里的 employee / zone 几何坐标（未 transform），与 viewport transform 互操作由 `useCanvasInteraction` 独立处理。拆分前后逻辑等价。
- **风险：live verify 覆盖**→ 必须覆盖：ceremony 全链路视觉、pan/zoom、employee click select、prefab hover。以重构前的录屏/截图作 reference。
- **Trade-off：文件数增加**→ 渲染从 2 文件变 11 文件（7 layer + 1 renderer orchestrator + 3 hook）。换来单文件 ≤ 200/250 行，后续 polish 改单层不用读全链。
