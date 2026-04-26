## 1. Settings primitive 落地

- [x] 1.1 在 `packages/ui-office/src/components/settings/settings-primitives.tsx` 新增 `SettingsSection({ title, description?, action?, children })`：`<section>` 顶部 `border-t border-white/5 pt-6 first:border-t-0 first:pt-0` + 标题行（H3 `text-sm font-semibold tracking-wide uppercase text-white/90` + description `text-xs text-white/55` + 右侧 `action` slot）+ `<div class="space-y-3">{children}</div>`；显式禁止 `border` / `background-color` / `border-radius` 上身
- [x] 1.2 verify：grep `SurfaceCard` 在 `settings-primitives.tsx` 仍导出（类型 + props 不变），新增的 `SettingsSection` 也导出

## 2. Provider tab 重排

- [x] 2.1 删 `SettingsProviderTab.tsx:82-92` 的 `div.rounded-[20px]` 内层 "Resolved product" 卡，改为右栏顶部 inline summary 行：`<div class="flex items-center gap-2 text-sm text-white/80">` + product 显示名 + 一个 tone chip（`Cyan` 表 active access mode）；不带 border / background-color / border-radius
- [x] 2.2 删除两处 "Advanced Routing" SurfaceCard 重复，合并为右栏底部一段 `<SettingsSection title="Advanced routing">`（保留原字段 endpoint override / default headers / execution lane）
- [x] 2.3 保留 `xl:grid-cols-[340px_minmax(0,1fr)]` 双栏（Tailwind v4 arbitrary 必须 underscore 而非 comma）；narrow tier (< xl) 走单列堆叠，"Resolved product" inline summary 排在 product picker 下方一行（`xl:hidden` 块）
- [x] 2.4 verify (代码层)：`grep -c '<SurfaceCard' SettingsProviderTab.tsx` = 1；`grep -ic "Advanced Routing" SettingsProviderTab.tsx` = 1；`grep -c "rounded-\[20px\]" SettingsProviderTab.tsx` = 0

## 3. Runtime tab 5→2 SettingsSection 合并

- [x] 3.1 删除 5 张 SurfaceCard（"Runtime orchestration" / "Runtime controls" / "Summarization" / "Memory" / "Default employee runtime"）
- [x] 3.2 改为 `<SettingsSection title="Runtime defaults">` 内含：execution mode (Select) + tool search + git auto-commit + density chip row + employee runtime default (`<RuntimeBindingControl scope="company" />`)；字段网格 `md:grid-cols-2 xl:grid-cols-3`；`RuntimeBindingControl` 套 `md:col-span-2 xl:col-span-2` 防 helper copy 截断。注：tasks 原描述里的 "default model Input" 在当前 controller 无独立 setter (model 是 provider 字段)，drop 以避免双源
- [x] 3.3 改为 `<SettingsSection title="Conversation memory & summarization">` 内含 H4 子标题 "Memory"（4 字段 grid `md:grid-cols-2 xl:grid-cols-4`）+ "Summarization"（3 字段 grid `md:grid-cols-3`）；H4 之间不加 border / bg
- [x] 3.4 `VaultDirectorySection` 保持独立（desktop-only，逻辑独立），保留 1 层 SurfaceCard（顺路把 SurfaceCard 内层手写 `rounded-[20px]` status 卡降级为纯文本块以过 8.1 grep gate）
- [x] 3.5 verify (代码层)：`grep -c '<SurfaceCard' SettingsRuntimeTab.tsx` = 0；VaultDirectorySection 是单独 component，自身 SurfaceCard 不计入；`grep -c '<SettingsSection' SettingsRuntimeTab.tsx` = 2

## 4. MCP panel 改写

