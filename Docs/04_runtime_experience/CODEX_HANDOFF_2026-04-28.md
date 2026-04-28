# Codex Handoff — 2026-04-28 RC1

## 1. 任务

按 OpenSpec change 一次性交付到 `v1.1.0-rc.1`,产出三件产品级 capability:

- **`long-running-runtime`** — micro-compact / rolling-journal / fork-sub-context / completion-verifier / resume-coordinator
- **`interaction-modes`** — `InteractionMode` 4 值 union + YOLO Master 内置员工 + 4 个公司模板种入 + main-graph mode-aware router + SessionModeSwitcher UI
- **`kanban-data-pipeline`** — `kanban_cards` 表 + `KanbanRepo` + pm-planner 写卡 + employee-completion 转卡 + platform/Tauri 路由 + KanbanOverlay 接数据

## 2. 入口与圣经

- **仓库根:**`/Users/haoshengli/Seafile/WebWorkSpace/Offisim`
- **OpenSpec change 目录:**`openspec/changes/long-running-harness-interaction-modes-kanban-data/`
  - `proposal.md` — Why / What / Impact
  - `design.md` — 9 个 Decisions、Trade-offs、Migration plan
  - `tasks.md` — 7 个 section、约 80 个 task,带 baseline sampling、commit 节奏、harness 验证、live closure
  - `specs/long-running-runtime/spec.md` — Requirements + Scenarios
  - `specs/interaction-modes/spec.md` — Requirements + Scenarios
  - `specs/kanban-data-pipeline/spec.md` — Requirements + Scenarios
- **项目级硬约束:**`CLAUDE.md`(根目录) + `AGENTS.md`(根目录)
- **行为参考(read-only,严禁复制代码):**`/Users/haoshengli/Seafile/WebWorkSpace/ClaudeSource/claude-code-haha copy/` — micro-compact / sessionMemory 行为参考。**所有实现必须用 Offisim 自有类型 / repo / event-bus 重写,license 不兼容。**

## 3. 不可违反的硬规则

### 3.1 OpenSpec 流程约束

- 严格按 `tasks.md` 的 task 编号执行,不能跳号、不能合并、不能延后
- **执行顺序错位提醒:** Phase B Task 3.7 (`todo_*` 工具) 依赖 Phase C Task 5.2 (KanbanRepo)。`tasks.md` Section 4 (Pause Phase B, Pivot to Phase C 5.1+5.2) 明确告诉了正确顺序 — 严格遵守。
- 每个 capability 末尾打 git tag:`phase-a-long-running-runtime`、`phase-b-interaction-modes`、`phase-c-kanban-data-pipeline`,RC 末尾打 `v1.1.0-rc.1`
- **不修改其他 archived change 的内容** — `openspec/changes/archive/` 是历史,只读

### 3.2 验证策略(CLAUDE.md "Validation Policy" 强约束)

- **不允许引入 vitest / playwright / 旧 smoke / AI test。** 任何 product 级自动化测试都禁止。
- **允许:** 纯函数 / utility 用 `node --test` (`*.test.mjs`) — `packages/core` 已有此惯例
- **允许:** deterministic harness — `packages/core/harness/scenarios/*.json` + `packages/core/src/testing/{soak-runner,scenario-runner,fake-gateway,replay-gateway,invariant-assertions}` 已有完备基建
- **产品验收 = live agent 手测:** `pnpm dev` + 真实浏览器 / `pnpm --filter @offisim/desktop dev` + Tauri release `.app`,边操作边观察。`tasks.md` Section 6.3 + 6.4 共 13 项 closure checklist 必须人工跑过。
- **AGENTS.md 强约束:** desktop 验收必须用 release `.app`,不能停在 dev webview
- **CLAUDE.md "验证层级不能越界":** web 页面只用浏览器层工具 (snapshot / screenshot / console / network),不要为 web 流程调用 AppleScript

### 3.3 代码规范(CLAUDE.md "Code Style")

- Biome:**2-space indent、single quotes、trailing commas、有分号、100 char line width**
- TypeScript strict (`noUncheckedIndexedAccess`、`noUnusedLocals`、`noUnusedParameters`)
- ESM (`module: ESNext`、`moduleResolution: bundler`)
- **不写不必要的注释和 docstring** — 如果一段代码读懂不需要注释,就别写

### 3.4 Git 卫生

