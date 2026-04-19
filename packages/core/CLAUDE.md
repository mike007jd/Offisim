# @offisim/core

LangGraph kernel, agents, services, repos (Node.js). 浏览器代码必须用 `@offisim/core/browser` subpath。

## Gotchas

- `HookRegistry` (**同步串行**, `await emit()` 阻塞流控用) ≠ `EventBus` (**异步 fire-and-forget**, 前缀订阅 UI 推送), 不要合并。图节点常常两个都 emit
- `Scratchpad` per-runtime 临时存储, 持久化用 `MemoryService`
- Boss node JSON 路由 **三层** 防御: (1) `BOSS_SYSTEM_PROMPT` 常量 (2) `TASK_KEYWORDS` 正则兜底 (3) `targetEmployeeId` / `sopTemplateId` 有效性校验。修改时三层同步
- `NodeContextMiddleware` 共享 1800 char budget (summary 1000 + pack 700), 两半独立查询独立截断, 不要加独立 middleware
- `InstallService.planCache` 是实例属性, `dispose()` 清理, 不要模块层缓存
- Employee repo `create()` 可选 `employee_id`, `transact()` 中必须用预生成 ID (非 `void promise.then()`)
- `createCheckpointSaver()` 是 async, `SqliteSaver` 懒加载避免 browser 拉 Node 依赖
- 外部 agent 接入统一走 A2A (`packages/core/src/a2a/`)。核心员工 runtime 仍是 `anthropic-adapter` / `openai-adapter` / `subscription-adapter (ACP)`
- `subscription` provider 依赖 `node:child_process`, 桌面端专用; `gateway-factory.ts` 用 `require()` 动态加载避免进 browser bundle
- `AnthropicAdapter` 非官方 endpoint 自动 CORS-friendly (Bearer 替 x-api-key, strip telemetry, `messages.create({stream:true})` 替 `.stream()`)

## Data Model & Zones

- Zone ID: DB 格式 `companyId::slug`, 用 `templateToZone(t, companyId)` normalize, `extractZoneSlug()` 提取。`companyId` 必填, preview/create 模式传 `STUDIO_PREVIEW_COMPANY_ID` / `WIZARD_PREVIEW_COMPANY_ID` sentinel (shared-types/zone.ts)。跨 company 重写用 `reparentZoneId(companyId, zoneId)` —— 注意 `normalizeZoneId` 对已含 `::` 的输入是 pass-through, 不能用来重锚。`saveZonesToDb` 用 `reparentZoneId` 强制按真实 companyId 重写 sentinel 前缀, DB 永远看不到 sentinel
- Render layer zone 查找有意保持 strict `z.zoneId === zoneId`。**例外**: `StudioState.addZoneFromPreset` 用 `crypto.randomUUID()` 作 zoneId (raw UUID, 无 `::`), Studio 内部自洽, 保存时 `reparentZoneId` 重写。不要为了"一致性"把 raw UUID 改成 prefixed
- 员工→zone 用 `resolveZoneForRole()` 按 targetRoles, 不要用 `ROLE_TO_DEPARTMENT`
- 模板 `CompanyTemplate.zones?` 自定义, 无时 fallback `SYSTEM_ZONE_TEMPLATES` (7)。用 `createZoneBlueprint()` 工厂
- zones 约束: 必须有 `rest`+`meeting` archetype, role 不可多 zone, 所有 role 需匹配
- `companies.default_model_policy_json` 实际存公司描述, 字段名误导但不可重命名
- Role 统一 `RoleSlug` branded type (shared-types/roles.ts)
- `getExecutionBatches()` 是 `SopService.getExecutionOrder()` 本地副本, 两处必须同步
- `PlanCreatedPayload.sopTemplateId` 贯穿 core→UI, 新增字段注意链路完整性
- Marketplace 安装：employee 已物化；skill 作为一等 asset（T2.1 `add-skills-foundation-two-tier-schema`）schema + SkillLoader + 两层 scope 已落地，publish/install 分支仍在补；sop / company_template / office_layout / prefab 未完成。Skill 不再嵌入 `employee.config_json.runtimeSkill`（该字段已删）
- `GitAutoCommitService` 桌面端专用, 浏览器 no-op
- `SopSyncService` 先 JSON.parse 再 stringify 比较 definition, 避免 key 顺序差异

## Repository 三后端同步

`packages/core/src/runtime/drizzle-repositories.ts` / `memory-repositories.ts` + `apps/web/src/lib/tauri-repos.ts` 现为 barrel（各 <200 行 NBNC）, 按 family 拆到 `runtime/repos/<family>/{drizzle,memory}.ts` + `tauri-repos/<family>.ts`。repo 接口变更必须跨 3 个 backend 同步对应 family 文件, 契约约束见 `openspec/specs/repository-backend-boundaries/spec.md`。自动 parity test 已删除, 靠人工 + spec 核对。

## Skills (SKILL.md open standard, vault-authoritative)

