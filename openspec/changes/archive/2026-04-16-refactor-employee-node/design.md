## Context

`packages/core/src/agents/employee-node.ts` 是 LangGraph `employee` 节点入口，被 `main-graph.ts:370` 直接调用。文件 1126 行 / 980 非空非注释行，`employeeNode` 单个 async 函数 954 行（line 172 → 1126），把 8 种互相独立的职责串在一个 try / catch 里：

```
employeeNode(state, config):
  ├─ [1] preflight: runtimeCtx unpack / pop assignment / load employee+company / emit entry events / subtask progress
  ├─ [2] prompt assembly: buildEmployeePrompt + skill catalog + memories + library citations + scratchpad
  ├─ [3] tool assembly: memory virtual tools + skill activation tool + handoff_to tool + workstation MCP tools
  ├─ [4] runEmployeeTurn closure: stream vs non-stream LLM call
  ├─ [5a] try: initial LLM call
  │   └─ while toolCalls.length > 0 && round < MAX_TOOL_ROUNDS:
  │       ├─ [6] handoff_to detection → Command early return
  │       ├─ [7a] parallel tool execution (memory / skill / workstation-guarded MCP)
  │       ├─ conversation history append + trim
  │       └─ follow-up LLM call
  │   └─ [8a] completion success: materialize deliverable / update task run / 4 emits / reflectAndRemember / citations / appendAgentEvent / hook.emit task.completed / scratchpad / deliverable event / return state update
  └─ [5b] catch:
      ├─ attemptLocalRecovery
      ├─ [8b] if recovered: ...重复 [8a] 的 ~130 行完成路径... (行 919-1016 与 727-860 结构级复制)
      └─ [9] if not recovered: emit failed events / update task run failed / structured error JSON / appendAgentEvent / return interrupt
```

该文件符合仓库 CLAUDE.md 里 `## Repository Hygiene -> 警惕屎山热点` 的全部判定条件：超长文件、god-function、完成副作用跨分支重复、工具组装/提示组装被迫寄生在外层 closure 之内。

D1 / D2 已验证"openspec propose → apply → live verify → archive → sync canonical spec"流程可跑通。D3 把该流程下沉到 core runtime 层，延续 `scene-orchestrator-boundaries` / `web-app-shell-boundaries` 的契约化拆分思路。

**Stakeholders / constraints**:
- `main-graph.ts` 的 `employee` 节点路由完全依赖 `employeeNode(state, config)` 调用契约；签名与返回类型（`Partial<OffisimGraphState> | Command`）必须不变
- `packages/core/src/index.ts:332` re-export `employeeNode` / `extractUsedCitations`；Public API 零破坏
- EventBus 事件是 UI 层 chat / Tasks / Activity Log / ResumeBar 的真相源；事件顺序任何变化都会被 live 验证逮到
- 结构化错误 JSON 被 `error-handler-node` 解析；schema 字段不可删改
- 本项目已删所有自动测试；验证走 live agent + 静态 diff。

## Goals / Non-Goals

**Goals**:

1. `employee-node.ts` 降到 ≤200 非空非注释行 barrel，只做 orchestration + re-export
2. 8 种职责拆到 6 个单责模块，每个模块对外只 export 自己那块逻辑需要的符号；模块之间只通过函数参数 / 返回值沟通，不共享可变 module-scope 状态
3. happy path 完成副作用和 recovery 完成副作用合并为同一个 `finalizeEmployeeSuccess()` helper，recovered 分支调一次、normal 分支调一次，消除行号 727-860 vs 919-1016 ~130 行结构性重复
4. `employeeNode` / `extractUsedCitations` 签名与行为 byte-identical；`main-graph.ts` / `index.ts` 调用方零修改
5. 事件序列（3 个 live 场景：normal / tool-using / handoff-or-walkthrough）pre/post 顺序 + 类型 + payload key 完全一致
6. 所有运行时常量（`MAX_HANDOFF_COUNT=3` / `MAX_CONTEXT_MESSAGES=20` / `TASK_TYPE_HANDOFF_CONTINUATION='handoff_continuation'` / `SKILL_TOOL_NAME='activate_skill_context'` / `MAX_TOOL_ROUNDS=5`）只保留一份 owner

