# Verified Missions — 整改路线图（post-audit）

> 状态：**TIER A+B 已落地（确定性层正确性 + marketplace 边界已修，全 release-gates 绿）/ TIER C（live 产品接线）PENDING**
> 日期：2026-06-26 ｜ 基线：`main@48fc545b`
> 来源：ChatGPT 对「全 M0–M7 实现层完成」的审计 + 本仓逐条核实（亲读关键文件 + 9 个独立只读 verifier 并行复核 + GitNexus 调用图佐证）

本文件取代「🏁 Verified Missions PRD v1.0 全 M0–M7 实现层完成」的口径。审计**总体属实**：核心架构与确定性 harness 切片已落地，但**产品接线、持久化一致性、marketplace 安全边界仍有阻断项**，当前不能签「完成」。

---

## 0. 整改进展（A+B 已落地，2026-06-26）

> 分支 `fix/verified-missions-audit-ab`，2 个 commit：`2e9de0a8`（A 确定性层）+ `1129ab8d`（B marketplace 边界 + hygiene + §18.1 一致性）。

- **Tier A 全修**：A1 零-required fail-fast（createMission/completeMission/loop 三处守卫，不靠 `[].every()`）｜A2 `gitChangedPaths: string[]→string[]|null`，能力失败→`null`→git_diff_policy verdict `ERROR`（loop 当 infra→blocked 不消 repair）｜A3 attempt 在 complete/fail/block/cancel/repair 原子收尾（终态 + finished_at）｜A4 `updateStatus` CAS（`expectedStatus?`+返回 boolean，三后端一致：drizzle `changes>0`/memory 显式/tauri read-before-update），闭合并发 cancel-vs-verifying lost-update。
- **Tier B 全修**：B1 `validatePlaybook` 加 `trustedSource?`（默认 false），不受信源仅许 retry-safety=`safe` 评估器，`command_exit_zero`/`llm_rubric_review`→`untrusted_evaluator`（复用 `EVALUATOR_RETRY_SAFETY` 单源）｜§18.1 validator 前置拒绝零-required playbook（`no_required_criterion`，镜像 materialize.ts 默认）闭合 validator/runtime 不一致｜B2 两个 UI-hygiene 红（`wired`→`configured`、`--off-fs-1`→`--off-fs-meta`）。
- **门禁**：每条 A/B red-then-green + inject-proof（删守卫即转红）；独立对抗 reviewer 复核（抓出 Tauri CAS 后端语义分叉 + tautological inject-proof + §18.1 缺口，全修）；**全 `node scripts/release-gates.mjs` 5 道绿**（validate 含 9 mission harness + ui-hygiene + security:harness + supply-chain audit + cargo 125/0）。无 schema/迁移变更，无 live 路径行为变更（runMission 未接线，A1/A3/A4 仅在 harness + 未来 live runner 生效）。
- **仍 PENDING = Tier C**（见 §3，需真 `.app` + 真模型逐项 live 验证）：M2 runMission 产品入口 / budget 接线 / attempt id 写入 / M3 Start+审批 UI / M4 启动重对账钩子 / M5 `git.rs` worktree+merge 白名单 / pause-resume 建 attempt / A2-b committed-baseline / 多写真事务 / M6 publish+install / M1 生产 driver。

---

## 1. 诚实的里程碑状态（修正版）

| 里程碑 | 真实状态 |
|---|---|
| M0 Truth Closure | 代码落地（真实用户 DB/.app 证据需 live 复验） |
| M1 Runtime Driver | **契约完成 / 生产未接**：SPI 在 `shared-types/runtime/driver.ts`，但无生产 `AgentRuntimeDriver` 实现，live 路径仍走 `agent_runtime_*`/`pi_agent_*`，与 SPI 平行 |
| M2 Mission Core | **不通过**：runMission 无产品入口；零 required → 空 PASS 完成；budget 不接线；attempt 不收尾 |
| M3 Mission UX | **部分**：Composer + 只读 Control 存在；**无可执行 Start**、无审批、无完整状态总线 |
| M4 Durable Recovery | **不通过**：算法/harness 有；启动钩子、session writer、真实 resume 均无 |
| M5 Worktree Isolation | **不通过**：纯逻辑/harness 有；live adapter 必被 `git.rs` 白名单拒（缺 worktree/merge） |
| M6 Playbook Marketplace | **不通过 + P0 边界缺**：validator/materialize-plan 有；publish/install 无；command 安全边界不足 |
| M7 Second Runtime | Spike/ADR 完成（与 NO-GO 一致，无第二 runtime 实现） |

可签字的交付描述：
> **Verified Missions v1.0 核心架构 + 确定性 harness 切片已落地；产品接线尚未完成；存在 release-blocking 的确定性正确性 bug 与 marketplace 安全边界缺口。**

---

## 2. 核实结论（判定，非照抄审计）

