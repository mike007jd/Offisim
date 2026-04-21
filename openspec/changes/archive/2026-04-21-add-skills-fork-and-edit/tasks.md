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

- [x] 9.1 Happy-path fork：2026-04-21 / web live（isolated Playwright Chromium）— clean browser company boot 后先在 Alex direct chat 用 `install_skill_from_git` 装 company-scope `frontend-design`，随后 employee chat `fork_skill` 产出 `Fork skill · frontend-design` 预览并 confirm；浏览器上下文 `repos.skills.listByEmployee(companyId, alexId)` 落出 employee-scope row，`source_kind='forked'`、`source_ref='company-skill:sk_1776769941019_no28lhdm@0.1.0'`，且 OPFS `companies/<company>/employees/alex-chen/skills/frontend-design/SKILL.md` 与 company parent body byte-identical；截图 + console dump 已补
- [x] 9.2 Happy-path edit：2026-04-21 / web live（isolated Playwright Chromium）— 在同一条 Alex direct chat 上调用 `edit_skill_body`，浏览器产出 `Edit skill · frontend-design` 预览并 confirm；浏览器上下文 `repos.skills.listByEmployee(...)` 显示 version `0.1.0 -> 0.1.1`，OPFS `SKILL.md` body 变更为仅保留 3 条规则（frontmatter 保持）；截图 + console dump 已补
- [x] 9.3 Cross-employee fork reject：已用真实 desktop DB/vault 的 tool-layer harness 直调 `handleSkillInstallTool('fork_skill', { skillId: 'sk_1776761246943_mddq4vp9', targetEmployeeId: 'fd582e8a-6fb0-4b90-af90-5e51fd01da0c' }, ctx, 'a709d82c-983a-41ea-a153-dd0d10bfde83')`，稳定返回 `cross-employee-forbidden`
- [x] 9.4 Company-scope edit reject：已用真实 desktop DB/vault 的 tool-layer harness 直调 `handleSkillInstallTool('edit_skill_body', { skillId: 'sk_1776761246943_mddq4vp9', ... }, ctx, 'a709d82c-983a-41ea-a153-dd0d10bfde83')`，稳定返回 `company-scope-forbidden`
- [x] 9.5 Not-skill-owner reject：已给 Alex materialize 一条 employee-scope `frontend-design` fork（`sk_1776764595123_52w15dwl`），再由 Maya 直调 `edit_skill_body` 命中 `not-skill-owner`
- [x] 9.6 Fork idempotency：同 employee 对同 parent version 连 fork 两次 → 第二次走 slug-collision `source_ref` 对齐分支 → 返 `wasExisting: true`，skills row count 不变
- [x] 9.7 Slug override live：fork 后员工 listSkillsForEmployee 同 slug 只出现一次，且是 employee-scope 版本（观察点：T2.2 observation 9.9 cross-scope override live 证据 — 本次真产出）
- [x] 9.8 Version patch bump：连 edit 两次，看 `skills.version` 从 `0.1.0 → 0.1.1 → 0.1.2`
- [x] 9.9 Staging TTL：已用短 TTL harness 走完整 `fork -> pending confirm -> wait expire -> confirm` 链，`InteractionService.resolve()` 返回 `skillInstallOutcome.kind='staging-expired'`，web follow-up 改为 `"That skill preview expired. Ask again to generate a fresh preview."`
- [x] 9.10 Desktop Tauri live：在 Tauri 里重跑 9.1 + 9.2，验 vault 目录里真 SKILL.md 文件就位（`ls companies/*/employees/*/skills/`）

## 10. Openspec archive-gate 三查 + 台账同步

- [x] 10.1 Spec 一致性：2026-04-21 archive gate 已复核落地 scope，并由 `openspec archive add-skills-fork-and-edit -y` 同步 delta → canonical（`skills-foundation` / `agent-mediated-skill-install` 更新，`skill-fork-and-edit` 新建）
- [x] 10.2 Tasks 一致性：9.x 现已全部补齐 live verify record；web happy-path 由 isolated Playwright Chromium 截图 + console dump 落证，tauri 项维持原 shell / sqlite / vault 证据
- [x] 10.3 文档注释一致性：`packages/core/CLAUDE.md` Skills 节补 `installSkill(fork source)` / `readSkillDirectory` / `editSkillBody` API 说明 + fork provenance DB-only 约定 + frontmatter 不扩 `offisim.*`
- [x] 10.4 协议台账 `openspec/protocols-ledger.md` SKILL.md 行：追加 T2.3 落地，明确 Offisim fork provenance 只在 DB，frontmatter 未扩 `offisim.*`，保 Anthropic 开放标准 portability
- [x] 10.5 Memory 更新：2026-04-21 已同步 `~/.claude/projects/-Users-haoshengli-Seafile-WebWorkSpace-Offisim/memory/project_1_0_roadmap.md` 的 T2.3 状态，并回写 `MEMORY.md` 的 Current State / Next Change Queue / Open Issues

## 11. Verify records（archive 时填）

> 每条 9.x 完成后回填：日期、runtime（web / tauri）、证据形式、观察结论。未 PASS 保留未勾。

