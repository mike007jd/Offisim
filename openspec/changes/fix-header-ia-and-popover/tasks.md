## 1. Visual hierarchy: peer nav vs office tool

- [x] 1.1 在 `packages/ui-office/src/components/layout/Header.tsx` `OfficeToolButton` 内把 active branch 的 className 从 `border border-cyan-400/35 bg-cyan-400/15 text-cyan-100` 改为弱指示态：保留 `text-cyan-200` icon tint，加底部 1px underline（`relative` + `after:absolute after:bottom-0 after:left-2 after:right-2 after:h-px after:bg-cyan-300/70` 或等价实现），删 border + bg
- [x] 1.2 保留 `aria-pressed={active}` / `data-office-tool` / `disabled` 处理逻辑不变
- [x] 1.3 检查 inactive / disabled 视觉与 active 在视觉对比度上明显可分（dim slate vs bright cyan + underline）
- [x] 1.4 `PeerWorkspaceNav` 不动（其 selected chip 视觉权重保留作为唯一强提示）
- [x] 1.5 `pnpm --filter @offisim/ui-office build` 通过

## 2. Dashboard / Kanban 互斥（panel exclusion）

- [x] 2.1 在 `apps/web/src/components/app-shell/AppMainShell.tsx` 找到 `onToggleDashboard` / `onToggleKanban` 当前实现位置（或 props upstream），定位 panel state owner — 真 owner 是 `useOfficeStateBindings.ts` 的 `handleToggleDashboard` / `handleToggleKanban`，AppMainShell + useAppKeyboardShortcuts 都消费同一对回调
- [x] 2.2 在 `onToggleDashboard` handler 内：若新状态是 open 且 `kanbanOpen=true`，先把 kanbanOpen 设 false 再 setDashboardOpen(true)
- [x] 2.3 在 `onToggleKanban` handler 内：对称处理（若新状态是 open 且 `dashboardOpen=true`，先关 Dashboard）
- [x] 2.4 确认键盘快捷键 `⌘D` / `⌘J` 走同一 handler（不绕过互斥逻辑）；如果走旁路，把互斥下沉到一个共享 `openExclusivePanel('dashboard' | 'kanban')` helper — `useAppKeyboardShortcuts` 直接调 `handleToggleDashboard` / `handleToggleKanban`，互斥自动覆盖键盘路径
- [x] 2.5 `buildOfficeToolItems` 不动；`HeaderOfficeToolItem.isActive` 语义保持
- [x] 2.6 `pnpm --filter @offisim/web build` 通过

## 3. Overflow popover 复用 ui-core 的 `DropdownMenu`（Radix）

> /simplify 阶段从手写 portal 重写为 Radix。理由：`packages/ui-core/src/components/dropdown-menu.tsx` 已 export 但仓库内还没人消费，本场景是它的设计本意；自带 portal + collision-aware placement + outside-click + Escape + ARIA，砍 ~70 行手写代码 + 不再需要 `@types/react-dom` devDep。

- [x] 3.1 `Header.tsx` 从 `@offisim/ui-core` 导入 `DropdownMenu` / `DropdownMenuTrigger` / `DropdownMenuContent` / `DropdownMenuItem`
- [x] 3.2 用 `<DropdownMenu>` + `<DropdownMenuTrigger asChild>` 包裹原 `MoreHorizontal` trigger 按钮（保留 `aria-label="More office tools"` + 视觉 className），ARIA `aria-haspopup` / `aria-expanded` 由 Radix 自动注入
- [x] 3.3 `<DropdownMenuContent align="end" collisionPadding={8}>`：默认 `side="bottom"` + `sideOffset=4`，越界时 Radix 自动 flip（right-aligned → left-aligned；below → above），无需手写 4 步 fallback
- [x] 3.4 portal 由 Radix `Portal` 内置；不再需要 `createPortal` / `useLayoutEffect` / 手写 listeners
- [x] 3.5 菜单宽度通过 className 注入 `w-48 max-h-[60vh] overflow-y-auto`
- [x] 3.6 resize / scroll 时 Radix 自动 reposition；trigger 滚出视口时自动收起。无需手写 window listener
- [x] 3.7 outside-click / Escape 由 Radix 内置；`onSelect={() => tool.onActivate()}` 替代手写 mousedown handler
- [x] 3.8 trigger 仅保留 `aria-label="More office tools"` + 视觉 className，其余 ARIA 由 `DropdownMenuTrigger` 透传
- [x] 3.9 `pnpm --filter @offisim/ui-office build` 通过

