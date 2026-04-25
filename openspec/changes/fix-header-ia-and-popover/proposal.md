## Why

Header 当前把 peer workspace nav 和 office tool group 用相同的视觉权重渲染（cyan border + 高亮 bg + 高亮 text），用户很容易看到"两个 chip 都亮着"，无法区分主从层级——peer nav 是 mode selector（当前在哪个 workspace），office tool 是 panel toggle（开了哪些 overlay）。Dashboard 和 Kanban 的 `isActive` 各自独立，用户同时打开两个时两个 tool icon 同时亮，加上 peer nav 的 Office 也亮，header 上能出现 3 个相同视觉权重的 selected chip。

OfficeToolBar 的 overflow popover (`MoreHorizontal` 触发) 用 `absolute right-0 top-[calc(100%+4px)]` 定位，没走 portal，也没做 viewport 边界检测——narrow 屏 / 窗口靠右贴边时，popover 容易被父容器或视口边缘遮挡。

UX overhaul A2 验收锁定"对照图 2"，本 change 解决这两类视觉/交互冲突。

## What Changes

- **唯一 selected state（视觉分层）**：peer workspace nav 保留当前的 selected chip 视觉权重（border + bg + 高亮 text），作为"当前 workspace"的唯一强提示；office tool group 改用更弱的指示态（只用 icon tint + 微弱 underline / dot，不再用 chip border + bg），表达"该 panel 当前打开"而非"被选中"。
- **Dashboard / Kanban 互斥**：同一时间最多一个 panel overlay active；打开 Kanban 时若 Dashboard 已开，自动关 Dashboard（反之亦然）。Add Employee / Studio 是 dialog/overlay 入口，不参与互斥（与 panel 语义不同）。
- **Overflow popover 不越界**：OfficeToolBar 的 `MoreHorizontal` overflow menu 改走 React portal 渲染至 body，并在打开时按触发按钮 bounding rect + viewport size 计算定位（默认 `right-aligned, below`，越界右边缘改 `left-aligned`，越界下边缘改 `above`）。原生 `title` tooltip 的越界不在本 change scope（浏览器原生行为）。
- **a11y / 语义对齐**：peer nav 的 selected 项保留 `aria-current="page"`；office tool 的 active 用 `aria-pressed`（已有，不变），但视觉上不与 peer nav selected 重叠。

## Capabilities

### New Capabilities
（无）

### Modified Capabilities
- `office-tool-discovery`: 新增 3 条 requirement —— (1) peer nav vs office tool 视觉权重必须分层，(2) Dashboard / Kanban 在 office tool group 内互斥 active，(3) office tool overflow popover 必须 viewport-aware 不越界。

## Impact

- **Code**：`packages/ui-office/src/components/layout/Header.tsx`（PeerWorkspaceNav / OfficeToolBar / OfficeToolButton 三个内部组件视觉 + portal 接入）；`apps/web/src/lib/workspace-navigation.ts` `buildOfficeToolItems` 的 dashboard/kanban `isActive` 互斥逻辑需要在调用方（`AppMainShell.tsx`）保证只有一个 open，或在 `buildOfficeToolItems` 之前 normalize。
- **API**：`HeaderOfficeToolItem.isActive` 语义不变（仍是 boolean "this tool's panel is open"）；新增 portal 实现细节内聚于 Header.tsx，不暴露新 prop。
- **依赖**：无新依赖（React 19 已含 `createPortal`）。
- **不动的范围**：peer nav 的导航行为 / workspace key 集合 / office tool 的 4 项目录 / chat panel / scene / 其他 workspace 表面，均不动。
