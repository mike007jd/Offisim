## Context

`apps/launcher/src/App.tsx` 当前外层 `div` 是 `flex flex-col h-screen`，子段顺序：
1. Header（`px-4 py-3 border-b`）
2. LaunchPanel 包裹 `div`（`px-4 py-4`） → 内部 `grid grid-cols-3 gap-3`
3. StatusBar 包裹 `div`（`px-4 pb-3`） → 内部 `flex items-center gap-4 text-xs font-mono`
4. Error banner（条件渲染，`mx-4 mb-3`）
5. Database unreachable banner（条件渲染，`mx-4 mb-3`）
6. LogViewer 包裹 `div`（`flex-1 min-h-0 px-4 pb-4`）

Tauri 窗口配置 `apps/launcher/src-tauri/tauri.conf.json`：默认 `800 × 600`，最小 `640 × 480`，可 resize。

观察到的三类布局缺陷（在 minWidth/minHeight 边界 reproduce）：

1. **横向溢出 — StatusBar action buttons 被推出可视区**：StatusBar 单行排 4 个 indicator + 可选 LAN/Port/Exit + 3 个 button。`flex items-center gap-4` 不 wrap，左侧 indicator 容器 `flex-1` 吃所有剩余宽度，但 indicator 自身没 wrap 也没 truncate；窄窗口下 indicator 撑满后 button 段从右侧溢出，超出 viewport 部分被裁切。
2. **横向溢出 — LaunchPanel 三按钮挤死**：`grid-cols-3 gap-3` 写死 3 列。640 宽下减去 `px-4 ×2 + gap-3 ×2` margin 后每列约 195px，按钮内 icon 24px + label + description 还需要 padding，文案 "Web + LAN" / "Browser on localhost:5176" 容易被裁。
3. **纵向压缩 — 上方段被挤压**：`flex flex-col h-screen` 下子段无 `flex-shrink-0`，flex 默认允许 shrink。如果 LogViewer 内部内容（log lines）触发任何 intrinsic 高度计算异常，或两条 banner 都显示时，浏览器会按 flex 比例分配，可能把 LaunchPanel/StatusBar 高度压到 min-content 之下导致 button 被裁。当前代码 LogViewer 有 `min-h-0` 但其它段没显式 `flex-shrink-0`，行为不稳定。

约束：
- 不动 Rust IPC 层（`lib/ipc.ts`）。
- 不动 `LogViewer.tsx` 内部行为（tab / 滚动 / 颜色）。
- 不动 Tauri window config（minWidth/minHeight 不能放宽，640×480 是产品边界）。
- 不引入新依赖；仍用 Tailwind v4 工具类。

## Goals / Non-Goals

**Goals:**
- 在 `640 × 480` 到默认 `800 × 600` 之间的所有窗口尺寸下，launcher 全部 4 个语义区（launch / status / banner / log）都可见且可操作。
- LogViewer 是唯一弹性区，吃所有剩余高度并允许内部 scroll。
- 任何窄宽下，3 个 launch 按钮和 StatusBar 右侧 3 个 action button 都不被裁切，必要时换行。
- 实现使用纯 CSS Grid + Flex Wrap，不引入 ResizeObserver / 媒体查询 hook。

**Non-Goals:**
- 不重构 LaunchPanel / StatusBar 的 indicator 信息结构（只调布局，不动语义）。
- 不放宽 Tauri minWidth/minHeight。
- 不引入响应式 hook 或 JS 测量；纯 CSS。
- 不动 `LogViewer.tsx` 的 tab 和 autoscroll。
- 不为 web build 单独适配——launcher 只在 Tauri 窗口里跑。

## Decisions

### D1. 外层从 nested flex 切到 CSS Grid `grid-rows-[auto_auto_auto_minmax(0,1fr)]`

4 个 row track：
- row 1 = `auto` → Header
- row 2 = `auto` → 控制区（LaunchPanel + StatusBar 合并到同一段，纵向 flex stack）
- row 3 = `auto` → Banner stack（Error + Database warning，纵向 flex stack with gap）
- row 4 = `minmax(0, 1fr)` → LogViewer 包裹（唯一弹性区）

