## 1. Shared-types + interaction context扩

- [x] 1.1 `packages/shared-types/src/interactions.ts` 中 `SkillInstallConfirmInteractionContext` 扩 `action?: 'install' | 'fork' | 'edit'`（可选，缺省 install）+ `parent?` + `bodyDiff?`；`sourceKind` union 加 `'fork'`
- [x] 1.2 `packages/shared-types/src/skill.ts` 新增 `SkillEditError` 类型（`kind: 'skill-not-found' | 'skill-md-invalid' | 'version-bump-failed'`），exports 里 surface
- [x] 1.3 `pnpm --filter @offisim/shared-types build` 跑通类型发布

## 2. SkillLoader.installSkill 接 fork source

- [x] 2.1 `packages/core/src/skills/skill-loader.ts` `SkillInstallSource` union 加 `SkillInstallSourceFork = { kind: 'fork'; parentSkillId: string; parentVersion: string }`
- [x] 2.2 `encodeSkillSourceRef(source)` switch 加 `'fork'` → `'company-skill:<parentSkillId>@<parentVersion>'`
- [x] 2.3 `installSkill` 内 `source_kind` 从 hard-coded `'installed'` 改成按 source.kind 映射：`'fork'` → `'forked'`，其它仍走 `'installed'`（marketplace / git / upload / claude-code / codex 都属 installed 语义）
- [x] 2.4 补 `installSkill({ scope: 'company', source: { kind: 'fork', ... } })` 用 `scope-target-conflict` 抛错的单测路径 — 加显式 `scope === 'company' && source.kind === 'fork'` 新 guard（旧 `employeeId` guard 只覆盖双侧都传参情况，不够），spec scenario 对齐

## 3. SkillLoader.editSkillBody 新入口

- [x] 3.1 `skill-loader.ts` 加 `editSkillBody({ skillId, newBody })` 入口，按 design D3 实现：find row → readFile → parseSkillMd → serializeSkillMd(frontmatter, newBody) → writeFile → skills.update（bump patch version + updated_at）
- [x] 3.2 抛 `SkillEditError` 三类（`skill-not-found` / `skill-md-invalid` / `version-bump-failed`）
- [x] 3.3 补 semver patch bump helper（`bumpPatch(version: string): string | null`，`null` 返 → 触发 `version-bump-failed`）
- [x] 3.4 `SkillRepository.update(skillId, patch: SkillUpdate)` 三后端已在 T2.1 落地（drizzle / memory / tauri），editSkillBody 直接复用；无需新增 API

## 4. Staging manager 扩 action discriminator

- [x] 4.1 `packages/core/src/skills/skill-staging.ts` `StagedSkill` 改成 discriminated union：`StagedSkillInstall {action: 'install' | 'fork'} & install tree fields` | `StagedSkillEdit {action: 'edit', skillId, newBody, employeeId, companyId}`
- [x] 4.2 `SkillStagingManager.put()` 用 distributive `Omit<T>` generic 保持变体字段；`take()` 返 union 供 committer switch

## 5. Committer 按 action 分支

- [x] 5.1 `packages/core/src/skills/skill-install-committer.ts` `handle()` 按 `staged.action` switch（non-edit → `commitInstallOrFork` 走 installSkill；`'edit'` → `commitEdit` 走 editSkillBody）
- [x] 5.2 返回值 union 扩：`{ kind: 'installed', ... }` / `{ kind: 'edited', skillId }` / `{ kind: 'cancelled' }` / `{ kind: 'staging-expired' }` / `{ kind: 'error', ... }`
- [x] 5.3 `InteractionService` 侧 `SkillInstallConfirmOutcome` union 同步扩加 `'edited'`

## 6. fork_skill 工具

