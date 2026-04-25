## Context

Market workspace 的真相数据源是 platform PostgreSQL 的 `listings` / `package_versions` / `listing_previews` / `creators` 表（schema 见 `packages/db-platform/src/migrations/002_registry_core.sql`）。线索：

- migration 全是 schema-only，0 条 INSERT，0 个 seed 脚本
- platform 入口 `apps/platform/src/index.ts` 起来后只跑 migrate，不种数据
- registry-client 只走真 HTTP，无本地 fixture fallback；platform 503 / 空表 → Market 显示 "Marketplace service unavailable" 或空 grid
- `useMarketplace` hook 拉 `/v1/market/search`，shape 里没有 demo flag
- `KIND_FILTERS` 只暴露 `all / employee / skill`，即便 DB 里有其他 kind 的 listing 也无 UI 入口筛
- 仓库内已有可复用为 seed payload 的 source-of-truth：
  - 5 条公司模板 `packages/core/src/templates/{ai-startup,agency-lite,content-studio,product-team,rd-company}.ts`
  - 200+ prefab `packages/renderer/src/prefab/builtin-catalog.ts`
  - default zone layout `packages/renderer/src/prefab/default-zone-layouts.ts`
- 仓库**没有**现成的 SOP fixture 文件、SKILL.md fixture、或独立 layout pack manifest——这三类要在本 change 里手写最小 seed payload

## Goals / Non-Goals

**Goals:**
- launcher 起 desktop dev → 打开 Market Explore tab → 看到 6 条 Offisim 官方 listing（每个 AssetKind 各一条）
- Kind filter 在 UI 里有 7 项（`all` + 6 个 kind），任选一项都返回 ≥1 条结果
- 2 个 `INSTALLABLE_KINDS`（`employee` + `skill`）的 seed 真能走完 install 流程，不靠 placeholder
- Seed 是 idempotent 的，重启 platform 不会复制行
- Seed 不阻断启动：DB 写入失败 → warn log，platform 继续起
- 不引入 launcher 行为变化、不引入新 build script、不引入新 npm dep

**Non-Goals:**
- 不实现 `sop / company_template / office_layout / prefab` 的 install pipeline（仍由 `INSTALLABLE_KINDS` gate 掉 install 按钮）
- 不修复 platform 没起时 Market 的 503 表现（属后续 Settings / Launcher 阶段）
- 不在 Market UI 加 "Demo content" 标签（seed 内容就是真 Offisim 资源，不是 mock；不要给真内容打 demo 标）
- 不动 publish / draft / install_receipt 流程
- 不动 db-platform schema（无新 migration）

## Decisions

### D1. Seed 走 TypeScript 入口，不走 SQL migration
- **选择**：`apps/platform/src/seed/official-seed.ts` 在 boot 时执行
- **替代方案**：`packages/db-platform/src/migrations/007_seed_offisim.sql` 一条 INSERT migration
- **理由**：seed payload 含从 `@offisim/core` templates 和 `@offisim/renderer` prefab catalog 实时拉取的字段（如果以后 templates 改名了 SQL 写死的 manifest 会过期）；TS 侧 import 这两个 workspace 包后字段始终随源走。SQL migration 还有"执行一次后无法 re-seed"的副作用，不利于 dev DB 重置后无脑跑通

### D2. Idempotency 钥匙 = `creators.handle = 'offisim'` 是否存在
- **选择**：seed 函数第一行 `SELECT creator_id FROM creators WHERE handle = 'offisim'`，命中则直接 return（整批 skip）
- **替代方案**：每条 listing 用 `INSERT ... ON CONFLICT (slug) DO NOTHING`
- **理由**：批整体一致性更强（要么 6 条全在要么 6 条全不在），避免半状态；用户如果手动删了某条 seed listing，重启 platform 也不会偷偷补回（符合"用户操作优先"原则）。如果 dev 想强制 re-seed，删 creator 行即可级联清掉所有 6 条 listing + version + preview

### D3. `INSTALLABLE_KINDS` 不变，preview-only 类靠现有 gate
- **选择**：保持 `INSTALLABLE_KINDS = {employee, skill}`，sop / company_template / office_layout / prefab 的 listing 在详情页 install 按钮自动隐藏（现成 gate）
- **替代方案 A**：扩 `INSTALLABLE_KINDS` 到 6 类 → 触发未实现的 install pipeline → 必然假绿
- **替代方案 B**：给 seed listing 加 `is_demo` 字段 + UI 标签 → 污染 schema、Offisim 自家资源不该叫 demo
- **理由**：F0 验收只要求 preview，install 按钮自然 gate 比新增字段干净。不开新 install 路径就不会有半成品

