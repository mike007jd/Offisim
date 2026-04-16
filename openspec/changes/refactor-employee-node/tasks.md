## 1. Pre-refactor live baseline

- [ ] 1.1 启动 web dev (`cd apps/web && pnpm dev`)，跑一个 normal 任务（例："Write a haiku about testing"），用 Playwright snapshot 抓全 EventBus timeline 到 `/tmp/employee-node-pre-normal.json`：含 `graph.node.entered` / `employee.state.changed` / `task.state.changed` / `task.subtask.progress` / `llm.stream.chunk(reasoning|content)` / `task.assignment.changed` / 可选 `deliverable.created` 的有序数组（payload 关键 key 保留，`event_id` / `created_at` / `task_run_id` / `thread_id` 等 UUID/timestamp normalize 成占位符 `<uuid:N>` / `<ts:N>`）
- [ ] 1.2 跑一个 file-deliverable 任务（例："create snake.html game"），同样抓到 `/tmp/employee-node-pre-tool.json`，确认 `deliverable.created` 有出现
- [ ] 1.3 尝试 trigger handoff（chat prompt 直白要求"hand this off to <colleague name>"）；若能稳定 trigger 抓到 `/tmp/employee-node-pre-handoff.json`，否则在该文件写 `{"unable_to_trigger_live": true, "fallback": "static walk-through in step 8.x"}` 占位
- [ ] 1.4 抓 `/tmp/employee-node-pre-source-stats.json`：line count（`wc -l` + `grep -cvE`）、importer list（`grep -rn employee-node packages/core apps/web`）、export 符号 list（`grep -nE '^export ' packages/core/src/agents/employee-node.ts`），作为 post 阶段比对基准
- [ ] 1.5 commit baseline 文件 metadata 到 `openspec/changes/refactor-employee-node/baseline-notes.md`（pre 文件本体 stay in /tmp，不入库；只记录文件指纹与执行时间）

## 2. Phase A — 提常量到独立模块

- [ ] 2.1 新建 `packages/core/src/agents/employee-node-constants.ts`，把 `MAX_HANDOFF_COUNT`(3) / `MAX_CONTEXT_MESSAGES`(20) / `TASK_TYPE_HANDOFF_CONTINUATION`('handoff_continuation') / `SKILL_TOOL_NAME`('activate_skill_context') / `MAX_TOOL_ROUNDS`(5) 5 个常量集中 export
- [ ] 2.2 `employee-node.ts` 改为 `import { ... } from './employee-node-constants.js'`，删除原行 47/51/54/56/470 处声明
- [ ] 2.3 typecheck `pnpm --filter @offisim/core typecheck`、build `pnpm --filter @offisim/core build` 双绿，commit "Phase A: extract employee-node constants"

## 3. Phase B — 抽 employee-preflight.ts

- [ ] 3.1 新建 `packages/core/src/agents/employee-preflight.ts`，定义 `PreflightResult` type（含 `assignment / remaining / employee / company / taskRunId / taskLabel / totalAssignments / completedSoFar / isDirectChatTask / resolved / taskDescription / requiredSkills / runtimeSkill / memoryPolicy / toolSearchEnabled` 字段）
- [ ] 3.2 实现 `runPreflight(state, runtimeCtx, config)` 把原 line 176-290 行为搬迁；no-assignment / employee-deleted 两个 early-return 用 discriminated union `{ kind: 'early-return', stateUpdate } | { kind: 'continue', preflight: PreflightResult }` 表达
- [ ] 3.3 `employee-node.ts` 改为调用 `runPreflight`，删除原 line 176-290 同等代码
- [ ] 3.4 typecheck + build 双绿；commit "Phase B: extract employee-preflight"

## 4. Phase C — 抽 employee-prompt-assembly.ts

- [ ] 4.1 新建 `packages/core/src/agents/employee-prompt-assembly.ts`，搬迁 `parseRuntimeSkillConfig` / `normalizeSkillText` / `taskHasSkillMismatch` / `formatSkillCatalogSection` / `formatSkillInstructionsSection` 5 个 helper（原 line 58-125）
- [ ] 4.2 在同模块定义 `assemblePrompt(preflight, runtimeCtx)` 把原 line 277-343 prompt 拼装搬来；返回 `{ systemPrompt, citationMap, runtimeSkill }`；保留 try/catch 包裹 LibraryService.getRelevantSnippetsWithCitations 与 memoryService.getRelevantMemories 失败的 silent-skip 行为
- [ ] 4.3 `employee-node.ts` 改为调用 `assemblePrompt`，删除原 helper 与 prompt 拼装代码段
- [ ] 4.4 grep 全仓 `parseRuntimeSkillConfig|formatSkillCatalogSection|formatSkillInstructionsSection|taskHasSkillMismatch|normalizeSkillText` 确保没有第三方 importer（除新模块自己）；若 employee-direct-setup-node.ts 也用到要补 import
- [ ] 4.5 typecheck + build 双绿；commit "Phase C: extract employee-prompt-assembly"

## 5. Phase D — 抽 employee-tool-kit.ts