`packages/core/src/skills/` — 两层 schema（company-global + employee-specific）skill 体系，和 `memory` 方向相反：**SKILL.md 在 vault 是源真相，`skills` DB 表只做索引**（listing 零磁盘 IO）。

- SKILL.md 字段（严格标准）：frontmatter `name`（kebab-case）+ `description` 必填；可选 `allowedTools` / `license` / `version`；禁 `offisim.*` 私有命名空间。Body 自由 markdown。Parser / serializer 在 `skill-md.ts`。
- 磁盘布局（`VaultFileSystem` 一致 desktop / web）：
  - 全局：`companies/{cid}/skills/{slug}/SKILL.md`（+ 可选 `scripts/` `references/` `assets/`）
  - 员工专属：`companies/{cid}/employees/{employeeSlug}/skills/{slug}/SKILL.md`
- `SkillLoader` 三层 progressive disclosure：
  - Tier 1 `listSkillsForEmployee(companyId, employeeId)` — DB-only 合并（employee 覆盖 company，slug dedupe），零磁盘 IO
  - Tier 2 `loadSkillBody(skillId)` — 读 SKILL.md 返回 body（frontmatter 剥离）
  - Tier 3 `loadSkillAsset(skillId, relPath)` — 只允许 `scripts/` / `references/` / `assets/` 前缀；IO 前拒 `..` / 绝对路径
- `slug`：`skillSlug(name, id)` 和 `employeeSlug` 同策略（kebab-case，纯非 ASCII fallback `skill-{id前8字符}`）
- DB 表 `skills`（migration 025 / desktop v31）：`UNIQUE` 用两条 partial index（`WHERE employee_id IS NULL` / `IS NOT NULL`），让 `(companyId, null, slug)` 跨 company-scope 行碰撞
- 旧 `runtimeSkill` 迁移：`migrateRuntimeSkills()` 扫全员 `config_json.runtimeSkill` → 生成员工 scope SKILL.md + 插 row（`source_kind='synthesized'`, `source_ref='legacy:runtimeSkill'`），strip 原字段。Guard 在 `settings.skills_migration_v1_done`（`settings` key-value 表也是 025 加的）
- 员工 prompt 装配：`employee-prompt-assembly.ts` 在 skillLoader 可用时注入 `## Available skills` 块（description 截 200 UTF-16）；列表空则整段不输出。**本次不注册 `activate_skill` 工具**（纯 tier-1 informational）

## Employee Vault (Obsidian-style, Phase 1)

`packages/core/src/vault/` — 员工状态的 markdown 视图, 4 个文件/员工:
`companies/{companyId}/employees/{slug}/{employee,soul,memory,relationships}.md`

不变量 (写错了测试立挂):
- **md = source of truth for human-editable fields** (persona / soul body / relationship 叙述); **DB = source of truth for runtime state** (taskRun / llmCall / checkpoint)
- 冲突: `md.updated_at > db.updated_at` 时 md 赢, `hydrateCompany()` 启动时解决一次, runtime 内仅 DB→md 单向
- `VaultSyncService` 订阅 EventBus `employee.` / `memory.` / `relationship.` 前缀 + per-employee 500ms debounce + per-employee serial writer queue (无全局锁)
- `employee.*` 任何事件都 re-render **全部 4 个文件** (新员工一次到位); `memory.*` 只触发 `memory.md`; `relationship.*` 只触发 `relationships.md`
- 软删除 Dismiss 员工: `employee.md` 标 `dismissed: true`, 文件夹保留; 硬删 `employee.deleted` 才 `fs.remove` 整个员工目录
- frontmatter YAML 必须 stable key 排序 (`dump({sortKeys: true})`), 否则 git diff 全乱
- web 端有 FSAccess API 时: vault directory handle 持久化到 IndexedDB, 刷新后启动时 rehydrate 并重新探测权限; 无 FSAccess API 时降级为 zip export-only, 不做 live mount
- `memory.md` 是 read-only view: md → DB 不 import memory (content 结构复杂), 玩家用 UI Forget/Edit 按钮, 不手编 md body
- `renderMemoryMd` 按 4 类别 (`experience` / `decision` / `knowledge` / `preference`) 分段, 每类内按 `last_reinforced_at` 倒序 + `importance` tie-break
- `employeeSlug(name, id)` 生成 FS-safe 目录名, 纯非 ASCII fallback 到 `employee-{id前8字符}`
- `VaultSyncError` 经 `onError` callback 和 EventBus `vault.sync.failed` 事件双通道 surface, runtime 不崩; UI 层订阅 `vault.` 前缀转 Toast (runtime/app 接入在 Phase 1c, core 层完成)
- `VaultSyncFailedPayload.target` 四值 `'write' | 'import' | 'delete' | 'activate'`。前三条是 per-employee 失败 (`employeeId` 有效); `'activate'` 是 company-level 激活失败 (由 `apps/web/src/lib/vault-tauri-activation.ts` 的 `emitActivationFailure` 发出, `employeeId: ''` sentinel)。App.tsx toast handler 必须覆盖全 4 个分支