- [x] 11.1 9.1 Happy-path fork — 2026-04-21 / web isolated Playwright Chromium / evidence: live preview captured `Fork skill · frontend-design` targeting `Employee: Alex Chen`; browser console dump from `window.__OFFISIM_DEBUG__.repos.skills.listByEmployee(companyId, alexId)` produced employee row `sk_1776769973213_uh6o1wwi` with `scope='employee'`, `source_kind='forked'`, `source_ref='company-skill:sk_1776769941019_no28lhdm@0.1.0'`, `vault_path='companies/464ea3ce-91c6-4b5f-92e7-1afba99e6728/employees/alex-chen/skills/frontend-design/SKILL.md'`; OPFS readback showed forked `SKILL.md` body byte-identical to company parent
- [x] 11.2 9.2 Happy-path edit — 2026-04-21 / web isolated Playwright Chromium / evidence: live preview captured `Edit skill · frontend-design`; browser console dump showed same employee row version bump `0.1.0 -> 0.1.1` with stable `source_ref`; OPFS readback of `companies/464ea3ce-91c6-4b5f-92e7-1afba99e6728/employees/alex-chen/skills/frontend-design/SKILL.md` changed body tail from the original frontend-design prose to exactly `1. Prefer bold visual hierarchy. 2. Avoid generic layouts and default fonts. 3. Ship responsive polished interactions.`
- [x] 11.3 9.3 Cross-employee fork reject — 2026-04-21 / tauri desktop tool-layer harness against the live desktop sqlite + vault / evidence: `handleSkillInstallTool('fork_skill', { skillId: 'sk_1776761246943_mddq4vp9', targetEmployeeId: 'fd582e8a-6fb0-4b90-af90-5e51fd01da0c' }, ctx, 'a709d82c-983a-41ea-a153-dd0d10bfde83')` returned `{\"kind\":\"cross-employee-forbidden\",\"message\":\"fork_skill: cannot fork a skill to a different employee.\"}`
- [x] 11.4 9.4 Company-scope edit reject — 2026-04-21 / tauri desktop tool-layer harness against the live desktop sqlite + vault / evidence: `handleSkillInstallTool('edit_skill_body', { skillId: 'sk_1776761246943_mddq4vp9', newBody: '## 1. Single rule\\n\\nKeep only one concise frontend rule.' }, ctx, 'a709d82c-983a-41ea-a153-dd0d10bfde83')` returned `{\"kind\":\"company-scope-forbidden\",\"message\":\"edit_skill_body: cannot edit company-scope skills.\",\"skillId\":\"sk_1776761246943_mddq4vp9\"}`
- [x] 11.5 9.5 Not-skill-owner reject — 2026-04-21 / tauri desktop tool-layer harness against the live desktop sqlite + vault / evidence: after materializing Alex employee-scope fork `sk_1776764595123_52w15dwl`, `handleSkillInstallTool('edit_skill_body', { skillId: 'sk_1776764595123_52w15dwl', newBody: '## 1. Maya should not edit Alex skill\\n\\nThis should be rejected at owner check.' }, ctx, 'a709d82c-983a-41ea-a153-dd0d10bfde83')` returned `{\"kind\":\"not-skill-owner\",\"message\":\"edit_skill_body: only the owning employee can edit this skill.\",\"skillId\":\"sk_1776764595123_52w15dwl\"}`
- [x] 11.6 9.6 Fork idempotency — 2026-04-21 / tauri desktop / evidence: second `skill_install_confirm` fork interaction `ix-92293847-e864-479d-8bac-c72c98e8e5c9` resolved after asking Maya to fork company skill id `sk_1776761246943_mddq4vp9` again; sqlite check kept employee-scope `frontend-design` row count at `1` and preserved skill id `sk_1776761871124_rwxadqug` (no duplicate row)
- [x] 11.7 9.7 Slug override live（T2.2 observation 9.9 代收的 live 证据落地点）— 2026-04-21 / tauri desktop / evidence: Maya's edit-task reasoning explicitly cited only the employee-scope `frontend-design` skill (`id=sk_1776761871124_rwxadqug`, `scope=employee`, `version=0.1.0`) after the fork existed, demonstrating prompt-tier `listSkillsForEmployee` slug override over the company-scope parent
- [x] 11.8 9.8 Version patch bump — 2026-04-21 / tauri desktop / evidence: two edit confirmations resolved (`ix-7ddbf5de-8c47-444a-a5f8-7461f95d1e65`, `ix-a155a5d2-5865-4184-9f2b-51f6faae08a0`); sqlite + vault showed `skills.version` / SKILL.md frontmatter bump `0.1.0 -> 0.1.1 -> 0.1.2`
- [x] 11.9 9.9 Staging TTL — 2026-04-21 / tauri-runtime pieces + web follow-up harness / evidence: with `SkillStagingManager({ ttlMs: 1500 })`, `handleSkillInstallTool('fork_skill', { skillId: 'sk_1776761246943_mddq4vp9' }, ctx, 'a709d82c-983a-41ea-a153-dd0d10bfde83')` produced pending confirm; after waiting 1800 ms, `InteractionService.resolve(confirm)` returned `skillInstallOutcome={ kind: 'staging-expired' }`, and `getInteractionFollowUp(..., outcome)` yielded the user-facing message `"That skill preview expired. Ask again to generate a fresh preview."`
- [x] 11.10 9.10 Desktop Tauri live — PASS 2026-04-21 / Tauri desktop / evidence: Maya direct chat successfully rendered fork preview (`Fork skill · frontend-design`) and edit preview (`Edit skill · frontend-design`), both `skill_install_confirm` interactions resolved on confirm (`ix-87e9a6a5-e9fe-4cd8-9fda-f504c54b2806`, `ix-7ddbf5de-8c47-444a-a5f8-7461f95d1e65`), employee-scope sqlite row materialized with `source_kind='forked'` + `source_ref='company-skill:sk_1776761246943_mddq4vp9@0.1.0'`, and vault file existed at `companies/48b472c5-0979-4122-af16-66d03698e647/employees/maya-lin/skills/frontend-design/SKILL.md`; previous readonly crash no longer reproduced
