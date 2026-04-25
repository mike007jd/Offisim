## 1. Seed scaffolding

- [x] 1.1 在 `apps/platform/package.json` 的 `dependencies` 加 `@offisim/core` + `@offisim/renderer` + `@offisim/asset-schema`（缺什么补什么；asset-schema 已在则跳过）；运行 `pnpm install`
- [x] 1.2 新建目录 `apps/platform/src/seed/` 与 `apps/platform/src/seed/payloads/`
- [x] 1.3 新建 `apps/platform/src/seed/types.ts`，定义 `OfficialSeedPayload` 接口（`slug` / `kind` / `title` / `summary` / `description` / `version` / `runtime_range` / `schema_version` / `risk_class` / `manifest` / `tags` / `previews`）
- [x] 1.4 新建 `apps/platform/src/seed/official-seed.ts` 导出 `seedOfficialResources(db)`：先 `SELECT creator_id FROM creators WHERE handle='offisim'`，命中则直接 return；否则在一个 transaction 内插 creator + 6 listing + 6 version + ≥6 preview
- [x] 1.5 seed 函数对每条 payload 跑 `@offisim/asset-schema` 校验，invalid → `console.warn` 含 slug + 错误，跳过该条，继续余下
- [x] 1.6 整个 seed 用 try/catch 包，throw → `console.warn` 整批失败原因，**不 rethrow**，platform 继续起
- [x] 1.7 在 `apps/platform/src/index.ts` 的 DB 连接就绪后（migrate 完成之后）调一次 `await seedOfficialResources(db)`

## 2. Seed payloads

- [x] 2.1 `payloads/employee.ts`：从 `@offisim/core/templates/ai-startup` 取第一个员工，封装为 `EmployeeManifest`，slug `offisim/sample-marketing-strategist`，hero 用 inline SVG data URI（DiceBear 风格头像或简单几何）
- [x] 2.2 `payloads/skill-research-summary.md`：手写一份真 SKILL.md，frontmatter `name: research-summary` / `description`（描述何时触发，≥80 字以触发 SkillLoader 的 useful trigger 规则）+ body 100-250 字的研究摘要 SOP
- [x] 2.3 `payloads/skill.ts`：读取上面 .md 文件文本，封装为 SkillManifest（参考 `marketplace publish` 的 `buildSkillPackage` shape，把 SKILL.md 内容塞 `manifest.custom.skill_md_content`），slug `offisim/research-summary`
- [x] 2.4 `payloads/sop.ts`：手写一条 3-step SopDefinition manifest（research → outline → publish），slug `offisim/research-pipeline`
- [x] 2.5 `payloads/company-template.ts`：复用 `@offisim/core/templates/agency-lite` 整份 ProcessTemplate，封装为 company_template manifest，slug `offisim/agency-lite`
- [x] 2.6 `payloads/office-layout.ts`：从 `@offisim/renderer/prefab/default-zone-layouts` 引用一个 layout，封装为 office_layout manifest，slug `offisim/starter-layout`
- [x] 2.7 `payloads/prefab.ts`：从 `@offisim/renderer/prefab/builtin-catalog` 选 1 条代表 prefab（如 `desk-standard`），封装为 prefab pack manifest，slug `offisim/desk-essentials`
- [x] 2.8 在 `payloads/index.ts` 导出 `OFFICIAL_PAYLOADS: OfficialSeedPayload[]`，顺序固定 employee/skill/sop/company_template/office_layout/prefab

## 3. KIND_FILTERS UI 扩展

- [x] 3.1 修改 `packages/ui-office/src/components/marketplace/marketplace-meta.tsx`，将 `KIND_FILTERS` 扩到 7 项：`all` / `employee=Employees` / `skill=Skills` / `sop=SOPs` / `company_template=Templates` / `office_layout=Layouts` / `prefab=Prefabs`
- [x] 3.2 grep `KIND_FILTERS` 所有用法，确认 Market Explore 顶部 filter chip / Manage tab 切换 / detail 卡片 kind chip 全部正确处理新 4 项；任何 switch 写死 employee/skill 的地方补 default 兜底
- [x] 3.3 检查 `useMarketplace` / `useRegistry*` 的 query param 序列化，确认 `kind=sop` / `kind=office_layout` 等正确透到 `/v1/market/search`（已通用 string 透传则无改）

## 4. 构建 / 类型 验证

- [x] 4.1 串行 `pnpm --filter @offisim/asset-schema build && pnpm --filter @offisim/shared-types build && pnpm --filter @offisim/core build && pnpm --filter @offisim/renderer build && pnpm --filter @offisim/platform build`
- [x] 4.2 `pnpm --filter @offisim/platform typecheck` 必过
- [x] 4.3 `pnpm --filter @offisim/ui-office typecheck` 必过（KIND_FILTERS 扩展不应破坏类型）
- [x] 4.4 `pnpm --filter @offisim/web build` 串行验证 ui-office 改动没回归

