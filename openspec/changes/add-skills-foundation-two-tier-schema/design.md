## Context

Offisim 1.0 把 Skills Pillar（玩家可感知的"员工沉淀技能"）定为四大差异化之一。T2.1 是 Pillar 里第一块砖，后续 T2.2–T2.7 的 7 条 change（跨源导入 / fork / 自创 / 互传 / 自改 / UI 气泡）全部基于本次落地的 schema 扩展。

**当前状态**
- Skills 没有一等实体。`EmployeeConfig.runtimeSkill: RuntimeSkillConfig` 嵌在 `employees.config_json` 里，一员工一 skill，字段是产品早期自造的 `capabilityIndex.capabilities[]` 枚举 + `instructions` 长字符串。
- `INSTALLABLE_KINDS = ['employee']`；Marketplace 对 skill 无感知（哪怕 `SkillBindingList.tsx` 文案提 "install from marketplace"，实际路径根本不存在，这是产品幻觉）。
- Vault 已有员工目录结构（`${vaultRoot}/companies/{id}/employees/{slug}/{employee,soul,memory,relationships}.md`），skills 要插进这套布局。
- 协议台账 #6 SKILL.md: ❌ 未接。

**外部标准**
- Anthropic SKILL.md（2025-12 GA）：`anthropics/skills` 120k stars，19 家 agent（Claude Code / Cursor / Codex / Copilot / Windsurf / Hermes / Gemini 等）对接，agentskills.io 公共 registry。格式极简：目录 + `SKILL.md`（YAML frontmatter `name`/`description` 必填）+ 可选 `scripts/` `references/` `assets/` 子目录。核心是 progressive disclosure（startup 载 name+desc / activation 载 body / 按需载 scripts）。
- 决定不自造：roadmap `2026-04-19` 拍定 A2（"直接用 SKILL.md 开放标准，不自造"），协议台账 #6 下一步 "直接接"。

**约束**
- 无自动化测试（repo policy）。验证走 live agent。
- 串行 typecheck：shared-types → ui-core → core → ui-office → web。
- Web / Desktop / Platform 三栈不同：Desktop 有真实 fs（Tauri plugin-fs），Web 用 IndexedDB 虚拟 vault，Platform 完全不落员工数据。skills 数据主要跟 Desktop + Web 走，不碰 Platform。
- Pre-launch policy：脏数据不写 migration 兜底分支，直接 drop。

## Goals / Non-Goals

**Goals**
1. Skills 成为一等实体：`skills` 新表 + vault 目录 + 独立 Loader 服务 + prompt 装配入口。
2. 两层 scope（company global + employee specific）清晰：DB 字段区分 + 合并规则明确 + UI 能 surfacing。
3. SKILL.md 开放标准字节级兼容：解析/序列化只用 Anthropic frontmatter 字段，私有扩展集中到 `allowedTools` 一项（上游允许）。
4. Progressive disclosure 3 tier 全落地：listing（DB 零 IO）/ activation（读 body）/ on-demand（读 scripts/assets）。
5. Marketplace 内部生态（自家 registry）支持 skill 作 `kind='skill'` 独立 asset 类型，publish + install 贯通。
6. 员工专属 skill 绑定关系可查、可渲染到员工 prompt。
7. 旧 `runtimeSkill` embed 完全清除，pre-launch 不保留兼容路径。

**Non-Goals**
- 不做跨源导入（URL 拉取 / agentskills.io 同步 / 本地文件选择器）—— T2.2。
- 不做 fork（全局 → 员工专属复制改）—— T2.3。
- 不做员工自创（5 类 autonomous trigger + 5 秒撤销公告）—— T2.4 / T2.6。
- 不做员工互传（relationship 阈值 gate）—— T2.5（依赖 T3.1）。
- 不做 skill in-use 自改（体积/使用数/自省）—— T2.6。
- 不做 "获得/使用/交流都在员工气泡框" UI wow moments —— T2.7。
- 不做 skill 真正的 rich editor（WYSIWYG markdown 编辑、scripts 编辑）—— 最小 `<textarea>` 占位即可。
- Platform 侧不存 skill 数据（只作 registry 中转）。
- 不做 skill 版本化 pin（install 一次性复制源 body 到公司 vault，后续 registry 侧更新不自动拉回）。

