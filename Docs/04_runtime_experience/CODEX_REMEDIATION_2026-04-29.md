# Codex 整改 Handoff — 2026-04-29

> Branch: `codex/long-running-rc1`
> 起因：`v1.1.0-rc.1` 闭环报告之后做了"假体" smoke review，挖出 5 类真假完成与软覆盖。本 doc 是 codex 第二轮整改 prompt。读完此 doc + 跑通验证清单后，才允许打 `v1.1.0-rc.1` tag。

---

## 0. 反 anti-pattern 硬规则（开工前读，违反即整改无效）

这一波 review 之所以挖出大量"绿但是假"的东西，是因为上一轮没写死下面这些规则。本轮强约束：

1. **禁止 hardcoded 永真返回兜底**。任何 `return { ok: true }` / `return { success: true, result: { ok: true } }` / `?? true` / `?? 'completed'` 兜底，必须配合 `// reason: ...` 注释说明为什么这条路径不可能失败；不能写就是可以失败，那必须 fail-loud。
2. **禁止 mock 输出 == assertion 字符串自证**。scenario fixture 里 LLM mock 的 `content` **不能** 和 invariant `finalOutputContains` 用同一字符串。assertion 必须读 graph state / DB / events 真实值，不能读"LLM 说的话本身"。
3. **禁止 `expectError` substring match 当通过条件**。"FakeGateway exhausted" 这种异常不能当成"行为正确" —— 那是 fixture 不够覆盖。`expectError` 只允许用于"明确预期会抛业务异常"的负面 scenario，且必须配合至少一条**正向** invariant（事件数 / 状态字段 / DB 行）共同断言。
4. **禁止"能力不存在 vs 无数据"折叠成同一返回值**。比如 resume coordinator 现在 saver 不存在和无 snapshot 都返 null；fix 时必须分两个返回 case（`{ kind: 'unsupported' }` vs `{ kind: 'no-snapshot' }`），让 caller 能区分。
5. **禁止 `RecordingToolExecutor.execute` hardcoded `{success:true}`**。本轮要把它改成"按 scenario fixture 查表，corpus miss 即 throw"，和 fake-gateway 同形态。
6. **禁止把 verifier-blocked step 写进 `completedStepIndices`**。blocked 是 blocked，不能伪装成 completed 让 `areAllPlanStepsTerminal` 给 boss_summary 假信号。
7. **禁止 boss_summary 在 outputs 为空时静默判 success**。outputs 为空必须根据 (taskPlan, completedStepIndices, pendingAssignments) 三元组明确分支，不能一律 "Task processing complete."。
8. **每条 fix 必须配真 invariant scenario**。invariant 要读真状态（graph state / repo / events），不能只看"LLM 输出字符串包含 X"。所有新 scenario 都走 `packages/core/harness/scenarios/*.json` + 标准 schema（fixture/invariants 字符串 schema 要么改 runner 让它认，要么迁到标准 schema —— 不许留 dead spec）。
9. **每条 commit 必须跑：** `pnpm typecheck` + `pnpm lint` + `node scripts/harness-contract.mjs --force-build` + `node scripts/harness-replay.mjs --force-build`，绿才能 commit。
10. **本轮结束前必须实机 release dmg + Computer Use live verify**，覆盖第 7 节"RC 真闭环"全部 6 项，全部真过才允许打 tag。

---

## Phase A — SOP 假完成根因（5 条路径，`a11ffa8d` 只覆盖 1 条）

### A.1 `boss-summary-node.ts:164-175` outputs-empty 静默判 success

**当前**：
```ts
if (employeeResults.length === 0) {
  if (...) await runtimeCtx.repos.threads.updateStatus(state.threadId, 'completed');
  return { completed: true, messages: [new AIMessage({ content: 'Task processing complete.' })] };
}
```
完全不看 `taskPlan` / `pendingAssignments` / `completedStepIndices` / `blockedStepIndices`。preflight 短路 / dispatcher 0-ready / 全员 blocked 都会撞进这条 fallback。