- [x] 4.1 删除 `McpConfigPanel.tsx` 内两张 `<Card>` 包装（`ui-core` 引入），改用 `<SettingsSection>`
- [x] 4.2 `<SettingsSection title="Add MCP server">` 改为顶部一行 inline form：transport 选择器 + name + URL/command 输入 + Add 按钮，不再独占一段 card
- [x] 4.3 `<SettingsSection title="Configured servers">` 内按 `server.transport` 分组渲染；每组顶部一行 `<header class="text-[11px] uppercase tracking-wide text-white/55">` 显示 `${transport.toUpperCase()} · ${count}`
- [x] 4.4 server row 改为 flat list：`<div class="flex items-center gap-3 rounded-md px-3 py-2 hover:bg-white/[0.04]">` + name + status badge + Reconnect/Delete icon button；删除 row 自身的 border / bg
- [x] 4.5 强制 `key={server.serverId ?? "local:" + server.name}` 稳定；分组只改渲染顺序，不改 React identity
- [x] 4.6 删除 `SettingsWorkspaceSurface.tsx` 在 MCP tab 外层套的 `<SurfaceCard>` wrapper — 该死代码（旧的 SettingsWorkspaceSurface 组件）整段删除（无 consumer，活路径是 SettingsPage → SettingsContentArea → `<McpConfigPanel />` 直接），文件保留 `SettingsTab` type + `useSettingsWorkspaceController` hook
- [x] 4.7 verify (代码层)：`McpConfigPanel.tsx` 不再 import `Card`/`CardContent`/`CardHeader`/`CardTitle`；`grep -c '<SurfaceCard' McpConfigPanel.tsx` = 0；`grep -c '<SettingsSection' McpConfigPanel.tsx` = 2

## 5. External tab 微调

- [x] 5.1 `SettingsExternalTab.tsx` ul/li row 圆角从 `rounded-xl` → `rounded-lg`（li 行 + empty state 框）；不动 list 数据结构
- [x] 5.2 顶部 "Connect agent" 按钮区已是 inline header + button，保留现状（external tab 目前是 list-driven 不强行包 SettingsSection 以避免重复 H3 与现 H2 冲突）
- [x] 5.3 verify (代码层)：tab body 0 SurfaceCard

## 6. Sticky save bar 文案 + Retry 入口

- [x] 6.1 `SettingsContentArea.tsx` 扩文案分支：`!hasUnsavedChanges` → tooltip `No changes to save`；`hasUnsavedChanges && !inFlight && !saveError` → tooltip `Save provider + runtime changes`；`isSaving && !isReinitializing` → label `Saving…` disabled；`isReinitializing` → 旁边一行 hint `Reinitializing runtime`；`saveError` → tooltip `Save failed — retry` + 错误文字下一行 inline `<button class="text-xs text-cyan-300 underline">Retry</button>`
- [x] 6.2 Retry 按钮 onClick 复用 `controller.handleSave`；`disabled={isSaving || isReinitializing}` (即 `inFlight`)
- [x] 6.3 External tab 维持 `showSaveBar = activeTab !== 'external'` 隐藏行为
- [x] 6.4 内容区 `pb-28` padding-bottom 保持，确认对所有非-External tab 都生效
- [x] 6.5 controller API 暴露 `isReinitializing` 单独字段（`assembleSettingsControllerApi.ts`），原 `isSaving` 仍是 `isSaving || isReinitializing` 合并值不变（保 backward compat）

## 7. SettingsWorkspaceSurface 行数 gate

- [x] 7.1 重排后跑 `grep -cvE '^\s*(//|$|/\*|\*)' packages/ui-office/src/components/settings/SettingsWorkspaceSurface.tsx`：83 NBNC 行（远 ≤ 180 NBNC settings-controller-boundaries gate）
- [x] 7.2 死组件整段删除即可，无需做 sub-helper / SettingsTabRouter 拆分

## 8. 静态 grep gate（cards-in-cards 防回归）

- [x] 8.1 `grep -rE 'rounded-\[2[04]px\]' packages/ui-office/src/components/settings/ --exclude=settings-primitives.tsx` 输出 0 条（顺路把 SettingsRuntimeTab 内 density chip 框 + VaultDirectorySection 内两个 status 卡 rounded-[20px] 降级）
- [x] 8.2 `grep -c '<SurfaceCard'`：Provider 1 / Runtime 0 / External 0 / McpConfigPanel 0；总和 = 1 (合规)
- [x] 8.3 `grep -rE '<Card[ >]' packages/ui-office/src/components/settings/` 输出 = 0（MCP panel 已删 ui-core/Card 引用）