### D4. KIND_FILTERS 扩到 7 项 + KIND_ICON 复用
- **选择**：`marketplace-meta.tsx` 的 `KIND_FILTERS` 数组直接列 7 项，label 对应 `Employees / Skills / SOPs / Templates / Layouts / Prefabs`
- **替代方案**：从 `KIND_ICON` 自动派生（programmatic）
- **理由**：手列 7 项控制 label 文案和顺序更直接，未来加 kind 也是手改一行；programmatic 派生看似优雅但 label 顺序不可控

### D5. Seed 资产源
- **employee**：从 `packages/core/src/templates/ai-startup.ts` 第一个员工抽出来，封装成 `EmployeeManifest`（schema 在 `@offisim/asset-schema`），slug = `offisim/sample-marketing-strategist`
- **skill**：手写一份最小 SKILL.md（name + description + body 250 字内），slug = `offisim/research-summary`
- **sop**：手写一条最小 SopDefinition manifest（3 个 step 的内容研究流程），slug = `offisim/research-pipeline`
- **company_template**：复用 `packages/core/src/templates/agency-lite.ts` 整份，封装成 company_template manifest，slug = `offisim/agency-lite`
- **office_layout**：手写一条最小 layout pack（引用 `default-zone-layouts.ts` 的 4 个 zone），slug = `offisim/starter-layout`
- **prefab**：从 `builtin-catalog.ts` 选 1 个代表 prefab（如 `desk-standard`）封装为 prefab pack manifest，slug = `offisim/desk-essentials`

### D6. Seed payload 子目录布局
- `apps/platform/src/seed/official-seed.ts`：boot 入口，封装 idempotency 检查 + 6 条插入
- `apps/platform/src/seed/payloads/employee.ts` etc.：每类一个文件，导出 `{ slug, title, summary, description, manifest, hero_url, tags }`
- `apps/platform/src/seed/payloads/skill-research-summary.md`：真 SKILL.md 文本（用 `import.meta.url` + fs read 读，或 build 时 inline 字符串）
- `apps/platform/package.json` deps 加 `@offisim/core` + `@offisim/renderer`（如未在）

### D7. Hero / preview 图
- **选择**：6 条 listing 的 `hero_url` / `listing_previews.url` 用 placeholder 字符串（如 `data:image/svg+xml;base64,...` inline SVG），不引入新静态资源
- **替代方案**：搬一组真图进 `apps/platform/public/seed/`
- **理由**：F0 优先打通信息架构，让卡片不空白即可；后续 H 阶段 / 美术专项可以补真图

## Risks / Trade-offs

- [seed 与未来真发布 listing 撞 slug] → 用 `offisim/` 前缀的 slug，规约 platform 不允许 publish 这个前缀（保留命名空间），或在文档里声明该前缀只给官方用。本 change 不强制 enforcement，**先约定不写校验**
- [import @offisim/core 到 platform 体积膨胀] → core/browser entry 已经分了，但 templates 目录纯数据应该没大依赖；监控 platform `dist` 体积，超 +500KB 时考虑改成 JSON 抽取
- [手写 SOP / layout / skill manifest 与 schema drift] → 用 `@offisim/asset-schema` AJV 校验 seed payload，启动时若 invalid → warn log + skip 该条（不阻断）；schema 变了 seed 会立刻吵
- [creators 表已有 'offisim' handle 但不是官方 seed（dev 自己注册的）] → idempotency 命中后直接 return，dev 自己的 creator 不会被覆盖；若用户撞名，需要 dev 手动改 handle
- [KIND_FILTERS 从 3 扩到 7 影响现有 dev 验证习惯] → 文案紧凑（每个 label 一词），不会破坏宽度；不影响 publish flow
- [seed 失败模式] → 任何 SQL 错误 catch 后只 warn log，platform 继续起；防止 schema drift / DB connection 抖动把 platform 拽崩

## Migration Plan

- 不需要 migration（D1）；新装 platform 第一次跑 boot 自动种
- 已有 dev DB：boot 自动检测 → 没有 'offisim' creator → 写入；若用户已手动建过同名 creator，跳过
- Rollback：`DELETE FROM creators WHERE handle = 'offisim'` 级联清掉所有 6 条 listing + version + preview；删 `apps/platform/src/seed/` 目录 + `index.ts` 调用 + `marketplace-meta.tsx` 多余 4 项 filter

## Open Questions

- 是否要在 listings 加 tag `official` / `featured` 让 UI 之后能高亮 Offisim 自家内容？**当前先不加**；H 或后续 change 真要做 featured section 时再补
- 是否需要 `OFFISIM_DISABLE_OFFICIAL_SEED=1` env 给 CI / 测试关 seed？**当前先不加**；platform 进 CI 的场景目前没有，需要再加
