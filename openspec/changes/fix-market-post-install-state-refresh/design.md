## Context

Market 安装路径分两条 pipeline、两份持久化、各自的 listing 反向键，但 Market UI 只消费平台 `install_count`，从未连过本机已装信号——结果就是 R-005 live verify 实测的 "装完弹完成弹窗，详情页按钮还是 Install"。

**Pipelines（已存在）**：
- **Employee**：`startRegistryInstall` → `install-core` 状态机（`packages/install-core/src/install-service.ts`）→ `installedPackages` 行（`InstalledPackageRow.origin_listing_id` 是反向键，`packages/install-core/src/types.ts:187`）+ vault 磁盘 `companies/<cid>/employees/<slug>/employee.md`。
- **Skill**：`installSkill`（`packages/core/src/skills/skill-loader.ts:323`）→ `skills` 表行（`source_kind = 'marketplace'`、`source_ref = listingId`，`packages/core/src/skills/skill-loader.ts:39`）+ vault 磁盘 `companies/<cid>/[employees/<slug>/]skills/<slug>/SKILL.md`。

**UI 表面（待改）**：
- `packages/ui-office/src/components/marketplace/MarketDetailView.tsx`：line 158 显示 `formatInstallCount(detail.install_count)`（平台全局），line 161-178 Install 按钮无 `installed` 分支
- `packages/ui-office/src/components/marketplace/MarketListingCard.tsx`：line 41 同款 install_count；卡片无 `Installed` 角标
- `packages/ui-office/src/hooks/useMarketplace.ts`：listing 列表/详情拉取 hook，自然的已装态计算住址

**事件层（部分已存在）**：
- `install-service.ts` 已 `events.emitInstallState(companyId, txnId, from, to, packageId)`；`to === 'installed'` 已是可订阅信号。
- `skill-loader.ts:installSkill` **未 emit 任何事件**，但 ui-office 侧已有 `skill.*` 前缀订阅习惯（`useSkillsForEmployee` 同款）——意味着 DB / repo 层有一处在 broadcast skill 行更新。需要确认或补一个统一信号。

约束：
- 仓库无产品自动测试；live agent 验收（一条 employee 路径 + 一条 skill 路径，桌面 release `.app` 两面都点）。
- Market workspace UI 改动必须 live 验证，不能只靠 typecheck 绿。

## Goals / Non-Goals

**Goals：**

- Market 详情页按钮：`(currentCompanyId, listingId)` 维度本机已装时切到 `Installed` 文案 + disabled。
- Market 卡片角标：同信号上铺到 grid 视图，让用户在列表层就看到本 company 已装的 listing。
- 安装完成 → 详情页 / 列表页**自动**刷新已装态，不需要用户手动重渲。
- 平台 `install_count`（全局指标）和本机已装态（per-company）在 UI 共存且语义独立 —— spec 明文锁住。
- Employee + Skill 两条 INSTALLABLE_KINDS 全覆盖。

**Non-Goals：**

- 不动平台 `install_count` server-side 数据流（platform 端 metric pipeline，本 change 不涉及）。
- 不在详情页接入 `Open` / `Manage` employee detail 跳转（needs Personnel routing；后续 follow-up）。
- 不替换 `MarketManageView` 的 InstalledList / Uninstall 路径（已工作）。
- 不扩 `INSTALLABLE_KINDS` 到其他 kind（独立 change）。
- 不引入新 DB 列；现有 `origin_listing_id` + `source_ref='marketplace'` 已足够。

## Decisions

### Decision 1：已装态走"per-company Set<listingId>"形态，而不是 per-card boolean

`useMarketplace.ts`（或 sibling hook）一次拉本 company 全部 installed 记录（`repos.installedPackages.listByCompany(companyId)` + skill 表 query），合并成 `installedListingIds: Set<string>`，往下喂给 `MarketDetailView` / `MarketListingCard` 作 prop。详情页消费 `installedListingIds.has(detail.listing_id)`。

**为何不**：每个 card 独立 query —— N+1，6 条 listing 6 次 IO，事件订阅也得 6 倍；语义上"是否已装"是**集合查询**不是**个体查询**。

**为何不**：放 Redux / 全局 store —— overkill，scope 限于 Market workspace。

### Decision 2：统一新事件 `market.listing-installed`

两条 pipeline 完成时 emit 同一形状事件，避免 ui-office 订阅两套信号 + 等价 reduce：

```ts
type MarketListingInstalledEvent = {
  companyId: string;
  listingId: string;
  kind: 'employee' | 'skill';
  // installedPackageId 仅 employee；skillId 仅 skill。可选字段，UI 不依赖
  installedPackageId?: string;
  skillId?: string;
};
```

emit 点：

- Employee：`install-service.ts` 在 `state-machine` 进入 `installed` 终态后，从 `txn.source_ref` / `originListingId`（line 337-349 已计算）拿 listingId、emit。
- Skill：`skill-loader.ts:installSkill` 在 `source.kind === 'marketplace'` 分支成功后 emit。

