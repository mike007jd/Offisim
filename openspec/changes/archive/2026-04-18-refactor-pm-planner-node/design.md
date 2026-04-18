## Context

`pmPlannerNode` 是 LangGraph 主图里 boss → pm_planner → step_dispatcher 的中间 agent，职责是把 user intent 翻译成 TaskPlan。与 `employeeNode`（已 refactor）一样，当前是"一个 async function 从头做到尾"的形态。

参考模板：
- `employee-node-boundaries` canonical spec：barrel 137 NBNC + 9 单责 sibling（constants / preflight / prompt-assembly / tool-kit / turn-runner / tool-round / completion / error-finalize / handoff）
- pm-planner 比 employee-node 简单（无 tool loop，无 handoff），所以 sibling 数 ≤ employee-node 的 9 个

## Goals / Non-Goals

**Goals:**

- `pm-planner-node.ts` ≤ 150 NBNC barrel
- 6 个 sibling module 各 ≤ 200 NBNC
- LLM plan 和 SOP plan 两条路径 byte-identical
- plan.created event payload byte-identical

**Non-Goals:**

- 不改 PM_SYSTEM_PROMPT 文案（JSON schema 保持兼容）
- 不改 SOP matching 算法（`matchSopTemplate` / `sopBatchesToLlmPlan` 搬家不改逻辑）
- 不改 plan persistence 表结构
- 不引入测试

## Decisions

### D1. 目录定位：`agents/pm-planner/`

**选择**：`packages/core/src/agents/pm-planner/` 子目录。

**理由**：对齐 `employeeNode` 重构后的 `agents/employee/` 聚合（如果有）或平摊；`agents/` 目录下每个大 node 有自己子目录。

### D2. Sibling 数 6 而非 9

**选择**：拆 6 个 sibling（preflight / prompt-assembly / plan-parser / sop-matching / plan-persistence / plan-review-gate）。

**理由**：

- 无 tool loop，不需要 `turn-runner` / `tool-round` / `tool-kit`
- 无 recovery finalize 路径，`completion` / `error-finalize` 不独立
- SOP matching 作为"另一条生成路径"独立成 module（LLM plan 和 SOP plan 两选一，清晰的分支）
- `plan-review-gate` 处理 `PLAN_REVIEW_REQUIRED` interaction trigger 的 ask-resolve loop，独立便于未来扩展

### D3. Barrel 顺序写 pipeline

**选择**：

```ts
export async function pmPlannerNode(state: OffisimGraphState, config: RunnableConfig): Promise<...> {
  const prep = preflight(state, config);
  if (prep.kind === 'short-circuit') return prep.result;

  const sopPlan = await tryBuildSopPlan(prep.intent, prep.roster, prep.sopTemplates);
  const plan = sopPlan ?? await generateLlmPlan(prep);  // generateLlmPlan 在 prompt-assembly + plan-parser 合作
  if (!plan) return failWithNoPlan(state);

  const reviewed = await awaitPlanReview(plan, state, config);
  const persisted = persistPlan(reviewed, state);
  return { plan: persisted, ...nextGraphState };
}
```

**理由**：barrel 读起来就是 pipeline 文档，每一步 delegate 到 sibling。

### D4. plan-parser 单独成 module

**选择**：`plan-parser.ts` 托管 `LlmPlanStep` interface + `parsePmPlan(content): LlmPlan | null` + JSON schema fallback。

**理由**：plan 解析是纯函数，易测；未来如果换 LLM output format 只改这个文件。

### D5. SOP matching 保留作为 "alternative generator"

**选择**：`sop-matching.ts` 导出 `tryBuildSopPlan(intent, roster, templates): LlmPlan | null`——匹配到返回 plan，否则 null。barrel 优先尝试 SOP，fallback LLM。

**理由**：当前代码已经是这个行为（`tryBuildSopPlan` 返回 null 时才调 LLM），拆出来模式清晰。

### D6. plan-review-gate 是 async loop

**选择**：`plan-review-gate.ts` 导出 `awaitPlanReview(plan, state, config)`：检查 `state.mode === 'plan-review'` 则 emit `PLAN_REVIEW_REQUIRED` interaction 并等待 resolution（通过 `InteractionCoordinator`，继续运行后 plan 可能被修改或接受）。

**理由**：interaction gate 是有副作用的 async 流程，独立 module 便于未来扩展 plan edit / reject。

## Risks / Trade-offs

- **风险：SOP matching 的 state 依赖**→ `matchSopTemplate` 当前读 `state.memories.sopTemplates`，拆分后仍走 state，不引入 module-level cache。
- **风险：LLM plan parsing 失败分支**→ `parsePmPlan` 返回 null 时 barrel 直接走 `failWithNoPlan`，错误 event 一致。
- **风险：plan review interaction 打断后恢复**→ `awaitPlanReview` 通过 LangGraph 的 interrupt 语义实现（`getConfigSignal(config)`），拆分前后语义一致。
- **风险：live verify 路径**→ SOP plan 和 LLM plan 两条路径都要覆盖；SOP 路径需要预置 SOP template。
- **Trade-off：7 文件替代 1 文件**→ 接受，和 employee-node 的 10 文件对齐。