- [x] 6.1 `packages/core/src/agents/skill-install-tools.ts` 加入 `fork_skill` 到 `SKILL_INSTALL_TOOL_NAMES` union 和 `SKILL_INSTALL_TOOL_DEFS`
- [x] 6.2 `fork_skill` handler：校验 skillId 存在、parent scope=company、targetEmployeeId 合法（缺省 = 调用员工，非空必须 = 调用员工），否则返 `{ kind: 'fork-parent-not-company' | 'cross-employee-forbidden' | 'skill-not-found' }`
- [x] 6.3 `SkillLoader.readSkillDirectory(skillId)` 新 API：读 parent SKILL.md + 深度遍历 `scripts/` / `references/` / `assets/`（复用 `VaultFileSystem.listDir` + `exists` + `readFile`；遇不存在的子树跳过，unreadable 节点吞）
- [x] 6.4 调扩展后 `stageAndEmit`（加 `action?` / `parent?` 入参）构造 `SkillInstallSource = { kind: 'fork', parentSkillId, parentVersion }` + interaction context `action: 'fork'` + `parent: { skillId, slug, name, version }` + options label `'Fork'`
- [x] 6.5 Tool description 自带 `fork_skill` 边界说明（T2.2 precedent：manager-node system prompt 不列 install tools，tool def description 承载；manager-node `Available employees` 列表由其它 consumer 维护，不在本 change scope）— 故本步改为只 expand tool description 而非 mutate manager system prompt

## 7. edit_skill_body 工具

- [x] 7.1 注册 `edit_skill_body` 到 tool 列表 + tool def + 工具描述
- [x] 7.2 handler：校验 skillId 存在、scope=employee、employee_id = 调用员工；否则返 `{ kind: 'company-scope-forbidden' | 'not-skill-owner' | 'skill-not-found' }`
- [x] 7.3 newBody 校验（非空 ≥ 10B、不以 `---\n` / `---\r\n` 开头、≤ 64 KiB），违反返 `{ kind: 'invalid-new-body', reason: 'empty' | 'frontmatter-in-body' | 'too-large' }`
- [x] 7.4 读旧 body（loadSkillBody）生成 oldPreview；newBody 生成 newPreview（各 ≤ 160 UTF-16，超出补 `…`）
- [x] 7.5 调 staging manager 存 `{ action: 'edit', skillId, newBody, employeeId, companyId }` + interaction context `action: 'edit'` + `bodyDiff: { oldPreview, newPreview }`，options label `'Save'`
- [x] 7.6 同 6.5 — tool description 自带说明，manager-node prompt 不改

## 8. UI 层：SkillInstallConfirmBubble 按 action 分支

- [x] 8.1 `packages/ui-office/src/components/chat/SkillInstallConfirmBubble.tsx` 按 `context.action` switch：install 原样、fork 显示 `Fork "⟨parent.name⟩@⟨parent.version⟩" → ⟨resolvedEmployeeName⟩` + parent slug 行、edit 显示两个截断 body preview（Old/New 并排，New 绿色高亮）
- [x] 8.2 Confirm 按钮 label 按 action 切 — 由 `stageAndEmit` / `stageEditAndEmit` 构造 `options[0].label` 做（Install / Fork / Save），UI 渲染 `request.options.map` 直接显示，无需 bubble 内分支
- [x] 8.3 Cancel label 不变（`{ id: 'cancel', label: 'Cancel' }` 三条路径一致）
- [x] 8.4 bundle 增量审计：web build `app-install-C4lt88ED.js = 166.75 kB`，pre-T2.3 baseline ~162 kB；实测 +~5 kB 在 <10 kB budget 内，符合 "增量 render 分支不引依赖" 预期

## 9. Live verification（5 场景 happy + 4 场景 reject）

> web 层只用浏览器层证据（screenshot / console / network），tauri 用原生 shell。

