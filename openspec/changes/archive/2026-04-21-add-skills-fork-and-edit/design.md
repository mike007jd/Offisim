## Context

T2.1 确立 "SKILL.md 在 vault 是源真相，`skills` 表做索引" + 两层 scope + 三 tier loader + `installSkill` 做唯一 write 入口。T2.2 把 install 变成 chat-native，加了 **staging + `skill_install_confirm` interaction + committer** 三段式 pattern（`packages/core/src/skills/skill-staging.ts` / `skill-install-committer.ts` / `agents/skill-install-tools.ts` 四工具 + `InteractionService.handleSkillInstallConfirm` wiring）。

T2.3 要在这个框架里加两条 agent-native 动作：

1. **fork** — 员工对某条 company-scope skill 说 "这招我要自己一份"，产出 employee-scope 副本，body 等同原版（玩家后续用 edit 改出差异）
2. **edit** — 员工对自己 employee-scope 的 skill body 重写（策划意图：skill 自进化的 MVP 表面）

这两条都 **不碰 company-scope 写入**。T2.6 "skill 自改进 / 全局改动 5 秒撤销公告" 是后话，本 change 明确不做。

为了让 install / fork / edit 三条 chat-native 动作共享预览 + 确认 + 5 秒撤销的 UX（而不是三套独立 preview bubble），必须把 T2.2 的 staging + committer pipeline 泛化到支持多 action。这是本次最大的架构决策点。

## Goals / Non-Goals

**Goals:**

- 员工 tool kit 追加 `fork_skill` / `edit_skill_body` 两条工具（和 T2.2 四条并列，共 6 条 skill mutation 工具）
- staging + `skill_install_confirm` interaction + committer pipeline 扩成三 action 统一入口
- `SkillLoader.installSkill` 扩一条 `kind: 'fork'` source；新增 `SkillLoader.editSkillBody` 单独入口（不走 installSkill，语义是"改已存在的 row + 重写 SKILL.md body"，硬挤进 installSkill 会把 slug-collision 语义搞乱）
- Fork provenance pin：`source_kind='forked'` + `source_ref='company-skill:<parentSkillId>@<parentVersion>'`。SKILL.md frontmatter **不动**（保 Anthropic 开放标准 portability）
- Fork / edit 都限制 "只能影响调用员工自己"：fork 的 target 默认 = 调用员工，edit 只能操作 `employee_id === 调用员工` 的 skill
- 预览 UI 按 action 分支显示不同信息（install = staging 内容 / fork = parent 行 + 目标员工 / edit = 旧 body 截断 + 新 body 截断 diff），共享"Confirm / Cancel" 交互壳 + 5 秒 TTL

**Non-Goals:**

- 不做 company-scope skill body 编辑（归 T2.6）
- 不做上游 skill 升级对已 fork 员工版本的通知 / rebase / merge（pin + 不追踪，产品决策锁定）
- 不做员工互传（归 T2.5，依赖 T3.1 relationships）
- 不做自创建（autonomous 触发归 T2.4）
- 不加 UI 入口（保 chat-native 一致性，17 决策 B3）
- 不做跨 employee fork：只能 fork 给调用自己（想给 Alice fork 一份让 Alice 自己说，不允许 Bob 代操作；PM 心智："员工的技能是员工自己的"）
- 不扩 SKILL.md frontmatter 白名单（保开放标准）

## Decisions

### D1 — interaction 复用：扩 context 的 `action` 判别式，不开新 interaction kind

**Chosen**: 继续用 `kind: 'skill_install_confirm'`，`context.action: 'install' | 'fork' | 'edit'` 做 discriminator，默认不填时视为 `'install'`（老调用向后兼容）。

**Alternatives considered:**
- 新 `skill_mutation_confirm` kind — 要改 UI subscription / handler / InteractionService switch / shared-types union，代价大，心智并无更清晰
- Install / fork / edit 三个独立 kind — UI 要维护三套气泡，违背 "统一预览面板" 目标

**Why**: install / fork / edit 在玩家视角都是 "系统想动你的 skill 表，请你确认" 的同一类事件；预览 UI 差异点只是"显示的内容不同"，不是"交互类型不同"。复用 kind 把"交互类型"和"被改对象内容"分开。

### D2 — 两工具分界：fork_skill / edit_skill_body 独立签名

**Chosen**: 两条工具独立，不合并成通用 `mutate_skill`：

