## 1. BrandRegistry + 2D 资产

- [x] 1.1 新建 `packages/ui-office/src/assets/brands/` 目录，放 4 张占位 SVG：`hermes.svg`（简笔女孩头像）/ `openclaw.svg`（红色龙虾剪影）/ `codex.svg`（蓝色 CLI 图标）/ `custom.svg`（紫灰问号方块）。每张 viewBox `0 0 100 100`，≤50 KB，中心主体在 80% 内区。
- [x] 1.2 新建 `packages/ui-office/src/lib/brand-registry.ts`：定义 `BrandVariant` 字面量 union (`'default' | 'hermes' | 'openclaw' | 'codex' | 'custom'`) + `BrandEntry` 接口 + `REGISTRY` 常量对象 + `resolveBrand(employee)` 函数（按 design §9 合约）+ 具名常量 `HERMES_BRAND` / `OPENCLAW_BRAND` / `CODEX_BRAND` / `CUSTOM_BRAND` 导出。

  **偏离 design §2 / D2**：ui-office 经 `tsc` 编译（非 Vite），所以 `import hermesSvg from '.../hermes.svg?url'` 在 typecheck 阶段就会炸。改用同构 inline SVG 字符串方案：SVG 文件照落盘（spec 要求文件存在），同时在 `brand-svg-sources.ts` 里维护同等 XML 字符串 + `svgToDataUri()` 转 data URI；registry 的 `asset2dUri` 取 data URI。Art team 换资产时两边都要改一次。spec 层 "URI derived from the matching .svg file" 仍成立（data URI 派生自 SVG 文本）。

- [x] 1.3 `pnpm --filter @offisim/ui-office build` 绿；`resolveBrand` 四个 scenario 通过类型推理 + 代码静态检查正确：internal → `{kind:'internal'}`；`brand_key='hermes'` → `entry.brandKey==='hermes'`；未知 key → `CUSTOM_BRAND`；null key → `CUSTOM_BRAND`。

## 2. BrandAvatar2D 组件

- [x] 2.1 新建 `packages/ui-office/src/components/shared/BrandAvatar2D.tsx`：接口 `{ brandKey: string | null; size?: number; className?: string }`。内部调 `resolveBrand({ is_external: 1, brand_key: brandKey })`，拿 `entry.asset2dUri`，渲染 `<img src={uri} width={size} height={size} className={...}>`，`rounded-full` 样式与 `DicebearAvatar` 等价。
- [x] 2.2 组件 JSDoc 注释说明调用方不应把 internal employee 丢给本组件（内部应走 `DicebearAvatar`）。

## 3. 3D LowPolyCharacter variant 扩展

- [x] 3.1 `packages/ui-office/src/components/scene/office3d-employees.tsx` `LowPolyCharacter` 加 `variant?: BrandVariant` prop，默认 `'default'`。早返 `'default'` 分支保留原块人 geometry + 原 `outfitColor` / `skinTone` 行为；byte-identical（原 10 个 mesh 原位复制）。
- [x] 3.2 新文件 `office3d-brand-variants.tsx` 导出 `HermesBody`：slim body + hair mesh + winged emblem 头顶标识，品牌色 indigo/purple；limbRefs 四槽对齐 default。
- [x] 3.3 同文件 `OpenClawBody`：红色椭球 body + 两 claw mesh；legs 走 `visible={false}` 隐形占位保持 limb ref 可动画。
- [x] 3.4 同文件 `CodexBody`：bluish body + 头顶左右两根旋转 box 模拟 `<>` 代码符号 + 胸前高亮条。
- [x] 3.5 同文件 `CustomBody`：紫灰 body + 固定浅灰 skin，不加额外 brand 特征（visually 不同于 default 又不冒充任何品牌）。
- [x] 3.6 所有 variant 共享 `limbRefs` 接口；`LowPolyCharacter` 外层 `useAgentAnimation(state, { groupRef, ringMatRef })` + selection ring 走 `groupRef` 是 variant-agnostic 的共享路径。Live verify (§9.3–9.6) 跑 ceremony 动画观察。

## 4. AgentState / PlacedEmployee / EmployeeRenderData 透字段

- [x] 4.1 `packages/ui-office/src/runtime/use-agent-states.ts`：`AgentState` 加 `isExternal?: boolean` + `brandKey?: string | null`；`buildAgentStateMap` 接受的 row 类型扩 `is_external?: number` + `brand_key?: string | null` 可选字段，ingest 时 `isExternal = row.is_external === 1` + `brandKey = row.brand_key ?? null`。
- [x] 4.2 `office3d-employees.tsx` `PlacedEmployee` 通过 `emp.agent.isExternal` / `emp.agent.brandKey` 访问；`EmployeeMarker` 调 `resolveBrand({ is_external: ... ? 1 : 0, brand_key: ... })` 分支渲染。
- [x] 4.3 `office-2d-canvas-renderer.ts` `EmployeeRenderData` 加 `isExternal: boolean` + `brandKey: string | null`；`use-scene-snapshot.ts` `push(...)` 从 AgentState 透出。

## 5. 2D canvas 渲染分支 + cache key 扩展

- [x] 5.1 `office-2d-avatar-cache.ts` cache key 从 `${companyId}:${seed}` 分裂为 `${companyId}:dicebear:${seed}` + `${companyId}:brand:${brandKey||'custom'}`；新增 `getBrandAvatarImage(brandKey, companyId, onReady)` 从 BrandRegistry 读 SVG data URI。原 `getAvatarImage(seed, companyId)` 接口不变，仍是 internal 路径。`clearAvatarCache` 共用 LRU 一次清两路。
- [x] 5.2 分支收敛在 `use-scene-snapshot.ts` `loadAvatar()` 里（design §4 允许 render-data 构造层分支；snapshot 本身仍然是"resolver 消费者"而非 state holder）。`draw-employees.ts` 保持 `drawAvatarCircle(ctx, ..., { avatarImage: emp.avatarImage })` 不动 —— 避免同一逻辑两处散落。注：该偏离不影响 spec 的行为要求（internal 走 DiceBear、external 走 brand SVG），只是分支点从 draw helper 抬到 snapshot builder。
- [x] 5.3 Live verify 2D（合并到 §9.3–§9.6，PASS）。

