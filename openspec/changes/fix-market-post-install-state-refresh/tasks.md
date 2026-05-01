## 1. Stage A — Event type + emit hooks

- [ ] 1.1 Add `MarketListingInstalledEvent` type to `packages/shared-types/src/events/`（参照现有 `events/` 子文件结构选 `market.ts` 或 `install.ts`，并在 `events/index.ts` re-export）。Payload 形状见 design.md Decision 2 / spec Requirement #2。
- [ ] 1.2 在 `packages/install-core/src/install-service.ts` 已有的 `installed` 终态分支（line 337-349 `originListingId` 已计算）emit `market.listing-installed`。事件源经 `this.events` 接口暴露 → 在 `InstallEventEmitter` 接口加 `emitMarketListingInstalled` 方法（包括默认 noop fallback for legacy callers）。
- [ ] 1.3 在 `packages/core/src/skills/skill-loader.ts` `installSkill` 末尾、`source.kind === 'marketplace'` 分支成功后，emit `market.listing-installed`（payload `kind: 'skill'`、`skillId: row.skill_id`、`listingId: source.listingId`）。skill-loader 现在没事件依赖；用注入 `MarketEventEmitter` 类似 install-service 的依赖式接口，避免 skill-loader 直接耦合 EventEmitter 实现。
- [ ] 1.4 在 `packages/core/src/skills/skill-loader.ts` `source.kind` 不为 `marketplace` 的所有分支（`git` / `upload` / `fork` / `self-authored`）确认**不**emit `market.listing-installed`（spec Requirement #3）— 留 unit 视读保护，不写测试。
- [ ] 1.5 `pnpm --filter @offisim/shared-types build && pnpm --filter @offisim/core build && pnpm --filter @offisim/install-core build`。

## 2. Stage B — Hook layer: derive + subscribe

- [ ] 2.1 在 `packages/ui-office/src/hooks/useMarketplace.ts`（或新增 sibling `useInstalledListings.ts` 视现有结构）新加 `installedListingIds: Set<string>` state。**依赖**：`activeCompanyId` + `repos.installedPackages.listByCompany` + skills repo（找现有 skill 列表 hook，若无需新加 `repos.skills.listByCompany` 或类似查询）。
- [ ] 2.2 mount-time 拉取：activeCompanyId ready 后并行查询 `installedPackages.listByCompany(companyId)` + `skills repo.listByCompanyMarketplaceSourced`（如该方法不存在，在 `packages/db-local/src/repos/skills.ts` 等价位置加一个 narrow query：`SELECT skill_id, source_ref FROM skills WHERE company_id = ? AND source_kind = 'marketplace'`），合并两份 listingId 进 `Set`。
- [ ] 2.3 订阅 `market.listing-installed` 事件，handler 守卫 `event.companyId === activeCompanyId`（spec Requirement #2 最后一条），命中则 `setInstalledListingIds(prev => new Set([...prev, event.listingId]))`。订阅需在 unmount + activeCompany 切换时正确 dispose。
- [ ] 2.4 activeCompanyId 切换：reset `installedListingIds` 为 empty Set 后立即重新 listByCompany（spec Requirement #4）。
- [ ] 2.5 把 `installedListingIds` 通过 `MarketPage` 顶层 props 喂下游 `MarketCardGrid` / `MarketDetailView`。Prop 命名 `installedListingIds: ReadonlySet<string>`（不允许下游 mutate）。

## 3. Stage C — UI: button + badge

