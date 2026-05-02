## Why

2026-05-02 Tauri release `.app` 主流程 live verify 抓到 6 条 shell 级交互硬伤，单看每条都是 cosmetic，合起来直接破坏「点哪去哪」的产品基线信任：

- 顶部 6-tab workspace nav 必须双击才能切（issue #10）；Settings 4-tab 同症（#12）。一次点击触发但视觉/路由没生效，用户每次切栏要点两下。
- 右侧 collaboration panel 折叠手柄在 Tasks tab 激活时被吃 click，整个 panel 收不回来（#21 — bug，不是 cosmetic）。
- Header 通知图标的 unread badge 被父容器 `overflow-hidden` 裁切（#13）。
- ChatInput slash-command 列表用 ArrowDown 选到下方时不会 `scrollIntoView`，长 list 第二屏的命令永远滚不到（#5）。
- Settings 左栏顶端的折叠按钮（视觉 `<`）容易被误读为 back 按钮（#4，用户拍板：直接移除）。

这些都不是单点 patch 能合理处理的：双击 #10/#12 必须 runtime 调试到底定位真因（候选：URL sync replaceState 与 onSelect 时序竞态、anchor focus 抢占重新解析 URL、SyncExternalStore snapshot 早期返回）；折叠手柄 #21 必须 DOM/event 路径定位被遮挡或 overflow 裁切的根源；不允许「加 onMouseDown 兜底」「加 z-50 hack」「全局加防抖」这类绕开根因的修法（per 用户 2026-05-02 锁定的"必须找根因"约束）。

## What Changes

- **新建 `shell-interaction-baseline` capability**，立 4 条 shell 级交互不变量，同时承接桶 1 的根因修复：
  - **Single-click navigation invariant**：peer workspace nav（Header）+ Settings tab nav（SettingsTabNav），任何同模式 tab 第一次 left-click 必须切换；不允许双击触发的实现路径。
  - **Right-panel collapse handle reachability**：`PanelCollapseHandle` 在右栏展开状态下 100% 时间可点，不被 Tasks/Plan/Outputs 子 tab 的 `forceMount` panel 遮挡或裁切。
  - **Notification badge non-clipping**：unread count badge 不被 Header 右栏 `overflow-hidden` 容器裁切；推荐改用 inline ring 渲染，不靠 `padding` hack 兜底。
  - **Slash / mention menu kbd nav scrolls active item**：`ArrowDown` / `ArrowUp` 改变 active index 时，对应行必须 `scrollIntoView({ block: 'nearest' })`。
- **修改 `settings-workspace-presentation` capability**：移除 SettingsTabNav 的折叠按钮、`collapsed` / `onToggleCollapse` props 和 `verticalCollapsed` 视觉态（用户 2026-05-02 拍板：Settings 不需要左栏折叠，workspace 级 collapse 已存在）。
- **根因修复**（属本 change 实现层，不写进 spec）：
  - 双击 #10/#12 真因定位 + 修复（候选：`PeerWorkspaceNav` 的 `<a href> + preventDefault` 与 `useUrlSync` 的 popstate / replaceState 时序竞态）。
  - 折叠手柄 #21 真因定位 + 修复（候选：Tasks subtab `forceMount` 容器 `overflow-y-auto` 创建的滚动容器拦截了外部 `absolute -left-3` 的 handle，或 z-index 抢位）。
  - Notification badge 渲染策略改造，不再靠 negative offset + 父容器 `overflow-hidden`。

## Capabilities

### New Capabilities
- `shell-interaction-baseline`: shell 级交互不变量 — workspace/Settings 单击导航、右栏 collapse handle 可达、badge 不裁切、列表 kbd nav 滚动 active item。

### Modified Capabilities
- `settings-workspace-presentation`: 移除 Settings 左栏 collapse 按钮、相关 props 与 `verticalCollapsed` 视觉态。

## Impact

- **代码**：
  - `packages/ui-office/src/components/layout/Header.tsx`（`PeerWorkspaceNav` + `activateWorkspaceLink` + Header 右栏 overflow 策略）
  - `packages/ui-office/src/components/layout/AppLayout.tsx`（`PanelCollapseHandle` stacking / hit-test）
  - `packages/ui-office/src/components/layout/RightSidebar.tsx`（Tasks/subtab `forceMount` 容器与 collapse handle 的 z-index/overflow 关系）
  - `packages/ui-office/src/components/notifications/NotificationCenter.tsx`（badge 渲染策略）
  - `packages/ui-office/src/components/chat/ChatInput.tsx`（slash menu + mention menu kbd `scrollIntoView`）
  - `packages/ui-office/src/components/settings/SettingsTabNav.tsx`（移除 collapse 按钮 + 相关 props）
  - `packages/ui-office/src/components/settings/SettingsWorkspaceSurface.tsx` 或调用方（清理 `onToggleCollapse` / `collapsed` 传递）
  - `apps/web/src/lib/url-routing/useUrlSync.ts`（如果 #10/#12 根因落在 URL sync 时序竞态，本文件需要修复 — 待根因诊断后定）
- **API / 公共契约**：`SettingsTabNav` props 删除 `collapsed` + `onToggleCollapse`（破坏 internal API，无外部消费者）。
- **依赖 / 风险**：根因可能多源 — #10 与 #12 不一定同源（一个是 anchor，一个是 button），不能假设同因；landing 修法分两条独立调查路径。
- **下游解锁**：桶 5（`workspace-thread-architecture`）依赖本桶交付的单击 nav 与 collapse handle 信任面，不变 RightSidebar 结构再次破坏交互。
- **不影响**：3D / 2D 渲染、boss routing、Market、SOP、Personnel 业务逻辑。
