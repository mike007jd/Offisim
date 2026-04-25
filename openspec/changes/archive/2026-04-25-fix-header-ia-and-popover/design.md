## Context

Header 当前实现 (`packages/ui-office/src/components/layout/Header.tsx`) 内含三个内部组件：

- `PeerWorkspaceNav` — 5 个 peer workspace 的 segmented control，selected 项用 `border border-cyan-400/30 bg-blue-500/15 text-blue-100`。
- `OfficeToolBar` + `OfficeToolButton` — 4 个 office tool 的圆形按钮组，`isActive=true` 用 `border border-cyan-400/35 bg-cyan-400/15 text-cyan-100`，与 peer nav selected 视觉权重几乎一致（仅 hue 微差）。
- `OfficeToolBar` 末尾的 `MoreHorizontal` overflow menu —— 当 office tool 超过 `MAX_VISIBLE_OFFICE_TOOLS=3` 时，溢出项进入 absolute 定位的 dropdown（`absolute right-0 top-[calc(100%+4px)] z-10`），不走 portal，没有 viewport 边界检测。

`buildOfficeToolItems` (`apps/web/src/lib/workspace-navigation.ts`) 让 dashboard 和 kanban 各自暴露 `isActive: opts.dashboardOpen` / `isActive: opts.kanbanOpen`，两个 panel 的开关状态在调用方（`AppMainShell.tsx`）独立维护，没有互斥语义。

Office tool 的 4 项当前全部 visible（`MAX_VISIBLE_OFFICE_TOOLS=3` 触发 overflow 在 4 项时只剩 1 项进 menu）。窄屏 / 未来加 tool 时 overflow 会更频繁。

## Goals / Non-Goals

**Goals:**

- Header 视觉层级清晰：peer workspace selected 是唯一的强 chip 高亮；office tool active 是从属指示态。
- 同一时刻 Office 内最多 1 个 panel overlay 处于 active（Dashboard 或 Kanban，不能同时）。
- Overflow popover 在任何视口尺寸 / 任何 trigger 位置，都不被父容器或视口边缘遮挡。
- 不破坏现有的 a11y 语义（`aria-current="page"` for peer，`aria-pressed` for tool）和 `data-office-tool` 测试钩子。

**Non-Goals:**

- 不动 peer workspace 的目录 / icon / label / 导航逻辑。
- 不动 office tool 的 4 项目录（studio / dashboard / kanban / add-employee）。
- 不动 chat panel / scene / 其他 workspace 表面。
- 不引入 Floating UI / Radix Popover 等新依赖（React 19 自带 createPortal 够用）。
- 原生 `title` tooltip 越界不在 scope（浏览器原生行为，要修需引入第三方 tooltip lib，超出 A2）。

## Decisions

### Decision 1: Office tool active 视觉降级到从属指示态

**选择**：Office tool active 改用 `text-cyan-200` + 底部 1px underline（`after:` 伪元素或 inset border-bottom）替代 chip 风格 border + bg。Inactive 仍是 `text-slate-400`。

**理由**：

- Peer nav 的 chip 高亮表达"我在这里"（mode），是 navigation primary。
- Office tool 的 active 表达"这个 panel 正打开"（toggle state），是 secondary action affordance。
- 两者用相同 chip 视觉权重时，用户分不清主从——这是 A2 的核心诉求。
- Underline / icon tint 的弱指示态在工具类 toolbar 是行业标准（VSCode side bar, Figma toolbar, macOS Finder sidebar 都这样）。

**Alternatives considered**：

- 把 office tool active 改成完全一样的"chip + 不同色 hue"——还是 chip，权重没降，仍会被读为 selected。
- 完全去掉 active state——dashboard/kanban 切回 visible 后没法知道是否已开，UX 倒退。

### Decision 2: Dashboard / Kanban 互斥由调用方负责

**选择**：在 `AppMainShell.tsx` 的 `onToggleDashboard` / `onToggleKanban` handler 内：打开一个时若另一个已开，先关另一个。`buildOfficeToolItems` 的 isActive 语义不变。

**理由**：

- panel state 已经在 `AppMainShell` 维护（`useState` 或 workspace session state），互斥逻辑放最近 owner 最自然。
- `buildOfficeToolItems` 是纯 mapper，加互斥会让它知道"哪些 tool 是 panel"，污染抽象。
- 互斥在 handler 层意味着键盘快捷键 (`⌘D` / `⌘J`) 也走同一路径自动获益。

**Alternatives considered**：

