## Context

当前 market（~16 文件，`packages/ui-office/src/components/marketplace/`，已核代码）：`MarketPage`(workspace shell + sessionState；detail-open 时是**两栏 fr grid** `grid-market-detail-desktop`=`minmax(0,3fr) minmax(23.75rem,2fr)` / `grid-market-detail-tablet`=`minmax(0,3fr) minmax(21.25rem,2fr)`，**不是固定 440 panel**)、`MarketCardGrid`(`grid-market-card-list`=`minmax(17.5rem,1fr)`，骨架用 `h-market-grid-card`=220px)、`MarketListingCard`(`h-market-listing-card`=**260px**, `rounded-2xl`, 96px image-hero band 从 `listing.preview` 渲 image/icon + kind-icon fallback, kind chip, Installed badge, creator, rating)、`MarketDetailView`(`layout:'full'|'panel'|'narrow'`)、`MarketFilterBar`(kind/sort 走 `ui-core` `Select` 原生箭头；mode=`ModeDropdown`、manageTab=`ManageTabDropdown` **已是 `EntityDropdown`**，非原生 select)、`market-rarity.ts`(Tailwind class)、`MarketplaceDetailOverlay`(deep-link 专用)、`marketplace-meta.tsx`(`INSTALLABLE_KINDS={employee,skill}`)。已装态 SSOT `useInstalledListings`(返回 `installedListingIds` + `installedPackageKeys` 双 set，订阅 `market.listing-installed`)。路由：workspace='market' + sessionState.selectedListingId 驱动 detail。

V3 prototype `offisim-market-prototype.html`：`.mkt-grid repeat(auto-fill,minmax(252px,1fr)) gap14 pad sp-7`；卡 `.mc-cover` **88px band 渲 per-kind `kv-<kind>` 可视化**（生产卡，line 1172-1419：kv-employee/kv-skill/kv-sop/kv-template/kv-layout/kv-prefab/kv-bundle），`.mc-iconwrap`(48×48 icon tile) 是 legacy/spec-state fallback（line 323 注释明确）；`.mc-cover.thumb` 可选附加 ≤96×64 thumb；`.mkt-card.featured{grid-column:span 2}` + radial cover；`.seg` filter chip-grammar；detail rail 440px(head 48px)；`.mkt-card{--rc:var(--r-<kind>);--rcs:var(--r-<kind>-s)}`。

## Goals / Non-Goals

**Goals:** Market = V3 密集 chip + segmented filter + detail side-panel 440 + rarity CSS-var，组件 props 签名不变。

**Non-Goals:** install pipeline / 已装态 / publish / seed；workspace routing；deep-link overlay 逻辑；surface 配色（Phase 0）。

## Decisions

### D1 — card cover = 88px band 渲 per-kind 可视化，icon-only 是 fallback
`MarketListingCard`：删 16:9 image hero；render **88px band**，按 `listing.kind`（always present）选 per-kind cover 可视化 `kv-<kind>`（employee 头像+tag / skill 权限风险条+capability glyph / sop DAG pip+role 序列 / template·company_template role 色带 / layout·office_layout floor-plan SVG / prefab 等距线稿 / bundle 内容叠层）；band 由 rarity surface `--rcs` 着色，featured 用 rarity radial-gradient。**仅当无 kind viz 命中（legacy/spec-thumbnail 状态）才 fallback** 到 icon-only tile（48×48 kind icon 居中在 band，`--rcs`/`--accent-surface` 底）。curated/featured 且 preview content-fit 时可**附加** ≤96×64 小 thumb（非全幅）。`--r-md`、`--line-soft`、`--elev-1`，高度 `h-market-listing-card`。stats row：star icon `--warn`、installs mono、creator handle。顶部 3px rarity stripe 用 `var(--rc)`。
**理由**：V3 DNA §11「strip SaaS aesthetic，dense inventory chips」——但 prototype 生产卡渲的是**信息密集的 per-kind 可视化**（让卡片一眼读出 kind 内核），不是裸 icon；裸 icon 只在没有 kind viz 可渲时兜底。cover 永远 key 在 `listing.kind` 上（不依赖任何 "curated flag"）。

### D2 — filter segmented chip-grammar
`MarketFilterBar` 的 **kind/sort** 从 `ui-core` `Select`（原生箭头）改 segmented（container-grammar：border `--line`、`--r-md`、inner 28-30px hover sunken），自定义 12×12 chev svg，**无原生 `<select>` 箭头**（V3 硬规则 §12.5）。**mode（ModeDropdown）/ manageTab（ManageTabDropdown）已经是 `EntityDropdown`（非原生 select）**，只 restyle 成同款 V3 chip-grammar，保留 `EntityDropdown` 语义 + `onSelect`/`onModeChange`/`onManageTabChange` 契约，不退回原生 select。onChange 签名全部不变。