**期望**：分三支
- `taskPlan === null && pendingAssignments.length === 0 && completedStepIndices.length === 0` → 真 idle，message 走专门 idle 文案，**不**写 thread `completed`，**不**返回 `completed: true`
- `taskPlan !== null && (blockedStepIndices.length > 0 || 任意 step 没在 completedStepIndices ∪ blockedStepIndices)` → 异常 stuck，写 `interruptReason: 'boss-summary-empty-with-pending-plan'`，**不**写 thread completed，**不**说 "Task processing complete"，message 必须报告"还有未完成 step"
- `taskPlan !== null && plan 全部 step 都进了 completedStepIndices ∪ blockedStepIndices`（A.2 改完后）→ 走 plan-finished 总结，必须按 blocked 数量分别报告"完成 N，阻塞 M"

**Invariant scenario（新写）**：
- `boss-summary-empty-with-stale-plan-does-not-mark-complete.json` —— 灌一个有 taskPlan + completedStepIndices=[] 的 state 进 boss_summary，断言 `thread.status !== 'completed'`、最终消息 **不**等于 `'Task processing complete.'`、`interruptReason` 字段非空
- `boss-summary-idle-no-plan-does-not-mark-complete.json` —— 全 null state 进 boss_summary，断言 `thread.status !== 'completed'`

### A.2 `main-graph.ts:230-235` step_advance 把 verifier-blocked 当 completed

**当前**：
```ts
const newCompletedIndices = [...(state.completedStepIndices ?? [])];
for (const stepIdx of stepsToComplete) {
  newStepResults.push({ stepIndex: stepIdx, outputs });
  newCompletedIndices.push(stepIdx);  // 不区分 ok / blocked
  ...
}
```
verifier 把 task 判 blocked 后，step 仍然进 `completedStepIndices`，`areAllPlanStepsTerminal` 永远是骗子。

**期望**：
- `OffisimGraphState` 加新字段 `blockedStepIndices: number[]`（`packages/core/src/graph/state.ts`），跟 `completedStepIndices` 同位
- `step_advance` 决定 step 终态：检查这 batch 里所有 task_runs 的 `output_json` 或 `taskRuns.findByStep(stepIdx)` 拉真 status；如果 batch 内有任一 `blocked`，整个 step 进 `blockedStepIndices` 而非 `completedStepIndices`；全 ok 才进 completed
- `areAllPlanStepsTerminal()`（`main-graph.ts:143-148`）改成"step 在 completed ∪ blocked 集合"才算 terminal
- `routeFromStepDispatcher` 在 plan 全 terminal 时，必须把 `blockedStepIndices` 一并传给 boss_summary 让它能区分

**Invariant scenario（新写）**：
- `step-advance-segregates-blocked-from-completed.json` —— scenario 制造一个 batch 里 1 ok + 1 blocked，断言 `completedStepIndices` 不含 blocked 那个 step、`blockedStepIndices` 含、`areAllPlanStepsTerminal === true`
- 修 `kanban-card-state-transitions.json`：assertion 加上 `blockedStepIndices` 校验

### A.3 `pm-planner/plan-persistence.ts:138-150` reset 漏字段

**当前**：
```ts
return { taskPlan, currentStepIndex:0, pendingAssignments:[], dispatchedStepIndices:[],
         completedStepIndices:[], stepResults:[], currentStepOutputs:[],
         currentTaskRunId:null, currentEmployeeId:null, interruptReason:null, completed:false };
```
对照 `state.ts` 漏：`recentToolResults`、`replanCount`、`handoffCount`、`meetingActionItems`、`hrAssessment`、`managerDirective`、`blockedStepIndices`（A.2 加了之后）。

