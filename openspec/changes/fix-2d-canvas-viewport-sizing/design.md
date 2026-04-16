## Context

**现状代码**（`Office2DCanvasView.tsx`，行号基于 commit `e900626` 当时状态）：

- **line 515-522**: initial sizing effect。空依赖 `[]`，读 `container.getBoundingClientRect()` → 写 `containerSizeRef` + `viewportRef`（via `computeFitViewport`） + `needsRedrawRef`。只在 component mount 时执行一次。
- **line 524-564**: ResizeObserver effect。空依赖 `[]`。
  - observer callback（line 530-549）：读 `entry.contentRect`，写 `canvas.width/height` + `canvas.style`，调 `preserveViewportOnResize` 保 pan/zoom，更新 `containerSizeRef`
  - 手动 initial sizing（line 552-559）：在 observer 注册之后再 `getBoundingClientRect()` 写一次 canvas 尺寸和 `containerSizeRef`（但不碰 `viewportRef`）
- `computeFitViewport(w, h)`（geometry module）：纯函数，`scale = min(w/2000, h/1500) * 0.92`，centered。数学正确。
- `preserveViewportOnResize(prev, prevW, prevH, nextW, nextH)`: 纯函数。`if (prevW <= 0 || prevH <= 0) return computeFitViewport(nextW, nextH)` —— 有零宽/零高 fallback，但只有 prev 为 0 才触发。如果 initial sizing 拿到了一个正数但偏小的 rect，之后 prev 永远 > 0，再不会走 fit 分支。

**SceneCanvas 宿主**（`SceneCanvas.tsx`）：
- 最外层 `<div className="h-full w-full overflow-hidden bg-surface relative">`
- 2D 容器 `<div className="absolute inset-0 ... opacity-100">` 只在 `hasMounted2D` 为 true 时渲染 children
- `hasMounted2D = useState(viewMode === '2D')`：首次进入时如果 viewMode='3D'，2D 不 mount；用户切到 2D 时才 `setHasMounted2D(true)`

**最可能的失效链路**：

1. 用户初始是 3D mode。`hasMounted2D = false`，Office2DCanvasView 未 mount。
2. 用户点击 2D 按钮 → `effectiveViewMode = '2D'` → useEffect 触发 `setHasMounted2D(true)` → React commit → Suspense 加载 lazy module → Office2DCanvasView mount。
3. Office2DCanvasView mount 的那一帧，DOM 刚插入，浏览器尚未完成 full layout。`useEffect` 跑在 commit 之后、paint 之前。初始 sizing effect (line 515) 读 `containerRef.current.getBoundingClientRect()` —— **这里可能读到尚未完成的布局尺寸**。
4. 即便读到正确尺寸，还有另一条竞态：ResizeObserver effect (line 524) 也要跑初始 sizing (line 552-559)，它读了一次 `getBoundingClientRect` 但**没有** re-compute viewport —— 所以如果 line 515 和 line 552 两次 rect 不一样（极少见但可能），viewportRef 会基于 line 515 的 rect，canvas width/height 会基于 line 552 的 rect，rects 不匹配 = 画面偏小。
5. 此外 ResizeObserver **首次回调** 也可能在 mount 后不久触发（标准行为：observe 后总会同步或异步触发一次），callback 里走 `preserveViewportOnResize`。如果这次 preserve 是从"错的初始 scale"开始的，问题被永久固化。

**Live 证据**：切到 2D 后 canvas 内容 ~30% 宽 × ~25% 高，说明 initial scale 大约被算成 `min(container.w * 0.3 / 2000, container.h * 0.25 / 1500) * 0.92` 左右 —— 等价于初始 rect 大概是实际容器的 30% 大小。很可能 mount 瞬间 rect 是某个动画中间态（opacity 转换完成前？flex layout first pass？）。

## Goals / Non-Goals

**Goals:**

- 2D canvas mount 后首个稳定帧 canvas 已填满 container，不再需要用户手动 resize / pan / zoom 纠正
- 切换 3D ↔ 2D 多次（≥ 3 轮）不退化
- 保留现有 pan / zoom / drag / wheel 交互完全不动
- 修复锁定在 view 层 + 几何 helper 层，不触 SceneCanvas / 3D / AppLayout
- 给 view 层一个清晰的 "first-fit" vs "preserve-on-resize" 状态机，把两条 initial sizing 路径合并成一条

**Non-Goals:**

- 不修 SceneCanvas 的宿主布局、不引入新 breakpoint
- 不改 3D canvas 路径（它用的是 R3F，Three.js 自己管 sizing）
- 不改 `computeFitViewport` 的纯函数数学
- 不改 `preserveViewportOnResize` 的 pan/zoom preserve 语义
- 不改 device pixel ratio 处理
- 不解决 2D 跨 workspace 切换后的 pan/zoom 持久化（那是另一个 open issue）