## Decisions

### Decision 1: SKILL.md 字节级开放标准兼容

**选**：解析 / 序列化器严格只认 Anthropic SKILL.md 定义字段，不发明私有字段。
- 必填 frontmatter：`name: string`（kebab-case，与目录名字节相等）/ `description: string`（LLM 看到的 1-2 句触发描述）
- 可选 frontmatter：`allowedTools: string[]`（Anthropic 2025-12 接受的工具约束扩展字段，符合标准）/ `license: string` / `version: string`
- Body：markdown，无结构限制
- 目录内可选：`scripts/*` / `references/*` / `assets/*` 任意文件（Claude Code 认这些相对路径）

**不选**：自造字段如 `offisim.capabilityIndex` / `offisim.allowedTools` / 扁平结构（旧 `runtimeSkill` 样式）
**理由**：
1. Roadmap A2 拍定"不自造"，协议台账 #6 也指"直接接"。自造字段会和上游后续演进漂移（A2A v0.3→v1.0 是前车之鉴）。
2. SKILL.md 的 3 层 disclosure 机制（尤其 `scripts/` 可执行 helpers）是 Hermes 等 agent 能共享 skill 的关键，Offisim 若缺就丧失互操作性。
3. DB 索引字段（`version` / `source_kind` / `source_ref` / `slug`）是 Offisim 侧运营数据，**不回写 SKILL.md**，保持磁盘可移植性。

**依赖**：`gray-matter` 包作 YAML frontmatter 解析器（~20KB unpacked，@types/gray-matter 另发）。若想更轻用手写 frontmatter splitter（regex + `js-yaml`）；`js-yaml` 本来就是 `@langchain/langgraph` 依赖链里已存在，引用成本 0。**最终选 `js-yaml` + 手写 frontmatter splitter**（150 行以内，测试负担最小）。

### Decision 2: Vault 源真相 + DB 索引层

**选**：SKILL.md 磁盘文件是源真相，`skills` 表是派生索引。
- 写路径：先写磁盘（`SKILL.md` + scripts/assets），成功后 upsert DB 行。
- 读路径：listing 走 DB（零磁盘 IO）；activation / on-demand 走磁盘。
- 冲突策略：DB 与磁盘不一致时，magic 调 `rehydrateSkillsFromVault(companyId)`（开发工具 + 系统事件驱动修复），永远以磁盘为准。

**不选**：DB 持有 body（`body_md TEXT` 列）作为源真相。
**理由**：
1. SKILL.md 开放标准的核心是"目录 = 可移植单元"。用户把公司 vault git 化 / 交给 git clone 就能带走所有 skill，是 Offisim 相对 SaaS agent 的独立卖点（roadmap 定义#2d "员工可以对外工作，vault git 化带走"）。
2. 和 `memory.md` DB-authoritative 的决策方向相反，是有意为之：memory 是 runtime 高频写入、需要 transaction、md 作导出视图；skill 是低频写入、需要跨工具互通、md 作原生格式。
3. listing 性能不丢（DB 索引）；listing body 不需要，progressive disclosure 的第 1 tier 本就 frontmatter-only。
4. Web 端虚拟 FS（IndexedDB）继续保持 "vault in key-value store" 抽象，skill 不开特例。

**风险**：
- Desktop vault 目录 rename / 人工删除时 DB 脏 —— 走 rehydrate 修（T2.2 再做完整 hydrator；本次最小版启动时 best-effort 扫一次）。
- Web IndexedDB `vault:skills` key 空间膨胀 —— body 大小写入日志，超阈值 (e.g. 50KB/skill) 拒绝保存并弹提示。

### Decision 3: 两层 scope 的合并规则

**选**：query-time merge + slug-dedupe（employee 优先覆盖 company）
```ts
function listSkillsForEmployee(companyId, employeeId): SkillMetadata[] {
  const company = db.skills.where({companyId, employeeId: null});
  const employee = db.skills.where({companyId, employeeId});
  // employee 专属先进 map → 同 slug 的 company 不入
  const bySlug = new Map(employee.map(s => [s.slug, s]));
  for (const s of company) if (!bySlug.has(s.slug)) bySlug.set(s.slug, s);
  return [...bySlug.values()];
}
```