- `fork_skill({ skillId: string, targetEmployeeId?: string })` — skillId 必须指向 company-scope row；targetEmployeeId 缺省 = 调用员工自己 ID
- `edit_skill_body({ skillId: string, newBody: string })` — skillId 必须指向调用员工 employee-scope row；newBody 是完整 SKILL.md body（frontmatter 不在参数里）

**Why**:
- LLM 对 "fork" / "edit" 两个动词的调用选择更稳，合并工具要靠 `action: 'fork' | 'edit'` 判别式增加误判风险
- 参数 shape 不一样（fork 不需要 newBody，edit 必须有 newBody），合并后的 JSON schema 会含大量 `oneOf` / 条件 required，LLM 容易传错

### D3 — edit 不走 `installSkill` 主路径

**Chosen**: `SkillLoader.editSkillBody(skillId, newBody, source)` 作独立 API：找 row → readFile 原 body → 以新 body 重写 SKILL.md（frontmatter 原封保留）→ bump `version` 小位（`0.1.0 → 0.1.1`）→ `updated_at` 刷新。**不**走 slug-collision 校验，**不**改 vault path。

**Alternatives considered:**
- 让 `installSkill` 支持 `skillId` 作为"更新 existing" 的 override — 会把 "install 幂等语义（同 source_ref 返 existing）" 和 "edit 显式 overwrite" 两套逻辑缠在一起，维护地狱
- 直接让 tool handler 手写 fs.writeFile + skills.update — 绕开 loader 单所有者，违背 T2.1 "所有 skill mutation 走 SkillLoader" 原则

**Why**: fork 仍走 `installSkill({ source: { kind: 'fork' } })`，复用 slug-collision + 路径 + 回滚机制；edit 是"同 row 重写"，语义本质不同，独立入口更清晰。

### D4 — fork 的 slug 策略：沿用 parent slug

**Chosen**: fork 出来的 employee-scope row slug **和 parent 相同**。partial UNIQUE index 已经保证 `(companyId, employeeId=NOT NULL, slug)` vs `(companyId, employeeId=NULL, slug)` 可共存（T2.1 落地）。

**Alternatives considered:**
- Fork 时加后缀 `-forked` 或 `-alice` — 违反 "Tier 1 listing 员工侧 override company-scope 同 slug" 设计，玩家会在 chat 看到两条重名的 skill，错位

**Why**: 统一 slug 是 T2.1 "员工侧覆盖 company 侧" 机制的产品形态（玩家说 "use writing-style"，system 自动优先员工 fork）。这条也是 T2.2 observation 9.9 cross-scope override live 证据的产生点。

### D5 — fork 再 fork / fork 相同 parent 两次的幂等

**Chosen**:
- Same `(parentSkillId, parentVersion)` 对同一 employee fork 第二次：slug-collision 走 `source_ref` 对齐分支 — 返回 existing row，`wasExisting: true`（沿用 T2.1 installSkill 幂等语义）
- Different parent version（company-scope skill 升级后再 fork）：视为新 install，`source_ref` 不同，抛 slug-collision 要求先改名或 delete 旧 fork。**本次不做** "fork 自动 overwrite 旧版" 捷径
- Fork 一个已 fork 的 employee-scope skill：拒。fork 的 parent 必须是 company-scope。`fork_skill` handler 校验 `parentRow.scope === 'company'`，否则返 `{ kind: 'fork-parent-not-company' }`

**Why**: 幂等走老路径，避免新分支；跨版本 fork 冲突交给玩家手动消歧，符合 "pin + 不追踪 upstream" 的最小责任原则。

### D6 — edit 的 staging：body-only 最小 staging entry

**Chosen**: 扩 `SkillStagingEntry` union 成 `{ action: 'install' | 'fork' | 'edit' }` 判别式：

- `install` / `fork` 带 tree + scan + skillMdText（现状）
- `edit` 只带 `{ action: 'edit', skillId, newBody, employeeId, companyId }`

Committer 按 action switch：install / fork → 老路径（走 installSkill）；edit → 走 editSkillBody。

**Alternatives considered:**
- Edit 也构造一个完整 tree + scan — 无谓 overhead，body change 不碰 assets
- Edit 不进 staging，直接走 interaction context 带 newBody 字符串 — context 是会发 UI / 存日志的，大 body 进 context 有泄露 / 体积问题