**Non-Goals**:

1. 不改 employee node 的 observable 语义：prompt 内容 / tool schema / event payload 字段 / 结构化错误 JSON 全部 byte-identical
2. 不优化 tool loop、不改 round 上限、不改 context trim 阈值
3. 不动 `employee-builder.ts` / `employee-deliverables.ts` / `employee-local-recovery.ts` / `employee-memory-tools.ts`（这些已经是单责模块，只被重组后的新模块调用）
4. 不动其它 agent 文件（boss / manager / hr / pm-planner / step-dispatcher / error-handler / department-dispatcher / recovery-agent）
5. 不新增 spec capability（仅新增 `employee-node-boundaries` 一个），不修改已有 canonical spec
6. 不动 repo 三副本（drizzle / memory / tauri）
7. 不做 UI 层改动，不动 chat / Tasks / Activity Log / ResumeBar 订阅逻辑

## Decisions

### D1 — 模块切分按"数据流阶段 + 跨分支共享"划，不按"代码位置"划

**决定**：按 employeeNode 内部真实数据依赖切 6 个单责模块：

| 模块 | 职责 | 依赖输入 | 输出 |
|---|---|---|---|
| `employee-preflight.ts` | pop assignment、load employee/company、emit 入口事件、subtask 进度 tracking | `state, runtimeCtx` | `PreflightResult = { assignment, remaining, employee, company, taskRunId, taskLabel, totalAssignments, completedSoFar, isDirectChatTask } \| null`（null = 没 assignment 或 employee 不存在，caller 走 early return） |
| `employee-prompt-assembly.ts` | `buildEmployeePrompt` + skill catalog/instructions + memories + library citations + scratchpad 拼装；也 export `taskHasSkillMismatch` / `parseRuntimeSkillConfig` 这类 skill helper | `runtimeCtx, employee, company, taskDescription, requiredSkills, memoryPolicy, toolSearchEnabled` | `{ systemPrompt: string, citationMap: CitationEntry[], runtimeSkill: RuntimeSkillConfig \| null }` |
| `employee-tool-kit.ts` | memory virtual tools + skill activation tool + handoff_to tool + workstation MCP tools 组装；内部常量 `SKILL_TOOL_NAME` owner | `runtimeCtx, employee, isDirectChatTask, handoffCount, runtimeSkill, toolSearchEnabled` | `{ virtualTools, mcpTools, allTools, allowedMcpToolNames }` |
| `employee-turn-runner.ts` | `runEmployeeTurn` closure：组 request、stream vs non-stream 分支、emit `llmStreamChunk` | `runtimeCtx, state, resolved, allTools, config, streamEnabled` | `(messages, meta) => Promise<LlmResponse>` |
| `employee-tool-round.ts` | 单轮 tool-call 结果收集：handoff_to 检测（返回 handoff descriptor 让 barrel 做 Command 早返）、memory / skill / workstation-guarded MCP 并行执行、conversation history 追加 + trim | `llmResponse, runtimeCtx, employee, state, runtimeSkill, allowedMcpToolNames, taskRunId, conversationHistory` | `{ kind: 'handoff', args } \| { kind: 'continue', nextHistory, nextLlmResponse }`（后者由 caller 调 turn runner 得到） |
| `employee-completion.ts` | `finalizeEmployeeSuccess` 共享完成副作用：materialize deliverable / update task run / 4 emits / reflectAndRemember / citations / appendAgentEvent / hook.emit task.completed / scratchpad / deliverable event / 返回 state update；单参数 `{ runtimeCtx, state, employee, assignment, taskRunId, llmResponse, systemPrompt?（recovery 专用以避开重算）, citationMap, isDirectChatTask, remaining, totalAssignments, completedSoFar, taskLabel, taskDescription, resolved, config, source: 'normal' \| 'recovery' }` | 同 | `Partial<OffisimGraphState>` |
| `employee-error-finalize.ts` | 失败终结：emit failed events / update task run failed / structured error JSON build / appendAgentEvent / 返回 state update with `interruptReason` | `runtimeCtx, state, employee, assignment, taskRunId, errorMessage, resolved, totalAssignments, completedSoFar, taskLabel, remaining` | `Partial<OffisimGraphState>` |