**不选**：DB 层 UNIQUE 跨 scope 禁重名
**理由**：允许重名是 T2.3 fork 的基础语义（员工 fork 全局 skill，改自己的版本，但名字保留便于识别）。

**风险**：`INSTALL` 到 company 时若员工已有同名 skill，全局 skill 对该员工不可见，容易让用户困惑。缓解：SkillBindingList UI 对被覆盖的 company skill 加 "overridden by your own" 灰字 badge（本次 minimal，T2.7 再优化）。

### Decision 4: 旧 `runtimeSkill` embed → 一次性迁移 + 类型层删除

**选**：bootstrap 一次性扫全员 `config_json.runtimeSkill`，每条生成员工专属 SKILL.md + 插 `skills` 行（`source_kind='synthesized'`, `source_ref='legacy:runtimeSkill'`）；跑完 strip 字段。类型定义层直接删 `RuntimeSkillConfig`，无 backwards compat。

**不选**：保留类型定义 + 运行时双读路径（"如果 runtimeSkill 存在就用它"）
**理由**：
1. Repo policy "pre-launch drop dirty data"（feedback_prelaunch_drop_dirty_data）+ "不用 fallback 假装完成"（CLAUDE.md Product Closure Bar）。
2. 类型层保留会污染所有 consumer（`employee-prompt-assembly` / `employee-tool-round` / `useEmployeeEditor` / `SkillBindingList`）需要双分支，成本远高于一次性迁移。
3. 用户数据量小（没有 beta 用户），迁移失败数据直接 drop 可接受。

**迁移映射**：
- `runtimeSkill.skillName` → frontmatter `name` (kebab-case via slugify)
- `runtimeSkill.summary` → frontmatter `description`
- `runtimeSkill.instructions` → body 主体
- `runtimeSkill.capabilityIndex.*` → body 末尾追加 `\n\n## Capabilities\n\n<summary + list>`
- `runtimeSkill.allowedTools[]` → frontmatter `allowedTools:` 数组
- `runtimeSkill.enabled === false` → 丢弃（本次不做启用/禁用状态；默认全启用）
- `runtimeSkill.instructionMode` / `instructionExcerpt` → 丢弃（冗余，body 已含全部）

**风险**：slug collision（员工同时有多个 runtimeSkill？→ 实际不可能，类型里是单条）；命名不合法字符 → 走 `skill-{hash8}` fallback。

### Decision 5: Progressive disclosure 3-tier API

**选**：显式分层 API，同步/异步分明
```ts
// Tier 1: listing，零磁盘 IO，同步 OK（DB 已在 memory 缓存）
listSkillsForEmployee(companyId, employeeId): SkillMetadata[]
// SkillMetadata = { id, slug, name, description, scope, version }

// Tier 2: activation，读 SKILL.md body，async
loadSkillBody(skillId): Promise<string>

// Tier 3: on-demand，body 解析后按需读子文件
loadSkillAsset(skillId, relPath: 'scripts/foo.sh' | 'references/bar.md' | 'assets/logo.png'): Promise<Buffer | string>
```

**不选**：一次性 load 全 skill 到内存（`Skill` 对象含 body + 全 scripts）
**理由**：
1. SKILL.md 的 killer feature 是大 skill（含多个 scripts）不拖 prompt context。T2.4 / T2.6 做员工自创 / 自改时会出现"员工 skill 100+ 条"的场景，必须按需加载。
2. 员工 prompt 装配只需 Tier 1；本次 LLM 不调 `activate_skill` 工具（未实现），Tier 2 API 先暴露不触发。
3. Web IndexedDB 的 IO 是 async，强制 API 一致。

### Decision 6: 员工 prompt 装配最小注入