- [ ] 3.1 `MarketDetailView.tsx` 接 `readonly installedListingIds: ReadonlySet<string>` 新 prop。`const isInstalled = installedListingIds.has(detail.listing_id) && INSTALLABLE_KINDS.has(detail.kind);` line 161-178 install 按钮分支：`isInstalled` → 文案 `Installed` + `disabled` + 视觉变弱（沿用 ui-core 已有 disabled 样式 token，不引入新色）。`onInstall` 在 isInstalled 时不绑定。
- [ ] 3.2 详情页 `MetaRow label="Installs"` 不动（spec Requirement #1 最后一条 — `install_count` 必须保留作平台全局指标）。**复核**：line 158 维持 `formatInstallCount(detail.install_count)`，不替换不复用为本机指标。
- [ ] 3.3 `MarketListingCard.tsx` 接同款 `installedListingIds` prop 或上层算好 `installed: boolean` 喂下来（看 prop sprawl 选）。已装时在卡片现有 `formatInstallCount(...) installs` 行**旁**渲 `Installed` badge（不替换 install_count，spec Requirement #1）。badge 用 `@offisim/ui-core` 已有 Badge primitive，不写新组件。
- [ ] 3.4 `MarketCardGrid.tsx` / `MarketPage.tsx` 把 `installedListingIds` props 透传到下游。检查 prop 链是否过深（>2 层）；若过深考虑 hook 直接被叶组件消费。
- [ ] 3.5 `MarketplaceDetailOverlay.tsx`（deep-link install path）也消费同款 prop / hook，避免 overlay 路径的 detail view 没已装态。

## 4. Stage D — Validation gates

- [ ] 4.1 `pnpm --filter @offisim/shared-types build && pnpm --filter @offisim/ui-core build && pnpm --filter @offisim/core build && pnpm --filter @offisim/ui-office build && pnpm --filter @offisim/web build`（串行）。
- [ ] 4.2 `pnpm --filter @offisim/web typecheck`。
- [ ] 4.3 `pnpm --filter @offisim/platform typecheck`（不变，confirm no regression）。
- [ ] 4.4 `pnpm openspec validate fix-market-post-install-state-refresh --strict`。

## 5. Stage E — Live verification

- [ ] 5.1 `pnpm --filter @offisim/ui-office build && pnpm --filter @offisim/desktop build`（origin-sync prebuild 应继续通过；这是无关验证 baseline）。
- [ ] 5.2 启 `pnpm --filter @offisim/platform dev`，开 release `.app`，进 Market。**Employee 路径**：找一条 `kind: 'employee'` listing（如 Sample Marketing Strategist，前次 verify 已知装过——若已存在已装行，删 `companies/<cid>/employees/sample-marketing-strategist/` + 对应 `installedPackages` 行后再跑），点 Install → Approve & Continue → Installation Complete → 详情页按钮 SHALL 切到 `Installed` disabled，无需手动刷新。截图为证。
- [ ] 5.3 同 session **Skill 路径**：找一条 `kind: 'skill'` 官方 listing，点 Install 走完整路径 → 详情页按钮同款切 `Installed`。截图为证。
- [ ] 5.4 回退到 grid 视图，`Installed` 角标 SHALL 在两条已装 listing 卡片上出现（与 `formatInstallCount` 平台值并存，不替换）。
- [ ] 5.5 切换 company（如有第二 company；若无，create 一个空 company），Market grid + 详情页 SHALL 不再展示 `Installed` 角标 / 按钮（spec Requirement #4）。切回原 company SHALL 恢复。
- [ ] 5.6 Negative：non-marketplace skill install（git / fork / upload / self-authored）SHALL NOT 触发 Market UI 状态变化（spec Requirement #3）。可以走 chat skill install workflow（`install_skill_from_git` 工具）或 fork existing skill 验证。这条若 live 太复杂，作 code-read evidence（grep 确认 emit 仅在 `marketplace` 分支）。

## 6. Stage F — Archive readiness

- [ ] 6.1 跨读 proposal / design / spec / 涉及代码注释 / `apps/desktop/CLAUDE.md` / `packages/ui-office/CLAUDE.md`，确认无过期 claim（特别是 `INSTALLABLE_KINDS` 的描述、Market workspace IA 段，若有需要同 change 内对齐）。
- [ ] 6.2 `pnpm openspec validate fix-market-post-install-state-refresh --strict` 通过。
- [ ] 6.3 协议台账 `openspec/protocols-ledger.md`：本 change 是 UI + 内部事件，不动外部协议；row 不需要更新（confirm only）。
- [ ] 6.4 commit + `/opsx:archive`。
