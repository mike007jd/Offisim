## 1. 取当前 openspec 实际状态

- [x] 1.1 跑 `ls openspec/specs/` 并把输出记下来（作为后续替换 docs 内容的 ground truth，预期 5 个目录：`avatar-seed-resolution` / `plan-step-store` / `typed-json-field-parsers` / `unified-shell-routing` / `workspace-state-management`，但以 `ls` 实际输出为准）
- [x] 1.2 跑 `ls openspec/changes/archive/` 确认 2026-04-16 归档 5 条齐全（`2026-04-16-centralize-json-field-parsers` / `2026-04-16-unify-avatar-source` / `2026-04-16-unify-office-shell-routing` / `2026-04-16-unify-office-workspace-state` / `2026-04-16-unify-sop-step-state`）
- [x] 1.3 跑 `ls ~/.claude/projects/-Users-haoshengli-Seafile-WebWorkSpace-Offisim/memory/MEMORY.md` 确认 memory 文件存在；如果路径不同，把真实路径记下来，后续步骤用真实路径

## 2. 更新 CLAUDE.md `## Ground Truth` 段

- [x] 2.1 打开 `/Users/haoshengli/Seafile/WebWorkSpace/Offisim/CLAUDE.md`，定位 `## Ground Truth` 章节
- [x] 2.2 把行 `- 稳定能力的规范化描述将陆续落到 \`openspec/specs/\`（重建中）` 替换为 `- 稳定能力的规范化描述落在 \`openspec/specs/\`；2026-04-16 首轮重建已落 5 个 canonical spec（avatar-seed-resolution / plan-step-store / typed-json-field-parsers / unified-shell-routing / workspace-state-management）。未覆盖的 capability 继续按 refactor-first-then-spec 流程补（先把代码从屎山状态重构出来，再把稳定结构落成 spec）。`

## 3. 更新 CLAUDE.md `## Truth-source priority` 段

- [x] 3.1 在同一个 `CLAUDE.md` 定位 `## Truth-source priority (AI 接手必读)` 章节
- [x] 3.2 把 `3. **\`openspec/specs/\`** — 稳定能力的规范化描述（正在重建，未覆盖的 capability 暂以代码为准）` 替换为 `3. **\`openspec/specs/\`** — 稳定能力的规范化描述；首轮重建 2026-04-16 已落 5 个 canonical spec。未覆盖的 capability 继续按 refactor-first-then-spec 节奏补，期间仍以代码为准`

## 4. 更新 MEMORY.md Current State 区块

- [x] 4.1 打开 `~/.claude/projects/-Users-haoshengli-Seafile-WebWorkSpace-Offisim/memory/MEMORY.md`（如 Task 1.3 拿到其他路径，以实际路径为准）
- [x] 4.2 定位 `## Current State (2026-04-16)` 下那条以 `**Spec home is now \`openspec/specs/\`**` 开头的条目
- [x] 4.3 把整条（到 ` ceremony 与 seat-registry 坐标耦合）。` 结束）整体替换为：`- **Spec home is \`openspec/specs/\`**，2026-04-16 首轮重建已落 5 个 canonical spec（avatar-seed-resolution / plan-step-store / typed-json-field-parsers / unified-shell-routing / workspace-state-management）。18 个 capability 的 audit 结果仍在 [project_capability_audit_2026-04-16.md](project_capability_audit_2026-04-16.md)。流程闭环已跑通：refactor → live verify → archive change → sync canonical spec。剩余 capability 继续按这个流程补，**但不要给还没重构出屎山状态的代码提前写 spec**（会固化既有耦合问题：SOP 三处状态源 / 3D vs 2D 头像 / Office shell 双路径 / prefab JSON 字段 / ceremony 与 seat-registry 坐标耦合等这些具体耦合，其中 SOP 状态源 / 2D-3D avatar seed / Office shell 已经在本轮闭环里解掉，其余仍是候选）。`

## 5. 在 MEMORY.md Session History 追加 2026-04-16 第二条

- [x] 5.1 在 `## Session History (condensed — detail in git log)` 末尾追加一行：`- 2026-04-16 (late) — openspec 重建首轮闭环。5 个 canonical spec 落 \`openspec/specs/\`（refactor commit：\`3aeb53f\` / \`4c0e831\` / \`9cd4f71\` / \`b69770d\` / \`538bee0\`；openspec sync commit：\`48ca5d2\`）。Live Playwright 验证时顺手修了一个 provider-chain runtime bug（commit \`ca7499c\`：PlanStepStoreProvider 在 CompanyBridge 外层导致 cold load 白屏）。流程定型：每个 refactor change 跑完 refactor + live verify 后立即 sync 对应 canonical spec，不要再攒成批次。`

## 6. Grep 兜底 + 验证

- [x] 6.1 跑 `grep -nE '重建中|屎山再|先屎山' CLAUDE.md` — 应该零命中
- [x] 6.2 跑 `grep -nE '重建中|屎山再|先屎山|openspec/specs/.*空' ~/.claude/projects/-Users-haoshengli-Seafile-WebWorkSpace-Offisim/memory/MEMORY.md` — 应该零命中（以步骤 1.3 拿到的真实路径为准）
- [x] 6.3 如果 6.1 / 6.2 仍有命中：把剩余命中行列出来，逐条判断是"该清"还是"无关上下文"；"该清"的追加改动回 Task 2/3/4；"无关"的在此任务里备注原因并通过
- [x] 6.4 跑 `openspec validate align-docs-with-openspec-rebuild` 确认 change 语法合法
- [x] 6.5 （可选）跑 `git diff CLAUDE.md` 目视 review 改动只落在 Ground Truth / Truth-source priority 两段，没意外动到其他章节