| # | 发现 | 判定 | 分类 | 处置 |
|---|---|---|---|---|
| P0 | Marketplace「零任意代码」不成立：validator 放行 `config.command`，evaluator `bash_execute(approvalId:null)`，Rust deny-only 不拦 `git push`/`curl POST` | 属实但潜伏 | 边界缺（publish/install 未接线，不可利用） | **B：现在锁边界** |
| P1 | M2/M4/M5/M6 无产品入口（runMission/reconcile/runtimeSessionLinks/worktree/materialize 只 impl+harness） | 属实 | M-pass（代码自注释） | 如实降级 claim（→ C） |
| P1 | 零 required criterion → 空 PASS 完成（`[].every()===true`） | 属实 | **确定性层真 bug** | **A：修** |
| P1 | `git_diff_policy` 能力失败假 PASS（git 不可用/非 git/无 project 返回 `[]`→PASS） | 属实(a) | **确定性层真 bug** | **A：修(a)**；(b) committed-baseline → C |
| P1 | attempt 永远 running（不收尾，root_run_id/session_link 恒 null） | 属实 | **确定性层真 bug**（状态收尾） | **A：修收尾**；id 写入 → C |
| P1 | 状态写无事务/CAS（并发 cancel 被 verifying 覆盖） | 属实 | **确定性层真 bug** | **A：加 CAS 守卫** |
| P1 | budget_json 生产 runner 不接线（usage 不上报） | 属实 | M-pass（loop 机制本身对的） | → C |
| P2 | pause/resume 违反自身不变量（resume→running 不建 attempt） | 属实但潜伏 | 延后（loop 未接线才不触发） | → C |
| 门禁 | `validate` ≠ release gates；2 个 UI-hygiene 红；M1 无生产 driver；M3 只读 | 属实 | claim 夸大 | **B：修红 + 全门禁 + 改 claim** |

> 审计两处小过度：① Rust classifier 对灾难模式与 TS 同步，但 deny-only、放行 `git push`/宽 `rm`/`curl POST`（注释自承「left to the TS layer to ask」）——P0 残余风险真实。② M-pass 延后项在代码里是公开标注的延后，不是隐藏 bug，但完成度确实没到。

---

## 3. 路线图

### Tier A — 确定性层真 bug（本轮，纯逻辑/harness 可测/不需 live）
- **A1** 零 required 空 PASS：`completeMission` 加 `requiredCount===0` 守卫 + `createMission` fail-fast + loop 进循环前拦空集。
- **A2** git_diff_policy 假 PASS：`gitChangedPaths` 契约 `string[] → string[] | null`，能力失败 → evaluator ERROR（非 PASS）。
- **A3** attempt 收尾：service 在终态/repair 转移里原子收尾 current attempt（status + finished_at）。
- **A4** 状态写 CAS：`updateStatus` 加 `expectedStatus` WHERE 守卫 + 受影响行数判定，闭合 lost-update 竞态。

### Tier B — marketplace 边界 + 门禁口径 + claim（本轮）
- **B1** marketplace 命令边界：`validatePlaybook` 加 `{ trustedSource }`，不受信源只许 retry-safety=`safe` 评估器；`command_exit_zero`/`llm_rubric_review` → `untrusted_evaluator` 拒绝。§25.2 对 marketplace **现在可签**。
- **B2** 修 2 个真 UI-hygiene 红（`company-template-service.ts:459` 文案、`office.css:1978` 未定义 `--off-fs-1`）。
- **B3** 完成度改跑全门禁 `node scripts/release-gates.mjs`（validate + ui-hygiene + security:harness + audit + cargo）。
- **B4** claim 与 memory 如实降级。

### Tier C — live 产品接线 epic（后续，需真 `.app` + 真模型，逐项 live 验证）
> 做完才谈得上「Mission 真正能在产品里跑起来」。这是从「确定性层正确」到「GA 可用」的路径。

- [ ] **M2** runMission 产品入口（Composer/Control 接 `createMissionRunController`，真 Start）
- [ ] **M2** budget 接线 + agent usage 上报（喂 `mission.budget_json` 进 loop，填 `execution.usage`）
- [ ] **M2/M3** attempt `root_run_id` / `runtime_session_link_id` 写入（live runner 关联）
- [ ] **M3** Mission Control 可执行 Start + 审批 UI（`recordedApproval` 真数据）+ 完整状态总线
- [ ] **M4** 启动重对账钩子（host 启动调 `reconcileInterruptedMissions`）+ session/safe-boundary writer
- [ ] **M5** `git.rs` `ALLOWED_SUBCOMMANDS` 加 `worktree`/`merge`（Rust 安全改，path-jail 内 write-capable 子命令）
- [ ] **M2** pause/resume：resume→running 建新 attempt（修 running 必须有 active attempt 不变量）
- [ ] **A2-b** git_diff_policy committed-baseline（attempt 起点记 HEAD，`git diff baseline..HEAD` 覆盖已提交变更）
- [ ] **加固** 多写真事务原子化（createMission/recordEvaluation 跨 Tauri `sql:` 事务）
- [ ] **M6** publish/install 接线（template 进 `INSTALLABLE_KINDS`，materialize 接 install-core）——必须先经 B1 边界
- [ ] **M1** 生产 `AgentRuntimeDriver` 实现（live 路径真走 SPI，而非平行）

---

## 4. 门禁政策（纠偏）
- `pnpm validate`（含 9 个 mission harness）**不是**全 release gates。
- 全 release gates = `node scripts/release-gates.mjs`：validate + ui-hygiene + security:harness + supply-chain audit + cargo test（node + rust 双 lane，CI 跑全套）。
- 「release gates 全绿」只有跑过上面全套并全绿才能宣称。
