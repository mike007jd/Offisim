## Why

`Office2DCanvasView.tsx`（963 行）+ `office-2d-canvas-renderer.ts`（753 行）= 1716 行堆在一个渲染回路里。`drawScene` 已经是 7 层顺序绘制（clear → grid → zones → zone labels → prefabs → employee desks → employee nodes），但全部在单个 function body 里；`Office2DCanvasView` 组件同时做 viewport state / rAF loop / click & drag handler / SeatRegistry build / employee placement 派生。改任何一层（e.g. 给 ceremony phase 加可视化）都要在 963 行 view + 753 行 renderer 里来回跳。收完能直接解锁 defer 队里的 "2D canvas polish"。

## What Changes

- **Renderer 按层拆** (`components/scene/canvas-layers/` 子目录)：
  - `draw-background.ts`（clear + floor grid）
  - `draw-zones.ts`（zone fill + stroke + label）
  - `draw-prefabs.ts`（prefab silhouettes via render registry）
  - `draw-employees.ts`（desk backgrounds + avatar + status ring + name label）
  - `draw-ceremony.ts`（phase color overlay + meeting bubble + waiting relationships）
  - `draw-interactions.ts`（hover / selection / interaction hold indicators）
  - `draw-drag-overlay.ts`（drag preview + snap guides）
- **`office-2d-canvas-renderer.ts` 瘦成 thin orchestrator**：按既有 draw order 依次调用 layer，≤ 200 NBNC。`STATUS_COLORS` / `getStatusColor` / 各 layer 共用的 `SceneSnapshot` 等 type 继续从 renderer 导出（再 re-export 防消费者改 import）。
- **View 按责拆 hook** (`components/scene/hooks/` 子目录)：
  - `useCanvasViewport.ts` — pan / zoom / transform matrix
  - `useCanvasRedrawLoop.ts` — `needsRedraw` ref + rAF loop + drawScene 调用
  - `useCanvasInteraction.ts` — pointer events → hit test → select / drag
- **`Office2DCanvasView.tsx` 瘦成 composition barrel**：≤ 250 NBNC，只做 useMemo 派生 + 3 个 hook 调用 + canvas ref 挂载 + `<canvas>` + 文字 overlay DOM。
- **可观测行为不变**：同 prompt + 同员工 + 同 zone 下，rAF frame 的每层绘制 byte-identical；rendering 性能不降低（各层可独立 memo dirty-check）。

## Capabilities

### New Capabilities

（无）

### Modified Capabilities

- `office-2d-canvas-viewport`: 新增 3 条 requirement（layered renderer 结构 / 拆分 view hook / 可观测行为 byte-identical）+ 保留现有 5 条 requirement 不动。

## Impact

- **目录新增**：`packages/ui-office/src/components/scene/canvas-layers/{draw-background,draw-zones,draw-prefabs,draw-employees,draw-ceremony,draw-interactions,draw-drag-overlay}.ts` + `components/scene/hooks/{useCanvasViewport,useCanvasRedrawLoop,useCanvasInteraction}.ts`
- **文件重写**：`office-2d-canvas-renderer.ts` 753 → ≤ 200；`Office2DCanvasView.tsx` 963 → ≤ 250
- **消费者无改动**：`Office2DCanvasView` default export 不变；`STATUS_COLORS` / `drawScene` re-export 防 import 破坏（其实 consumer 只 import view，不 import renderer 内部函数）
- **验证**：live runtime 打开 2D view，观察 ceremony 全链路（gathering → working → reporting）视觉与重构前 byte-identical，pan/zoom/click 交互一致
- **无依赖升级 / 无 API 断裂 / 无 DB migration**