## Decisions

### D1: 用 ResizeObserver first-entry 作为初始 sizing 的权威源

**选择**: 移除 line 515-522 的独立 initial sizing effect。把初始 sizing 完全交给 ResizeObserver effect（line 524），在 observer callback 里用一个 `hasInitializedRef` 标记判断是否首次回调，**首次走 `computeFitViewport` + 写 canvas size，之后才走 `preserveViewportOnResize`**。

**理由**:
- ResizeObserver 规范保证 `observe()` 后总会异步触发一次 first entry（即便尺寸没变），所以把 fit viewport 的时机延后到 first entry 比"mount 瞬间手动测量"更可靠
- 合并两条初始 sizing 路径 → 消除 `viewportRef` 用 rect A、canvas.width 用 rect B 的潜在不一致
- ResizeObserver callback 里的 `contentRect` 比 `getBoundingClientRect` 更适合做 layout 测量（contentRect 扣掉 padding/border、同步于浏览器真实 layout 完成时间点）

**备选**:
- 用 `useLayoutEffect` 代替 `useEffect` 做 initial sizing。否决：即便在 layout effect 里读 rect，如果父层用了 `absolute inset-0` 而祖先还在 transition 中，`useLayoutEffect` 读的也是 transition 中间态。ResizeObserver 才是"等浏览器说尺寸稳定了"的机制。
- 在 `useEffect` 里 `requestAnimationFrame` 两次再测。否决：脆弱，依赖 frame 时序假设；不同浏览器/DPR 行为不一。

### D2: 首次 resize 语义改为 "fit"，后续保持 "preserve"

**选择**: 在 `office-2d-canvas-geometry.ts` 新增（或在 view 层本地保留）一个布尔 `isFirstSizing`。如果 true，callback 调 `computeFitViewport` 写 `viewportRef`；调完置 false，之后所有 resize 走 `preserveViewportOnResize`。

**理由**:
- 语义清晰：首次 fit 是"我还没布好"的兜底，后续 preserve 是"用户可能已经 pan/zoom 过"的保守
- 副作用局限：只在 `viewportRef` 被初次写入时触发，不影响后续用户操作
- 由 view 层持有该 flag 不污染纯函数 `preserveViewportOnResize` 的数学

**备选**:
- 扩 `preserveViewportOnResize` 接受一个 `isFirst` 参数。否决：让纯几何函数承担状态语义，职责混乱。
- 让 view 层每次 mount 就直接 `computeFitViewport`。否决：切 3D→2D→3D→2D 时，第二次进入 2D 如果希望保留上次 pan/zoom，语义就错了；但这个场景不在本 change scope 内，保持 first-fit 行为安全。

### D3: 把 ResizeObserver effect 里的 manual initial sizing (line 552-559) 移除

**选择**: 删除 line 552-559 的 `getBoundingClientRect` + 手动写 canvas width/height / containerSizeRef。所有初始尺寸走 observer callback 的 first entry 路径统一处理。

**理由**: 既然 D1 已经保证 observer first entry 会带来正确的 `contentRect` 并写 canvas.width/height，再手动读一次 rect 没有增量价值，只会增加"读两次 rect 得到不一致值"的风险。

**备选**: 保留 manual initial sizing 作兜底。否决：ResizeObserver 是标准 API，浏览器支持率高（Chromium/Firefox/Safari 全覆盖）；加了兜底反而掩盖真实 bug。

### D4: 不动 `isFirstResize` 是否 persist 到 ref/ 状态

**选择**: 用 `useRef<boolean>(true)`（不是 state），callback 内手动切 false。不触发 re-render。

**理由**: 这个 flag 只是生命周期内的一次性开关，不需要 React 感知。用 state 只会引入无意义的 re-render。

### D5: Renderer pipeline 加 dpr 补偿（apply 阶段扩入）

**背景**：Apply 阶段 live 采样发现 sizing 修好后 scene 依然只占 canvas 左上 1/4，根因是 `office-2d-canvas-renderer.ts` 的 `drawBackground` 和 `drawScene` 都忽略 dpr。具体：

- `drawBackground`（line 131-139）：`ctx.resetTransform()` 抹掉 caller 在 rAF loop 里设置的 `ctx.setTransform(dpr, 0, 0, dpr, 0, 0)`，然后用 CSS 尺寸 `fillRect(0, 0, canvasWidth, canvasHeight)`，只填充 canvas 左上 CSS 尺寸矩形（而不是整个 `canvas.width × canvas.height` 像素空间）
- `drawScene` line 707：`ctx.setTransform(viewport.scale, 0, 0, viewport.scale, viewport.x, viewport.y)` 也不含 dpr，所有 zone/employee/prefab 绘制都在 1:1 坐标系进行，dpr=2 下 scene 实际像素尺寸是预期的 1/dpr

