## Why

T2.1 / T2.2 让 skill 能被全局安装（company scope）和 chat-native 装进来，但**每个员工只能被动读**——没有"这个员工把这招改成自己版本"的入口，skill pillar 的"员工沉淀技能、互相学、自进化"三大差异化（T2.4 / T2.5 / T2.6）全卡在"fork" 这一步。策划决策 A4 早就锁"全局 skill 能被员工 fork 成专属修改版"，现在兑现。

同时顺路收 T2.2 observation 的 9.9 cross-scope override 场景：同 slug 两 scope 共存的代码路径 T2.1 建好了，fork 是第一次**人工驱动**产出 employee-scope row，是 T2.2 observation 代收证据变成 live 证据的自然时机。

## What Changes

- 员工新增 **`fork_skill`** 工具：把一条 company-scope skill 复制成调用员工的 employee-scope 专属副本；SKILL.md body 原封不动，provenance pin 只落 DB（`source_kind='forked'` + `source_ref='company-skill:<parentSkillId>@<parentVersion>'`），**不污染 SKILL.md frontmatter**（保开放标准 portability）
- 员工新增 **`edit_skill_body`** 工具：对自己 employee-scope skill 重写 body（frontmatter 不动），走 T2.2 的 staging + `skill_install_confirm` interaction pattern + 5 秒撤销公告。不能改 company-scope skill（越权直接 refuse）
- Fork / edit 都落 **`SkillLoader.forkSkill()` / `SkillLoader.editSkillBody()`**，vault 写入 + DB upsert + 幂等语义复用 T2.1 的 `installSkill` 机制
- Chat preview bubble 复用 T2.2 `skill_install_confirm` interaction，body diff 展示用复用的 `formatSkillPreview` helper（加 parent pin / body 前 80 字截断字段）
- **Pin 但不追踪 upstream**：company-scope skill 升级不触发 employee fork 通知 / rebase / merge；parent_version 只写一次、当时对齐，之后两条独立演化。产品心智："员工的技能可以自己长歪，不是上游分支"
- Manager node system prompt 加两行说明（和 T2.2 一样路径）：列出两条新工具 + 一句边界（只能 fork/edit 自己 scope）

## Capabilities

### New Capabilities
- `skill-fork-and-edit`: 员工专属 skill 的分叉 + body 改写语义（工具签名 / provenance pin / staging 交互 / 越权拒绝 / 幂等）

### Modified Capabilities
- `skills-foundation`: `SkillLoader` 加 `forkSkill` / `editSkillBody` 两条 write API；`source_kind` 枚举扩 `'forked'`；`encodeSkillSourceRef` / `SkillInstallSource` union 扩 `{ kind: 'fork', parentSkillId, parentVersion }`。SKILL.md frontmatter 白名单不动（保开放标准 portability）
- `agent-mediated-skill-install`: 把 `skill_install_confirm` interaction 泛化成 `skill_mutation_confirm`（install / fork / edit 三源共用），或者复用现名但扩 `action` 判别式；由 design 决定。tasks / verify 列表同步扩展

## Impact

- **packages/core/src/skills/SkillLoader.ts**：新 `forkSkill` / `editSkillBody` 两入口，复用 `installSkill` 的幂等 / vault 写入机制
- **packages/core/src/agents/employee-node.ts** + tool builder：注册 `fork_skill` / `edit_skill_body` 两工具，越权拦截（company 源只能读、不能 fork 到别人身上、员工不能改别人 fork）
- **packages/ui-office/src/components/chat/**：`skill_install_confirm` interaction context 扩 `action: 'install' | 'fork' | 'edit'`，预览面板按 action 分支：install 显示 staging 内容 / fork 显示 parent 行 + "copy to ⟨employee⟩" / edit 显示 body diff（旧 → 新截断版）
- **packages/core/src/agents/manager-node.ts**（system prompt 段）：加两行工具说明
- **packages/db-local/src/migrations/**：不需要新 migration — `skills.source_kind` 是 TEXT，`SkillSourceKind` union 已含 `'forked'`（T2.1 forward-declared，目前无生产者），本次正式启用。`source_ref` 用 `company-skill:<parentId>@<parentVersion>` 约定
- **openspec/protocols-ledger.md**：SKILL.md 行同步注明 "Offisim fork provenance 只在 DB，frontmatter 未引入私有命名空间"
- Memory MEMORY.md + 1.0 roadmap：T2.3 收口后更新
- **不影响**：外包员工（不吃 skills pillar）、A2A dispatch、2D / 3D render、Market publish（fork 产物不上 marketplace）
