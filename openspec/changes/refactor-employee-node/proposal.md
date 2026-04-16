## Why

`packages/core/src/agents/employee-node.ts` 目前 1126 行 / 980 非空非注释行，`employeeNode` 一个 async 函数就占了 954 行，把 8 种互相独立的职责糊在一个 try/catch 里：

1. **Preflight** — pop assignment、load employee/company、emit initial `graph.node.entered` / `employee.state.changed` / `task.state.changed` / `task.subtask.progress`
2. **Prompt 组装** — `buildEmployeePrompt` + skill catalog / memories / library citations / scratchpad 拼接
3. **Tool 组装** — memory virtual tools + skill activation tool + handoff_to tool + workstation-scoped MCP tools
4. **Streaming 包装** — `runEmployeeTurn` closure（stream vs non-stream + `llm.stream.chunk` 发射）
5. **Tool loop** — 最多 5 轮：handoff_to 早返 Command、其它 tool call 并行执行、conversation history 滚动累积 + 超长 trim、下一轮 LLM 调用
6. **Handoff 执行** — 写 handoff 记录 / 创建新 task run / emit handoff.initiated / 返回 `new Command({ goto: 'employee' })`
7. **Success 完成** — materialize deliverable / update task run / emit 4 条 event / reflect memory / extract citations / appendAgentEvent / hook.emit `task.completed` / scratchpad write / emit `deliverable.created` / 返回 state update
8. **Error 恢复 / 失败** — `attemptLocalRecovery` → recovered 时执行上面的"success 完成" 第二遍（happy path 和 recovery path 的 completion 侧效应几乎逐行重复，行号 727-860 vs 919-1016 同结构复制了 ~130 行）；否则 emit failed events + 结构化错误 JSON

这个文件同时命中本仓多条"屎山热点"判断：超长文件、 god-function、完成侧效应跨分支重复、单责模块能装得下的工具组装/提示组装被迫留在外层 closure。它不像 D1 `useSceneOrchestrator` 还有 `/** 四个功能切分 */` 分隔符 — `employee-node.ts` 一个 function body 里就是顺序杂烩。

Queue（[project_next_change_queue.md](../../../../../.claude/projects/-Users-haoshengli-Seafile-WebWorkSpace-Offisim/memory/project_next_change_queue.md)）把 D3 标为 `[ ] queued` 目标文件 `packages/core/src/agents/employee-node.ts (1126 行)`。D1 / D2 闭环节奏已跑通（UI 层 scene-orchestrator → App.tsx），本次把 D 系列下沉到 core runtime 层，沿用"先重构 → live verify → openspec archive → sync canonical spec"流程。

## What Changes

**纯物理拆分重构** — observable behavior 零变化（同 assignment 走完同样的事件序列、同样的 conversation history、同样的返回值、同样的结构化错误 JSON）。

- **新 capability `employee-node-boundaries`** — 固定 `employee-node.ts` 的职责边界与公共 API，让未来 ceremony / handoff / memory / deliverable 各自独立演进不再回炸这个文件
- **拆成 1 barrel + 5-6 单责模块**（具体边界由 design.md 固定），位于 `packages/core/src/agents/`
  - `employee-node.ts` 降到 barrel：只做 orchestration + re-export 2 个公共符号（`employeeNode` / `extractUsedCitations`）
  - 新模块（拟名，以 design 为准）：`employee-preflight.ts` / `employee-prompt-assembly.ts` / `employee-tool-kit.ts` / `employee-turn-runner.ts` / `employee-tool-round.ts` / `employee-completion.ts` / `employee-error-finalize.ts`
- **消除 happy path vs recovery path 的 completion 逻辑重复** — 提取 `finalizeEmployeeSuccess(...)` 共享 helper，recovered 分支调它一次，normal 分支调它一次，行为完全一致
- **不动 public API**：`employeeNode` / `extractUsedCitations` 命名导出签名不变，`packages/core/src/index.ts:332` 和 `packages/core/src/graph/main-graph.ts:8,370` 不需要改
- **不动运行时不变量**：
  - event 顺序严格保持 `graphNodeEntered → taskStateChanged(queued→running) → taskSubtaskProgress(running) → llmStreamChunk* → (handoff path: handoffInitiated + employeeStateChanged)` OR `(normal: taskStateChanged(running→completed) + taskAssignmentChanged + taskSubtaskProgress(done) + employeeStateChanged(executing→idle))` OR `(error: taskStateChanged(running→failed) + taskSubtaskProgress(failed) + employeeStateChanged(executing→failed))`
  - tool loop 上限 `MAX_TOOL_ROUNDS = 5`、handoff 上限 `MAX_HANDOFF_COUNT = 3`、context trim 阈值 `MAX_CONTEXT_MESSAGES = 20` 常量保留且只有一份
  - 结构化错误 JSON schema（`errorCode: 'LLM_CALL_FAILED'` / `recoverable: true` / `nodeName: 'employee'` / `provider` / `model`）字段不变
  - `reflectAndRemember` 仅在 `memoryService && !isDirectChatTask && !handoff_continuation` 时触发
  - citations 抽取与 `deliverable.created` emit 条件不变