**期望**：抽 helper `createEmptyPlanScopedState(): Partial<OffisimGraphState>` 在 `state.ts` 同文件，列全所有 plan-scoped 字段，作为单一 source of truth。判定 plan-scoped vs thread-scoped 的边界：
- **必须清**（每次新 plan）：`recentToolResults`、`pendingAssignments`、`dispatchedStepIndices`、`completedStepIndices`、`blockedStepIndices`、`stepResults`、`currentStepOutputs`、`currentStepIndex=0`、`currentTaskRunId=null`、`currentEmployeeId=null`、`interruptReason=null`、`completed=false`
- **不清**（thread-scoped）：`replanCount`、`handoffCount`（这两个是 thread 累计，跨 plan 限流，不能清）；`meetingActionItems` / `hrAssessment` / `managerDirective` —— **codex 自己确认** 是 plan-scoped（每次 PM 重新跑应该重新算）还是 thread-scoped（跨 plan 持续追踪），决定后在 helper 注释里写 `// plan-scoped` / `// thread-scoped` 二选一原因。决定错了会被 review 打回。

**Invariant scenario（强化已有 `pm-planner-clears-stale-dispatch-state.json`，去掉自证）**：
- 删掉当前 `finalOutputContains: "STALE_DISPATCH_RESET_EMPLOYEE_DONE"`（mock-content 等于 assertion，自证）
- 改成读 graph state 直接断言：`recentToolResults.length === 0`、`completedStepIndices.length === 0`、`dispatchedStepIndices.length === 0`、`pendingAssignments.length === 0`、`blockedStepIndices.length === 0`
- 加一条 negative：fixture 灌入 `recentToolResults: [{toolName:'pnpm-test',success:true}]`，跑完 PM 新 plan，期望 task 第一步 verifier 看到 `recentToolResults` 是空（不是旧的 success），断言 verifier 输出 `ok: false`

### A.4 `pm-planner/preflight.ts:32-37, 39-66` 短路时 emptyPlan 完全不清旧字段

**当前**：
```ts
const emptyPlan = { taskPlan: null, currentStepIndex: 0, stepResults: [], currentStepOutputs: [] };
if (!directive || directive.recommendedEmployees.length === 0) return { kind:'short-circuit', result: emptyPlan };
if (validEmployees.length === 0) return { kind:'short-circuit', result: emptyPlan };
```
preflight 短路（cancel / 无 directive / 无 employee）继承所有旧 plan 字段。

**期望**：preflight 短路也用 A.3 的 `createEmptyPlanScopedState()`，再叠 `taskPlan: null`。短路路径加 `interruptReason: 'pm-preflight-cancelled' | 'pm-preflight-no-directive' | 'pm-preflight-no-employee'` 让下游 boss_summary 能区分（A.1 已要求看 interruptReason）。

**Invariant scenario**（合并到 A.3 的 scenario 里加一个 case）：preflight 短路后 graph state 字段全空 + interruptReason 有意义。

### A.5 `mode-router.ts` + `yolo-master-node.ts:48-75` yolo / direct mode 绕过 PM reset

**当前**：yolo / direct_to_employee 完全绕过 pm_planner，旧 dispatchedStepIndices/completedStepIndices/taskPlan/recentToolResults 全留。

**期望**：mode 入口节点（yolo-master-node 入口、direct-to-employee 入口）也调 `createEmptyPlanScopedState()` reset 一次。同时这两个 mode 自己产生的 assignment 进 `pendingAssignments` 时，必须自带 taskRunId（保证 A.6 的 fix-loud 不打到自己）。

**Invariant scenario**：
- 修 `yolo-mode-skips-boss-chain.json`：去掉 `expectError: "FakeGateway exhausted"`，给完整 fixture 让 yolo 跑通一个 turn；assertion 必须读 graph state 断言 `recentToolResults` 在入 yolo 前是空（不是上一个 thread 残留）、`taskRuns count >= 1`、`kanbanCards origin=employee count >= 1`、`firstGraphNodeIs: yolo-master`
- 同样改 `direct-mode-skips-boss-chain.json`

