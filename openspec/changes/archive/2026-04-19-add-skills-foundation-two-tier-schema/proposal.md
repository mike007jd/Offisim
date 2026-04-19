## Why

2026-04-19 定稿的 1.0 roadmap 把 Skills Pillar 列为"立项漏了的核心差异化"（T2 整块 7 条 change），Offisim 的核心 loop "员工做任务 → 沉淀 skill → 互传 → 自改进" 里 skill 是唯一还不存在的一等实体。**现状**：员工能力通过 `employee.config_json.runtimeSkill`（单条嵌入 JSON）表达，不是独立实体；`INSTALLABLE_KINDS` 写死 `['employee']`，`PublishDialog` 只发员工；`SkillBindingList` UI 文案写 "install a skill package from the marketplace" 但产品里根本没这条路径。协议台账（`openspec/protocols-ledger.md` #6）标记 "SKILL.md 未接 / ❌"。

T2.1 是 Skills Pillar 第一块砖，负责**把骨头架起来**：直接采用 Anthropic **SKILL.md 开放标准**（2025-12，`anthropics/skills` 120k stars，19 家 agent 互通，不自造）作 skill 格式；落地**两层 schema**（company 全局层 + employee 专属层）作为并列实体；打通 vault 磁盘布局 → DB 索引 → loader progressive disclosure → 员工 prompt 装配 → Marketplace 内部装发整条链路。后续 T2.2 跨源导入 / T2.3 fork / T2.4 自创 / T2.5 互传 / T2.6 自改 / T2.7 UI surfacing 都挂在本次落的 schema 上，不重构。

## What Changes

**一等实体 + 两层 schema**
- 新增 `skill` 作一等实体。两层 scope：**全局层** = 公司下全员可见（`scope: 'company'`, `employee_id: null`），**员工专属层** = 只绑给某员工（`scope: 'employee'`, `employee_id: <fk>`）。两层 row 住同一张 `skills` 表，scope + employee_id 区分。
- 全局 skill 员工可见但不可改（后续 T2.3 fork 会复制一份到员工层再改）；员工专属 skill 只对该员工的 prompt 可见。
- 员工在 prompt 装配时看到 **merged list** = `(company global) ∪ (own employee-specific)`。

**SKILL.md 开放标准为 skill 持久化格式**
- Skill 源真相是磁盘上一个目录，目录内必有 `SKILL.md` + YAML frontmatter（`name` / `description` 必填，kebab-case name）；可选 `scripts/` / `references/` / `assets/` 兄弟目录。解析 / 生成走同一套，纯 Anthropic SKILL.md 开放规范，不扩私有字段。
- 三层 progressive disclosure 契约：
  1. **Startup / listing**：只读 SKILL.md frontmatter `name + description`（DB 索引字段冗余一份，listing 零磁盘 IO）
  2. **Activation**：LLM 决定用某 skill 时读 SKILL.md body 全文
  3. **On-demand**：body 里引用的 `scripts/*` / `references/*` / `assets/*` 按需读

**Vault 磁盘布局**
- 全局：`${vaultRoot}/companies/{companyId}/skills/{skillSlug}/SKILL.md` (+ 可选 scripts/references/assets)
- 员工专属：`${vaultRoot}/companies/{companyId}/employees/{employeeSlug}/skills/{skillSlug}/SKILL.md` (+ 可选兄弟)
- `skillSlug` = 从 frontmatter `name` 派生的 filesystem-safe kebab-case；和 `employeeSlug` 同策略（纯非 ASCII fallback `skill-{id前8字符}`）
- Vault 是 **源真相**（git-friendly，跨工具复用 SKILL.md 生态）；DB 是**索引层**（listing / prompt 装配高频路径）

**DB schema (新表 + 迁移)**
- 新表 `skills`：`skill_id TEXT PK` / `company_id TEXT FK NOT NULL` / `employee_id TEXT FK NULLABLE` / `scope TEXT NOT NULL CHECK in ('company','employee')` / `slug TEXT NOT NULL` / `name TEXT NOT NULL` / `description TEXT NOT NULL` / `version TEXT NOT NULL DEFAULT '0.1.0'` / `source_kind TEXT NOT NULL CHECK in ('authored','installed','forked','synthesized')` / `source_ref TEXT NULL`（install 的 registry listingId / fork 的父 skill_id / synthesized 的生成上下文 hash）/ `vault_path TEXT NOT NULL`（相对 vault root）/ `created_at INTEGER` / `updated_at INTEGER`
- 唯一约束：`UNIQUE(company_id, employee_id, slug)`（员工 vs 全局通过 employee_id NULL 区分）
- 迁移：db-local migration 025 + desktop SQL plugin embed version 31；db-platform 不动（platform 不落员工数据）

