# PR 草稿 — Verified Missions 审计整改 A+B

> 本文件是即将提交的 A+B 整改 PR 的描述草稿。代码落地后用作 PR body（开 PR 时复制即可）。

**分支建议**：`fix/verified-missions-audit-ab`（不直推 main）
**标题**：`fix(missions): close deterministic-layer correctness bugs + lock marketplace command boundary (audit remediation A+B)`

---

## 背景

ChatGPT 审计拒签「全 M0–M7 实现层完成」。逐条核实后确认审计总体属实。本 PR 处理**现在就能修、harness/门禁可测、不需 live `.app`** 的部分：确定性层正确性 bug（A）+ marketplace 安全边界与门禁口径（B）。live 产品接线（runMission 入口/budget/M3 Start/M4 钩子/M5 Rust 白名单等）不在本 PR，见路线图 Tier C。

## 改动

### A — 确定性层正确性 bug
- **A1 零 required criterion 不再空 PASS 完成**：`MissionService.completeMission` 拒绝零 required（§18.1 至少一个 gate）；`createMission` fail-fast；`MissionLoopController` 进循环前拦空集（不靠 `[].every()`）。
- **A2 git_diff_policy 能力失败不再假 PASS**：`EvaluationContext.gitChangedPaths` 契约 `string[] → string[] | null`；git 不可用/非 git/无 project → `null` → evaluator `ERROR`（loop 当 infra→blocked，不消 repair）；真干净 `[]` → PASS。porcelain 只覆盖未提交变更的已知边界已在注释 + harness 断言固化（committed-baseline 归 Tier C）。
- **A3 attempt 正常收尾**：`MissionService` 在 complete/fail/block/repair 转移里原子收尾 current attempt（status + finished_at），不再永远 running。（`root_run_id`/`runtime_session_link_id` 写入归 Tier C live runner。）
- **A4 状态写 CAS 守卫**：`updateStatus` 加 `expectedStatus` WHERE + 受影响行数判定；并发 cancel 不再被后写的 verifying 覆盖。三后端（drizzle/memory/tauri）同步。

### B — marketplace 边界 + 门禁 + claim
- **B1 marketplace 命令安全边界锁定**：`validatePlaybook` 加 `{ trustedSource }`（默认 false）。不受信源仅允许 retry-safety=`safe` 评估器；`command_exit_zero`/`llm_rubric_review` → `untrusted_evaluator` 拒绝。§25.2「零任意代码」对 marketplace 现在成立、可签；本地/第一方 command 用法不受影响。
- **B2 修 2 个 UI-hygiene 红**：`company-template-service.ts` stale "wired" 文案；`office.css` 未定义 `--off-fs-1` token。
- **B3** 完成度判定改跑全门禁 `node scripts/release-gates.mjs`。
- **B4** 路线图 + memory 把「全 M0-M7 完成 / release gates 全绿」如实降级。

## 不在本 PR（Tier C，需 live）
runMission 产品入口、budget+usage 接线、attempt id 写入、M3 Start、M4 启动重对账钩子、M5 `git.rs` worktree/merge 白名单、pause/resume 建 attempt、git_diff_policy committed-baseline、多写真事务、M6 publish/install、M1 生产 driver。

## 测试
- 每条 A/B red-then-green + inject-proof（删守卫→用例转红）。
- `pnpm validate` EXIT 0（含 9 个 mission harness）。
- 全门禁 `node scripts/release-gates.mjs`（node + rust）5 道全绿，含 B2 后的 ui-hygiene。
- `detect_changes(compare main)` 确认改动只触达预期 symbol/flow。

## 风险 / blast radius
- A2 改 `gitChangedPaths` 返回类型：唯一消费者 `git_diff_policy` + 生产 impl + 3 个 harness fake，已同步。
- A4 改 `updateStatus` 签名：三后端 repo + patch 类型同步；CAS 0 行变更抛 `MissionStateError`，调用方已有处理。
- 无 schema/迁移变更；无 live 路径行为变更（runMission 未接线，A1/A3/A4 仅在 harness + 未来 live runner 生效）。

🤖 Generated with [Claude Code](https://claude.com/claude-code)