barrel（`employee-node.ts`）编排：

```ts
export { extractUsedCitations } from './employee-completion.js';
// or inline — tbd in apply

export async function employeeNode(state, config) {
  const runtimeCtx = getRuntime(config, 'employee');
  runtimeCtx.eventBus.emit(graphNodeEntered(...));

  const pre = await runPreflight(state, runtimeCtx);
  if (!pre) return { pendingAssignments: [], completed: true };
  if ('earlyReturn' in pre) return pre.earlyReturn;

  const prompt = await assemblePrompt(pre, runtimeCtx);
  const toolkit = await assembleToolKit(pre, runtimeCtx);
  const runTurn = buildTurnRunner(runtimeCtx, state, pre.resolved, toolkit.allTools, config);

  let conversationHistory = [
    { role: 'system', content: prompt.systemPrompt },
    { role: 'user', content: pre.taskDescription },
  ];
  let llmResponse = await runTurn(conversationHistory, { taskRunId: pre.taskRunId });

  try {
    let round = 0;
    while (llmResponse.toolCalls.length > 0 && round < MAX_TOOL_ROUNDS) {
      round++;
      const r = await runToolRound(llmResponse, { pre, runtimeCtx, state, toolkit, conversationHistory });
      if (r.kind === 'handoff') {
        return await executeHandoff(r.args, { pre, state, runtimeCtx });
      }
      conversationHistory = r.nextHistory;
      llmResponse = await runTurn(conversationHistory, { taskRunId: pre.taskRunId });
    }
    return await finalizeEmployeeSuccess({ ...commonCtx, llmResponse, source: 'normal', round });
  } catch (err) {
    const recovered = await attemptLocalRecovery(...).catch(() => null);
    if (recovered) {
      return await finalizeEmployeeSuccess({ ...commonCtx, llmResponse: recovered, source: 'recovery', round });
    }
    return finalizeEmployeeFailure({ ...commonCtx, errorMessage });
  }
}
```

**Alternatives considered**:

- **(a) 按 try / catch 块机械切两半**：一个 `employee-happy-path.ts`、一个 `employee-error-path.ts`。否决：happy path 和 recovery path 有 ~130 行结构重复，机械切反而固化重复；且 prompt / tool 组装在 happy path 入口，catch 分支无法复用。
- **(b) 用 class 抱起来**：`class EmployeeNode { preflight() / assemblePrompt() / ... }`，状态存成员。否决：class 会引入隐式可变状态（`this.currentRound` 等），单测思路变复杂，且本仓代码风格偏函数式，其它 agent（boss / manager / pm-planner）都是 free function。
- **(c) 8 个更细的 module**（preflight / skill-helpers / prompt-memories / prompt-library / tool-virtuals / tool-mcp / turn-runner / tool-round / handoff-executor / success-finalize / error-finalize）。否决：过细 → 每个模块少于 50 行，依赖关系反而绕。6 模块是"每个模块有 60-200 行真内容"的 sweet spot。

**选 (D1) 的 rationale**：

1. 6 个模块各自有明确的输入/输出类型；每个都可以独立 read-and-understand
2. handoff 与 completion 是 employeeNode 控制流骨架，留在 barrel 里更清晰（barrel = orchestrator）
3. 与已存在的 `employee-builder.ts` / `employee-deliverables.ts` / `employee-memory-tools.ts` / `employee-local-recovery.ts` 命名与粒度一致
4. 跨分支共享的 `finalizeEmployeeSuccess` 能消除真实重复（~130 行）而不是制造抽象

### D2 — 工具循环 round 用 discriminated union 传 handoff 信号，不用 throw / 共享可变 flag