### D3 — detail side-panel 440 固定（替换两栏 fr split）
`MarketDetailView layout='panel'` 固定右侧 440px 滑入（head 48px = rail height），列表留左。**当前 `MarketPage` detail-open 分支是两栏 fr grid（`grid-market-detail-desktop`/`-tablet`），本 change 把 wrapper 改成固定 440 右栏**——同时改 `MarketPage.tsx` grid wrapper + `index.css` 的 detail grid utility（成对）。detail 内容区块不变。narrow 仍 drill-in 全屏。

### D4 — rarity CSS-var 别名
`market-rarity.ts` 返回 CSS-var（`--r-<kind>` 别名：employee→accent/skill→violet/sop·prefab→warn/template→violet/layout→danger/bundle→ink-3，fallback ink-3；配对 surface `--r-<kind>-s` → `--accent-surface`/`--violet-surface`/…，fallback `--surface-sunken`），卡片 `style={{ ['--rc']: …, ['--rcs']: … }}` + 3px top stripe + badge 用 `var(--rc)`、cover band tint 用 `var(--rcs)`。getter 签名兼容（同时给 cssVar + 兜底 ink-3）。

### D5 — install 单点不动 + 修正 detail-open 分支 badge wiring
不改 `INSTALLABLE_KINDS`、detail `isInstallable` gate、`useInstalledListings`、`market.listing-installed` emit、`useInstallFlow().startRegistryInstall`/`startFileImport` 入口、`MarketplaceDetailOverlay`（deep-link）。重做仅触样式/结构。**附带修正**：`MarketPage` detail-open 分支当前只给 `MarketCardGrid` 传 `installedListingIds`（漏 `installedPackageKeys`，no-detail 分支两个都传）；改 wrapper 时补上 `installedPackageKeys`，让 detail 打开时 re-seed 后已装 badge 仍能 survive（dual-key 匹配）。

## Risks / Trade-offs

- **改卡片结构误伤 Installed badge / install gate** → 保留 badge 匹配逻辑（listing_id 或 package_id::version）+ gate；live 验已装态 + install 按钮只 employee+skill。
- **kind/sort Select→segmented 行为回归**（多选/键盘可达）→ segmented 保持 onChange 契约 + a11y（role/aria）；mode/manageTab 已是 `EntityDropdown`，restyle 时保留其语义不引入回归。
- **detail panel vs deep-link overlay 双路径** → overlay 仅 deep-link，detail panel 走 workspace；两者共用 `MarketDetailView` 内容，样式改动两处同步。
- **per-kind cover viz 缺数据** → 任一 kind 数据不足以渲 `kv-<kind>` 时 fallback icon-only tile（48×48），不留空、不破图。
- **rarity getter 返回型变更** → 兼容旧调用（同时给 cssVar + surface + 兜底 ink-3）。

## Migration Plan

1. `market-rarity.ts` → CSS-var（`--r-<kind>` + `--r-<kind>-s`）。
2. `MarketListingCard` 88px band per-kind cover viz（icon-only fallback）+ 高度 + stats + rarity stripe + cover tint。
3. `MarketCardGrid` grid 模板（minmax 252 + featured span 2）+ `index.css` `.grid-market-card-list`。
4. `MarketFilterBar` kind/sort segmented + mode/manageTab restyle（保留 EntityDropdown）。
5. `MarketDetailView` panel 440 + `MarketPage` detail-open wrapper（fr split → 440 panel）+ `index.css` detail grid utility + 补传 `installedPackageKeys`。
6. 串行 build + live 验（含 deep-link install + 已装 badge + detail 打开时 re-seed badge）。
7. 回滚：marketplace 组件 + index.css market utility 改动，单 commit 可 revert（不动 install/hook/overlay 逻辑）。

## Resolved Questions

- **cover 渲什么 key 在哪？** 已定：cover 永远 key 在 `listing.kind`（always present）上 → 选 `kv-<kind>` per-kind 可视化，**不依赖任何 "curated flag"**。无 kind viz 命中（legacy/spec-thumbnail）才 fallback icon-only tile。这是 cover 契约的硬规则，不留到 apply。
- **可选 ≤96×64 thumb 的触发？** 仅作 per-kind cover 之上的**附加**装饰：curated/featured 且 preview content-fit 时附加。apply 时按 platform listing schema 核 curated/featured 字段；无该字段则不附加 thumb（per-kind cover 仍正常渲，因为它 key 在 kind 上而非 curated）。