- [ ] 9.1 Happy-path fork：web live — 装一条 company-scope skill → 员工 chat `"把 writing-style 给我 fork 一份"` → 预览 bubble `action=fork` 标题 → Confirm → 刷新 employee skills list 看到 employee-scope 同 slug 行、`source_kind='forked'`、`source_ref='company-skill:...'`；截图 + console dump
- [ ] 9.2 Happy-path edit：员工 chat `"简化我的 writing-style，只保留 3 条规则"` → 预览 bubble `action=edit` 两个截断 body 并列 → Confirm → SKILL.md body 变更 + version 从 0.1.0 → 0.1.1；live 证 git diff
- [ ] 9.3 Cross-employee fork reject：员工 Alice chat `"给 Bob fork 一份 writing-style"` → handler 返 `cross-employee-forbidden` → LLM 自然语言回 "can't fork to another employee"；console log 证
- [ ] 9.4 Company-scope edit reject：员工 chat `"改 company-scope skill X 的内容"` → handler 返 `company-scope-forbidden`
- [ ] 9.5 Not-skill-owner reject：Alice 试图 edit Bob 的 employee skill → `not-skill-owner`
- [ ] 9.6 Fork idempotency：同 employee 对同 parent version 连 fork 两次 → 第二次走 slug-collision `source_ref` 对齐分支 → 返 `wasExisting: true`，skills row count 不变
- [ ] 9.7 Slug override live：fork 后员工 listSkillsForEmployee 同 slug 只出现一次，且是 employee-scope 版本（观察点：T2.2 observation 9.9 cross-scope override live 证据 — 本次真产出）
- [ ] 9.8 Version patch bump：连 edit 两次，看 `skills.version` 从 `0.1.0 → 0.1.1 → 0.1.2`
- [ ] 9.9 Staging TTL：fork 后等 6 秒再 confirm → 返 `staging-expired`；UI toast / chat follow-up 观察
- [ ] 9.10 Desktop Tauri live：在 Tauri 里重跑 9.1 + 9.2，验 vault 目录里真 SKILL.md 文件就位（`ls companies/*/employees/*/skills/`）

## 10. Openspec archive-gate 三查 + 台账同步

- [ ] 10.1 Spec 一致性：落地 scope 和 `skills-foundation` / `agent-mediated-skill-install` / `skill-fork-and-edit` 三 spec 对齐，任一偏差先改 spec 再 archive — archive 前由 opsx 检查
- [ ] 10.2 Tasks 一致性：每个 9.x 必须有 live verify record（截图 / git diff / console dump 三选一），未 verify 的不勾 — apply 阶段不收
- [x] 10.3 文档注释一致性：`packages/core/CLAUDE.md` Skills 节补 `installSkill(fork source)` / `readSkillDirectory` / `editSkillBody` API 说明 + fork provenance DB-only 约定 + frontmatter 不扩 `offisim.*`
- [x] 10.4 协议台账 `openspec/protocols-ledger.md` SKILL.md 行：追加 T2.3 落地，明确 Offisim fork provenance 只在 DB，frontmatter 未扩 `offisim.*`，保 Anthropic 开放标准 portability
- [ ] 10.5 Memory 更新：roadmap `project_1_0_roadmap.md` T2.3 改 ✅；`MEMORY.md` Current State + Open Issues 同步 — archive 时做

## 11. Verify records（archive 时填）

> 每条 9.x 完成后回填：日期、runtime（web / tauri）、证据形式、观察结论。未 PASS 保留未勾。

- [ ] 11.1 9.1 Happy-path fork — ⟨date / runtime / evidence⟩
- [ ] 11.2 9.2 Happy-path edit — ⟨date / runtime / evidence⟩
- [ ] 11.3 9.3 Cross-employee fork reject — ⟨date / runtime / evidence⟩
- [ ] 11.4 9.4 Company-scope edit reject — ⟨date / runtime / evidence⟩
- [ ] 11.5 9.5 Not-skill-owner reject — ⟨date / runtime / evidence⟩
- [ ] 11.6 9.6 Fork idempotency — ⟨date / runtime / evidence⟩
- [ ] 11.7 9.7 Slug override live（T2.2 observation 9.9 代收的 live 证据落地点）— ⟨date / runtime / evidence⟩
- [ ] 11.8 9.8 Version patch bump — ⟨date / runtime / evidence⟩
- [ ] 11.9 9.9 Staging TTL — ⟨date / runtime / evidence⟩
- [ ] 11.10 9.10 Desktop Tauri live — **FAIL 2026-04-20** / Tauri desktop / observed error `Attempted to assign to readonly property.` (1 error in DevTools console) — fork happy path 在 `fork_skill` preview bubble 之前炸出；team chat (`@Maya Lin 把 frontend-design 给你自己 fork 一份.`) + Maya direct chat 两条入口复现一致；vault / DB 未被写入（employee-scope row count 仍为 0）。blocker 在 desktop chat/orchestration 层 readonly 赋值点（具体文件 + 栈待 DevTools stack trace 确认）