**选择**: 把 dpr 作为显式参数传进 `drawScene`，内部两处 setTransform 都乘 dpr：
- `drawBackground`：`ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.fillRect(0, 0, canvasWidth, canvasHeight);`（caller 已传 CSS 尺寸，dpr 补偿后刚好覆盖全部像素）
- `drawScene` line 707：`ctx.setTransform(dpr * viewport.scale, 0, 0, dpr * viewport.scale, dpr * viewport.x, dpr * viewport.y)`

**理由**:
- 显式传参避免 drawScene 反推 dpr（比如从 `ctx.canvas.width / canvasWidth`），失真概率低
- drawBackground 保留 `setTransform(dpr,...)` 后 `fillRect(0,0,w,h)` 的语义最清晰，不需要再 `resetTransform`
- 改动仅限 renderer，不污染 view 层 rAF loop 的 `ctx.setTransform(dpr,...)` 习惯（view 层那行实际上已经是 dead code，可在本 change 里一并移除或保留，选择移除以避免未来误导）

**备选**:
- drawScene 从 ctx 或 window 读 dpr。否决：隐式依赖全局 / canvas attr 反推 CSS 尺寸，调用侧测试也更难。
- 只改 drawBackground 不改 drawScene line 707。否决：半修，scene 仍偏小，acceptance 不过。
- 让 caller rAF loop 自己把 viewport 乘好 dpr 再传进 drawScene。否决：caller 已经把 viewport 视作"世界 → CSS 像素"语义，改 caller 会扩散到 interaction handler（点击坐标换算）。把 dpr 补偿局限在 renderer 内最安全。

**风险**：pan/zoom/drag 的 hit-test 代码在 view 层用的是 `viewport.scale / x / y`（CSS 像素语义），不经过 dpr，因此不受本修改影响。需要在 live 验证里确认 pan/zoom 行为不变（tasks.md 4.6/4.7 已覆盖）。

## Apply 阶段根因修订（保留作历史）

原 proposal 把根因归结为"initial rect 读取偏小"，apply 阶段 live 采样否决了这一点：
- container.getBoundingClientRect() 和 ResizeObserver contentRect 首次都测到 1200×766（真实值），computeFitViewport 算出的 viewport 也对
- canvas 像素采样：(240,153)/(720,459) 有 bg+scene 内容，(1200,766)/(1680,459)/(2160,153) 全 alpha=0
- 证据指向 renderer pipeline 丢失 dpr，不是 sizing 阶段

结论：view 层 sizing 合并（D1/D2/D3/D4）是结构重构，渲染偏小的真正修复靠 D5。本 change 同时覆盖两者。

## Risks / Trade-offs

- **[风险] ResizeObserver first entry 在某些浏览器 / 场景下不触发** → Mitigation: 极少，但 tasks.md 里要求 live 测试 "切 3D→2D" 后 canvas 是否填满。若真不触发，fallback 是在 `useEffect` 里 `queueMicrotask` + `requestAnimationFrame(() => observer.disconnect(); observer.observe(container))` 强制重启 observer。
- **[风险] 首次 fit 和用户在上一次 2D session 的 pan/zoom 冲突** → Mitigation: 本 change 显式说明"每次 2D mount 都 first-fit" 是可接受的，因为 `hasMounted2D` 永不回 false，2D 组件其实只 mount 一次；切 3D 时是 opacity-0，unmount 只在 tab 离开或 company 切换时。所以用户视角下 first-fit 只发生一次。
- **[风险] 修改破坏 pan/zoom 在 window resize 时的保真** → Mitigation: `isFirstSizing` 在 mount 后首次 fit 完就置 false，之后 window resize 触发的 observer callback 仍走 `preserveViewportOnResize`，语义不变。tasks.md 要求 live 验证 "fit 完成后手动缩放浏览器窗口，pan/zoom 保持"。
- **[风险] 删除 line 515-522 / line 552-559 后，redraw 首帧时 canvas 尚未写 width/height，画到 0×0** → Mitigation: observer first entry 一定早于首次 rAF 的有效 render（rAF 本身也要等 layout 稳定）。兜底：在 rAF loop 内添加 `if (canvas.width === 0 || canvas.height === 0) return`，跳过这一帧直到 observer 触发 —— 这条是防御，实际应该不需要。

## Open Questions

- 是否要把 `isFirstSizing` 导出到 geometry module 以便其他 view 复用？ → 本 change 暂不导出；仅 view 层本地 `useRef`。若未来 3D 或其他 canvas view 复用类似模式，再抽。