### A.6 `employee-completion.ts:131-138` 兜底改 fail-loud

**当前**：
```ts
const completionOutcome = taskRunId
  ? await verifyTaskCompletion({ ... })
  : ({ ok: true } as const);
```
没 taskRunId 静默 ok。任何后续新路径漏塞 taskRunId 默认 ok。

**期望**：
```ts
const completionOutcome = taskRunId
  ? await verifyTaskCompletion({ ... })
  : ({ ok: false, reason: 'no-task-run-id' } as const);
```
任何故意走"无 taskRunId" 的合法路径（比如纯 chat 不走 plan），必须显式 opt-in：`FinalizeSuccessContext` 加 `skipVerification?: boolean` 字段，调用方明示。codex 必须 grep 全仓所有 `finalizeEmployeeSuccess` 调用点，逐条决定要不要 `skipVerification: true`，并在调用点注释为什么。

**Invariant scenario**：
- `completion-without-taskrunid-defaults-to-blocked.json` —— 不显式传 skipVerification，taskRunId 缺失，断言 outcome 是 blocked

### A.7 `pm-heartbeat-node.ts:42-46` 不告警 blocked / review_ready

**当前**：只看 `running > 5min` 算 stuck，blocked 永远不会触发 stuck 告警。

**期望**：判定加上 `tr.status === 'blocked'` 也算 stuck（blocked 本质就是需要人介入），但不能和真 stuck 混淆 —— 用不同 `reason` 字段区分（`'verifier-blocked'` vs `'running-too-long'`）。

**Invariant scenario**：
- `pm-heartbeat-flags-blocked-task.json` —— fixture 一个 blocked task_run，跑 heartbeat，断言 emit 的 stuck event 至少 1 条且 reason='verifier-blocked'

---

## Phase B — 员工工具面（解 6.4.2 / 6.4.3 RC blocker）

### B.1 `employee-tool-kit.ts:32-108` 注册 `read_file` / `write_file` / `bash`

**当前**：组装路径只有 memory + todo + skill-install + handoff_to + workstation MCP，**零 fs/shell**。

**期望**：
- 在 `assembleToolKit()` 里加注入：当 `runtimeCtx.builtinTools` 存在时，把 `read_file` / `write_file` / `bash` push 进 pool（顺序在 memory tools 之后、workstation MCP 之前）
- `RuntimeContext` 类型加可选字段 `builtinTools?: { fs?: FsBridge; shellExec?: ShellBridge }`
- `tauri-runtime.ts` 实例化时传入真 fs + shellExec，bridge 通过 Tauri command（见 B.4 / B.5）；`browser-runtime.ts` 不传（保持 builtin tools 在 web 模式不启用，工具列表里也不出现，让 LLM 知道没这能力，**不要**注册一个永远 throw 的假工具）
- `core/CLAUDE.md` 已经有"4 lane"描述，本次 wire 只覆盖 **gateway lane**；3 条 SDK lane 维持当前 throw 但改成更具体的错误消息（见 B.6）

### B.2 `tools/builtin/{file-read,file-write,bash}-tool.ts` 接到 `CompositeToolExecutor`

**当前**：工厂存在但没人 new `CompositeToolExecutor`；`tauri-runtime.ts:265,319` 和 `browser-runtime.ts:288,311` 只 wire MCP+Auditing。

**期望**：
- `tauri-runtime.ts` 在 toolExecutor 链外面再包一层 `CompositeToolExecutor`，把 `createBuiltinTools({ fs, shellExec })` 的输出和现有 MCP+Auditing 链组合
- `browser-runtime.ts` 不用包（builtin 在 web 模式 disabled）
- `createBuiltinTools` 内部 `executionMode === 'browser-limited' || !config.fs/shellExec` 还是 return null，但现在 tauri 模式真有 fs/shellExec，不会再死代码

