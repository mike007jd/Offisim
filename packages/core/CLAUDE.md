# @offisim/core

Core now holds shared services, repos, data contracts, tools, vault, and legacy
helpers. It is no longer the product AI runtime owner. Desktop AI execution is
Pi Agent Host (`apps/desktop/src-tauri/src/pi_agent_host.rs` +
`scripts/tauri-pi-agent-host.entry.mjs`), and renderer code must treat
`DesktopAgentRuntime` as a thin Pi client.

## Gotchas

- `HookRegistry` (**同步串行**, `await emit()` 阻塞流控用) ≠ `EventBus` (**异步 fire-and-forget**, 前缀订阅 UI 推送), 不要合并。pi 运行时常常两个都 emit
- `Scratchpad` per-runtime 临时存储, 持久化用 `MemoryService`
- Boss = delegate-only 编排器（`pi-bridge/pi-orchestration-service.ts`）：boss 系统提示是硬工具纪律，只发 `delegate` 一个工具，**绝不能编造员工结果**——只有 `delegate` 工具结果回到对话后才能转述。employee 子 agent 才拿全套 builtin/MCP 工具（boss 无 `employeeId`，直接执行会让 audit 归属错乱）
- `NodeContextMiddleware` 共享 1800 char budget (summary 1000 + pack 700), 两半独立查询独立截断, 不要加独立 middleware
- `InstallService.planCache` 是实例属性, `dispose()` 清理, 不要模块层缓存
- Employee repo `create()` 可选 `employee_id`, `transact()` 中必须用预生成 ID (非 `void promise.then()`)
- 不要在 core 里恢复 Claude/Codex/OpenAI SDK lane、provider catalog、runtime provider profile、或新的模型 transport factory。Pi Agent owns auth/model/session/tool loop.
- `read_attachment` 是唯一允许 AI 读 chat attachment 的 builtin：只在 gateway lane 进入 tool pool，执行时必须拿到当前 `companyId + RunScope.threadId`，并且 `vaultRef` 里的 company/thread 必须完全匹配；缺 scope、跨 company、跨 thread 都返回 `attachment-forbidden`，不要 fallback 到全局 store 或 graph thread。
- Pi runtime 主门禁是 `scripts/harness-pi-agent-host.mjs`。旧 `pi-bridge` 代码只可作为迁移/历史代码，不可重新接回桌面主路径。
- Boss roster 注入 SSOT 在 `pi-bridge/pi-orchestration-service.ts` 的 boss 系统提示装配：从 `repos.employees.findByCompany(companyId)` 取 **enabled internal** 员工（至少 `employee_id + name + role_slug`）按 id 注入；external A2A 员工无本机工作区能力。
- Runtime workspace binding SSOT for file/shell tools is the active graph thread's project: carry `threadId` through `ToolCallRequest` into builtin adapters, resolve `graph_threads.project_id` first, then legacy `projects.thread_id`; if selected project has no usable `workspace_root`, emit `workspace-binding.unavailable` once per `(companyId, projectId)` session from the runtime-context layer.
- Skill install runtime guards are typed chat outcomes, not toast crashes: Web `sync_from_claude_code` returns `desktop-only-tool` and renders `This skill source requires the desktop app.`; `create_skill_from_scratch` with a non-caller `targetEmployeeId` renders `Skill author must match the active chat employee.` and must not stage a preview.
- Claude Code skill sync in desktop must scan both home and project-local `.claude/skills` through the Tauri install environment. Project-local reads under the bound repo root must go through `project_list_dir` / `project_read_file`, not browser plugin-fs. A single filter match may stage directly; multiple matches return candidates.

## Data Model & Zones

- Zone ID: DB 格式 `companyId::slug`, 用 `templateToZone(t, companyId)` normalize, `extractZoneSlug()` 提取。`companyId` 必填, preview/create 模式传 `STUDIO_PREVIEW_COMPANY_ID` / `WIZARD_PREVIEW_COMPANY_ID` sentinel (shared-types/zone.ts)。跨 company 重写用 `reparentZoneId(companyId, zoneId)` —— 注意 `normalizeZoneId` 对已含 `::` 的输入是 pass-through, 不能用来重锚。`saveZonesToDb` 用 `reparentZoneId` 强制按真实 companyId 重写 sentinel 前缀, DB 永远看不到 sentinel
- Render layer zone 查找有意保持 strict `z.zoneId === zoneId`。**例外**: `StudioState.addZoneFromPreset` 用 `crypto.randomUUID()` 作 zoneId (raw UUID, 无 `::`), Studio 内部自洽, 保存时 `reparentZoneId` 重写。不要为了"一致性"把 raw UUID 改成 prefixed
- 员工→zone 用 `resolveZoneForRole()` 按 targetRoles, 不要用 `ROLE_TO_DEPARTMENT`
- 模板 `CompanyTemplate.zones?` 自定义, 无时 fallback `SYSTEM_ZONE_TEMPLATES` (7)。用 `createZoneBlueprint()` 工厂
- zones 约束: 必须有 `rest`+`meeting` archetype, role 不可多 zone, 所有 role 需匹配
- `companies.description_json` 存公司描述 JSON(2026-05-29 从 `default_model_policy_json` rename — pre-launch 单基线 schema 允许 rename)
- Role 统一 `RoleSlug` branded type (shared-types/roles.ts)
- Marketplace 安装：employee 已物化；skill 作为一等 asset（T2.1 `add-skills-foundation-two-tier-schema`）schema + SkillLoader + 两层 scope + publish/install/fork/edit 主路径已落地；剩余主要是 UX 和 evidence 收口。company_template / office_layout / prefab 仍未完成。Skill 不再嵌入 `employee.config_json.runtimeSkill`（该字段已删）
- `GitAutoCommitService` 桌面端专用, 浏览器 no-op