## 6. 3D scene 渲染分支

- [x] 6.1 `office3d-employees.tsx` `EmployeeMarker` 调 `resolveBrand(emp.agent)`。internal 传 `variant='default'` + `outfitColor={outfit}` + `skinTone={skin}`；external 传 `variant={brand.entry.asset3dVariant}` 不传 outfit/skin。
- [x] 6.2 Live verify 3D（合并到 §9.3–§9.6，PASS；外包 Alex + internal Maya `dispatchEmployeeToWorkspace` movement 采样各 12 / 8 帧，maxMoving=1，位置连续）。

## 7. 列表 UI 分支

- [x] 7.1 `AgentCard.tsx`：`agent.isExternal` → `<BrandAvatar2D brandKey={agent.brandKey}>`；internal 保留 `<DicebearAvatar seed=...>`。
- [x] 7.2 `EmployeeInspector.tsx`：`employee?.is_external === 1 || agent.isExternal` 二者 OR（employee 先到准，agent 兜底）→ `<BrandAvatar2D brandKey=...>`；internal 保留 `<DicebearAvatar>`。
- [x] 7.3 `TeamHealthCard.tsx`：`agent.isExternal` 分支同 AgentCard。
- [x] 7.4 `EmployeeCreatorOverlay.tsx`：`onDeploy` 是创建流（internal-only wizard，per design §Non-Goals）；读代码确认无"编辑 existing" 分支，**不需要改**。
- [x] 7.5 `DeliverableCard.tsx`：`ContributorStack` 里 contributor metadata (`Deliverable.contributingEmployees[i]`) 无 `isExternal`；保留 DiceBear + 加 TODO 注释指向 Phase 2b 第 2 条 followup。

## 8. AvatarCustomizer external-employee disable

- [x] 8.1 入口是 `EmployeeInspector` "Edit Details" → `EmployeeEditorDialog`（内含 `<AvatarCustomizer>`）。`useEmployeeEditor` → `EmployeeFormData` 加只读 `isExternal` + `brandKey`；`rowToFormData` 注入；`DEFAULT_FORM` + `DEFAULT_WIZARD_FORM` 默认值补齐。EditorDialog Profile tab 内 AvatarCustomizer 前置 `formData.isExternal` 分支：true → 只读 banner "This employee uses its brand's built-in avatar and cannot be customized."；false → 原 AvatarCustomizer。
- [x] 8.2 banner 容器带 `data-testid="external-avatar-disabled"`。
- [x] 8.3 internal 员工分支未动 AvatarCustomizer 调用 props（Profile tab 其他字段 byte-identical）。

## 9. Verification (typecheck + build + live + bundle budget)

- [x] 9.1 串行 `pnpm --filter @offisim/shared-types build && pnpm --filter @offisim/ui-core build && pnpm --filter @offisim/core build && pnpm --filter @offisim/ui-office build && pnpm --filter @offisim/web build` 全绿。
- [x] 9.2 Bundle budget check：`apps/web/dist/assets/` 前 5460 KiB → 后 5468 KiB，净增 **+8 KiB**（远低于 500 KB 上限；inline SVG data URI 压缩后在 index bundle 内，故无独立 chunk 体现）。
- [x] 9.3 Live verify — internal 员工回归：Maya（internal）Team 卡头像 `alt="Maya Lin"`，Editor 无 `external-avatar-disabled` banner；Clothing accent / Hair style controls 在；3D `dispatchEmployeeToWorkspace(maya)` 8 帧采样 maxMoving=1，位置连续，未卡死。
- [x] 9.4 Live verify — external Hermes：Alex 切到 `is_external=1, brand_key='hermes'` 后，Team/Inspector 头像 `alt="Hermes"`；3D runtime `isExternal:true, brandKey:'hermes'`；2D canvas fingerprint `9f143d0f1b114f74`。
- [x] 9.5 Live verify — external OpenClaw：同 Alex `brand_key='openclaw'` 后，Team 头像 `alt="OpenClaw"`；3D `brandKey:'openclaw'`；2D canvas fingerprint `aba4604aac59bd0b`。
- [x] 9.6 Live verify — external custom fallback：同 Alex `brand_key='totally-unknown-brand'`，Team/Inspector 头像 `alt="Custom"`；3D external 状态保留原 key（runtime 层透传），fallback 在 live canvas 生效；2D fingerprint `596e693598028633`，无崩溃。
- [x] 9.7 Live verify — AvatarCustomizer disable：external Alex Editor 命中 `data-testid="external-avatar-disabled"`，文案 "This employee uses its brand's built-in avatar and cannot be customized."；internal Maya 同路径完整 pickers 仍在，无 banner。

## 10. Archive & spec sync

- [ ] 10.1 `/opsx:archive add-external-employee-brand-avatars` — `external-employee-brand-avatars` canonical spec 新增。
- [ ] 10.2 更新 MEMORY.md Phase 2b 条目：第 2 条打勾 + archive commit SHA。
- [ ] 10.3 单 commit 收口（feat/ui-office），commit message 简述"external employee 渲染分支落地 + BrandRegistry SSOT + 首批 3 brand + custom fallback；第 3 条 install UI 后续"。