### B.3 `apps/desktop/src-tauri/src/lib.rs` + `capabilities/default.json` 注册 shell command

**当前**：只有 `tauri_plugin_fs` 接通，没有 shell 执行 command。

**期望**：
- 加 Tauri command `bash_execute(cwd: String, cmd: String, timeout_ms: u32) -> Result<{stdout, stderr, exit_code}>`
- 严格沙箱：`cwd` 必须在 `projects.workspace_root` 之内（grep 现有 vault / project root 校验逻辑参考），不在则拒
- `capabilities/default.json` 加权限 entry，名字配上面 command
- timeout 必须，避免无限阻塞
- stdout / stderr 大小 cap（比如 1MB），超 cap truncate 并标记

### B.4 `claude-agent-host.mjs` + `codex-agent-host.mjs` 解禁 prompt + 接事件流

**当前**：
- `codex-agent-host.mjs:117-131, 430-431` developerInstructions 硬编码 "Do not invoke tools..."；`approvalPolicy:'never'` `sandbox:'read-only'`
- `apps/web/src/lib/tauri-engine-adapters.ts:86-118` 只 yield 一个 text_delta + run_completed，没 tool_started / tool_completed

**期望（本轮范围内只做 codex sidecar 的最小修复，不接 SDK lane 全工具）**：
- 删除"Do not invoke tools"硬编码
- approvalPolicy / sandbox 改成从 trusted-host 配置传入；workspace-bound 模式默认 `sandbox: 'workspace-write'`、`approvalPolicy: 'on-request'`
- **不**在本轮全量接 tool_started / tool_completed 事件流到前端 UI（工作量大，先做后端）；在 adapter 层加 `// TODO(remediation-2026-04-29): wire tool events to UI` 注释明说待办，但 **必须** 让 codex sidecar 真的能调 fs/shell（即"功能可用 + UI 不显示工具调用"先做完，UI 增强延后单独 ticket）

### B.5 3 条 SDK lane 错误消息改具体

**当前**：3 个 adapter 收到 tools 直接 throw "lane does not yet expose Offisim tool calls"。

**期望**：throw 消息改成 `"<lane name> lane does not currently support fs/shell tool calls. Switch this employee to gateway lane to use file/shell tools."` 让玩家知道怎么解（而不是悄悄不能用）。这条不是修能力，是修可发现性 —— SDK lane 全工具支持不在本轮范围。

### B.6 YOLO Master persona 文案对齐能力

**当前**：`yolo-master-persona.ts:11-12` 自我描述 "runs verification commands before claiming completion"，但 gateway lane 默认拿不到 shell tool（B.1 wire 上之后才有）。

**期望**：B.1 落地后，YOLO Master 在 tauri release 模式下应该真有 fs/shell 工具；persona 文案不用改。**但**要在 persona 里加一句：`"If file or shell tools are unavailable in this session, explicitly tell the user before continuing — never silently skip verification."`

### Phase B Invariant scenario（必须配合实机 verify）

- `gateway-lane-yolo-has-fs-shell-tools.json` —— 用 deterministic-runtime 跑 YOLO Master 一个 turn，断言 toolKit 里包含 `read_file` / `write_file` / `bash` 三条
- `tool-kit-without-builtins-omits-fs-shell.json` —— 不传 builtinTools 时，toolKit **不**含这三条（确认 web 模式不出现假工具）
- 实机：见第 7 节 6.4.2 / 6.4.3

---

## Phase C — Kanban 状态机

### C.1 `core/src/runtime/repos/kanban-repo.ts:49-61` 加 from/to 校验

**当前**：`transition()` 直接走 `storage.update`，零 from/to 校验。