- 每个 task 一次 commit,Conventional Commit 前缀(`feat:` / `fix:` / `refactor:` / `test:` / `docs:` / `chore:`)
- **不允许 `--amend`** — pre-commit hook 失败时,根因修复后创建新 commit
- **不允许 `--no-verify` / `--force`/`git reset --hard`**
- 每个 task commit 之前必须做简化审查(见第 4 节);commit message 末尾加 `Simplification pass: clean` 或附 simplifier skill 输出摘要

### 3.5 仓库卫生(CLAUDE.md "Repository Hygiene")

- 不允许 `output/`、`screenshots/`、`.playwright-mcp/`、debug 脚本、tmp 文件进 git
- 不允许 placeholder / stub / `Pending removal` 路径长存
- 不允许 fallback 假装完成

## 4. 简化审查(每个 task commit 前必跑)

如果 harness 装了 `superpowers:simplify` 或同等 skill,直接调用对 staged diff 跑一遍。否则手工按下表过:

| 维度 | 检查 |
|---|---|
| DRY | `grep -rn` 类似函数名,可复用就复用 |
| YAGNI | 任务用不到的 abstraction / option / hook 参数 / "为以后预留"分支 → 删 |
| 死代码 | 未用 import / 变量 / export / leftover stub → 删 |
| 注释 | 只解释 *why*,删除 paraphrase 代码的注释 |
| 命名 | 邻近代码风格一致 (`KanbanCard` 不是 `KanbanCardItem`) |
| 类型 | 无 `any`、`unknown` 仅在边界、`as` 必须配 runtime 检查 |
| 错误处理 | 仅在边界(HTTP / IPC / FS / LLM),不吞错 |
| 测试覆盖 | 每个新分支有断言 |

发现问题 → 修 → 重跑该 task 测试 → 跑 `pnpm lint:fix && pnpm format` → commit。**不能"留给下个 task"或"清理 PR"。**

## 5. 类型一致性(多处声明必须同步)

| 类型 | 出现位置 |
|---|---|
| `InteractionMode = 'boss_proxy' \| 'human_in_loop' \| 'direct_to_employee' \| 'yolo'` | `packages/shared-types/src/interactions.ts`、`packages/db-local/src/migrations/0YY_session_interaction_mode.sql` (字面量)、`apps/platform/src/routes/sessions.ts` (zod)、`apps/web/src/components/session-mode/SessionModeSwitcher.tsx` (UI 列表) |
| `KanbanState = 'todo' \| 'doing' \| 'blocked' \| 'review' \| 'done'` | `packages/db-local/src/schema.ts`、`packages/core/src/runtime/repos/kanban-repo.ts`、`apps/platform/src/routes/kanban.ts` (zod)、`apps/web/src/runtime/useKanbanStream.ts` (type) |
| `KanbanOrigin = 'pm-planner' \| 'employee' \| 'manager' \| 'human'` | 同上 4 处 |

任一处与 shared-types 不一致即视为 bug。改一处 → grep 其他三处确认。

## 6. 视觉契约(KanbanOverlay,按 ocean-cyber DNA)

- ✅ 复用现有 `.glass-panel` 类作为容器
- ✅ 顶部 2px 接缝:`linear-gradient(90deg, var(--color-sea-blue), var(--color-kelp-green), var(--color-sea-blue))` + `box-shadow: 0 0 12px color-mix(in srgb, var(--color-sea-blue) 60%, transparent)`
- ✅ Origin pill 海洋色:pm-planner=sea-blue / employee=kelp-green / manager=coral-orange / human=foam
- ✅ 关闭按钮用 `.cyber-button`,卡片用 `.glass-panel-sm`
- ✅ 间距全用 `--sp-*` token (`p-sp-lg`、`gap-sp-md`)
- ✅ Backdrop scrim:`color-mix(in srgb, var(--color-abyss) 35%, transparent)`,只覆盖中央区,不挡左右 panel
- ❌ 不允许引入木纹 / 金属 / 粉笔 / 黑板纹理(workspace 是深海赛博风,不是工业风)
- ❌ 不允许 raw `bg-slate-900/85`、`p-3`、`gap-2`

## 7. 数据库选型(已锁,见 design.md Decision 6)

- 看板表 → **db-local** (SQLite),跟 `projects` / `companies` 同库
- `interaction_mode` 列 → 加在 db-local 的 `meeting_sessions` 表
- 不动 db-platform (PostgreSQL),那是 marketplace / auth 数据

## 8. 上手前侦察(写第一行代码前必跑)