**Why**: staging 主要价值是"敏感内容不外泄 + 5 秒 TTL 自动清理"，edit 同样需要这些保证。最小字段 staging entry 维护简单。

### D7 — 预览 UI 信息分支

**Chosen**: `skill_install_confirm` interaction context 新增：

- `action: 'install' | 'fork' | 'edit'`（默认 install）
- `parent?: { skillId, slug, name, version }`（fork only）
- `bodyDiff?: { oldPreview: string, newPreview: string }`（edit only；各截 160 字 UTF-16）

UI 气泡：
- action=install：原样（staged 内容 + 权限 warning）
- action=fork：显示 `Fork "⟨parent.name⟩@⟨parent.version⟩" → ⟨targetEmployee⟩` + parent 行，不展 body
- action=edit：显示 `Edit your "⟨skill.name⟩"` + 两个截断 body 并排

**Why**: 玩家看到的信息量和决策所需信息对齐。Edit 一定要看到 body 变了什么，否则玩家只能瞎点 confirm；install / fork 给 body 价值不高（装 / 复制的是整包）。

### D8 — 越权拒绝矩阵（tool-level hard guards）

| 场景 | fork_skill | edit_skill_body |
|---|---|---|
| skillId 指向 company-scope skill | OK（parent） | **reject** `company-scope-forbidden` |
| skillId 指向别的员工 employee-scope | reject `fork-parent-not-company` | **reject** `not-skill-owner` |
| skillId 指向调用员工 employee-scope | reject `fork-parent-not-company` | OK |
| targetEmployeeId 指向别人 | **reject** `cross-employee-forbidden` | N/A |
| targetEmployeeId 缺省 | 默认 = 调用员工 | N/A |
| skillId 不存在 | reject `skill-not-found` | reject `skill-not-found` |

**Why**: 所有越权路径必须在 tool handler 层挡掉（拒错给 LLM），绝对不能靠 loader 层挡——loader 层的 `installSkill` / `editSkillBody` 是通用 write 入口，未来 T2.5 peer-transfer 时要支持"给别人加 skill"，两层语义分开更安全。

## Risks / Trade-offs

**[LLM 误调 fork_skill 代替 install]** → LLM 可能把 "给 Alice 装一份 writing-style" 误解成 fork — 但 writing-style 可能还没进 company scope（装了才 fork，没装不能 fork）。tool description 要明确："fork 只能作用于**已存在**的 company-scope skill；要装新的请用 install_*"。Handler `skill-not-found` 分支拒掉，LLM 能自动重试。

**[slug collision 体验差]** → 玩家两次 fork 不同 parent version 会撞 slug。错误 message 要清晰："Alice already has a fork of writing-style@0.1.0; delete it first or skip this fork"。

**[Body edit 无版本历史]** → Edit 直接覆盖 SKILL.md，没有 "回到上版" 入口（除了 5 秒撤销）。玩家改坏了就改坏了。接受，理由：vault 在 git 下（`GitAutoCommitService` 桌面端自动 commit），历史在 git log。1.0 不做 skill 内置版本浏览器。

**[LLM 产出的 newBody 不合规]** → LLM 可能产出带 frontmatter 的 body / 空 body / 超长 body。Handler 在 staging 前 sanity check：
- 非空（>= 10 字节）
- 不含 `^---\n` 开头（frontmatter 污染）
- <= 64 KB（UX + DB 考虑，和现状 SKILL.md 规模匹配）

不满足 → `{ kind: 'invalid-new-body' }` 拒给 LLM，让它重试。

**[Fork 时 assets 复制爆体积]** → fork 会把 parent 的 `scripts/` / `references/` / `assets/` 全复制到员工目录，如果有大 binary 会吃盘。1.0 不做 symlink fork（跨 OS 复杂），接受全复制。之后 skill bundle 大了再优化。

## Migration Plan

- 无 DB migration（`source_kind` union 已含 `'forked'`）
- 无 schema breaking change
- **向后兼容**：老 `skill_install_confirm` interaction 消费者（T2.2 的 UI）看不到 `action` 字段时按 `'install'` 解释，不会崩
- Rollback：代码级 revert；没有 deprecated shim

## Open Questions

无。以下几点显式已决策：
- Fork 跨员工：拒（D8）
- Edit 版本历史：走 git，不内置
- Parent 升级追踪：pin + 不追踪（产品决策）
- Tool 数量：两条不合并（D2）