## 4. 验证（live agent，无自动测试）

- [x] 4.1 `pnpm --filter @offisim/shared-types build && pnpm --filter @offisim/ui-core build && pnpm --filter @offisim/core build && pnpm --filter @offisim/ui-office build && pnpm --filter @offisim/web build` 串行通过
- [x] 4.2 浏览器层 live verify：dev 5176 + `My AI Company`（默认 8 员工 Office workspace）。Dashboard tool 打开后 `data-office-tool="dashboard"` 的 className 实测 = `text-cyan-200 hover:text-cyan-100 after:absolute after:bottom-0.5 after:left-2 after:right-2 after:h-px after:rounded-full after:bg-cyan-300/70`（无 border / bg / cyan-100 chip）；同时 peer nav `Office` 仍是唯一 `aria-current="page"` chip（`border + bg-blue-500/15` 风格保留）。截图 `/tmp/header-baseline.png` + `/tmp/header-dashboard-open.png`
- [x] 4.3 浏览器层：Dashboard 开 → click `[data-office-tool="kanban"]` → 实测 `{dashboard: pressed=false, kanban: pressed=true}`（已经 evaluate 拿到）。Tool group 唯一显示 active 的是 Kanban
- [x] 4.4 反向：Kanban 开 → click `[data-office-tool="dashboard"]` → 实测 `{dashboard: pressed=true, kanban: pressed=false}`。互斥成立（注意：DOM `aria-pressed` 与 `el.click()` 同帧 query 偶尔 stale，跨帧 query 一致）
- [x] 4.5 浏览器层：`⌘D` 单独切换 Dashboard open/close ✓；`⌘J` 单独切换 Kanban open/close ✓。**注**：Dashboard topmost 时按 `⌘J` 不会 cross-switch — 这是 `useAppKeyboardShortcuts` 内 `anyModalOpen` 设计行为（modal stack 优先），与本 change 互斥逻辑解耦：`useAppKeyboardShortcuts` 直接调 `handleToggleDashboard` / `handleToggleKanban`，互斥逻辑覆盖键盘路径，只是 modal stack 在 cross-panel 场景拦截了 shortcut。本 change 不修 modal stack 行为
- [x] 4.6 浏览器层：现有 4 tool（studio/dashboard/kanban/add-employee），MAX_VISIBLE=3 → Add Employee 进 overflow，无需临时改 MAX。Resize viewport 560×800 + trigger left=122 right=150 → menu portal 到 body（`menuInBody=true`），默认 right-aligned 时 left=-42 越界左，**flip 到 left-aligned**（left=trigger.left=122 right=314 < vw-8=552），未被裁 ✓。Resize 1400×900 时同布局（header wrap 后 trigger 仍偏左），left-aligned 命中
- [x] 4.7 浏览器层：menu open → resize / scroll → Radix 自动 reposition（trigger 仍在视口内时菜单仍 open 且不越界），保持视口可见。/simplify 后行为：reposition 而非 close（设计改进，spec scenario 已同步修订）
- [x] 4.8 浏览器层：trigger 连续 click 三次 → `aria-expanded` 序列 `true → false → true`（toggle 正常，没有"打开瞬间被 outside-click 关掉"）✓
- [x] 4.9 a11y 抽查：实测 peer nav `[Office: aria-current="page"]`，其余 null；tools `aria-pressed` 跟 panel 状态同步；overflow trigger `aria-haspopup="menu" + aria-expanded` 同步 ✓
- [x] 4.10 verify 观察已记录在 4.2–4.9 各项末尾（含截图路径 + DOM query 实测值）
- [x] 4.11 N/A — 4.6 没临时改 `MAX_VISIBLE_OFFICE_TOOLS`（既有 4 tool 已天然触发 overflow），无需复原