**员工 ↔ skill 绑定（取代 `runtimeSkill` embed）**
- 删除 `EmployeeConfig.runtimeSkill` + `RuntimeSkillConfig` 类型（schema level）。
- 员工可见 skill 由 `listSkillsForEmployee(companyId, employeeId)` 查询，返回 company scope + 该员工 scope 的合并列表。
- 旧数据一次性 bootstrap 迁移：读每个员工 `config_json.runtimeSkill`（如存在），在其员工专属目录生成 `SKILL.md` + 插 `skills` 行 `scope='employee', source_kind='synthesized', source_ref='legacy:runtimeSkill'`；迁移完 strip `runtimeSkill` 字段。迁移失败视作脏数据在 migration 中丢弃（pre-launch policy，不写兼容分支）。

**Loader / prompt assembly**
- 新 `SkillLoader` 服务 (core 侧)，两个公开 API：
  - `listSkillsForEmployee(companyId, employeeId): SkillMetadata[]`（progressive disclosure tier 1，DB 查询，零磁盘 IO）
  - `loadSkillBody(skillId): string`（tier 2，读 SKILL.md）
  - `loadSkillAsset(skillId, relPath): Buffer | string`（tier 3，按需）
- `employee-prompt-assembly.ts` 消费 tier 1 metadata：员工 system prompt 注入一小段 "Available skills" 清单（每项 `name` + `description`，一行一条），LLM 若要激活通过工具调用 `activate_skill(name)` 拿 body。激活机制本 change 不落（T2.4 / T2.7 会细化），本 change 先把 metadata 注入做实，body 读取 API 暴露但 prompt 层不触发。

**Marketplace `skill` 作新 asset kind**
- `INSTALLABLE_KINDS` 扩到 `['employee', 'skill']`。
- `PublishDialog` 增加 skill 发布流程：用户从员工专属 skill 中选一条 → 目录打包（SKILL.md + 可选子树）→ 上平台 registry（manifest kind `skill`，body 作 `content.md`）。
- 安装方向：Market → Explore 模式 Kind 过滤增 "skill"；点 Install → 落到当前公司 **全局层** (`scope='company', source_kind='installed', source_ref=listingId`)，员工立刻 merged list 可见。
- 平台 registry 的 `Listing.kind` union 已允许任意字符串（platform/registry-client 校验），本次只在客户端/UI 侧生效。若后续平台加 whitelist 单独迁移。
- **BREAKING**：`INSTALLABLE_KINDS` 长度从 1 变 2；`KIND_FILTERS` 长度从 2 变 3；`PublishDialog` 表单增 kind selector。所有直接写 `'employee'` assertion 的代码需改 union 分支。

**不在本次范围**
- 不做外部 URL / 本地文件导入（T2.2）
- 不做 fork 语义（T2.3）
- 不做员工自动创 skill（T2.4）
- 不做员工互传（T2.5）
- 不做 skill in-use 自改（T2.6）
- 不做 "获得 / 使用 / 交流" UI 气泡（T2.7）；`SkillBindingList` 这次只做最小更新（从单 skill 视图改多 skill 列表 + 区分 scope），不重做交互。

## Capabilities

### New Capabilities

- `skills-foundation`: SKILL.md 格式契约 + 两层 schema（company global / employee scope）+ vault 磁盘布局 + DB 索引 + SkillLoader progressive disclosure（3 tier）+ 员工 prompt 装配 merged list + Marketplace skill 作 asset kind（publish + install）+ 旧 `runtimeSkill` embed 一次性迁移删除。**不**覆盖 import / fork / self-create / peer-transfer / self-improve / UI surfacing。

### Modified Capabilities

- 无。旧 `runtimeSkill` embed 没有对应 capability spec（只是 `EmployeeConfig` 字段），删除按"pre-launch drop dirty data"走，不产生 delta spec。

## Impact

