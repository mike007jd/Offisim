## Why

Market 安装走完整路径后，详情页不反映已装态。2026-05-01 release `.app` live verify 实测：`Sample Marketing Strategist` 走完 Approve & Continue + `Installation Complete` 弹窗 + 本地 vault 写入 `companies/<cid>/employees/sample-marketing-strategist/employee.md`，但回到 Market listing 详情页按钮仍显示 `Install`，metadata `Installs` 仍显示平台全局值（如 `0 installs`）。结果：用户看不到自己刚装的成果，会困惑"是不是没装上"，重复点 Install 也不会被本机阻断（install pipeline 只做 idempotency 检查到 install_transaction 层）。MarketDetailView 当前只消费 `detail.install_count`（平台全局指标），完全无 local installed-state 信号。

这是真 UX bug — `过程即价值` 原则下，"系统做的事玩家必须能看到、理解、干预"，已装态是用户最直接想看见的事实。

## What Changes

- **新 capability** `market-listing-installed-state`：在 (company, listing-id) 维度计算"本机此 company 是否已装该 listing"，把这个信号铺到 MarketDetailView 按钮 + MarketListingCard 角标 + 装完后的弹窗 close 路径让详情页重读已装态（无需手动 refresh）。
- **MarketDetailView**：按 kind 分支查询本机已装态。`employee` 走 `repos.installedPackages.findByPackageId(companyId, packageId)` + `origin_listing_id === listing.listing_id` 过滤；`skill` 走对应 skill 表 provenance（`source_ref` 含 listing-id 的 row）。已装时按钮文案切到 `Installed` 并 disabled（不在本 change 接 Open / Manage 跳转 — 那是 follow-up）。
- **MarketListingCard**：grid 视图同样消费已装态，已装行加 `Installed` 角标（不替代当前 `formatInstallCount` 平台指标显示，二者并存）。
- **Install completion event → refresh**：`startRegistryInstall` 完成（`install-transactions.finish('installed')` 之后）emit 一个 `market.listing-installed` 事件（payload: `{ companyId, listingId, packageId, kind }`）；MarketDetailView 和 MarketListingCard 通过现有 ui-office event subscription 模式订阅，命中本视图就重读已装态。同样适配 `installSkill` skill lane。
- **澄清平台 `install_count` 语义**：`detail.install_count` 是平台全局指标，**不**反映本机状态。详情页 `Installs` 行保留作平台数据（不在本 change 删它），但配合按钮的 `Installed` 状态形成"全局热度 + 本机已装"二维信号。Spec 明文区分两者。

非范围：
- 平台 install_count 自更新（这是 platform server 端 metric pipeline，独立面）
- Detail 页 Open / Manage 跳转 employee detail（follow-up，避免本 change 牵连 routing）
- Uninstall affordance（已在 `MarketManageView` 的 InstalledList 路径，本 change 不动）

## Capabilities

### New Capabilities
- `market-listing-installed-state`：Market 详情页 + 卡片在 (company, listing-id) 维度反映本机已装态、随安装事件刷新、与平台全局 `install_count` 信号正交。

### Modified Capabilities
<!-- 无。external-employee-install / agent-mediated-skill-install / marketplace-official-seed 都不是这次的契约面。 -->

## Impact

- **Code touched**：
  - `packages/ui-office/src/components/marketplace/MarketDetailView.tsx`（按钮按已装态分支 + 新 prop）
  - `packages/ui-office/src/components/marketplace/MarketListingCard.tsx`（角标 + 新 prop）
  - `packages/ui-office/src/components/marketplace/MarketPage.tsx` 或 `useMarketplace.ts`（已装态计算 + event 订阅 wiring，最终给 props 喂 `installedListingIds: Set<string>` 类的形态）
  - `packages/ui-office/src/components/marketplace/marketplace-meta.tsx`（如果"Installed"角标 / 文案常量集中放这里）
  - `packages/install-core/src/install-service.ts`（`startRegistryInstall` 成功完成后 emit `market.listing-installed`）
  - 对应 skill 安装入口（`installSkill` 或 ui-office `tauri-skill-install-adapters.ts` 等同步 emit）
  - `packages/shared-types/src/events/`（新事件 type 定义）
- **APIs / data / runtime**：无 schema 变更。InstalledPackageRow.origin_listing_id 已存在；只是消费层从未连接。skills 表的 listing 反向键看实际 schema 定（`source_ref` `'company-skill:<parentId>@<parentVersion>'` 或专门字段）— task 阶段确认。
- **Risk surface**：
  - 已装态计算放 hook 层（`useMarketplace.ts` 或 sibling），订阅事件后 set state；防 N+1 — 用 `listByCompany` 一次拉本 company 全部 installedPackages，前端 build `Set<listingId>` 给 list / detail 共用，不在每个卡片单独 query
  - Skill 路径若 emit 事件 wiring 不完整，detail 页只在重渲（route nav）时刷新；live verify 必须含 skill install 案例
  - `install_count` UI 不动；spec 明文锁住平台 vs 本机语义防未来误改
- **Verification gate**：live agent 跑两条路径 — (1) employee install → 详情页按钮 → `Installed` + 角标出现；(2) skill install → 同效果。代码绿不算完成。
