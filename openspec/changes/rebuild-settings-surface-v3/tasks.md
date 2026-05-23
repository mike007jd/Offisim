## 0. Precondition

- [x] 0.1 Phase 0 已 apply：V3 design tokens 在场（`--line-soft` / `--surface-1` / `--r-md` / `--elev-1` / `--sp-3` / `--fs-micro` / `--ls-caps` / `--ink-3` 等已定义且 light-only）。本 phase 的 `.card-block` 直接消费这些 token；缺失则先完成 Phase 0。
  - **已做**：核 `apps/desktop/renderer/src/generated/tailwind-theme.css` 确认 V3 token 全到位，并暴露成 Tailwind class（`border-line-soft` / `bg-surface-1` / `rounded-r-md` / `shadow-elev-1` / `text-ink-3` / `text-fs-micro` / `tracking-ls-caps` / `space-y-sp-3`）。`theme-provider.tsx` 已被 Phase 0 pin 到 `light`（dark machinery retained but inert）。

## 1. card-block + SettingsSection

- [x] 1.1 定义 `.card-block` 样式（`--line-soft` border + `--surface-1` + `--r-md` + `--elev-1` + 16px pad，相邻 `--sp-3`）—— 放 `settings-primitives.tsx` cn() class（或 index.css @layer，apply 定）
  - **已做（apply-time 决定）**：选 design Open Question 倾向方案 —— card-block 不落 index.css `@layer`，直接用 V3 Tailwind utility class 内联在 `SettingsSection` 的 children wrapper：`rounded-r-md border border-line-soft bg-surface-1 p-4 shadow-elev-1`（`p-4`=16px pad）。相邻 `--sp-3`(8px) 由各 tab 父容器 `space-y-sp-3` 提供（见 1.2），避免新增 index.css util / 裸 hex。
- [x] 1.2 `SettingsSection` 重写：caps label + children 包进单层 card-block；API 签名不变（8 调用点零改）
  - **已做**：`SettingsSection` header `<h3>` 改为 caps label `text-fs-micro font-semibold uppercase tracking-ls-caps text-ink-3`（weight 决定：用 `font-semibold`=600 与已落地 Phase 1-4 V3 caps label 约定一致，prototype 标 680 取近似，不引入 arbitrary `font-[680]`）。children 包进单层 `rounded-r-md border border-line-soft bg-surface-1 p-4 shadow-elev-1`（旧 `border-t border-border-default` bare divider 移除）。`description`/`action` 行为不变。API 签名 `{ title, description?, action?, children }` 零改 → 8 调用点零改（实测 8× 仍编过 + 渲染）。父 tab 容器 `space-y-4`/`space-y-6` → `space-y-sp-3` 提供相邻 card 8px gap（Runtime / MCP 两处；Provider 右栏 sibling card 仅 Advanced routing 一张，不受影响）。
- [x] 1.3 核 `VaultDirectorySection` 的 SurfaceCard 不被二次包进 card-block（独立实体）；核各 tab 无嵌套卡 / 无 3 层 border
  - **已做**：`VaultDirectorySection`（唯一 `SurfaceCard` 用户）在 Runtime tab 是 `<VaultDirectorySection>` 顶层 sibling，不在任何 SettingsSection 内 → 独立实体，零改。
  - **已做（apply-time 偏离，记录）**：发现 `SettingsProviderTab.tsx` 旧代码在 `<details>`（`rounded-lg border`）里**嵌套了一个 `<SettingsSection>`**。card-block 反转后这条会变成 details-border → card-block → source-tile-border = 3 层嵌套，撞 spec「no element chain producing 3+ nested borders」。修法：把内层 `<SettingsSection>` 降级为 plain caps-label header + content（无 card-block），保留 `<details>` 作为该字段的单层 disclosure 容器（details(1) → source tile `rounded-md border`(2) = 2 层，合规）。同时该块带 4 处中文 UI 文案（标题「模型目录更新」/ 按钮「更新模型目录」/ summary「上次成功…」/ toast「模型目录已更新…」「模型目录更新失败…」）违反「UI 全英文」硬规则，一并译成英文（Model catalog refresh / Refresh catalog / Last refreshed / Model catalog refreshed / Model catalog refresh failed）。属本 phase card-block 反转新暴露的结构 + 文案修复，未增减功能。
  - **已做**：Runtime「Main harness control」内的 stat tile（`rounded-md border`）、MCP server row（`rounded-md border-border-subtle`）、pending-stdio confirm（`rounded-md border-warning/40`）都是 card-block 内单层 flat tile/row = 2 层，合规（prototype `.stat-grid` 同款）。External tab row 已是 `rounded-lg` flat list rows（非 SurfaceCard per row），无 save bar / 无 SettingsSection，无需改。无 `rounded-[20px]` 旧内卡、无 `ui-core/Card`。

## 2. nav + content 宽度