**期望**：
- 在 `kanban-repo.ts` 顶部声明 `const ALLOWED_TRANSITIONS: Record<KanbanState, ReadonlySet<KanbanState>>`，5 状态 (`todo|doing|blocked|review|done`) 按 spec 给白名单
- `transition(cardId, nextState, reason)` 内部先 `select` 拿当前 state，比对 `ALLOWED_TRANSITIONS[current].has(next)`；不在白名单 throw `KanbanInvalidTransitionError(current, next)`
- 三后端（drizzle / memory / tauri）都通过这个 Repo 入口；如果有绕过 Repo 的直接 SQL update 路径，全部改成走 Repo

### C.2 `apps/desktop/src-tauri/src/kanban.rs:259-273` Rust 端校验

**当前**：`transition_kanban_card` 直接 `UPDATE ... SET state = ?`。

**期望**：
- 在 SQL UPDATE 前 `SELECT state FROM kanban_cards WHERE card_id = ?`
- Rust 端镜像 `ALLOWED_TRANSITIONS` 常量
- 不合法 transition 返 `Err`，前端 useKanbanStream 收到 error 显式 surface（不要静默吞 —— 见 D.x）

### C.3 Invariant scenario

- `kanban-card-state-transitions.json`（已存在，强化）：原 invariant 只断言 op:state 字符串拼接；加上：
  - 调一次合法 transition 走通
  - 调一次非法 transition（done→todo）期望 throw / error event
  - assertion 加 reason / cardId / transitioner_id 精确字段
- `kanban-rejects-illegal-transition.json`（新写）：直接断言非法 transition 抛错
- 修 `assertKanbanEventSequence`（`invariant-assertions.ts:137-162`）让它能查 reason / cardId 字段

---

## Phase D — Harness 强度（绿 = 真覆盖）

### D.1 5 条 stub / dead spec 全部转标准 schema 或删

**当前**：
- `permission-runtime-deny-overrides-thread-grant.json:1-5` —— 只有 `{id, category}`
- `recorded-stream-tool-call-replay.json:1-5` —— 同 stub
- `stream-nonstream-middleware-parity.json:1-5` —— 同 stub
- `completion-verifier-blocks-without-evidence.json` / `long-running-microcompact-triggers.json` / `yolo-80-turn-multi-file-refactor.json` —— 用 `fixture/invariants` 字符串 schema，scenario-runner 不认

**期望**：
- 三条空 stub：要么补全 fixture / invariants 走真 scenario，要么删了在 manifest 里同步删；不允许保留 dead 文件
- 三条 fixture/invariants 字符串 schema：**让 runner 认这种 schema**（在 `scenario-runner.ts` 加一条分支处理 `typeof invariants === 'string'` 走专门 contract test 路径），或迁到标准 schema。二选一，写在 commit message 里说明选了哪个

### D.2 `RecordingToolExecutor.execute` 改可注入

**当前**：`scenario-runner.ts:653-659` 所有工具调用恒返 `{success:true,result:{ok:true}}`。

**期望**：
- scenario JSON 加可选字段 `toolFixtures: Record<string, ToolResultFixture[]>`，按 tool name + 调用顺序索引
- `RecordingToolExecutor.execute(toolName, args)` 查 `toolFixtures[toolName]` 队列，pop 第一条返；队列空或 toolName 不存在则 throw `ToolFixtureMissing(toolName, callIndex)` —— 跟 fake-gateway 同形态
- 现有所有依赖 RecordingToolExecutor 的 scenario 全部补 `toolFixtures` 字段；至少 `permission-ask-approved-blocks-and-then-executes.json`、`skill-create-real-tool-call.json`、`completion-verifier-persists-blocked-status.json` 必须显式给

### D.3 `yolo-mode-skips-boss-chain.json` / `direct-mode-skips-boss-chain.json` 去掉 `expectError` 通过

**当前**：`expectError: "FakeGateway exhausted"` 当通过条件，substring match。

**期望**：见 A.5 已经覆盖。

### D.4 `pm-planner-clears-stale-dispatch-state.json` 去自证

见 A.3 已经覆盖。