- [ ] 5.1 新建 `packages/core/src/agents/employee-tool-kit.ts`，搬迁 `buildSkillActivationTool`（原 line 127-143），引用 `SKILL_TOOL_NAME` from constants
- [ ] 5.2 实现 `assembleToolKit(preflight, runtimeCtx)` 把原 line 346-391 工具组装搬来；handoff_to tool 的 colleagues lookup（`repos.employees.findByCompany(companyId)`）也搬入；返回 `{ virtualTools, mcpTools, allTools, allowedMcpToolNames }`
- [ ] 5.3 `employee-node.ts` 改为调用 `assembleToolKit`，删除原工具组装代码
- [ ] 5.4 typecheck + build 双绿；commit "Phase D: extract employee-tool-kit"

## 6. Phase E — 抽 employee-turn-runner.ts

- [ ] 6.1 新建 `packages/core/src/agents/employee-turn-runner.ts`，定义 `buildTurnRunner({ runtimeCtx, state, resolved, allTools, config, streamEnabled })` 把原 line 393-450 closure 搬迁为 free function；保留 stream / non-stream 双分支
- [ ] 6.2 严格保证 `chunk.reasoning` → emit reasoning kind、`chunk.content` → emit default kind 的 if-if（不是 if-else）顺序
- [ ] 6.3 `employee-node.ts` 改为 `const runTurn = buildTurnRunner(...)`
- [ ] 6.4 typecheck + build 双绿；commit "Phase E: extract employee-turn-runner"

## 7. Phase F — 抽 employee-tool-round.ts

- [ ] 7.1 新建 `packages/core/src/agents/employee-tool-round.ts`，定义 `ToolRoundOutcome = { kind: 'handoff', args: HandoffArgs } | { kind: 'continue', nextHistory: LlmMessage[] }`
- [ ] 7.2 实现 `runToolRound(llmResponse, ctx)` 把原 line 477-705 的 handoff 检测 + parallel `Promise.allSettled` 工具执行 + tool result unwrap + history append + trim 全部搬入；handoff 检测命中只返回 `{ kind: 'handoff', args }` 不做任何 side effect
- [ ] 7.3 保留：(a) `WORKSTATION_ACCESS_DENIED` 短路（`workstationToolResolver && !allowedMcpToolNames.has(name)`）；(b) failed tool 的 fallback `Tool execution failed: <msg>`；(c) `MAX_CONTEXT_MESSAGES` trim 阈值（保 first message + 最后 20 条）
- [ ] 7.4 `employee-node.ts` 把 while loop 改为 `while (...) { const r = await runToolRound(llmResponse, ctx); if (r.kind === 'handoff') return await executeHandoff(r.args, ctx); conversationHistory = r.nextHistory; llmResponse = await runTurn(conversationHistory, { taskRunId }); }`
- [ ] 7.5 在 barrel 内实现 `executeHandoff(args, ctx)` 行为同原 line 486-595 — 写 handoffs / 创建 newTaskRunId / mark current taskRun completed / hookRegistry.emit task.completed completionType: 'handoff' / emit handoffInitiated + employeeStateChanged / 返回 `new Command({ goto: 'employee', update: {...} })`
- [ ] 7.6 typecheck + build 双绿；commit "Phase F: extract employee-tool-round, keep handoff in barrel"

## 8. Phase G — 抽 employee-completion.ts

- [ ] 8.1 新建 `packages/core/src/agents/employee-completion.ts`
- [ ] 8.2 把 `extractUsedCitations`（原 line 150-170）搬入；barrel 改为 `export { extractUsedCitations } from './employee-completion.js'`
- [ ] 8.3 实现 `finalizeEmployeeSuccess(ctx)`：搬迁原 line 712-888 happy path 完成路径；ctx 字段对照 design.md D3
- [ ] 8.4 `appendAgentEvent` payload 通过 `ctx.source` 分支：`'normal'` → `{ taskRunId, employeeName, toolRounds: ctx.round, outputLength, citationCount }`；`'recovery'` → `{ taskRunId, employeeName, recoveredFromError: true, outputLength }`
- [ ] 8.5 `hookRegistry.emit('task.completed', { ..., completionType })`：normal → `'response'`；recovery → `'recovery'`
- [ ] 8.6 `employee-node.ts` happy path 末段改为 `return await finalizeEmployeeSuccess({ ...ctx, source: 'normal', round })`
- [ ] 8.7 typecheck + build 双绿；commit "Phase G: extract employee-completion shared between happy and recovery paths"

## 9. Phase H — recovery path 复用 finalizeEmployeeSuccess

- [ ] 9.1 `employee-node.ts` catch 块的 recovered 分支（原 line 904-1042）改为 `if (recovered) return await finalizeEmployeeSuccess({ ...ctx, llmResponse: recovered, source: 'recovery', round })`，删除 ~130 行重复代码
- [ ] 9.2 grep `recoveredFromError` 在 finalize 内只有 1 处出现（原代码有 2 处，post-refactor 应只剩 finalize 内一处）
- [ ] 9.3 grep `materializeFileDeliverableIfNeeded` 在 employee-* 文件中只在 completion 模块内调用 1 次（原 happy path + recovery 各一次共 2 次）
- [ ] 9.4 typecheck + build 双绿；commit "Phase H: recovery path reuses finalizeEmployeeSuccess"

