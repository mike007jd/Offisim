## Why

`packages/core/src/agents/pm-planner-node.ts` 689 行单 function `pmPlannerNode` 承担：employee roster 枚举 + SOP template 匹配 + LLM plan prompt 编排 + plan review interaction gate + plan persistence + TaskPlan 事件发射。和 `employee-node.ts` 重构前的 980 行巨型 function 同构——都是 agent node 里的 "多 stage pipeline 揉在一个 function"。Round 1 `refactor-employee-node` 已经把 employee-node 980→137 NBNC barrel + 9 sibling，效果验证过；本 change 沿用同模式收 pm-planner。

## What Changes

- **Thin barrel**: `pm-planner-node.ts` 压到 ≤ 150 NBNC barrel，只做 stage 顺序编排（preflight → prompt-assembly → LLM call → parse-plan → sop-match → plan-persistence → plan-review）。
- **6 个 sibling module** (`packages/core/src/agents/pm-planner/` 子目录)：
  - `preflight.ts` — graph-state 读取 + employee roster 枚举 + `buildEnrichedEmployeeList` 组装 + user intent 提取 + 边界校验（empty roster / no user message → fail fast）
  - `prompt-assembly.ts` — `PM_SYSTEM_PROMPT` 常量 + user prompt 构造（intent + roster summary + SOP templates hint）
  - `plan-parser.ts` — `parsePmPlan(content)` + `LlmPlanStep` interface + JSON schema / fallback
  - `sop-matching.ts` — `matchSopTemplate` + `findEmployeeForRole` + `sopBatchesToLlmPlan` + `tryBuildSopPlan`
  - `plan-persistence.ts` — 构建 `TaskPlan` + `PlanStep[]` + `PlanTask[]` 写入 repo + emit `planCreated` event
  - `plan-review-gate.ts` — `PLAN_REVIEW_REQUIRED` interaction trigger + 等待 resolution + state continue
- **保留**：`PM_SYSTEM_PROMPT` / `LlmPlanStep` / `parsePmPlan` / `matchSopTemplate` / `findEmployeeForRole` / `sopBatchesToLlmPlan` / `tryBuildSopPlan` 现有 export 全部保留（通过 barrel re-export），消费者无改动。
- **可观测行为不变**：plan 生成路径（LLM plan vs SOP plan）、plan persistence 事件、plan review interaction、失败回退序列全部 byte-identical。

## Capabilities

### New Capabilities

- `pm-planner-node-boundaries`

### Modified Capabilities

（无）

## Impact

- **目录新增**：`packages/core/src/agents/pm-planner/{preflight,prompt-assembly,plan-parser,sop-matching,plan-persistence,plan-review-gate}.ts`
- **文件重写**：`pm-planner-node.ts` 689 → ≤ 150 NBNC barrel
- **消费者无改动**：`main-graph.ts` 里 `pmPlannerNode` import 路径不变；`index.ts` re-export 其他 helper 也不变
- **验证**：live runtime 跑一轮 "make a plan for X" 任务，观察 plan.created event payload、plan review interaction（若触发）、task 分发时序与重构前 byte-identical；覆盖 LLM plan 和 SOP plan 两条路径
- **无依赖升级 / 无 API 断裂 / 无 DB migration**
