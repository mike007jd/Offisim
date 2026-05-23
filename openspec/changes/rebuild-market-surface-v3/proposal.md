## Why

V3 设计稿把 Market 从「Steam-store hero 卡」改成「密集 inventory chip」。2026-05-24 产品修正确认：`Docs/design` 是布局参考，不是图示参考，不能把参考图里的装饰图形照搬成 SVG cover。卡片走 `h-market-listing-card` + dense inventory header（kind icon tile、title、creator、Installed/kind chip）+ summary/tags/stats；不渲 SaaS 16:9 hero，也不渲 per-kind illustration/SVG cover。grid `repeat(auto-fill,minmax(252px,1fr))` gap14 pad sp-7、featured 卡 `grid-column: span 2`；filter bar 48px 用 `.nav` chip-grammar 的 segmented（无原生 select 箭头）；detail 从右侧 side-panel 440px 滑入（替换当前两栏 fr split）；rarity 用 CSS var 别名（employee→accent/skill→violet/sop·prefab→warn/template→violet/layout→danger/bundle→ink-3，含 `--r-<kind>-s` surface 别名）；stats row stars(warn)·installs(mono)·verification。

**当前实态（已核代码）**：卡片 `h-market-listing-card` = 260px（`index.css`，200px 是 `h-market-grid-card` 骨架）+ `rounded-2xl`（保留）+ 96px image hero band（`MarketListingCard.tsx` 从 `listing.preview` 渲 image/icon，kind-icon fallback）；grid `grid-market-card-list` = `minmax(17.5rem,1fr)`；detail 是两栏 fr grid `grid-market-detail-desktop` = `minmax(0,3fr) minmax(23.75rem,2fr)`（`MarketPage.tsx` 渲染，**不是**固定 440 panel）；filter 的 kind/sort 走 `ui-core` `Select`（原生箭头），mode（ModeDropdown）/ manageTab（ManageTabDropdown）**已经是** `EntityDropdown`（非原生 select）。Phase 3 把 Market 重做成 V3。依赖 Phase 0 token。

## What Changes

- **listing card → 密集 chip**：`--r-md` 边、`--line-soft` border、`--elev-1`；删除 16:9 image hero 与 per-kind illustration/SVG cover。header 用 kind icon tile + title + creator handle + kind chip + `Installed` badge（仍按 `listing_id` 或 `package_id::version` 匹配）；body 用 summary/tags；stats row（stars=warn、installs=mono、verification）+ 顶部 rarity stripe（`var(--rc)`）。
- **card grid**：`MarketCardGrid` 模板 `repeat(auto-fill,minmax(252px,1fr))`、gap 14px、padding `--sp-7`；featured 卡 `grid-column: span 2`。
- **filter bar V3 grammar**：`MarketFilterBar` 的 kind/sort 从 `ui-core` `Select`（原生箭头）改 `.nav` 风格 segmented chip-grammar（自定义 12×12 chev svg，无原生 `<select>` 箭头）；mode（ModeDropdown）/ manageTab（ManageTabDropdown）**已是 `EntityDropdown`**，restyle 成同款 V3 chip-grammar 但保留 `EntityDropdown` 语义，不退回原生 select。filter bar 内任何位置都不出现原生 `<select>` 箭头。
- **detail side-panel 440px**：`MarketDetailView` `layout='panel'` 固定右侧 440px 滑入（detail head 48px），**替换当前 `MarketPage` 两栏 fr split**（`grid-market-detail-desktop`/`-tablet`）；列表保持左侧。detail 内容（carousel/changelog/requirements/lineage）不变。narrow 仍 drill-in。
- **rarity → CSS var**：`market-rarity.ts` 从 Tailwind class 改 CSS var 别名映射（`--r-<kind>` + 配对 surface `--r-<kind>-s`），卡片顶 3px stripe + badge 用 `var(--rc)`，必要的 rarity surface accent 用 `var(--rcs)`。
- **install-badge wiring 修正**：`MarketPage` detail-open 分支（当前只传 `installedListingIds`）补传 `installedPackageKeys`，与 no-detail 分支对齐，让 detail 打开时已装 badge 也能 survive re-seed。
- **保留 install 单点**：`INSTALLABLE_KINDS=['employee','skill']` 不动、detail `isInstallable` gate 不动、`useInstalledListings` SSOT + `market.listing-installed` 事件不动、`useInstallFlow().startRegistryInstall`/`startFileImport` 单点入口不动、`MarketplaceDetailOverlay`（deep-link `offisim://install` 专用）保留不改。

**不在范围**：install pipeline / 已装态逻辑 / publish 主路径 / platform seed；workspace routing；surface 配色（Phase 0）。

## Capabilities

### Modified Capabilities
- `market-explore-redesign`: listing card 从 16:9 image hero 改为 dense inventory card，禁止 per-kind illustration/SVG cover；新增 V3 card-grid 密度（minmax 252、featured span 2）、filter bar segmented chip-grammar（无原生 select 箭头，kind/sort 从 Select 改、mode/manageTab 已 EntityDropdown 仅 restyle）、detail side-panel 440px（替换两栏 fr split）、rarity CSS-var 别名映射（含 `--r-<kind>-s` surface）、install-badge dual-key wiring（detail-open 分支补 `installedPackageKeys`）的结构要求。detail carousel/changelog/lineage、install identity（双 key 匹配）、published auth gating 要求保持不变。

## Impact

- 组件代码：`MarketListingCard.tsx`(dense inventory card / 删除 cover illustration / 高度 / stats / rarity stripe)、`MarketCardGrid.tsx`(grid 模板 + featured span / 骨架 `h-market-grid-card`)、`MarketFilterBar.tsx`(kind/sort Select→segmented，mode/manageTab restyle EntityDropdown)、`MarketDetailView.tsx`(panel 440 head 48)、`MarketPage.tsx`(detail-open grid wrapper 从 fr split 改 440 panel + 补传 `installedPackageKeys`)、`market-rarity.ts`(CSS-var + surface 别名)。
- CSS utility 类（`apps/desktop/renderer/src/index.css`）：新增/改 `.h-market-listing-card`（当前 16.25rem=260px）、`.grid-market-card-list`（当前 `minmax(17.5rem,1fr)` → `minmax(252px,1fr)`）、detail 容器从 `.grid-market-detail-desktop`(`minmax(0,3fr) minmax(23.75rem,2fr)`) / `.grid-market-detail-tablet`(`minmax(0,3fr) minmax(21.25rem,2fr)`) 两栏 fr 改为固定 440 右栏 panel utility。这些 utility 与 `MarketPage.tsx` 的 grid wrapper 成对修改。
- 不改：`marketplace-meta.tsx`(INSTALLABLE_KINDS) / `useInstalledListings.ts`（返回型已含双 set）/ `MarketplaceDetailOverlay.tsx` / `useInstallFlow` 入口。
- blast radius：组件 props 签名不变（onClick(listingId)、onChange、layout='full'|'panel'|'narrow'、useInstalledListings 返回型）→ 不波及 workspace routing / deep-link install。
- 验收 gate：typecheck + 串行 build；release `.app` live 验：卡片密集 / 无装饰 SVG cover 或 16:9 hero / grid 密度 minmax252 + featured span2 / filter segmented 无原生箭头（mode/manageTab 仍 EntityDropdown）/ detail 右侧 440 滑入 / rarity 颜色 / install 按钮仍只 employee+skill / 已装 badge（含 detail 打开时 re-seed 后仍在）/ deep-link install 正常。