- **File-size gate**（沿用 D2 调整后的 ≤350 标准）— barrel 目标 ≤200 非空非注释行、每个新模块 ≤250 行；总体大约 980 行 → barrel ~120-160 行 + 6 模块各 60-200 行
- **不改其它 agent 文件**（boss-node / manager-node / pm-planner-node / manager / hr / pm / boss 均不动）
- **不动 `employee-builder.ts` / `employee-deliverables.ts` / `employee-local-recovery.ts` / `employee-memory-tools.ts`** — 这些已经是独立模块，只被重组后的新模块调用

## Capabilities

### New Capabilities
- `employee-node-boundaries`: `packages/core/src/agents/employee-node.ts` 作为 LangGraph `employee` 节点编排入口的职责边界契约，约束 barrel 只做 orchestration + re-export、8 种职责各自独属单一模块、完成侧效应共享 helper 不跨分支重复、`employeeNode` / `extractUsedCitations` 两个公共符号签名稳定、事件序列 / 工具上限 / 结构化错误 JSON 等运行时不变量 byte-identical。

### Modified Capabilities

（无。本变更只新增结构契约，不修改已有 canonical spec。`avatar-seed-resolution` / `plan-step-store` / `typed-json-field-parsers` / `unified-shell-routing` / `workspace-state-management` / `chat-streaming-ux` / `deliverable-artifact-handoff` / `office-2d-canvas-viewport` / `scene-orchestrator-boundaries` / `web-app-shell-boundaries` 均与本文件无结构耦合。）

## Impact

**直接受影响代码**

- `packages/core/src/agents/employee-node.ts` — 1126 → ≤200 非空非注释行 barrel
- `packages/core/src/agents/employee-*.ts` 新增 6 个单责模块
- `packages/core/src/index.ts:332` — 导入路径不变（继续 re-export `employeeNode` / `extractUsedCitations` from `./agents/employee-node.js`）
- `packages/core/src/graph/main-graph.ts:8,370` — 导入路径不变

**间接依赖（已有独立模块，被新拆出的模块调用，不改它们）**

- `employee-builder.ts`（`buildEmployeePrompt`）
- `employee-deliverables.ts`（`materializeFileDeliverableIfNeeded` / `buildEmployeeDeliverableTitle`）
- `employee-local-recovery.ts`（`attemptLocalRecovery`）
- `employee-memory-tools.ts`（`MEMORY_TOOL_NAMES` / `buildMemoryTools` / `formatMemoriesSection` / `handleMemoryTool`）
- `runtime/tool-executor.ts`（`WORKSTATION_ACCESS_DENIED`）
- `llm/recorded-call.ts`（`recordedLlmCall` / `recordedLlmStream`）
- `services/library-service.ts`（`LibraryService` / `CitationEntry`）
- `events/event-factories.ts`（8 个 event factory）

**验证**

- `pnpm --filter @offisim/core typecheck && pnpm --filter @offisim/core build` 绿
- Repo 级 `pnpm typecheck && pnpm lint` 绿
- Live agent 验证（三个场景 pre/post 事件序列 byte-identical）：
  1. Normal task — 用户给个简单任务（"write a haiku about testing"），让 boss → manager → pm_planner → step_dispatcher → employee → boss_summary 走完，对比 EventBus timeline
  2. Tool-using task — 给个需要 file deliverable 的任务（"create snake.html game"），走 deliverable materialization + `deliverable.created` 事件
  3. （可选）Handoff — 能不能通过 chat prompt 触发 handoff_to 暂不确定；若不能稳定触发，walk-through code 逐行核对 handoff 分支 pre/post 行为一致性作为 fallback
- 3 个 live 场景事件序列以 pre/post JSON 留痕，存 `/tmp/employee-node-{pre,post}-{normal,tool,handoff}.json`
- 若 live 没覆盖 error handling（触发不到 LLM 真失败），在 archive 时显式说明"error path 仅做静态等价性核查"，不假装 live 验证

**非 impact（明确排除）**

- 不改 LangGraph 图形结构、路由（`main-graph.ts:370` 仍直接调 `employeeNode`）
- 不改 agent prompt 内容 / skill injection 格式 / memory section 格式
- 不改 `ChatMessage` / `TaskRun` / `Handoff` 等 schema
- 不新增或修改 event factory / event payload 字段
- 不改 `modelResolver.resolve()` 契约
- 不改 `toolExecutor.execute()` / `workstationToolResolver.resolveForEmployee()` 契约
- 不动 repo 三副本（drizzle / memory / tauri）— 本重构与 repo 层无接触