**New code**
- `packages/core/src/skills/skill-md.ts` — SKILL.md 解析 / 序列化（纯函数，无 IO），YAML frontmatter + markdown body；禁私有字段扩展
- `packages/core/src/skills/skill-loader.ts` — `SkillLoader` 服务，实现 3-tier disclosure API；依赖 `VaultSyncService` 做磁盘 IO
- `packages/core/src/skills/skill-repo.ts` — DB 读写（按 scope / 按 employee 查询）
- `packages/core/src/skills/skill-slug.ts` — 从 name 派生 slug（复用 `employeeSlug` 策略）
- `packages/shared-types/src/skill.ts` — `SkillMetadata` / `SkillScope` / `SkillSourceKind` / `SkillRow` 类型
- `packages/db-local/src/migrations/025-skills-table.sql` — 新表
- `apps/desktop/src-tauri/src/migrations.rs` — embed version 31

**Modified**
- `packages/shared-types/src/json-field-parsers.ts`：删 `RuntimeSkillConfig` / `RuntimeSkillCapability`；`EmployeeConfig.runtimeSkill` 删；加 migration-time 兜底（migration 跑完后类型层直接不存在）
- `packages/core/src/agents/employee-prompt-assembly.ts`：替换 `runtimeSkill` 分支为调用 `SkillLoader.listSkillsForEmployee`
- `packages/core/src/agents/employee-tool-round.ts`：任何读 `config.runtimeSkill` 处一律切换
- `packages/ui-office/src/hooks/useEmployeeEditor.ts`：移除 runtimeSkill 读写；改 `useSkillsForEmployee(employeeId)` 查询 hook
- `packages/ui-office/src/components/employees/SkillBindingList.tsx`：从单 skill 卡片改列表视图（global 全列 + 员工专属区分 badge）；不做新交互
- `packages/ui-office/src/components/marketplace/marketplace-meta.tsx`：`INSTALLABLE_KINDS` = `['employee','skill']`；`KIND_FILTERS` 加 'skill'
- `packages/ui-office/src/components/marketplace/PublishDialog.tsx`：加 kind selector；skill 分支从员工专属 skill 选源
- `packages/registry-client/src/*`：install/publish 调用支持 `kind: 'skill'`（manifest + content.md bundling）；若已完全透传 kind 仅加白名单
- `packages/core/src/vault/*`：`VaultSyncService` 补 skill 目录路径解析 helper；不改 sync 语义
- `packages/ui-office/CLAUDE.md`：`INSTALLABLE_KINDS`、`SkillBindingList` 文案说明更新；protocols-ledger #6 SKILL.md 状态改 ✅

**Dependencies / systems**
- 引入一个 YAML frontmatter 解析：复用 `gray-matter`（或等价最小实现）；若新增 dep 保持 <10KB gzip
- Vault 源真相 + DB 索引模式借鉴 `memory.md` 但反向（md 为真）；新加 `vault:skills` 同步路径入 `VaultSyncService` 既有 writeQueue
- Web / Desktop 路径差异：Web 模式无真实磁盘 → 只用 DB 存 body（`skills.body_inline TEXT` 可选列）?；本次决定 **web 侧复用 IndexedDB 虚拟目录**（和 deliverable H1-followup 同路数），保持单一 vault 抽象。IndexedDB virtual FS 细节在 design.md

**已知 trade-off**
- Skill 改用 markdown 后，editor 里改不是"表单改字段"而是"改 md 文件"。本次不做 WYSIWYG，用最小 `<textarea>` 或简易 markdown 编辑占位；T2.7 UI surfacing 再设计真正的编辑器
- SKILL.md 标准当前无 version 字段；我们在 DB 加 `version` 是 Offisim 扩展，未来若上游加版本字段再对齐（协议台账记）
- 两层 scope 的合并规则：如果员工专属和全局 skill 重名（同 slug），本次策略是 **员工专属覆盖全局**（merged list 内 dedupe by slug，employee 优先）；冲突时 DB UNIQUE 不阻止（不同 employee_id），prompt 装配层 dedupe
- 迁移遗留 `runtimeSkill` 为 synthesized SKILL.md 时，原字段的 `capabilityIndex.capabilities[]` 落到 body 正文作 `## Capabilities`，`instructions` 落到 body 主体；`allowedTools` 作 frontmatter `allowedTools:` 数组（Anthropic SKILL.md 允许扩展字段用于工具约束，这个扩展符合标准）