- [x] 2.1 `SettingsTabNav.tsx`：`w-56`(224) → `w-[244px]`
  - **已做**：vertical orientation `w-56` → `w-[244px]`；同时 V3 restyle —— `bg-surface-1 border-line-soft`、加 caps「Settings」nav title、tab 高 `h-8`、`rounded-r-sm`、active 用 `bg-accent-muted text-accent-text ring-1 ring-inset ring-accent-ring`（匹配 prototype `.set-tab.active` 的 `inset 0 0 0 1px var(--accent-ring)`，用命名 token ring 类而非 arbitrary shadow）。horizontal(narrow) 变体保留并同步 V3 token。
- [x] 2.2 `SettingsContentArea.tsx`：内容栏 `max-w-[720px]` 居中（nav 不算）；外层 scroll 区占满全宽
  - **已做**：scroll 区（`flex-1 overflow-y-auto`）保持全宽；内层从 `<div className="w-full">` 改 `<div className="mx-auto w-full max-w-[720px]">`。saveError banner 也在该居中列内。
- [x] 2.3 `SettingsContentArea.tsx`：save bar 外层 chrome 全宽，inner 控件栏 `max-w-[720px] mx-auto`，reserve 保持
  - **已做**：save bar 外层 `border-t border-line-soft bg-surface-1 ... shadow-overlay` 保持全宽；Save 按钮包进新 `<div className="mx-auto w-full max-w-[720px]">` → 与上方内容栏对齐。bottom padding reserve（`pb-24` when showSaveBar）不变。
- [x] 2.4 MODIFIED base「Settings Provider and Runtime use workspace width in release」匹配（外层占满 + 内层 720 居中，无 `max-w-5xl` 旧窄 clamp）
  - **已做**：无 `max-w-5xl` 出现（grep 确认）；外层 scroll + save-bar chrome 全宽，内层 720 居中。Provider 双列 `xl:grid-settings-provider`（`21.25rem/1fr`=340px/1fr）在 720 内放得下。

## 3. light + bell

- [x] 3.1 已 grep 确认 Settings 无铃铛（无 `Bell`/`bell`）、无 `--wiz-*`（Phase 0 已 light-only）
  - **已做**：`settings/` 目录 grep `Bell` / `wiz` 均 (none)。`SettingsSection` 旧 border 本就是 light `border-border-default`（非 dark `border-white/5`），V3 映射 `border-line-soft`，无 dark→light swap。Theme 控件（System/Light/Dark SegmentedControl）按 prototype-is-spec 保留不动（prototype line 1170/1819 仍展示该控件）；Phase 0 已把 resolution pin 到 light，控件 inert 但无害，controller `theme`/`setTheme`/`resolvedTheme`/density 机制零改。

## 4. 验收 gate

- [x] 4.1 串行 build + `pnpm typecheck`（settings-primitives 向后兼容导出、controller 行为不动）
  - **已做（全绿，exit 0）**：(1) `rm -rf packages/ui-office/dist tsbuildinfo && pnpm --filter @offisim/ui-office build` exit 0；(2) `pnpm --filter @offisim/ui-office typecheck` exit 0；(3) `cd apps/desktop/renderer && npx tsc --noEmit` exit 0；(4) `pnpm --filter @offisim/desktop-renderer build` ✓ built；(5) `pnpm tokens:check` exit 0 + `pnpm tokens:lint-hex` exit 0；(6) `pnpm typecheck` 25 successful / 25 total。`pnpm exec biome check packages/ui-office/src/components/settings/` no fixes。`settings-primitives.tsx` 仍导出 `SettingsSection`/`SurfaceCard`/`SectionLabel`/`surfaceInputProps`/format helpers（向后兼容）；controller hook 与 save/reinit/toolPermissions 路径未触碰。
- [ ] 4.2 release `.app` live（用户/Codex）：nav 244 / content 居中 max-720 / save bar inner 720 居中对齐 / 每 section 浅 card-block / 无嵌套卡 / VaultDirectorySection 独立 / save bar 文案 + reserve / 无铃铛 / 全 light / save runtimePolicy 含 toolPermissions 不破 — **BLOCKED 2026-05-24**：release `.app` 已用当前 worktree 精确路径构建并启动，但本机处于 macOS 锁屏界面；Computer Use 附着返回 `cgWindowNotFound`，解锁后必须用同一 `.app` 路径补跑。
- [ ] 4.3 archive gate 三查 — 见下「文档同步」；archive 前用户/Codex 完成 4.2 live verify 后再勾
  - **已做（文档同步部分）**：`packages/ui-office/CLAUDE.md` Settings 锁定规则已从「`SettingsSection` 无 border/bg/radius，顶部 1px 分割线」更新为 V3「per-section card-block + nav 244 + content 720 居中 + save bar inner 720 居中」。root `CLAUDE.md` Settings 引用未声明旧 flat-divider 模型，无需改。save-bar Retry 措辞：代码已用顶部 `ErrorState variant="banner"`（非 save-bar inline Retry），本 change 不固化旧契约，记为 known drift 留后续 save-UX change（与 design D2b 一致）。
