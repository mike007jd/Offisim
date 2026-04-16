## Context

2026-04-16 跑完了 openspec 重建的首轮收口。当天的实际仓库状态：

- `openspec/specs/` 已落 5 个 canonical spec：
  - `avatar-seed-resolution/spec.md`
  - `plan-step-store/spec.md`
  - `typed-json-field-parsers/spec.md`
  - `unified-shell-routing/spec.md`
  - `workspace-state-management/spec.md`
- `openspec/changes/archive/` 5 条 2026-04-16 归档，都对应上面 5 个 spec
- `openspec/changes/` 除 `archive/` 外暂无 active change（除了本 change 自己）

但 docs 还停留在重建前叙事：

- `CLAUDE.md` `## Ground Truth`（≈line 160）："稳定能力的规范化描述将陆续落到 openspec/specs/（重建中）"
- `CLAUDE.md` `## Truth-source priority`（≈line 168）："openspec/specs/ — 稳定能力的规范化描述（正在重建，未覆盖的 capability 暂以代码为准）"
- `MEMORY.md` `Current State (2026-04-16)` 第 5-6 行："Spec home is now openspec/specs/ (重建中，空)。18 个 capability 的 audit 结果... 顺序先做屎山重构，再写 spec 固化结构；spec 不要提前写"
- `MEMORY.md` `Session History` 最后一条 2026-04-16 条目结尾："下一步：屎山重构 → 再写 openspec spec"

这些旧叙事如果不更新，下一次 `/clear` 后新 session 读 docs 会以为 specs 还是空的、以为当前阶段不该写 spec，做出和 git 实际状态相悖的判断。

## Goals / Non-Goals

**Goals:**

- 把 `CLAUDE.md` 和 `MEMORY.md` 里三处已过时的"重建中/空/先屎山再写 spec"叙述，改成反映 2026-04-16 首轮收口后的实际状态
- 明确记录流程闭环（refactor → live verify → archive change → sync canonical spec）已跑通，后续 capability 沿用这个流程
- 保留 "不要提前写 spec 去固化耦合问题" 这条原则（它还没过期 — 意思是"不要给还没重构的屎山写 spec"，不是"不要写任何 spec"）
- Docs 变更可追述：每处改动都有明确锚点（章节名 + 旧字串 + 新字串），无需再读代码

**Non-Goals:**

- 不做任何源代码改动
- 不新增/修改/删除 `openspec/specs/` 下的 canonical spec
- 不重写 CLAUDE.md 其他章节（只动 Ground Truth + Truth-source priority 两段）
- 不重组 MEMORY.md 结构（只动 Current State 顶部 + Session History 追加）
- 不更新 `project_capability_audit_2026-04-16.md` 等 memory 详细笔记文件（它们是 audit 快照，不是 live status）

## Decisions

### D1: 只更新 3 个锚点，不做整体重写

**选择**: 精确替换 `CLAUDE.md` 两段 + `MEMORY.md` 一个 "Current State" 片段 + `MEMORY.md` Session History 追加一行。

**理由**: 这是 docs hygiene change，不是重构。最小 diff、最好 review。如果重写，grep 成本高、review 风险高，而且容易顺手改掉别的无关条目。

**备选**: 顺带清理其他过时条目。否决理由：超出 scope，会让本 change 变成"大清洁"，和 proposal 里声明的 Non-Goals 冲突。

### D2: 保留"不要提前写 spec"原则，但重新措辞

**选择**: 新叙事明确区分"已重构完成的 capability 立即写 canonical spec" vs "仍是屎山的 capability 先做 refactor 再写 spec"。

**理由**: 原叙事"spec 不要提前写"被首轮实际工作证伪了一部分——我们每做一个 refactor change 都马上写了对应 spec。但原则的内核仍有效：**不要给还没重构的屎山写 spec**。措辞要精准反映这个分辨。

### D3: 用绝对日期而非相对日期

**选择**: MEMORY.md 的新条目一律写 "2026-04-16" 而不是 "today"/"本次"。

**理由**: memory 是跨 session 存活的，相对日期会失去意义。这是 memory skill 本身的既有规则。

## Risks / Trade-offs

- **[风险] 我记错了实际 spec 数量/名字** → Mitigation: tasks.md 要求验证前先 `ls openspec/specs/`，以 ls 输出为准替换文字内容。
- **[风险] user 的 MEMORY.md 路径是 user-specific（`/Users/haoshengli/.claude/projects/...`），另一台机器上不同** → Mitigation: tasks.md 用 `~/.claude/projects/-Users-haoshengli-Seafile-WebWorkSpace-Offisim/memory/MEMORY.md` 的绝对路径，并在执行前再跑一次 `ls` 验证路径存在。
- **[风险] 有第三处过时叙事被漏掉** → Mitigation: tasks.md 最后一步要求跑 `grep -n "重建中\|屎山再\|先屎山"` 兜底，如果 grep 仍命中则列出来待决。