```bash
cd /Users/haoshengli/Seafile/WebWorkSpace/Offisim
pnpm install
pnpm typecheck                                # baseline 必须全绿
pnpm lint                                     # baseline warning count 记下来
pnpm harness:contract && pnpm harness:replay  # baseline 全绿
ls packages/db-local/src/migrations/          # 真实下一个 migration 编号 (tasks.md 0XX/0YY 占位按这步替换)
grep -n "type RoleSlug\|RoleSlug =" packages/shared-types/src/**/*.ts   # RoleSlug 真实位置
cat packages/core/src/agents/pm-planner-types.ts                        # PlanStep 真实字段
grep -n "loadLatest\|class CheckpointSaver" packages/core/src/graph/checkpoint-saver.ts
cat packages/core/src/runtime/hook-registry.ts
cat packages/core/src/runtime/runtime-binding.ts
cat apps/platform/src/app.ts
cat packages/ui-office/src/components/kanban/KanbanOverlay.tsx
cat packages/ui-office/src/components/kanban/KanbanBoard.tsx
```

把侦察结果记在心里(不写到 git tracked 文件)。如果 baseline 不绿,先修绿再开工。

## 9. 卡住时的决策树

按顺序自救:

1. **plan 与真实代码冲突** — 以真实代码为准,调整实现,commit message 里说明偏离原因
2. **真实代码缺 plan 假设的方法**(如 `loadLatest` / `setTargetFps`) — 在该 task 范围内补,签名按 plan 给的
3. **测试一直红** — 检查测试是否写错(罕见),否则继续修实现。**绝不允许改测试让它通过**
4. **typecheck 跨包不匹配** — 看第 5 节类型一致性表,找哪一处没同步改
5. **lint 修不掉** — `pnpm lint:fix && pnpm format`;还有就一个个看具体规则名手动修。**绝不关 lint 规则**
6. **pre-commit hook 失败** — 根因修复,**不要 `--no-verify`**
7. **简化审查发现问题但修了之后测试又红** — 测试出问题说明你的简化破坏了行为。回滚那次简化,思考为什么"看似多余"的代码其实在保护边界。再做一次更保守的简化
8. **closure checklist 某项手动测试过不去** — debug 到通为止;若行为本身和 spec 不一致,记录差异、修代码、再测、再 commit

## 10. 完成判定

只有下面 8 项全勾才算 RC 通过:

- [ ] 4 个 git tag 都打:`phase-a-long-running-runtime`、`phase-b-interaction-modes`、`phase-c-kanban-data-pipeline`、`v1.1.0-rc.1`
- [ ] `pnpm typecheck` 全 workspace 零错误
- [ ] `pnpm lint` 干净(warning count ≤ pre-RC baseline)
- [ ] `pnpm harness:contract && pnpm harness:replay && pnpm harness:soak` 全绿
- [ ] `tasks.md` Section 6.3 (web 浏览器 closure) 10 项全 ✅
- [ ] `tasks.md` Section 6.4 (Tauri release `.app` closure) 全 ✅
- [ ] `CHANGELOG.md` 加 1.1.0-rc.1 段
- [ ] `Docs/04_runtime_experience/EXECUTION_REPORT_2026-04-28.md` 写完并 commit

## 11. 完成报告

写到 `Docs/04_runtime_experience/EXECUTION_REPORT_2026-04-28.md`(`tasks.md` Task 7.1 已要求),内容:

1. 每个 phase 的 commit count、关键 commit hash、tag
2. 新增 / 修改的文件总数
3. 新增 harness scenario 数量、跑出的 metric (final tokens / micro-compact passes / journal writes / verifier triggers)
4. 简化审查总结(每 task 发现并修的清单,无问题写 `clean`)
5. 偏离 plan 的清单(每条 (a) plan 写啥 (b) 真实代码啥 (c) 怎么处理)
6. closure checklist 13 项逐项结果
7. 已知问题 / follow-up

## 12. 现在开始

```bash
cd /Users/haoshengli/Seafile/WebWorkSpace/Offisim
cat openspec/changes/long-running-harness-interaction-modes-kanban-data/proposal.md
cat openspec/changes/long-running-harness-interaction-modes-kanban-data/design.md
cat openspec/changes/long-running-harness-interaction-modes-kanban-data/tasks.md
```

通读三份后跑第 8 节侦察清单,然后从 tasks.md Section 1 开始。

不需要等任何确认,直接开干。