## 5. Live verify (launcher / desktop dev mode)

> 要求：drop existing platform DB 或确认 `creators.handle='offisim'` 不存在，让 seeder 真跑一次。

- [x] 5.1 确认 platform DB 干净：`psql -d offisim_platform -c "DELETE FROM creators WHERE handle='offisim';"`（级联清掉 6 条 seed listing）
- [x] 5.2 起 launcher 或直接 `pnpm --filter @offisim/desktop dev`，让 platform 起来；观察 platform stdout 应有 seed 成功 log（一次性），无 ERROR
- [x] 5.3 浏览器打开 desktop webview，进 Market workspace → Explore tab，记录看到的 listing 数量与 kind 分布；预期 ≥6 条且每个 kind 各 1 条
- [x] 5.4 依次点 7 个 kind filter，每个返回 ≥1 条；截图或日志记录
- [x] 5.5 进 `offisim/sample-marketing-strategist` 详情页 → 点 Install → 验证员工真创建到 active company 的 employees 表（codex live: company `fe24a509…` 新增 `name=Sample Marketing Strategist` / `role_slug=sample_marketing_strategist`）
- [x] 5.6 进 `offisim/research-summary` 详情页 → 点 Install → 验证 `skills` 表新增一条 `scope=company source_kind=installed`，vault 里能读到 SKILL.md 文本（codex live: vault `companies/fe24a509…/skills/research-summary/SKILL.md` frontmatter + body 都正常）
- [x] 5.7 进 `offisim/research-pipeline`（sop）/ `offisim/agency-lite`（company_template）/ `offisim/starter-layout`（office_layout）/ `offisim/desk-essentials`（prefab）四个详情页，确认 install 按钮**不显示**，详情卡片正常渲染（title/summary/hero/version chip）（codex live: 4 条都显示 `Install not available for ... packages`，title/summary/version 1.0.0/creator/permissions 全正常渲染）
- [x] 5.8 重启 platform 一次，观察 stdout：seed 函数应直接 skip（无插入 log），listing 数量保持 6 条（codex live: stdout `rebuilt in-memory artifacts for 6/6 seeded listings`，DB 6 条不变；rebuild 是 D2 设计的 artifact-store warm-up，不写 DB）
- [x] 5.9 删一条 seed listing（`DELETE FROM listings WHERE slug='offisim/research-pipeline'`）+ 重启 platform：seed 仍 skip（D2 设计：只看 creator 存在，不看每条 listing）；用户需手动删 creator 才会触发 re-seed（codex live: stdout `5/6`，DB 仍 5 条不补回，确认只看 creator 不补 listing）

## 6. Docs / 收尾

- [x] 6.1 更新 `apps/platform/CLAUDE.md`：新增一节说明 boot-time official seed 行为（idempotency 钥匙 = creator handle）+ 如何 re-seed（`DELETE FROM creators WHERE handle='offisim'` 重启）
- [x] 6.2 更新 `packages/ui-office/CLAUDE.md` `INSTALLABLE_KINDS` 行：澄清 `KIND_FILTERS` 已扩到 7 项但 `INSTALLABLE_KINDS` 仍只 employee+skill；其余 4 类只做 preview
- [x] 6.3 在 `openspec/protocols-ledger.md` 检查是否需要新行（asset-schema 是自家 schema，不是上游协议；SKILL.md 已有 ✅ 行）；无需新增
- [x] 6.4 5.1–5.9 全 PASS 后 archive 时同步 canonical `marketplace-official-seed` spec 至 `openspec/specs/`（落到 `openspec/specs/marketplace-official-seed/spec.md`，含 8 个 Requirement / 24 个 Scenario；`openspec validate` PASS）
- [x] 6.5 archive gate 三查：spec 一致 / tasks 一致 / 文档（platform CLAUDE.md + ui-office CLAUDE.md）一致 — spec 落差补齐两条（subsequent boot in-memory rebuild scenario + 新增 "Seeded artifacts MUST be served by the platform" requirement 含 `/v1/install/artifacts/:versionId` 路由 + 跨重启 install + 404 fallback 三 scenario）；tasks 5.x 全勾带 codex live evidence；platform CLAUDE.md "Boot-time official seed" 节 + ui-office CLAUDE.md INSTALLABLE_KINDS 行已对齐；协议台账无需新增（asset-schema 自家、SKILL.md 已 ✅）