### D.5 `mode-kanban-matrix.json` invariants 数组真被读

**当前**：runner 看 category 跳到 `runKanbanMatrixScenario` 跑 hardcoded 3 case。

**期望**：
- 让 invariants 数组真被 evaluate（`scenario-runner.ts` 给 kanban-matrix category 也跑通用 invariants 流程）
- 原 .test.mjs 校的 transition reason / kanban event sequence / origin precedence 全部加回 invariants

### D.6 `soak-runner.ts:171-288 runYoloSoakScenario` 接真 graph

**当前**：完全 mock 内存循环，从未触发真 graph / runtime / LLM；`trace.db` hardcoded 空数组 → leak detector 永远 0。

**期望**：
- 用 `deterministic-runtime` + `fake-gateway` 跑真 yolo graph 80 轮（fake-gateway 的 corpus 要 80 turn 都喂）
- `trace.db` 真采集：拿 RuntimeContext 的 repos 实际 row count 快照
- `summarizeRuntimeLeaks` 必须真能报 leak（构造一个 row 数随轮次线性增长的 case，断言 soak 报 leak）
- 加一条 negative invariant scenario 测 soak 真能炸

### D.7 fake-gateway 强 prompt 匹配

**当前**：19 条 scenario 里只有 `skill-create-real-tool-call.json` 用 `match`，其他 18 条 LLM 回放完全不校 prompt 内容。

**期望**：
- `assertTurnMatch` 默认行为：scenario fixture 没传 `match` 时，**不允许** 跳过；fake-gateway 必须做 prompt fingerprint hash 比对，hash mismatch 报 `prompt-drift`
- 或者对每条 scenario 都补 `match` 字段，约束 prompt contains 的关键 token

### D.8 `replay-gateway` 真用起来

**当前**：19 条 scenario 都不用 replay-gateway，只在 `harness-replay.mjs:34-39` 跑 1-key 自洽。

**期望**：
- 至少把 `recorded-stream-tool-call-replay.json` 和 `stream-nonstream-middleware-parity.json` 改成真用 replay-gateway 的 scenario
- 不然 replay-gateway 这部分代码就是死的，应该删

---

## 5. 文档与 spec 同步

每条 phase 完成后必须同步：
- `openspec/specs/long-running-runtime/spec.md` 加 A.1 / A.2 / A.6 的 Requirement + Scenario
- `openspec/specs/interaction-modes/spec.md` 加 A.5 yolo/direct mode reset 的 Requirement
- `openspec/specs/kanban-data-pipeline/spec.md` 加 C.1 / C.2 状态机白名单 Requirement
- `packages/core/CLAUDE.md` 在 "4 lane" 段落注明 gateway lane 现已暴露 fs/shell（B.1 之后），SDK lane 仍未暴露
- `Docs/04_runtime_experience/EXECUTION_REPORT_2026-04-28.md` 加一节 "2026-04-29 整改 round"，记录每条 finding 是怎么解的、配套 invariant scenario 名字
- 旧 `openspec/changes/2026-04-28-long-running-harness-interaction-modes-kanban-data/` 不动；新 change 不开（这是 fix-only round），所有改动追加进相关 spec capability

---

## 6. 自检（每个 phase commit 之前）

```bash
pnpm --filter @offisim/core typecheck
pnpm --filter @offisim/db-local typecheck
pnpm --filter @offisim/shared-types typecheck
pnpm lint
node scripts/harness-contract.mjs --force-build
node scripts/harness-replay.mjs --force-build
git diff --check
```
全绿才允许 commit。每条 commit 必须：
- 包含 fix + invariant scenario + 必要的 scenario runner 改造
- commit message 至少一行说明"配套 invariant scenario X 验证不变量 Y"
- 每条 fix 一个独立 commit（同一 phase 多条 fix 不要合 commit），方便回滚

---

## 7. RC 真闭环验证（实机 release dmg + Computer Use）

