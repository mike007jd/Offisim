## Why

OpenSpec 已经完成了一轮重建：2026-04-16 这天把 `centralize-json-field-parsers`、`unify-avatar-source`、`unify-sop-step-state`、`unify-office-shell-routing`、`unify-office-workspace-state` 五个 change 归档并把对应的 canonical spec 落到 `openspec/specs/`。但 `CLAUDE.md` 与 `~/.claude/projects/.../memory/MEMORY.md` 里仍写着 "openspec/specs/ 重建中 / 空"、"顺序先做屎山重构，再写 spec 固化结构"之类的旧叙事。下次 `/clear` 后新 session 读这些 docs 会被误导——以为 specs 还是空的，或以为现阶段不应该写 spec。

## What Changes

- 更新 `CLAUDE.md` 中 `## Ground Truth` 与 `## Truth-source priority` 两段，把 "openspec/specs/（重建中）" 改成反映当前 5 个 canonical spec 已落的事实，并标注后续 capability 按 refactor-first-then-spec 流程继续补
- 更新 `MEMORY.md` 里 `Current State (2026-04-16)` 区块（主要是 line 5-7 那块）：`openspec/specs/` 已不再是"空"，记录当前 5 个 canonical spec 名字 + 流程是"屎山重构 → 写 spec"已跑通一轮
- 更新 `MEMORY.md` `Session History` 追加一条 2026-04-16 记录，说明这轮 openspec 重建首轮收口
- **No code change**, **no spec change**（只是 docs / memory 同步）

## Capabilities

### New Capabilities
- `openspec-docs-alignment`: docs（`CLAUDE.md` 与 `MEMORY.md`）中关于 `openspec/` 状态的叙述必须与 `openspec/` 实际内容一致，包含 grep-checkable 的负面样例（"重建中" / "先屎山再写 spec" 等不再存在）

### Modified Capabilities
(无 — 不改任何已有的 canonical spec requirements)

## Impact

- `CLAUDE.md` — 2 段更新（Ground Truth / Truth-source priority）
- `~/.claude/projects/-Users-haoshengli-Seafile-WebWorkSpace-Offisim/memory/MEMORY.md` — Current State 区块 + Session History 追加
- 无源代码改动，无 openspec spec 改动，无 build / typecheck 影响