为什么不继续用 flex：flex 主轴 shrink 行为依赖 `flex-shrink-0` 全员声明，少一个就坍塌；改 grid 后 `auto` row 天然按 intrinsic 高度撑开，不需要逐个声明 shrink。`minmax(0, 1fr)` 显式让 LogViewer 可缩到 0 但仍占剩余空间，这在 flex 里需要 `min-h-0` 配合 `flex-1`，写法更脆。

替代方案：保留 flex + 给所有非 LogViewer 段加 `flex-shrink-0`。能修但更脆，未来加新 banner 容易漏。grid 的 row template 是显式契约。

### D2. LaunchPanel 响应式 grid

`grid-cols-1 sm:grid-cols-2 md:grid-cols-3`。Tailwind 默认断点 sm=640px、md=768px。launcher 窗口最小 640，所以：
- viewport ≤ 640：sm 不命中 → 单列堆叠（极端窄）
- 640 ≤ viewport < 768：sm 命中 → 两列
- viewport ≥ 768（包括默认 800）：md 命中 → 三列（保持原视觉）

按钮内加 `min-w-0` 防 grid 被 intrinsic 文案撑超；description 文本 `truncate` 兜底极窄。Icon 不再缩；让按钮 padding 自然适应。

替代方案：恒定 3 列 + 文案缩短。但最窄宽下 195px 列里塞 24px icon + 两行文字 + padding 仍局促，单列堆叠在 640 以下窗口（虽然 Tauri 限制 640，但用户改 config 或 OS 缩放放大字号时 viewport 会更窄）更稳。

### D3. StatusBar 拆成上下两 region 而不是单行 wrap

容器从 `flex items-center gap-4` 改成 `flex flex-col gap-2`，内部两层：
- 上层：indicator 段（`flex flex-wrap items-center gap-x-4 gap-y-1`）
- 下层：button 段（`flex flex-wrap items-center gap-2`）

为什么拆而不是单行 `flex-wrap`：单行 wrap 时 indicator 和 button 混排，wrap 后顺序乱、视觉断裂；拆两 region 后即使 indicator 自己内部 wrap 也不会污染 button 段。缺点是占两行高度（~40px → ~64px），但 launcher 整体高度宽裕，且 banner 平时不出现，纵向预算不紧。

### D4. Banner stack 抽成显式段落

把两个 conditional banner 包进同一 grid row 的 `flex flex-col gap-2`。row template 里这是 `auto`，平时 collapse 到 0；出现时按 intrinsic 高度撑，不影响 LogViewer 1fr 计算（grid 1fr 自动让出空间）。

### D5. 控制区合并到同一 grid row

LaunchPanel + StatusBar 共享一个 `auto` row（内部 `flex flex-col gap-3`），消除两个 row 之间的 padding 重复。视觉上仍是上下分块。

## Risks / Trade-offs

- **[Risk] grid template 用 Tailwind 任意值 `grid-rows-[...]`** → Tailwind v4 默认支持任意值；launcher 已用 `text-[11px]`、`text-[var(--accent-val)]` 等任意值，确认 build 通过即可。
- **[Risk] StatusBar 拆两行后窄宽下视觉变高** → 用 `gap-2` 控制紧凑度；banner 不显示时两行总高 ~60px，可接受。Live 验证目标：默认窗口下两行 + 空 banner stack + LogViewer 仍占 ≥70% 高度。
- **[Risk] LaunchPanel 单列时 description 文案与 label 上下堆**：按钮内本来就是纵向 flex，单列只是按钮变宽，视觉不破。
- **[Risk] LogViewer `flex-1 min-h-0` 包裹改成 grid 子项后丢失高度**：grid `minmax(0, 1fr)` 子项必须用 `h-full`（或 `min-h-0` + `overflow-hidden`），LogViewer 内部已是 `flex flex-col h-full`。包裹 `div` 加 `min-h-0 h-full` 防御。
- **[Trade-off] 不引入断点 hook**：不能根据 viewport 动态切换 indicator 显示密度，但 indicator 只是状态文本 + dot，wrap 即可，不需要折叠。
- **[Risk] 用户拖窗口非常缓慢时 wrap 触发瞬间 layout shift**：CSS 行为，不可避免；非阻塞。

## Migration Plan

无数据迁移、无 IPC 协议变更。纯前端 CSS / 组件结构调整。回滚方法：revert 这 1 commit。

## Open Questions

无。所有决策可在 live 验证一次拍板。
