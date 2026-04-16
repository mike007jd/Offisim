## Why

切换到 2D office view 后，canvas 内容明显只占容器左上一小块（大概 30% 宽 × 25% 高），右/下大量黑底空白。live 证据：2026-04-16 Playwright 会话 `verify-office-2d.png`（文件已删，复现步骤见 tasks.md）。容器本身的 CSS 链路是干净的 —— `Office2DCanvasView.tsx` 根节点 `w-full h-full`，祖先 `SceneCanvas` 里是 `absolute inset-0`——所以根因不在容器 CSS，而在 canvas **尺寸测量 + fit viewport 计算**：

- `Office2DCanvasView.tsx:515-522` 的 initial sizing effect 用空依赖 `[]`，只在 mount 瞬间跑一次 `container.getBoundingClientRect()`，读到的 rect 可能是 **layout 尚未稳定** 的中间尺寸（父层 flex/grid 还没完成 pass，或 `hasMounted2D` 刚从 false 翻到 true 时）
- `computeFitViewport(containerWidth, containerHeight)` 直接用初始 rect 算 `scale = min(w/2000, h/1500) * 0.92` —— 如果初始 w/h 偏小，后续 scale 永远保留那个小值
- `ResizeObserver` 初始触发只调用 `preserveViewportOnResize`（line 540）保现有 pan/zoom，不会重 `computeFitViewport`；所以**错的初始 scale 会被后续 resize 原样继承**

产品层面的影响：2D view 目前是浏览器用户看到的"破相"第一眼，和 memory 里记录的 "2D canvas migration — started but not fully product-closed" 强相关。这个 bug 修掉是 2D 路径 product closure 的一个必过关卡。

## What Changes

- 让 2D canvas 在 container 第一次真实 layout 完成后再计算 `computeFitViewport`（不再依赖可能 stale 的 initial `getBoundingClientRect`）
- initial sizing 和 ResizeObserver 两条路径合并或对齐时序，避免初始 rect 和 observer first entry 两次错开 fit viewport
- ResizeObserver 的 first entry 语义从"一律 preserve"改成"第一次是 fit，之后才 preserve"
- acceptance：2D view mount 后首帧 canvas 内容即填满可用容器；3D↔2D 来回切换多次不退化；pan/zoom 保留

## Capabilities

### New Capabilities
- `office-2d-canvas-viewport`: 2D 办公室 canvas 的视口初始化与响应式尺寸管理 —— 保证 fit viewport 用的是稳定 container 尺寸，而不是 mount-瞬间 rect

### Modified Capabilities
(无 — 不改 `avatar-seed-resolution` / `plan-step-store` / `typed-json-field-parsers` / `unified-shell-routing` / `workspace-state-management` 任何已有 canonical spec)

## Impact

- `packages/ui-office/src/components/scene/Office2DCanvasView.tsx` — 修改 initial sizing effect + ResizeObserver 初始触发逻辑（预计 +20/-15 行）
- `packages/ui-office/src/components/scene/office-2d-canvas-geometry.ts` — 可能新增一个 `isFirstResize` 分支的辅助；或不改，全部改落在 view 层（由 design 决策）
- 不触：`SceneCanvas.tsx`（宿主容器）/ `Office3DView.tsx` / 3D 渲染路径 / 布局 tokens / AppLayout
- 不触：`computeFitViewport` 纯函数本身的数学（已 verified 正确）
- 验证：live Playwright 切 3D→2D 看首帧填满 + 切回 3D + 再切 2D 两次不退化