- 在 `Header.tsx` 内做互斥——Header 不该知道业务语义，违反 component 层级。
- 设计成 stack（关掉 active 时上一个自动 restore）——增加复杂度，本 change 不需要。

### Decision 3: Overflow popover 复用 ui-core 的 `DropdownMenu`（Radix）

**选择**：

- 直接消费 `packages/ui-core/src/components/dropdown-menu.tsx`（已有的 Radix `react-dropdown-menu` 包装），它内置 `Portal` + `Content` 的 collision-aware placement + outside-click + Escape + ARIA (`aria-haspopup` / `aria-expanded`) + focus management。
- `<DropdownMenuTrigger asChild>` 把 ARIA 属性透传到自有 `<button aria-label="More office tools">`，保持现有的视觉 + 测试钩子。
- `<DropdownMenuContent align="end" collisionPadding={8}>` 默认 `side="bottom"` + `sideOffset=4`，命中越界时 Radix 自动 flip 到 left-aligned / above。
- 菜单宽度固定 `w-48` (12rem) 通过 className 注入；`max-h-[60vh] overflow-y-auto` 保护超长情况。
- resize / scroll 时 Radix 自动 reposition；trigger 滚出视口时 Radix 会自动收起。比手写"resize 关闭"UX 更稳。

**理由**：

- `DropdownMenu` 已在 ui-core export 但仓库内没人消费，本场景是它的设计本意；不该手写 portal + bounding rect + 三个 window listener。
- Radix collision detection 在 viewport 边缘行为（auto-flip + auto-reposition）就是 spec scenario 1–3 想要的；手写 4 步 fallback 实测有 corner case（trigger 偏左时默认 right-aligned 越界左 → flip 到 left-aligned 才合理），Radix 已覆盖。
- 不增依赖：`@radix-ui/react-dropdown-menu` 已是 ui-core 既有依赖。
- 砍 ~70 行手写 popover 代码 + 不再需要 `@types/react-dom` devDep。

**Alternatives considered**：

- 手写 `createPortal` + `useLayoutEffect` 计算 + 三个 window listener —— 本 change 的初版，已被替换。代码膨胀且有 corner case。
- 引入 `@floating-ui/react` —— 第二个 floating 库，多余。
- 用 CSS `position: fixed` 不走 portal —— 父 transform 仍会捕获 fixed 元素，不够稳。

### Decision 4: 视觉变化只动 className，不动结构 / props

**选择**：本 change 只改 Header.tsx 内 `OfficeToolButton` 的 className 字符串（active branch）+ `OfficeToolBar` 的 popover 渲染（加 portal + 定位 hook）。`HeaderOfficeToolItem` interface 不变。

**理由**：

- 减少 blast radius：消费方 (`AppMainShell.tsx` + `workspace-navigation.ts`) 不需要重新生成 props，互斥逻辑加在 handler 内即可。
- 保留所有现有 a11y / test selector（`aria-pressed` / `data-office-tool` / `aria-haspopup="menu"`）。

## Risks / Trade-offs

- **[弱指示态识别度低]** → 用户可能不容易识别 dashboard/kanban 是否打开。Mitigation：保留 `aria-pressed` 给屏幕阅读器；icon color 从 `text-slate-400` 跃迁到 `text-cyan-200` 在视觉上仍有明显对比度；underline 提供第二个视觉信号。
- **[互斥关闭旧 panel 时用户没感知]** → 用户开 Dashboard 时如果 Kanban 已开，Kanban 会突然消失。Mitigation：本身两 panel 互相覆盖中央区域，不会同时使用；overlay 关闭是即时的，无 toast 也能感知。
- **[Portal 测试 selector 漂移]** → 之前 e2e 假设 menu 是 trigger 子节点的可能失效。Mitigation：仓库已无自动 e2e（CLAUDE.md 明确无 vitest/Playwright），live verify 通过即可。
- **[Resize 关闭菜单]** → 用户 resize 时菜单消失略意外。Mitigation：菜单只在用户主动点击 overflow trigger 时打开，resize 频率极低；和"菜单飞出视口"对比是更可控的 UX。

## Migration Plan

无 data migration / 无 protocol bump。一次部署即生效。Rollback = revert 单个 commit。

## Open Questions

无。Office tool 4 项目录稳定（studio/dashboard/kanban/add-employee），未来若加 panel 类 tool（例如新加 Notifications panel），互斥规则需在 `AppMainShell` 的 handler 上扩，本 change 不预设这一抽象。
