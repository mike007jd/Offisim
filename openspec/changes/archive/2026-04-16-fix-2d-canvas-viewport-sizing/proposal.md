## Why

切换到 2D office view 后，canvas 内容明显只占容器左上一小块（大概 30% 宽 × 25% 高），右/下大量黑底空白。

**初始诊断（保留作历史）**：怀疑 `Office2DCanvasView.tsx:515-522` 的 initial sizing effect 读到 mount 瞬间的 stale rect，导致 `computeFitViewport` 用偏小输入算出偏小 scale，被 ResizeObserver `preserveViewportOnResize` 固化。

**Apply 阶段 live 采样修正根因**（2026-04-16）：
- container=1200×766，canvas attr=2400×1532（= container × dpr=2），初始 rect 一直是对的
- ResizeObserver first-entry `contentRect = 1200×766`，`computeFitViewport` 返回 scale≈0.47、x=130、y=30 也都对
- 但 canvas 像素采样显示 scene 只画到 (0,0)–(1070,735) 像素范围，右下 alpha=0 全透明

真正根因在 `office-2d-canvas-renderer.ts` 的 renderer pipeline **完全丢失 dpr 补偿**：
- `drawBackground(ctx, canvasWidth, canvasHeight)`（line 131-139）第一行 `ctx.resetTransform()` 抹掉 caller 在 rAF loop 里设的 `ctx.setTransform(dpr, 0, 0, dpr, 0, 0)`，然后用 CSS 尺寸 (1200×766) 当像素画，只覆盖 canvas 左上 CSS-sized 矩形
- `drawScene` line 707 `ctx.setTransform(viewport.scale, 0, 0, viewport.scale, viewport.x, viewport.y)` 也不含 dpr，scene 在 viewport.scale=0.47 下画，有效尺寸 = container × scale / dpr ≈ 容器 23.5%，恰好吻合"30% × 25%"观察
- dpr=1 显示器不会暴露这个 bug，dpr=2 Retina 一直破相

原 sizing 路径合并（initial sizing effect + ResizeObserver 两条合并成 first-entry fit）结构上仍有重构价值，本 change 合并保留，但**不解决 scene 偏小**；真正 fix 需要在 renderer pipeline 加 dpr-aware setTransform。

产品层面影响：2D view 目前是浏览器用户看到的"破相"第一眼，和 memory 里记录的 "2D canvas migration — started but not fully product-closed" 强相关。修掉是 2D 路径 product closure 的必过关卡。

## What Changes

- **（view 层 sizing 重构，原 scope）** initial sizing effect 和 ResizeObserver 合并：删除独立 `useEffect` initial sizing，由 ResizeObserver first-entry 唯一触发 `computeFitViewport`；新增 `hasInitialSizedRef` 标记；rAF loop 加零尺寸守卫
- **（renderer dpr 补偿，本 apply 阶段扩入）** `office-2d-canvas-renderer.ts` 的 `drawBackground` + `drawScene` pipeline 改成 dpr-aware：不再 `resetTransform` 后按 CSS 尺寸填矩形，而是所有 setTransform 都乘入 dpr，让 ROOM 坐标系正确映射到 canvas 实际像素
- acceptance：2D view mount 后首帧 canvas 内容即填满可用容器（scene 覆盖 ≥ ~47% × ~47% 容器中央区域，对应 FIT_MARGIN 下 ROOM 铺满后的居中框）；3D↔2D 来回切换多次不退化；pan/zoom 保留；DPR=2 显示器不再出现右下透明区

## Capabilities

### New Capabilities
- `office-2d-canvas-viewport`: 2D 办公室 canvas 的视口初始化与响应式尺寸管理 —— 保证 fit viewport 用的是稳定 container 尺寸，而不是 mount-瞬间 rect

### Modified Capabilities
(无 — 不改 `avatar-seed-resolution` / `plan-step-store` / `typed-json-field-parsers` / `unified-shell-routing` / `workspace-state-management` 任何已有 canonical spec)

## Impact

- `packages/ui-office/src/components/scene/Office2DCanvasView.tsx` — 合并 initial sizing 路径 + ResizeObserver first-entry fit + rAF 零尺寸守卫（约 +10/-15 行）
- `packages/ui-office/src/components/scene/office-2d-canvas-renderer.ts` — `drawBackground` + `drawScene` setTransform 加入 dpr 补偿（约 +6/-3 行）；`drawScene` 签名增加一个 `devicePixelRatio` 参数
- 不触：`SceneCanvas.tsx`（宿主容器）/ `Office3DView.tsx` / 3D 渲染路径 / 布局 tokens / AppLayout
- 不触：`computeFitViewport` / `preserveViewportOnResize` 纯函数本身的数学（已 verified 正确）
- 验证：live Playwright 切 3D→2D 看首帧填满 + 切回 3D + 再切 2D 两次不退化；用 canvas 像素采样确认 dpr=2 下右下角不再透明
