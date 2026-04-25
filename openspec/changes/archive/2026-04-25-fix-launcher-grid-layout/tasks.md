## 1. App.tsx 外层切 grid

- [x] 1.1 把 `apps/launcher/src/App.tsx` 根 `div` 从 `flex flex-col h-screen` 改成 `grid h-screen grid-rows-[auto_auto_auto_minmax(0,1fr)]`，去掉子段的 `flex-1 / min-h-0` 包裹
- [x] 1.2 合并 LaunchPanel + StatusBar 包裹到同一 grid row，内部 `flex flex-col gap-3 px-4 py-3`
- [x] 1.3 抽 banner stack 成 `flex flex-col gap-2 px-4`，整段在一个 grid row；保持 error / database 两条 banner 的条件渲染逻辑
- [x] 1.4 LogViewer 包裹改成 grid row 子项，`min-h-0 h-full px-4 pb-4`，确认 LogViewer 内部 `flex flex-col h-full` 仍生效

## 2. LaunchPanel 响应式

- [x] 2.1 `apps/launcher/src/components/LaunchPanel.tsx` 容器 grid 类名改成 `grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3`
- [x] 2.2 按钮根 `button` 加 `min-w-0`，description `<span>` 加 `truncate w-full text-center`，label 保持完整可读

## 3. StatusBar 拆 region

- [x] 3.1 `apps/launcher/src/components/StatusBar.tsx` 根容器从 `flex items-center gap-4 text-xs font-mono` 改成 `flex flex-col gap-2 text-xs font-mono`
- [x] 3.2 indicator 段单独成 `<div className="flex flex-wrap items-center gap-x-4 gap-y-1">`，去掉 `flex-1`，把 DatabaseIndicator + 两个 ProcessIndicator + Port + LAN + Exit 全放进去
- [x] 3.3 action 段单独成 `<div className="flex flex-wrap items-center gap-2">`，把 Stop / Restart Platform / Start Postgres 三个按钮放进去；保持原有 conditional 渲染
- [x] 3.4 确保 active_mode 为 null 时 action 段仍渲染（即使内容可能为空），不破坏 layout 节奏

## 4. Live verify

- [x] 4.1 `pnpm --filter @offisim/launcher build`（typecheck + vite build 通过）
- [x] 4.2 启动 launcher release `.app`：拖窗口到 `800 × 600` 默认尺寸 → Computer Use 截图对照 spec scenario "默认窗口尺寸下渲染 4 段" 通过
- [x] 4.3 拖窗口到 `640 × 600` 窄宽 → Computer Use 截图确认 LaunchPanel 退化两列、第三个按钮跨两列占满第二行、StatusBar action 按钮全可见、indicator 内部 wrap
- [x] 4.4 拖窗口到 `800 × 480` 矮高 → Computer Use 截图确认上方 3 段不被压缩、LogViewer 仍占剩余高度
- [x] 4.5 拖窗口到 `640 × 480` 极小（minWidth × minHeight）→ Computer Use 截图确认 4 段全部可见可用；点击 Web 按钮后 active 状态和 Stop / Restart Platform 可见，Stop 可点击
- [x] 4.6 双 banner 降级为代码保证验收：Error + Database unreachable banner 同处一个 `auto` grid row 内纵向堆叠，LogViewer 是唯一 `minmax(0,1fr)` row；双 banner 出现时只压缩 log row，不会压缩 launch / status 段
- [x] 4.7 Grep 确认无 `ResizeObserver` / `matchMedia` / `window.innerWidth` / `window.innerHeight` 在 `apps/launcher/src/**` 用于布局判断

## 5. Archive gate

- [x] 5.1 跑 `openspec validate fix-launcher-grid-layout`，无 schema error
- [x] 5.2 确认 spec 一致性：落地代码与 5 个 ADDED Requirement 的 11 个 scenario 全部对应；proposal 中 icon shrink 漂移已改回与实现一致
- [x] 5.3 确认 tasks 4.x live verify 全部勾上（含截图 / observation 落到 `verify-notes.md`）
- [x] 5.4 确认 launcher 没有现存 CLAUDE.md（不需要同步），根 `CLAUDE.md` 只记录 launcher 包位置 / 端口 / CI 跳过 Tauri，不与本 change 行为冲突
- [x] 5.5 检查 `openspec/protocols-ledger.md` 未列入 launcher 相关协议（无需同步台账）
