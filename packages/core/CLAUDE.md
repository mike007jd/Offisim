# @offisim/core

LangGraph kernel, agents, services, repos (Node.js). 浏览器代码必须用 `@offisim/core/browser` subpath。

## Gotchas

- `HookRegistry` (**同步串行**, `await emit()` 阻塞流控用) ≠ `EventBus` (**异步 fire-and-forget**, 前缀订阅 UI 推送), 不要合并。图节点常常两个都 emit
- `Scratchpad` per-runtime 临时存储, 持久化用 `MemoryService`
- Boss node JSON 路由 **三层** 防御: (1) `BOSS_SYSTEM_PROMPT` 常量 (2) `TASK_KEYWORDS` 正则兜底 (3) `targetEmployeeId` 有效性校验。修改时三层同步
- `NodeContextMiddleware` 共享 1800 char budget (summary 1000 + pack 700), 两半独立查询独立截断, 不要加独立 middleware
- `InstallService.planCache` 是实例属性, `dispose()` 清理, 不要模块层缓存
- Employee repo `create()` 可选 `employee_id`, `transact()` 中必须用预生成 ID (非 `void promise.then()`)
- `createCheckpointSaver()` 是 async, `SqliteSaver` 懒加载避免 browser 拉 Node 依赖
- 外部 agent 接入统一走 A2A (`packages/core/src/a2a/`)。核心 runtime 的模型调用通过 `gateway`（`anthropic-adapter` / `openai-adapter`）、`claude-agent-sdk`（`ClaudeAgentSdkAdapter`）、`codex-agent-sdk`（`CodexAgentSdkAdapter`，sidecar 走 `apps/desktop/src-tauri/resources/codex-agent-host.mjs`）和 `openai-agents-sdk`（`OpenAiAgentsSdkAdapter`，native OpenAI first，compat 仅允许 verified / harness-explicit 路径）这些 model transport binding；它们不是产品级普通 SDK lane。
- `AnthropicAdapter` 非官方 endpoint 自动 CORS-friendly (Bearer 替 x-api-key, strip telemetry, `messages.create({stream:true})` 替 `.stream()`)
- **Tauri 模式 credential-isolated bridge 分四条 transport**：`gateway` 走 Rust-side `llm_fetch` command；`claude-agent-sdk` 走 Rust-side `claude_agent_execute` trusted-host bridge（local Node sidecar + provider secret env 注入，credential 不越 Rust→JS 边界）；`codex-agent-sdk` 同模式走 `codex_agent_execute` + `codex_agent_host.mjs` sidecar；`openai-agents-sdk` 复用 Rust-side `llm_fetch` 作为 OpenAI SDK transport override。`gateway` lane 的 credential-isolated `fetch` 由 `apps/desktop/renderer/src/lib/tauri-llm-fetch.ts` 的 `createTauriLlmFetch(profile)` 构造（把 SDK 请求桥到 Rust `llm_fetch` Channel），并在 `apps/desktop/renderer/src/runtime/desktop-agent-runtime.ts` 里通过 `createGateway({ fetch })` 组装成 `runtimeCtx.llmGateway`。`GatewayConfig.fetch` / `AnthropicAdapterOptions.fetch` / `OpenAiAdapterOptions.fetch` / `OpenAiAgentsSdkAdapterOptions.fetch` 是 HTTP/OpenAI transport 的唯一注入口。non-Tauri product mode is removed; desktop uses explicit transport overrides
- **2026-05-09 runtime boundary correction**：默认 `offisim-core` harness 可以直接通过 model transport / provider adapter 调模型；调用模型不等于进入 SDK lane。未验证的 `claude-agent-sdk` / `codex-agent-sdk` / `openai-agents-sdk` transport 必须设置 `llmToolCallsEnabled=false`，不暴露 file/shell/memory/todo/skill/MCP/builtin tool schema；adapter 收到任何 tool request 必须失败关闭，不能假装已执行。SDK-native full-power 必须是单独 employee runtime / driver / replacement profile，并有 release `.app` 证据。
- `read_attachment` 是唯一允许 AI 读 chat attachment 的 builtin：只在 gateway lane 进入 tool pool，执行时必须拿到当前 `companyId + RunScope.threadId`，并且 `vaultRef` 里的 company/thread 必须完全匹配；缺 scope、跨 company、跨 thread 都返回 `attachment-forbidden`，不要 fallback 到全局 store 或 graph thread。
- **本地工具路由硬规则**：本地工具意图判定的 SSOT 在 `packages/core/src/agents/task-tool-intent.ts`（`detectTaskToolIntent` + `evidenceToolsForIntent` + 命名 vocabulary 集合）。Boss / Manager / PM preflight / direct setup / yolo entry 在入口处算一次，存入 `state.taskToolIntent`；下游消费者（manager / direct-setup / completion verifier）**只读 state field，禁止再 grep 文本**。`requiresLocalTools=true` 时只选 enabled internal employee；external A2A 员工没有本机工作区能力，不能作为证据来源；直聊 external A2A 做本地工具任务必须 fail fast。bare-noun（`file` / `命令` / `workspace` 等）和 narrative prose（"describe the workspace" / "file a bug"）不触发；只接 verb+object pairs / 显式 tool tokens / 中文 imperative。
- **路由 rebind 必须 observable**：manager-node 把 LLM 选 external 的 assignment 过滤掉时、`pm-planner/sanitize-rebind.ts` 把缺失/disabled 员工换成 planner-recommended 时，都必须 emit `task.assignment.rerouted` 事件 + `logger.info` 镜像，原始 `requestedEmployeeId` / `resolvedEmployeeId` / `reason` 进 payload。reason union: `'requires-local-tools' | 'employee-not-found' | 'employee-disabled' | 'no-recommendation-fallback'`。`sanitizePlanEmployees` fallback 优先取 `LlmPlan.recommendedEmployees` 或 `ManagerDirective.recommendedEmployees`，最后才退到 `validEmployees[0]`（并标记 `no-recommendation-fallback`）。
- **completion verifier 边界**：文件/读取任务要求 `read_file` 成功证据；写入/创建文件任务要求 `write_file` 成功证据；命令任务要求 `bash` 成功或预期失败证据；显式 verification 任务要求默认验证工具证据。普通文本交付不得因为没有工具调用而被卡死，也不得为了过关伪造工具证据。
- Deterministic harness scenarios must not assert mock LLM text as proof of success. `scripts/harness-contract.mjs` rejects any `finalOutputContains` assertion that exactly equals an `llmTurns[].content` value during load.
- Boss employee context SSOT lives in `packages/core/src/agents/boss-node.ts`: both routing and direct-reply prompts must receive the active company roster from `repos.employees.findByCompany(companyId)` with at least `employee_id + name + role_slug`; if DB rows are non-empty but injected count is zero, emit `boss.employee-context.empty` once per company session.
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
- `step_dispatcher` / `step_advance` 终态必须共同认 `areAllPlanStepsTerminal()`；所有 step terminal 后只能进 `boss_summary`，不能再在 dispatcher/advance 间自循环。未来若又撞 LangGraph recursion limit，先看 `plan.dispatcher.recursion_limit` runtime event payload。
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
- 员工 prompt 装配：`employee-prompt-assembly.ts` 在 skillLoader 可用时注入 `## Available skills` 块（description 截 200 UTF-16）；列表空则整段不输出。**本次不注册 `activate_skill` 工具**（纯 tier-1 informational）
- `employee-tool-kit.ts` 在 `skillStagingManager` + `skillLoader` 可用时注册 skill install/fork/edit 工具；skills 本体仍通过 prompt 的 `## Available skills` 暴露，不走 activation tool
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