## Repository 三后端同步

`packages/core/src/runtime/drizzle-repositories.ts` / `memory-repositories.ts` + `apps/desktop/renderer/src/lib/tauri-repos.ts` 现为 barrel（各 <200 行 NBNC）, 按 family 拆到 `runtime/repos/<family>/{drizzle,memory}.ts` + `tauri-repos/<family>.ts`。repo 接口变更必须跨 3 个 backend 同步对应 family 文件。自动 parity test 已删除, 靠人工核对。

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
- `slug`：`skillSlug(name, id)` kebab-case name + 纯非 ASCII fallback `skill-{id前8字符}`（注：`employeeSlug` 已改为纯 id 派生，见 Vault 段，两者不再同策略）
- DB 表 `skills` 属于当前单基线 SQLite schema；`UNIQUE` 用两条 partial index（`WHERE employee_id IS NULL` / `IS NOT NULL`），让 `(companyId, null, slug)` 跨 company-scope 行碰撞
- 员工 prompt 由 `pi-bridge/employee-builder.ts` 的 `buildEmployeePrompt` 装配（persona + 公司 + 任务）。**graph 时代的 `## Available skills` prompt 注入 + skill install/fork/edit 工具注册（旧 `employee-prompt-assembly` / `employee-tool-kit`）随 `agents/` 删除，pi 尚未重接**——skill install API 本体仍在 `skills/skill-install-tools.ts`（公共导出保留），重接进 pi 工具池是独立后续
- `create_skill_from_scratch` 是 self-authoring 唯一入口：LLM 产完整 SKILL.md → `parseSelfAuthoredSkillMd` 白名单 → staging preview (`action='create'`) → `SkillInstallCommitter` → employee-scope vault + `skills.source_kind='self-authored'` / `source_ref='llm-author:<modelKey>'`。self-authored 禁 company scope。
- **Fork + edit API（T2.3）**：
  - `installSkill` 加 `source: { kind: 'fork', parentSkillId, parentVersion }` 变体 — 同 `installSkill` 入口，`scope='company' + source.kind='fork'` 会抛 `scope-target-conflict`（spec skill-fork-and-edit scenario 2）；`source_kind='forked'` + `source_ref='company-skill:<pid>@<pver>'`
  - `readSkillDirectory(skillId)` 批量读 SKILL.md + `scripts/`/`references/`/`assets/` 全树（深度遍历），fork 用来 snapshot parent
  - `editSkillBody({ skillId, newBody })` 独立入口：不走 installSkill，不改 slug / scope / source_kind / source_ref / vault_path，只重写 body + bump `version` 小位（`bumpPatch` module-level helper，非 semver 输入返 `null` → 抛 `SkillEditError` kind `version-bump-failed`）。Loader 层不做 ownership 校验（generic write API，后续 T2.5 / T2.6 复用）
  - **Fork provenance DB-only**：SKILL.md frontmatter 不扩 `offisim.*`，保 Anthropic 开放标准 portability。parent slug / version 只进 `skills` row（`source_kind` + `source_ref`）

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
- desktop renderer 端有 FSAccess API 时: vault directory handle 持久化到 IndexedDB, 刷新后启动时 rehydrate 并重新探测权限; 无 FSAccess API 时降级为 zip export-only, 不做 live mount
- `memory.md` 是 read-only view: md → DB 不 import memory (content 结构复杂), 玩家用 UI Forget/Edit 按钮, 不手编 md body
- `renderMemoryMd` 按 4 类别 (`experience` / `decision` / `knowledge` / `preference`) 分段, 每类内按 `last_reinforced_at` 倒序 + `importance` tie-break
- `employeeSlug(id)` 生成 FS-safe 目录名 (`employee-{id前12字符}`), **纯 employee_id 派生** (不含 name): 同名员工不碰撞 + 改名不动目录 (employee-scope skill `vault_path` 安装时固化, 目录必须 rename-stable, 否则孤儿/分裂). 展示名在 `employee.md` 内
- `VaultSyncError` 经 `onError` callback 和 EventBus `vault.sync.failed` 事件双通道 surface, runtime 不崩; UI 层订阅 `vault.` 前缀转 Toast (runtime/app 接入在 Phase 1c, core 层完成)
- `VaultSyncFailedPayload.target` 四值 `'write' | 'import' | 'delete' | 'activate'`。前三条是 per-employee 失败 (`employeeId` 有效); `'activate'` 是 company-level 激活失败 (由 `apps/desktop/renderer/src/lib/vault-tauri-activation.ts` 的 `emitActivationFailure` 发出, `employeeId: ''` sentinel)。App.tsx toast handler 必须覆盖全 4 个分支
