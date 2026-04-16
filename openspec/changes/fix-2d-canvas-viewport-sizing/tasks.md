## 1. Live 复现 + 抓测量数据

- [ ] 1.1 确认 dev server 状态：`lsof -ti :5176` — 若无进程：`pnpm --filter @offisim/web dev` 后台启动；若有，直接用现存实例
- [ ] 1.2 用 Playwright MCP 打开 `http://localhost:5176`；等 3D office 渲染完成（Team panel 可见 + status bar `Ready`）
- [ ] 1.3 点击 header 上 `2D` 按钮切到 2D 视图；截图 + 快照
- [ ] 1.4 用 `browser_evaluate` 跑下面脚本抓 container 与 canvas 的真实尺寸，把输出贴进 design.md `## Open Questions` 下方或在 tasks.md 该步骤下方补一条 "observed:":

```js
() => {
  const canvas = document.querySelector('canvas[aria-label="2D office layout"]');
  const container = canvas?.parentElement;
  if (!canvas || !container) return { error: 'not found' };
  const cRect = container.getBoundingClientRect();
  const canvasRect = canvas.getBoundingClientRect();
  return {
    container: { w: cRect.width, h: cRect.height },
    canvasBox: { w: canvasRect.width, h: canvasRect.height },
    canvasAttr: { w: canvas.width, h: canvas.height },
    dpr: window.devicePixelRatio,
  };
}
```

- [ ] 1.5 如果 `container.w/h` 与 `canvasBox.w/h` 大致相等（意味着容器是对的、scene 内容被画小了），根因 = `computeFitViewport` 输入偏小；如果 `container.w/h` 远大于 `canvasBox.w/h`（容器满、canvas 元素小），根因 = canvas 属性 w/h 被错写。把结论记下来作为 Task 2 的分支依据。

## 2. 代码修改（严格按 design.md 的 D1/D2/D3/D4）

- [ ] 2.1 打开 `packages/ui-office/src/components/scene/Office2DCanvasView.tsx`
- [ ] 2.2 **D1 + D3**：删除 line ~515-522 的独立 initial sizing effect（`useEffect(() => { const container = containerRef.current; ...; viewportRef.current = computeFitViewport(rect.width, rect.height); ... }, [])`）
- [ ] 2.3 在 ResizeObserver effect 里新增 `const hasInitialSizedRef = useRef<boolean>(false);`（在同一 component scope 内，放在其他 ref 旁）
- [ ] 2.4 **D2**：改 ResizeObserver callback（约 line ~530-549）。伪代码：

```tsx
const observer = new ResizeObserver((entries) => {
  if (!mountedRef.current) return;
  const entry = entries[0];
  if (!entry) return;
  const { width, height } = entry.contentRect;
  if (width <= 0 || height <= 0) return; // defensive — skip zero-size callbacks
  const dpr = window.devicePixelRatio || 1;
  canvas.width = width * dpr;
  canvas.height = height * dpr;
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;

  if (!hasInitialSizedRef.current) {
    viewportRef.current = computeFitViewport(width, height);
    hasInitialSizedRef.current = true;
  } else {
    viewportRef.current = preserveViewportOnResize(
      viewportRef.current,
      containerSizeRef.current.width,
      containerSizeRef.current.height,
      width,
      height,
    );
  }
  containerSizeRef.current = { width, height };
  needsRedrawRef.current = true;
});
```

- [ ] 2.5 **D3**：删除 line ~552-559 的 manual initial sizing（`const rect = container.getBoundingClientRect(); ...; canvas.width = rect.width * dpr; ...`）。只保留 `observer.observe(container)` 和 cleanup `observer.disconnect()`。
- [ ] 2.6 确认 `containerSizeRef` 的初值仍是 `{ width: 0, height: 0 }`（mount 时）—— 不用改，D1 已经把唯一写入点收敛到 observer callback
- [ ] 2.7 （可选，防御）在 rAF loop 里的 `drawScene` 调用前加 `if (canvas.width === 0 || canvas.height === 0) { rafIdRef.current = requestAnimationFrame(loop); return; }` 以防 observer 首次回调晚于首次 rAF（现实中不会发生，但加上成本几乎为零）

## 3. 构建校验

- [ ] 3.1 串行跑：`pnpm --filter @offisim/shared-types build && pnpm --filter @offisim/ui-core build && pnpm --filter @offisim/core build && pnpm --filter @offisim/ui-office build && pnpm --filter @offisim/web typecheck` 全绿
- [ ] 3.2 `pnpm lint` 通过

## 4. Live 验证（Playwright）

- [ ] 4.1 dev server 重启（`kill` 旧的，清 `apps/web/node_modules/.vite`，`pnpm --filter @offisim/web dev` 新起）
- [ ] 4.2 Playwright 开 `http://localhost:5176`，等 3D 就绪
- [ ] 4.3 点击 `2D` 按钮。等 500 ms。重跑 Task 1.4 的测量脚本。acceptance：`canvasAttr.w === container.w * dpr`（容差 ±1px），`canvasAttr.h === container.h * dpr`（容差 ±1px），scene 视觉上填满（截图对比 Task 1.3 应显著变大）
- [ ] 4.4 点击 `3D` 回到 3D，等稳定；再点 `2D`。重跑测量。容差同上。
- [ ] 4.5 重复 4.4 三次（3D↔2D 共 3 个 round-trip），每次 2D 都测 + 截图；acceptance：不退化
- [ ] 4.6 在 2D 里用 wheel 缩放一次（确认 `applyWheelZoom` 还工作），再 pan 拖一次（确认 `applyPan` 还工作）；截图
- [ ] 4.7 在 2D 里手动缩放浏览器窗口（用 Playwright `browser_resize`，宽度从 1200 改到 800 再回 1200），观察：pan/zoom 保持，canvas 仍填满容器
- [ ] 4.8 清理：kill dev server，删 Playwright verify-*.png 截图（`rm -f verify-*.png`），不进仓

## 5. Commit + 收尾

- [ ] 5.1 `git status --short` 确认只有 `packages/ui-office/src/components/scene/Office2DCanvasView.tsx` 一个改动（+ openspec change 目录）
- [ ] 5.2 `git diff packages/ui-office/src/components/scene/Office2DCanvasView.tsx` 目视 review：只改了 initial sizing effect 删除 + ResizeObserver callback 重写 + 新 `hasInitialSizedRef`；没有误改交互 handler、drawScene 调用、rAF loop 主体逻辑
- [ ] 5.3 commit message 建议：`fix(ui-office): 2D canvas fits container on first visible frame`，body 解释"合并两条 initial sizing 路径，改由 ResizeObserver first entry 触发 fit viewport，后续 resize 保 pan/zoom"
- [ ] 5.4 `/opsx:archive fix-2d-canvas-viewport-sizing` 时选 Sync now，让 `openspec/specs/office-2d-canvas-viewport/spec.md` 落地