**决定**：`employee-tool-round.ts` 的 `runToolRound(...)` 返回 `{ kind: 'handoff', args } | { kind: 'continue', nextHistory }`。barrel 在 `kind === 'handoff'` 时调 `executeHandoff(args, ctx)` 拿 `Command` 早返。

**Alternatives considered**:

- Throw `HandoffSignal` 自定义异常让 barrel catch。否决：catch 块已经用于 LLM 错误；再多一层 catch-and-rethrow 把控制流搞糊。
- 返回 `Command | null`（null 表示 continue）。否决：把 handoff 的 Command 构造提前到 tool-round 模块里，handoff 写库 / 创建 TaskRun / emit events 也得搬进去，违反 D1 "handoff 作为 control-flow 留在 barrel 编排层"。

**选 (D2) 的 rationale**：discriminated union = TypeScript 惯用法，tool-round 只关心"这一轮的 LLM 响应里是不是要 handoff"，handoff 执行（写库、事件、Command 构造）仍在 barrel 明处。

### D3 — `finalizeEmployeeSuccess` 参数签名选单对象，不选位置参数

**决定**：

```ts
function finalizeEmployeeSuccess(ctx: {
  runtimeCtx: RuntimeContext;
  state: OffisimGraphState;
  employee: Employee;
  assignment: PendingAssignment;
  taskRunId: string | undefined;
  llmResponse: LlmResponse;
  citationMap: CitationEntry[];
  resolved: ResolvedModel;
  remaining: PendingAssignment[];
  taskLabel: string;
  totalAssignments: number;
  completedSoFar: number;
  taskDescription: string;
  config: RunnableConfig;
  isDirectChatTask: boolean;
  round: number;
  source: 'normal' | 'recovery';
}): Promise<Partial<OffisimGraphState>>
```

**Alternatives considered**:

- 15+ 位置参数。否决：位置参数顺序维护成本高、callsite 可读性差。
- 把 ctx 拆成两个参数 `(preflight, turnResult)`。否决：preflight 和 turnResult 的字段真的会频繁更新，每次改都要改两个 interface；一个 ctx 对象扁平，加字段成本低。

**选 (D3)** 与本仓其它 core 函数（`recordedLlmCall(runtimeCtx, request, opts)` / `materializeFileDeliverableIfNeeded(runtimeCtx, ..., opts)`）风格一致。

### D4 — File-size gate：barrel ≤200、每个单责模块 ≤250（延续 D2 精神但紧一档）

**决定**：`employee-node.ts` barrel ≤200 非空非注释行；6 个单责模块各 ≤250 行。

**理由**：
- D2 `App.tsx` 放到 ≤350 是因为 React composition root 不可压缩 props-passing overhead。本次是 pure TypeScript control-flow orchestration，没有 JSX props 开销，barrel 压到 ≤200 可行（orchestration 骨架 ~100 行 + imports/types ~50 行 + extractUsedCitations re-export ~10 行）
- 单模块 ≤250：preflight / prompt-assembly 各预估 ~150，tool-kit ~120，turn-runner ~90，tool-round ~180，completion ~200，error-finalize ~80。留 buffer 防 apply 阶段微调

**Alternatives considered**:

- 所有模块统一 ≤200。否决：completion 要 emit 5 条 event + 更新 task run + hook + scratchpad + deliverable event + state update build，不给空间会被迫再切细。
- barrel ≤150 极限压缩。否决：orchestration 骨架 + try/catch + types 至少 ~100，留 50 给 imports 太紧，apply 会被迫再把 executeHandoff 分出去。

### D5 — public API 保持 `employee-node.ts` 为唯一导入点

**决定**：`extractUsedCitations` 继续从 `employee-node.ts` re-export（barrel 里 `export { extractUsedCitations } from './employee-completion.js'`），`index.ts:332` 不改：

```ts
// index.ts (unchanged)
export { employeeNode, extractUsedCitations } from './agents/employee-node.js';
```

**Alternatives considered**:

- 把 `extractUsedCitations` 独立成 `employee-citations.ts` 并在 `index.ts` 单独 export。否决：会破坏 public API 已有的单文件来源，增加 caller 负担，违反 proposal "Public API 零破坏"约束。

**选 (D5) 的 rationale**：re-export 是零运行时开销的常量；barrel 仍然是"employee node 相关的所有公共符号的唯一来源"。

### D6 — 新模块的 RuntimeContext / state / employee 类型从现有处复用，不新增类型

**决定**：所有新模块函数签名只引用已有类型（`OffisimGraphState` / `RunnableConfig` / `Employee` / `RuntimeSkillConfig` / `PendingAssignment` / `LlmResponse` / `LlmMessage` / `ToolDef` / `CitationEntry` / `ResolvedModel`）。新增仅内部 `PreflightResult` / `ToolRoundOutcome` 两个 type alias，不 export 给模块外。

**理由**：此为纯物理拆分；引入新 public type 会扩大 surface area，给以后 type-only 误依赖留坑。

## Risks / Trade-offs

- **[R1] 事件顺序错位**：emit 条数多（entry 2 + per-round N + completion 4-5 + deliverable 1 + error 3）。抽象拆分时极易漏一条或顺序换位。
  **Mitigation**: apply 阶段强制做 `pre-diff` 抓 1 个 live normal task 的完整 event sequence 到 `/tmp/employee-node-pre-normal.json`；post-diff 同样抓一次到 `/tmp/employee-node-post-normal.json`；两个 JSON 必须 byte-identical（UUID / timestamp 用 normalizer 替换）。不通过不准 commit。

- **[R2] `runEmployeeTurn` 闭包捕获的变量**（`allTools` / `streamEmployeeReplies` / `resolved` / `config` / `state` / `runtimeCtx`）在拆成 free function 后需要显式参数化。遗漏或误传会导致 stream chunk event 不发、或模型参数错位。
  **Mitigation**: `buildTurnRunner(...)` 在 apply 阶段先用 inline snapshot 方式写出完整参数签名注释；做完后 grep `recordedLlmStream` 所有 callsite 保证 `chunk.reasoning` / `chunk.content` 两个 emit 分支都在。

- **[R3] happy path 完成路径与 recovery path 完成路径的表面行为"很像但不完全一样"**：正常路径有 `materializedDeliverable` 标记、recovery 分支有 `recoveredFromError: true` 标记；appendAgentEvent payload 键不同。若 `finalizeEmployeeSuccess` 粗合并会丢失 `recoveredFromError: true`。
  **Mitigation**: `source: 'normal' | 'recovery'` 入参；finalize 内部用 switch 分出 appendAgentEvent payload 差异；具体字段清单在 apply 的 tasks.md 里逐条列出比对。

- **[R4] handoff_to 早返要在 tool-round 外执行**，但 handoff 需要访问 `state.currentStepOutputs`、`remaining`、`employee` 做 Command 构造。
  **Mitigation**: `executeHandoff(args, { pre, state, runtimeCtx, remaining })` 入参齐全；barrel 调用点明显，不会遗漏 `remaining` 来源。

- **[R5] 3 个常量（`MAX_HANDOFF_COUNT` / `MAX_CONTEXT_MESSAGES` / `TASK_TYPE_HANDOFF_CONTINUATION` / `SKILL_TOOL_NAME` / `MAX_TOOL_ROUNDS`）跨模块用**。如果每个模块自己声明一份，值会分叉。
  **Mitigation**: 新建 `employee-node-constants.ts`（≤20 行）作为单一 owner，各模块 import 复用；barrel 也 import 不重复声明。

- **[R6] live 验证场景覆盖不全 error path**。Error 只在 LLM 真失败时走；测试环境很难稳定触发。
  **Mitigation**: 对 error path 做静态 walk-through（逐行在 diff 里对齐 `taskStateChanged` / `taskSubtaskProgress` / `employeeStateChanged` / `appendAgentEvent` 4 条 emit 的参数与顺序 + 结构化错误 JSON schema），archive 时在 completion log 明确标注"error path 仅做静态等价核查"，不假装 live verified。

