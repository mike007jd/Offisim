## Why

Launcher 当前用 `flex flex-col h-screen` 顺序堆 5 段（Header / LaunchPanel / StatusBar / 双 banner / LogViewer），三处布局缺陷导致小窗口不可用：(1) `LaunchPanel` 写死 `grid-cols-3`，三按钮在窄宽下被强挤；(2) `StatusBar` 单行 flex 不 wrap，右侧 Stop / Restart Platform / Start Postgres 按钮在窄窗口被推出可视区；(3) flex 主轴上各段都没 `flex-shrink-0`，矮窗口下顶部 Header / LaunchPanel / StatusBar 会被压缩到 min-content 之下。Launcher Tauri 配置 `minWidth: 640 / minHeight: 480`，必须在该尺寸到默认 `800×600` 之间全部 usable，否则 UX overhaul Phase A 第一关就过不去。

## What Changes

- 把外层从 `flex flex-col h-screen` 换成 CSS Grid `grid-rows-[auto_auto_auto_minmax(0,1fr)]`，明确 4 个 row track：header / 控制区（LaunchPanel + StatusBar 合并） / banner stack / log（唯一弹性区）。
- `LaunchPanel`：`grid-cols-3` 加响应式断点降级（`< sm` 单列、`< md` 两列、`>= md` 三列），按钮内 `min-w-0` + `truncate` 防文案溢出。
- `StatusBar`：左侧 indicator 段加 `flex-wrap gap-y-2`，右侧 button 段从 indicator 段拆出独立行（窄宽时按钮换行排第二行）；最窄宽下两段都允许 wrap。
- Banner stack（Error + Database warning）保持条件渲染但放进固定 row，使用内部 `flex-col gap-2`，不再抢 LogViewer 高度配额。
- LogViewer 占 `minmax(0, 1fr)` row，是唯一弹性区，永远吃剩余高度并能缩到 0；上面所有 row 都是 `auto` + 内部紧凑布局，不会被挤变形。
- Header / 控制区 / banner 都标记 `min-w-0`，防止子元素 intrinsic width 把 grid 撑出 viewport。

## Capabilities

### New Capabilities

- `launcher-shell-layout`：launcher 主窗口的布局契约。规定外层 grid row 划分、各 section 的 wrap / shrink 行为、最小窗口尺寸下的可用性约束。

### Modified Capabilities

无。launcher 此前没有 spec 覆盖。

## Impact

- 影响代码：`apps/launcher/src/App.tsx`（外层 layout）、`apps/launcher/src/components/LaunchPanel.tsx`（响应式 grid）、`apps/launcher/src/components/StatusBar.tsx`（拆行 + wrap）。
- 不影响：launcher Rust 侧 IPC、`LogViewer.tsx` 内部行为、Tauri window config（min size 640×480 不变）。
- 验证：live 拖拽 launcher 窗口从默认 800×600 缩到 minWidth 640 / minHeight 480，确认四区都可见、三个 launch 按钮都可点、StatusBar 右侧三个 action button 都不被裁切、LogViewer 仍占据剩余高度且可滚。
