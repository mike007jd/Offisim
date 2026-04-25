## Why

Platform `listings` 表当前 0 条数据，Market workspace 在 launcher / desktop dev mode 起来后只有空态或 503，所有 Phase F 后续 change（F1 删除 Market 外部员工卡片、未来 Market 相关重构）都没有可 live verify 的对象。同时 `KIND_FILTERS` 只暴露 `all / employee / skill` 三项，即便 seed 了其他 kind 用户也无法在 UI 里筛到。F0 是整个 Phase F 的强阻塞前置——必须让 launcher 起测试服后 Market 至少能预览到 Offisim 自家每一类官方资源。

## What Changes

- platform 启动时自动 seed 一条 `creators` 行（handle = `offisim`）和 6 条 `listings` + `package_versions` + `listing_previews`，每个 `AssetKind` 各一条（`employee` / `skill` / `sop` / `company_template` / `office_layout` / `prefab`）。Idempotent：只在 `creators.handle = 'offisim'` 不存在时整批写入，存在则完全跳过；不引入 `pnpm seed` 单独入口
- 将 `KIND_FILTERS` 从 3 项扩到 7 项（含 `all` + 6 个 AssetKind），让 Market Explore tab 顶部按 kind 过滤每一类都能命中至少 1 条
- `INSTALLABLE_KINDS` **不变**，仍然只含 `employee` + `skill`。其余 4 类只做 preview / detail 视图，install 按钮自然 gate 掉，不写半成品 install 路径
- seed payload 复用仓库已有产物作为源真相（避免凭空捏造）：employee 从 `packages/core/src/templates/*.ts` 导出的内置员工抽样、prefab 从 `packages/renderer/src/prefab/builtin-catalog.ts`、SOP 从内置 SOP 模板、company_template 同上、office_layout 从内置 layout、skill 写一条最小可装的真 SKILL.md（research-summary 之类），保证 install employee + install skill 路径在 seed 数据上真能跑完
- 不动 launcher 启动流程；platform 没起时 Market 仍显示原 503 错误（属 H 阶段或后续问题，本 change 不收）

## Capabilities

### New Capabilities
- `marketplace-official-seed`: platform boot 时保证 Offisim 官方 creator + 每类 AssetKind 至少 1 条 listing 存在；Market UI 按 7 个 kind 过滤器正确渲染并对每类返回 ≥1 条结果；2 个 `INSTALLABLE_KINDS`（employee + skill）的 seed 必须真实可装，其余 4 类只做 preview

### Modified Capabilities
- (无) — Market UI / KIND_FILTERS 当前没有 canonical spec 覆盖，新规则全部落进上面新建的 `marketplace-official-seed`

## Impact

- **新增**：
  - `apps/platform/src/seed/` 新目录，含 `official-seed.ts`（boot-time 调用入口）+ `payloads/` 子目录存 6 类 seed source（其中 SKILL.md 是真 frontmatter+body 文本）
  - `apps/platform/src/index.ts` 在 DB 连接就绪后调用 seeder（fail-soft：seed 失败不阻断启动，写 warn log）
- **修改**：
  - `packages/ui-office/src/components/marketplace/marketplace-meta.tsx`：`KIND_FILTERS` 扩到 7 项（Sets/SOPs/Templates/Layouts/Prefabs labels）
  - `packages/db-platform`：可能加一条新 migration（如果 seed 走 SQL）或不加（如果走 TypeScript seeder 直接 INSERT，推荐后者——payload 复用 TypeScript 源更顺，避免在 SQL 里手抄 manifest_json）
- **依赖**：seed 直接 `import` `@offisim/core` 内置模板和 `@offisim/renderer` 内置 prefab catalog；platform 已经依赖这两个 workspace 包没有的话需要补 `package.json` deps
- **下游**：F1 / 任何 Market 相关 change live verify 都基于本 change 产出
- **不影响**：launcher 启动逻辑、registry-client API、Market 已实现的 install pipeline（employee/skill install 走老路）、用户已发布的真实 listings（seed 是独立 creator handle，不会撞名）