订阅点：`useMarketplace.ts` 单次订阅，拿到 `companyId` 匹配后增量更新 `installedListingIds`（不重新 listByCompany 一遍 — 减 IO）。

**为何不**：复用 `install-service.emitInstallState` 的 `installed` transition —— 它的语义是"install txn 完成"，不携带 listingId（payload 只有 packageId）；拿不到 listingId 就需要多一步反查 `installedPackages.findByPackageId` 再过滤 `origin_listing_id`，增加耦合点。新事件直接带 listingId 更干净。

**为何不**：复用 `skill.*` 前缀事件 —— 那是 "skill row mutated" 通用信号，listing 关联得自己提取。新事件 narrow + 明确意图。

### Decision 3：按钮文案 / 状态 = `Installed` + disabled，**不接 Open**

详情页已装时按钮文案 `Installed`、`disabled` 视觉、不可点。原因：

- 跳到 employee detail 需要 routing 改动（`routeToPersonnel(employeeId, tab)` 已是单入口，但要先把 listing → employeeId 反查接出来）—— 牵 Personnel routing，超本 change 范围。
- "Installed" 静态文案在视觉 + 语义上已够 — 用户的核心诉求是"看到自己装上了"，跳转是 follow-up affordance。
- 卡片角标同款（`Installed` 浅 badge），不替换 `formatInstallCount` 平台值。

未来 follow-up（独立 change）：按钮变 `Open` 跳 employee detail / 变 `Manage` 跳 InstalledList — 那时 routing 已就位再加。

### Decision 4：`install_count` UI 不动 + spec 文字双指标共存

`MarketDetailView` line 158 的 `MetaRow label="Installs"` 保留显示 `detail.install_count`（platform 全局热度）；新加 `Installed` 状态在按钮 + 卡片角标两处。spec 必须明文区分：

- **平台 `install_count`**：跨用户跨设备的全局热度指标，由 platform server 维护。UI 显示但不反映本机状态。
- **本机已装态**：(company, listing) 维度，由本地 `installedPackages` / `skills` 表派生。UI 通过 `Installed` 角标 + 按钮文案反映。

**为何不**：把 `install_count` 改成本机 count —— 那会丢失全局热度信号，也跟 platform 端语义脱节。

### Decision 5：装完即增量更新 `installedListingIds`，不需要再次全量 listByCompany

事件订阅 handler 直接 `setInstalledListingIds(prev => new Set([...prev, listingId]))`。理由：

- 事件已经携带 `companyId` + `listingId`，幂等；
- 全量 re-query 的成本不可忽略（两表 + IPC），且 race（事件先到 vs DB commit）反而引入 stale 风险；
- 不在本 change 处理 uninstall（`InstalledList` 已有路径），所以不需要事件 → set delete 的逆向 wire；如果 uninstall 也想反馈 detail 页，单开 `market.listing-uninstalled` 事件（follow-up）。

### Decision 6：Spec 范围 = 新建 `market-listing-installed-state` capability

不改 `marketplace-official-seed`（那是 seed 契约），不改 `external-employee-install` / `agent-mediated-skill-install`（那是 install pipeline 契约，本 change 只是消费它们的产物）。新 capability 描述 "Market UI 在 (company, listing) 维度反映已装态、通过事件刷新、与 install_count 信号正交"。

## Risks / Trade-offs

- **Risk: skill 事件 emit 加在 `skill-loader.ts:installSkill` 而 `installSkill` 还被 fork / git / upload 等其他 source 走** → Mitigation：emit 时按 `source.kind === 'marketplace'` 分支，只有 marketplace 路径 emit `market.listing-installed`；其他 source 不影响 Market UI。
- **Risk: 详情页打开时已装态查询 race（先打开 detail，installed query 还没回，按钮先渲 `Install` 再变 `Installed`）** → Mitigation：`MarketDetailView` 接受 `installed: boolean | undefined` 三态 prop，`undefined` 时按钮渲 skeleton 或保持 `Install` 文案但加 loading 标记；hook 在初次 listByCompany 完成前不喂 detail 页。如果 hook 已经 ready，详情打开瞬间 prop 已就位，no flicker。
- **Risk: 多 company 切换时 stale `installedListingIds`** → Mitigation：`useMarketplace.ts` 已在 active company 切换时 reset listing list；同款 reset 应用到 `installedListingIds`，并在新 companyId 上重新 listByCompany。
- **Risk: live verify 必须跑两条**（employee + skill），漏一条就会 ship 半截 → 写进 tasks.md 验证条目，spec scenario 也明文列两条。
- **Trade-off: 不在本 change 接 Open / Manage 跳转**：用户拿到 `Installed` 静态状态，仍需手动去 Personnel 找已装员工。验收说明 "本 change 关闭'看不到已装'缺陷；Open 跳转是后续 affordance"。
- **Trade-off: 新事件 `market.listing-installed` 增加事件类型表面**：可控；single payload shape，single emit point per pipeline，不会扩散。比"复用 emitInstallState 加上 listingId 反查"耦合更小。