**前置**：所有 phase 跑完 + 整轮 simplification pass + commit 干净。

```bash
pnpm --filter @offisim/desktop build
# 用 release Offisim.app（com.offisim.desktop / tauri://localhost），不是 dev webview
```

逐项 live verify（任何一项不真过，**不准** 打 v1.1.0-rc.1 tag）：

1. **6.4.1 启动 / 公司 / 员工**：release app 启动、公司创建、员工列表 11 个、YOLO Master 可见 — 已绿，回归
2. **6.4.2 真创建文件**：clean direct chat 给 YOLO Master，让其在 project workspace_root 下创建 `verify-2026-04-29.md` 并写 "OK"。Computer Use 截屏 + 物理路径 `ls` 确认文件真在磁盘
3. **6.4.3 真跑命令**：clean direct chat 给 YOLO Master，让其执行 `pwd` 和 `ls -la` 并把输出贴回 chat。Computer Use 截屏确认输出非伪造（cwd 真等于 workspace_root，ls 列表真包含上一步创建的文件）
4. **SOP 真完成**：触发 SOP 跑通 boss → manager → employee → boss_summary，summary 必须包含真 employee 输出，**不**显示 "Task processing complete." 兜底文案
5. **Verifier-block 真显示**：手动制造一个空响应让 verifier block，期望：UI 显示 review_ready、task_runs DB 是 blocked、boss_summary **不**假装 success、PM heartbeat 后续报告 stuck reason='verifier-blocked'
6. **Stale checkpoint 真隔离**：跑完一个 plan 后开新 plan，验证新 plan 第一个 task 看不到旧 thread 的 verifier evidence（用 deterministic-runtime 在 harness 里能直接跑这条 scenario，但实机也要 visual 复测一次）

每项给截图 + 文字记录写进 `EXECUTION_REPORT_2026-04-28.md` 新增的 "2026-04-29 round" 节。

---

## 8. 不允许打 tag 的判定

只要满足下面任一条件，**禁止** `git tag v1.1.0-rc.1`：

- 任何 Phase A-D blocking 任务勾不上
- 实机 6.4.2 / 6.4.3 不能真创建文件 / 真跑命令
- harness contract / replay 任一非绿
- 反 anti-pattern 硬规则任意一条违反（reviewer 会 grep）
- 新 invariant scenario 数量 < phase 任务里要求的 (A.1/A.2/A.3/A.5/A.6/A.7/B.×2/C.×2/D.6/D.7) 共计 ≥ 12 条

---

## 9. 提示

- 上一轮 codex 在我写的 handoff "允许 `node --test`（`*.test.mjs`）" 这条上扩边界扩进了 stateful 测试 —— 这一轮**不允许**新建任何 `packages/core/src/**/*.test.mjs`，所有验证走 harness scenario。
- 每条 fix 完成后 simplification pass（手过一遍 reuse / quality / efficiency / safety 四面），重点检查"有没有又写了 hardcoded ok 兜底"。
- 写 invariant 时如果发现 `assertion 字符串 == LLM mock content`，立刻停手 —— 这就是上一轮的 anti-pattern。
- B 阶段 SDK lane 全工具支持不在本轮范围（量太大，单独后续 round），本轮只覆盖 gateway lane fs/shell 闭环 + sidecar 解禁。

---

**Codex 入口**：
```bash
cd /Users/haoshengli/Seafile/WebWorkSpace/Offisim && cat Docs/04_runtime_experience/CODEX_REMEDIATION_2026-04-29.md && echo "===previous handoff===" && cat Docs/04_runtime_experience/CODEX_HANDOFF_2026-04-28.md && echo "===execution report===" && cat Docs/04_runtime_experience/EXECUTION_REPORT_2026-04-28.md && echo "===CLAUDE.md ===" && cat CLAUDE.md && echo "===core CLAUDE.md===" && cat packages/core/CLAUDE.md
```