**选**：在 `employee-prompt-assembly.ts` 里现有 system prompt 片段后加一段 "Available skills" 清单：
```
## Available skills

- **{name}** — {description}
- **{name}** — {description}
...

Use these skill names verbatim when referencing relevant expertise.
```
如果列表空，整段不输出。**Activate skill 工具本次不注册**（LLM 只是"看到"了 skills 列表，不能激活 body）。

**理由**：
1. 本次 change 的闭环定义 = "数据架起来 + 员工能看到自己有什么 skill"，不到"员工能用 skill 做事"。那是 T2.4 / T2.7 的事。
2. 避免过度承诺：UI / 工具 / 激活机制是后续 change 的领域，本次乱伸手会撞 scope。

**不选**：直接把全部 skill body 塞进 prompt
**理由**：违反 progressive disclosure 核心 —— 大 skill 会炸 context。

**Risk**：员工 LLM 可能 hallucinate "我用 skill X" 但实际没工具激活。缓解：description 中提示 "reference by name when planning"，不暗示工具。T2.4 给工具。

### Decision 7: Marketplace `'skill'` kind 扩展

**选**：扩 `INSTALLABLE_KINDS = ['employee', 'skill']` + 扩 `KIND_FILTERS` + 加 `PublishDialog` kind selector + install 流程分支。
- Publish：员工专属 skill 走 "publish as skill"（选员工 + 选 skill → 打包）
- Install：Install 一个 skill listing → 落 company scope（全公司可见）
- 目录打包格式：zip or tarball 内 `SKILL.md` + 子目录；registry manifest `kind='skill'`，`content.md` 字段存 SKILL.md，`content.tree` 存子目录树 JSON

**不选**：沿用 employee listing 塞 skill 作副产物
**理由**：
1. Roadmap C1 "Market 只流通自家生态（全局 skill / 员工模板 / 公司模板 / SOP）"，skill 必须是平行 asset。
2. 员工 listing 本就复杂，混 skill 会把 flow 变四不像。

**Risk**：平台 registry 当前 `Listing.kind` 是宽松 union，客户端加新 kind 会先出现"平台存 skill listing 但老版 web 不认"情况。当前只有 dev 平台 + 少量 seed data，不算阻塞；正式发版前加 whitelist 单独 change（非本次）。

### Decision 8: Web 端虚拟 vault

**选**：复用 deliverable H1-followup 的 IndexedDB 虚拟文件系统 pattern
- Key：`vault:${companyId}:skills:${skillSlug}:SKILL.md` / `:scripts:{name}` etc.
- Value：string (md) / ArrayBuffer (asset)
- Web 和 Desktop 在 `SkillLoader` 层抽象一致，底层通过 `VaultSyncService` 分支

**不选**：Web 端单独用 DB blob 列
**理由**：保持 "vault 是单一抽象" 的统一；deliverable / memory 已在同条路径上，skill 无需另立。

**Risk**：IndexedDB 大小配额 UA 差异；单 skill body 超 100KB 极不常见（SKILL.md 典型 5-20KB）。

## Risks / Trade-offs

| # | Risk | Mitigation |
|---|---|---|
| 1 | SKILL.md 上游标准后续演进（如加 `version` 官方字段），Offisim 落地版本和新版漂移 | 在协议台账 #6 加 "每季度 diff `anthropics/skills` 仓库 README"；本次不 pin 版本，保持兼容策略 |
| 2 | Vault 源真相 + DB 索引不一致时 listing 脏 | `rehydrateSkillsFromVault(companyId)` best-effort 启动扫描；UI 不做显式 "resync" 按钮（避免用户频繁触发 T2.1 之外的边缘路径），脏时日志 warn |
| 3 | 两层 scope slug 冲突导致全局 skill 被悄悄遮蔽 | 员工编辑器侧 `SkillBindingList` 对被覆盖的 company skill 加 "overridden" badge；本次 minimal 版本足够，T2.7 正式 UI 再强化 |
| 4 | Marketplace 加 `'skill'` kind 但平台侧老版可能不认 | 确认 platform `Listing.kind` 类型为宽松 string union（registry-client 不做 client-side whitelist 之外的校验）；正式发版前再强化平台侧，单独 change |
| 5 | 迁移失败（旧 runtimeSkill 字段损坏）导致该员工无 skill | 迁移走 best-effort，失败记 log，继续下一条；pre-launch 阶段脏数据可接受丢失 |
| 6 | 引入 markdown 文件编辑，但没有 rich editor → 用户改不方便 | 本次 UI 只做列表显示 + 简易 `<textarea>` 编辑占位；T2.7 真正 UI surfacing 会做 WYSIWYG |
| 7 | 员工 prompt 注入 skill list 增大 context size（每员工多 100-300 tokens） | 实测：10 条 skill 平均 ~200 tokens，可接受；上限若达 50 条则按 description 前 120 字符截断 |
| 8 | `allowedTools` 作扩展字段未来上游若保留作别的语义会撞 | Anthropic 2025-12 已允许该扩展字段；协议台账 #6 记录；若上游改意则迁移到自己 namespace（单独 change） |

