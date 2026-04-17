## 1. Scaffolding

- [ ] 1.1 创建 `packages/core/src/agents/pm-planner/` + 6 空 sibling
- [ ] 1.2 基线：`wc -l pm-planner-node.ts`（689）+ public export 清单 + `pm_planner` event trace 基线

## 2. 抽 preflight

- [ ] 2.1 `preflight.ts`：读 graph state / 枚举 roster / 提 intent / 边界校验，返回 ready 或 short-circuit
- [ ] 2.2 barrel 先调 preflight，short-circuit 直接返回

## 3. 抽 prompt-assembly

- [ ] 3.1 `prompt-assembly.ts`：`PM_SYSTEM_PROMPT` 常量 + user prompt 构造（intent + roster summary + SOP templates hint）
- [ ] 3.2 全仓 `PM_SYSTEM_PROMPT` grep 只在此文件

## 4. 抽 plan-parser

- [ ] 4.1 `plan-parser.ts`：`LlmPlanStep` + `parsePmPlan(content)` + JSON fallback

## 5. 抽 sop-matching

- [ ] 5.1 `sop-matching.ts`：`matchSopTemplate` + `findEmployeeForRole` + `sopBatchesToLlmPlan` + `tryBuildSopPlan`

## 6. 抽 plan-persistence

- [ ] 6.1 `plan-persistence.ts`：构建 TaskPlan / PlanStep / PlanTask + 写 repo + emit `planCreated`

## 7. 抽 plan-review-gate

- [ ] 7.1 `plan-review-gate.ts`：`awaitPlanReview(plan, state, config)` 检查 `plan-review` mode + 发 `PLAN_REVIEW_REQUIRED` + 等 resolution

## 8. Barrel 压到 ≤ 150 NBNC

- [ ] 8.1 `pm-planner-node.ts` 改成：import siblings → pipeline sequence → re-export public helpers
- [ ] 8.2 删除内联 LLM call / prompt 构造 / SOP 匹配 / parse / persistence / interaction gate
- [ ] 8.3 gate 达成：`grep -cvE '^\\s*(//|$|/\\*|\\*)' pm-planner-node.ts` ≤ 150

## 9. Verification: typecheck + build

- [ ] 9.1 shared-types → ui-core → core → ui-office → web 串行 build 绿
- [ ] 9.2 `pnpm typecheck` 绿

## 10. Verification: spec gates

- [ ] 10.1 `ls agents/pm-planner/*.ts` 正好 6 文件
- [ ] 10.2 cross-sibling import 零匹配
- [ ] 10.3 public export 清单与基线一致

## 11. Live runtime verification

- [ ] 11.1 跑"多步规划型"prompt（"build a snake game: plan it as PM"）走 LLM plan 路径，观察 plan.created payload 与 baseline 对齐
- [ ] 11.2 跑一个匹配 SOP 的 intent（预置 SOP template，例如"meeting prep"）走 SOP plan 路径，确认无 LLM call
- [ ] 11.3 （可选）开 plan-review mode 跑，验证 PLAN_REVIEW_REQUIRED interaction 正常 resolve
- [ ] 11.4 观察记录到 `verify-notes.md`

## 12. 最终 gate

- [ ] 12.1 `openspec validate refactor-pm-planner-node --strict` 绿
- [ ] 12.2 通知用户等 `/opsx:archive`