## 10. Phase I — 抽 employee-error-finalize.ts + barrel 收尾

- [ ] 10.1 新建 `packages/core/src/agents/employee-error-finalize.ts`，实现 `finalizeEmployeeFailure(ctx)` 搬迁原 line 1045-1124 错误路径；保留结构化错误 JSON schema 8 字段（`errorCode / message / recoverable / nodeName / employeeId / taskRunId / provider / model`）
- [ ] 10.2 `employee-node.ts` catch 末段改为 `return finalizeEmployeeFailure({ ...ctx, errorMessage })`
- [ ] 10.3 验证 barrel `grep -cvE '^\s*(//|$|/\*|\*)' packages/core/src/agents/employee-node.ts` ≤ 200
- [ ] 10.4 验证每个新模块 `grep -cvE '^\s*(//|$|/\*|\*)' packages/core/src/agents/employee-{preflight,prompt-assembly,tool-kit,turn-runner,tool-round,completion,error-finalize,node-constants}.ts` ≤ 250
- [ ] 10.5 grep `^const MAX_HANDOFF_COUNT|^const MAX_CONTEXT_MESSAGES|^const TASK_TYPE_HANDOFF_CONTINUATION|^const SKILL_TOOL_NAME|^const MAX_TOOL_ROUNDS` packages/core/src 下每个常量恰好 1 次匹配
- [ ] 10.6 typecheck + build 双绿；commit "Phase I: extract employee-error-finalize, barrel shrunk to <=200 NBNC lines"

## 11. Repo 级验证 gate

- [ ] 11.1 严格按依赖序列跑 `pnpm --filter @offisim/shared-types build && pnpm --filter @offisim/ui-core build && pnpm --filter @offisim/core build && pnpm --filter @offisim/ui-office build && pnpm --filter @offisim/web build`
- [ ] 11.2 `pnpm typecheck` 全仓绿
- [ ] 11.3 `pnpm lint` 全仓绿（如 Biome 报 `import type` / 排序问题，跑 `pnpm lint:fix` 后再 typecheck）
- [ ] 11.4 grep `from '../agents/employee-node` in `packages/core` 与 `from './employee-node` in `packages/core/src/agents` 都不应有除 barrel 之外的内部循环依赖
- [ ] 11.5 grep `import.*employeeNode|import.*extractUsedCitations` 验证 callers（`packages/core/src/index.ts` / `packages/core/src/graph/main-graph.ts`）零修改

## 12. Live post-refactor verification

- [ ] 12.1 重启 web dev，跑 step 1.1 同 prompt 的 normal task，抓 `/tmp/employee-node-post-normal.json`
- [ ] 12.2 跑 step 1.2 同 prompt 的 file-deliverable task，抓 `/tmp/employee-node-post-tool.json`
- [ ] 12.3 若 1.3 抓到了 handoff baseline，重复一次抓 `/tmp/employee-node-post-handoff.json`；否则跳过
- [ ] 12.4 对每对 pre/post JSON 做 normalize-and-diff（jq 排序、UUID/timestamp 替换占位符）；要求 event 序列、event 类型、payload 顶层 key 完全一致；diff 报告写入 `openspec/changes/refactor-employee-node/live-verification-report.md`
- [ ] 12.5 若有任何 mismatch 立即 fix → 回到 phase 重做对应 phase；不允许"差一点但 fix 在 follow-up"

## 13. Static fallback walk-through（for paths live 不能稳定覆盖）

- [ ] 13.1 错误 path（无法稳定 live trigger）：在 `live-verification-report.md` 里逐行对照 `employee-error-finalize.ts` 与原 line 1045-1124 的 4 条 emit 顺序与参数；结构化错误 JSON 8 字段 schema 一致；明确标注"error path 仅静态等价核查"
- [ ] 13.2 若 1.3 没成功抓 handoff baseline：同样在 report 里逐行对照 `executeHandoff` 与原 line 486-595，覆盖 5 个步骤（findById / handoff create / new TaskRun create / mark current taskRun completed / emit + Command 构造）

## 14. Commit + Archive

- [ ] 14.1 final commit：把所有 phase commit squash 成一个 `refactor(core): split employee-node into single-responsibility modules`（或保留 phase commits 视 reviewer 偏好）
- [ ] 14.2 commit message body 列出 8 个模块 + 行数变化（1126 → barrel ≤200 + 8 模块）
- [ ] 14.3 用户 sign-off live verification report 后，跑 `/opsx:archive refactor-employee-node`，sync canonical spec 到 `openspec/specs/employee-node-boundaries/spec.md`
- [ ] 14.4 archive 后立即更新 `~/.claude/projects/-Users-haoshengli-Seafile-WebWorkSpace-Offisim/memory/project_next_change_queue.md` 的 D3 status → `[x] archived` + 补 archive commit SHA + scope anchor + 完整 completion log（参考 D2 体例）
- [ ] 14.5 主动提示用户："下一个 queued 条目是 D4（repo triple-copies）。要现在 /opsx:propose 吗？"