- **[R7] `conversationHistory` 的 append 与 trim 逻辑对输入 LLM 的 request 敏感**。新模块 `runToolRound` 必须按原顺序：先 append assistant message、再 append 所有 tool results、再做 trim、再让 caller 调 turn runner。
  **Mitigation**: tool-round 的 `nextHistory` 返回值里明确"包含本轮 assistant + 所有 tool results 的 trimmed history"；单元注释 + apply 阶段 diff 对齐原 654-702 行逻辑。

- **[R8] diff 文件规模大**：估算 ~1300 行修改。reviewer 难核对。
  **Mitigation**: apply 提交按拆分步骤做 4-5 个 intermediate commit（preflight 抽出 / prompt 抽出 / tool-kit 抽出 / turn-runner 抽出 / completion + error 合并 + barrel 瘦身），每步单独 typecheck 通过再下一步；最终一个 squash commit 落 main 前 reviewer 看 diff 更轻松。

## Migration Plan

1. 新开 `refactor-employee-node` 分支（或直接 main，沿用 D1/D2 的 main 工作流）。
2. **Phase A — 抽 `employee-node-constants.ts`**：只抽常量，其它不动。typecheck / build 过后 commit。
3. **Phase B — 抽 `employee-preflight.ts`**：把 line 176-290 抽成 `runPreflight(state, runtimeCtx)`，barrel 调用点替换。typecheck / build 过后 commit。
4. **Phase C — 抽 `employee-prompt-assembly.ts`** + 6 个 skill / prompt helper（`parseRuntimeSkillConfig` / `normalizeSkillText` / `taskHasSkillMismatch` / `formatSkillCatalogSection` / `formatSkillInstructionsSection`）搬家。commit。
5. **Phase D — 抽 `employee-tool-kit.ts`** + `buildSkillActivationTool`。commit。
6. **Phase E — 抽 `employee-turn-runner.ts`** 包 `runEmployeeTurn`。commit。
7. **Phase F — 抽 `employee-tool-round.ts`**，barrel 的 while 循环变成 "runToolRound → handoff 分支调 executeHandoff / continue 分支换 history 下一轮 turn"。commit。
8. **Phase G — 抽 `employee-completion.ts` 的 `finalizeEmployeeSuccess`**；happy path 改调它。commit。
9. **Phase H — recovery path 改调 `finalizeEmployeeSuccess({ source: 'recovery' })`**；验证 payload 字段差异对齐。commit。
10. **Phase I — 抽 `employee-error-finalize.ts`**。barrel 最终收到 ≤200 行。commit。
11. **Live verify**：3 个场景 pre/post 事件序列比对；若 handoff 场景 trigger 不了，做静态 walk-through。
12. **Archive** 走 `/opsx:archive refactor-employee-node`，sync canonical spec `employee-node-boundaries/spec.md`。

**Rollback**: apply 全程不改 public API；任何 phase 出现问题回滚到上一个 commit 即可，不需要 migration 文件或数据变更。

## Open Questions

1. `employee-node-constants.ts` 是独立文件，还是放进 `employee-preflight.ts` / `employee-tool-kit.ts` 内部？— apply 前定，看常量分布。倾向独立文件（D5 / R5）。
2. `extractUsedCitations` 搬到 `employee-completion.ts` 还是留在 barrel？— barrel re-export from completion（D5），但实现体搬到 completion。
3. `employee-tool-round.ts` 返回值里的 `nextHistory` 要不要显式区分 pre-trim / post-trim？— 只需 post-trim；pre-trim 已被 `conversationHistory` mutation 覆盖，不需要让 caller 看到。apply 时直接只返回 trimmed 版本。
4. 是否在 live verify 后把 proposal / design 同步更新（像 C change 把"initial rect stale" 修正为 "drawScene dpr"）？— 如果 apply 发现 D1-D6 任一决策需要调整，在 apply 最后 phase 同步改写 design 与 canonical spec。