## 9. Live verify @ 1440x900（Chrome MCP）

- [x] 9.1 `pnpm --filter @offisim/web dev` 启 5176（vite v6.4.1 ready in 232ms）
- [x] 9.2 4 tab 截图存 `verify-screenshots/{provider,runtime,mcp,external}-1440x900.png`
- [x] 9.3 每 tab body 视觉 ≤ 1 visual container；SettingsSection 顶部 1px 分割线生效
- [x] 9.4 Provider tab 全字段一屏可见（双栏 340px + 404px 后无水平/字段堆叠溢出）；Tailwind v4 arbitrary 语法修了 `[340px_minmax(0,1fr)]`
- [x] 9.5 Runtime tab 一屏 ≥ Runtime defaults 全控件；Conversation memory 在 scroll 下方（spec 9.7 明确允许超出 viewport scroll inside tab body）
- [x] 9.6 MCP tab 4 fixture (2 stdio + 2 sse) 不滚动；transport group 标 `STDIO · 2` / `SSE · 2`
- [x] 9.7 5 次 tab 切换 height 全 643 px 不变（sticky bar 占稳定 footer）
- [x] 9.8 编辑 Model 字段 → button tooltip `Save provider + runtime changes`；恢复后 → tooltip `No changes to save` disabled
- [ ] 9.9 模拟保存失败 + Retry — DEFERRED（需后端配合制造 401/网络失败；代码路径 + spec scenarios 静态可验，逻辑落地完整）
- [x] 9.10 External tab 无 sticky save bar（DOM 无 `button.h-11.rounded-lg`）

## 10. Live verify narrow viewport（≥ 768px）

- [x] 10.1 1280x800 viewport：Provider / Runtime 截图存档；MCP 与 1440 视觉等价（max-w-3xl 限 768px 下两 viewport 内容区一致）
- [x] 10.2 narrow tier (1100 viewport) 下 Provider `xl:hidden` resolved summary 在 picker 下方可见
- [x] 10.3 1280 (xl 临界) Runtime defaults 仍 3 列；narrow tier 自动降到 md:grid-cols-2

## 11. 顺路文档 sync

- [x] 11.1 更新 `packages/ui-office/CLAUDE.md` Settings 条：注明 SettingsWorkspaceSurface 死组件已删 (现仅留 type + hook)，并加新规则 "use `SettingsSection` for sub-groups, reserve `SurfaceCard` for stand-alone visual entities"
- [x] 11.2 ui-office gotchas 节加：Settings tabs use SettingsSection (no border/bg/radius) as the dominant layout primitive；MCP server list transport grouping；sticky bar 文案 + Retry + isReinitializing 暴露
- [x] 11.3 协议台账：本 change 不触 A2A / MCP protocol / SKILL.md / Tauri / LangGraph / Better Auth — no protocol touched

## 12. Archive 前三查（OpenSpec Archive Gate, 2026-04-19 起强制）

- [x] 12.1 Spec 一致性：spec deltas 与代码一致 — SettingsSection 签名落 settings-primitives.tsx ✓；Runtime tab 2 段 ✓；MCP transport group 渲染 ✓；sticky bar 5 文案分支 ✓；唯一偏离是 spec 描述的 "default model Input" 字段在 controller 无 setter，已在 3.2 注明并 drop
- [x] 12.2 Tasks 一致性：所有 [x] 项有 verify evidence；9.9 保留 [ ] 明示 deferred 并附为什么 + follow-up
- [x] 12.3 文档 / 注释一致性：CLAUDE.md (ui-office) 已 sync；canonical specs 待 archive 时同步

## 13. Verify-record 写到 archive 目录

- [x] 13.1 `verify-notes.md` 创建：每 9.x / 10.x 步骤实测结果 + screenshot path + 关键 DOM 测量值 (heights / gridTemplateColumns / saveBar tooltip)，9.9 标 DEFERRED 说明