## Migration Plan

**迁移目标**：旧 `employees.config_json.runtimeSkill` → 新 skills 表 + 员工 vault SKILL.md

**Step 1 — schema + table**
- db-local migration 025：新建 `skills` 表 + 索引
- desktop SQL plugin embed version 31（镜像 025）
- platform 不动

**Step 2 — bootstrap 迁移脚本**
- 放在 `packages/core/src/skills/skills-bootstrap.ts`
- 运行时机：`runtime-init` 阶段，`await migrateRuntimeSkills(reposData)`
- 逻辑：扫全员 → 有 runtimeSkill 的生成 SKILL.md + 插 row → strip config_json.runtimeSkill
- 成功标志：写 marker `settings` 行 `skills_migration_v1_done=true`，之后跳过

**Step 3 — 类型层 + 消费者切换**
- 删 `RuntimeSkillConfig` 类型 + `EmployeeConfig.runtimeSkill` 字段
- 所有 consumer 改用 `SkillLoader.listSkillsForEmployee(...)` 分支
- `useEmployeeEditor` / `SkillBindingList` / `employee-prompt-assembly` / `employee-tool-round`

**Step 4 — Marketplace**
- `INSTALLABLE_KINDS` 扩 + `KIND_FILTERS` 扩
- `PublishDialog` 加 kind selector + skill 发布流程
- registry-client `installListing(kind='skill')` 分支

**Step 5 — live verify (tasks.md)**
- 清空 local DB → 启动 desktop → 迁移痕迹应为 0（新装无旧数据）
- 手动植入 dummy runtimeSkill → 再启动 → 观察迁移产物（SKILL.md + DB row + stripped field）
- Publish 一个员工专属 skill → 装回 → 观察 global 生效
- 员工 system prompt 含 "Available skills" 段

**Rollback strategy**
- db-local migration 025 可回滚（删表 + 不恢复 config_json 字段 —— 已被 strip）。Pre-launch 可接受 rollback 导致 skill 数据丢失；正式发版后会加 `config_json.runtimeSkill` 留存副本（下个 change 再说，不在本次）。

## Open Questions

1. **Q**: `allowedTools` 作为 frontmatter 扩展字段若 Anthropic 官方在 2026 内加入标准，字段名是否仍用复数形式？
   **A**（当前决定）：不管。本次只进出 body / metadata 中转，DB 不存独立列；上游改名时一次性 replay vault SKILL.md 即可。

2. **Q**: Web 端虚拟 vault 的 IndexedDB 空间上限如何探测？
   **A**（当前决定）：用 `navigator.storage.estimate()`（浏览器主流已支持）；超 80% 时拒绝写并 toast。本次先不做配额探测，开发时手动观察；作 T2.2 的前置。

3. **Q**: 平台 registry skill listing 的实际存储模型（是单文件还是 tar.gz）？
   **A**（当前决定）：本次按"manifest + content.md"单文件形态实现，多文件 skill 暂不支持子目录 publish（publish 前打平 —— assets 不打包）。多文件 skill publish 在 T2.2 补。

4. **Q**: `description` 字段长度限制？
   **A**（当前决定）：无硬限制；UI listing 截 160 字符；prompt 注入截 200 字符。硬限制等 T2.7 再定。
