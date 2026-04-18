## 1. Scaffolding

- [x] 1.1 创建 `packages/core/src/agents/pm-planner/` + 6 空 sibling
- [x] 1.2 基线：`wc -l pm-planner-node.ts`（689）+ public export 清单 + `pm_planner` event trace 基线

## 2. 抽 preflight

- [x] 2.1 `preflight.ts`：读 graph state / 枚举 roster / 提 intent / 边界校验，返回 ready 或 short-circuit
- [x] 2.2 barrel 先调 preflight，short-circuit 直接返回

## 3. 抽 prompt-assembly

- [x] 3.1 `prompt-assembly.ts`：`PM_SYSTEM_PROMPT` 常量 + user prompt 构造（intent + roster summary + SOP templates hint）
- [x] 3.2 全仓 `PM_SYSTEM_PROMPT` grep 只在此文件

## 4. 抽 plan-parser

- [x] 4.1 `plan-parser.ts`：`LlmPlanStep` + `parsePmPlan(content)` + JSON fallback

## 5. 抽 sop-matching

- [x] 5.1 `sop-matching.ts`：`matchSopTemplate` + `findEmployeeForRole` + `sopBatchesToLlmPlan` + `tryBuildSopPlan`

## 6. 抽 plan-persistence

- [x] 6.1 `plan-persistence.ts`：构建 TaskPlan / PlanStep / PlanTask + 写 repo + emit `planCreated`

## 7. 抽 plan-review-gate

- [x] 7.1 `plan-review-gate.ts`：`awaitPlanReview(plan, state, config)` 检查 `plan-review` mode + 发 `PLAN_REVIEW_REQUIRED` + 等 resolution

## 8. Barrel 压到 ≤ 150 NBNC

- [x] 8.1 `pm-planner-node.ts` 改成：import siblings → pipeline sequence → re-export public helpers
- [x] 8.2 删除内联 LLM call / prompt 构造 / SOP 匹配 / parse / persistence / interaction gate
- [x] 8.3 gate 达成：`grep -cvE '^\\s*(//|$|/\\*|\\*)' pm-planner-node.ts` ≤ 150

## 9. Verification: typecheck + build

- [x] 9.1 shared-types → ui-core → core → ui-office → web 串行 build 绿
- [x] 9.2 `pnpm typecheck` 绿

## 10. Verification: spec gates

- [x] 10.1 `ls agents/pm-planner/*.ts` 正好 6 文件
- [x] 10.2 cross-sibling import 零匹配
- [x] 10.3 public export 清单与基线一致

## 11. Live runtime verification

- [x] 11.1 跑"多步规划型"prompt（"build a snake game ..."）走 LLM plan 路径，观察 plan.created payload 与 baseline 对齐
- [x] 11.2 无匹配 SOP → `tryBuildSopPlan` 返回 null，fallthrough 到 LLM（sop-matching sibling 路径活化）；需已配 SOP template 的完整 live 观察留给 backlog
- [ ] 11.3 （可选）开 plan-review mode 跑，验证 PLAN_REVIEW_REQUIRED interaction 正常 resolve — 本次 live run 未独立触发（onboarding prompt 被并入 snake-game 执行线程，没进新一轮 pm_planner）；gate 代码路径静态可达
- [x] 11.4 观察记录到 `verify-notes.md`

## 12. 最终 gate

- [x] 12.1 `openspec validate refactor-pm-planner-node --strict` 绿
- [x] 12.2 通知用户等 `/opsx:archive`
