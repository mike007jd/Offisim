## 1. Pre-refactor live baseline

- [~] 1.1 Pre-capture skipped (Option B) — B1 live post 捕获作替代,见 live-verification-report.md §B1
- [~] 1.2 Pre-capture skipped (Option B) — B2 live post 走了 pm_planner 短路 (非 refactor 相关),static walk-through 覆盖 deliverable 场景
- [~] 1.3 ~~尝试 trigger handoff~~ — **skipped (Option B)**, static walk-through in §13.2
- [x] 1.4 抓 `/tmp/employee-node-pre-source-stats.json`：line count（`wc -l` + `grep -cvE`）、importer list、export 符号 list，作为 post 阶段比对基准 — captured into `baseline-notes.md`
- [x] 1.5 commit baseline 文件 metadata 到 `openspec/changes/refactor-employee-node/baseline-notes.md`

## 2. Phase A — 提常量到独立模块

- [x] 2.1 新建 `packages/core/src/agents/employee-node-constants.ts`，5 个常量集中 export
- [x] 2.2 `employee-node.ts` 改为 import,删除原行 47/51/54/56/470 处声明
- [x] 2.3 typecheck + build 双绿，commit Phase A

## 3. Phase B — 抽 employee-preflight.ts

- [x] 3.1 新建 `employee-preflight.ts`,定义 `PreflightResult` type
- [x] 3.2 实现 `runPreflight(state, runtimeCtx)` 搬迁 preflight 行为,discriminated union early-return
- [x] 3.3 barrel 改为调用 `runPreflight`,删除同等代码 + 3 个 dead helper
- [x] 3.4 typecheck + build 双绿,commit Phase B

## 4. Phase C — 抽 employee-prompt-assembly.ts

- [x] 4.1 新建 `employee-prompt-assembly.ts`,搬迁 5 个 skill helper
- [x] 4.2 实现 `assemblePrompt(preflight, runtimeCtx)`,返回 { systemPrompt, citationMap, runtimeSkill }
- [x] 4.3 barrel 改为调用 `assemblePrompt`,删除 helper + 拼装代码
- [x] 4.4 grep 验证无第三方 importer (只 prompt-assembly + preflight 自用)
- [x] 4.5 typecheck + build 双绿,commit Phase C

## 5. Phase D — 抽 employee-tool-kit.ts

- [x] 5.1 新建 `employee-tool-kit.ts`,搬迁 `buildSkillActivationTool`
- [x] 5.2 实现 `assembleToolKit(preflight, runtimeCtx, state)` 搬迁工具拼装,返回 ToolKit
- [x] 5.3 barrel 改为调用 `assembleToolKit`,删除拼装代码
- [x] 5.4 typecheck + build 双绿,commit Phase D

## 6. Phase E — 抽 employee-turn-runner.ts

- [x] 6.1 新建 `employee-turn-runner.ts`,buildTurnRunner factory 搬迁 closure
- [x] 6.2 严格保留 if-if (非 if-else) chunk emit 顺序 (reasoning → default)
- [x] 6.3 barrel 改为 `const runEmployeeTurn = buildTurnRunner(...)`
- [x] 6.4 typecheck + build 双绿,commit Phase E

## 7. Phase F — 抽 employee-tool-round.ts

- [x] 7.1 新建 `employee-tool-round.ts`,定义 ToolRoundOutcome 联合
- [x] 7.2 runToolRound 搬迁循环体,handoff 命中只返回 args 零 side-effect
- [x] 7.3 保留 WORKSTATION_ACCESS_DENIED 短路 / failed tool fallback / MAX_CONTEXT_MESSAGES trim
- [x] 7.4 barrel while loop 改为 runToolRound + executeHandoff dispatch
- [x] 7.5 barrel 实现 executeHandoff(args, ctx),target missing 返 null
- [x] 7.6 typecheck + build 双绿,commit Phase F

## 8. Phase G — 抽 employee-completion.ts

- [x] 8.1 新建 `employee-completion.ts`
- [x] 8.2 `extractUsedCitations` 搬入,barrel re-export
- [x] 8.3 实现 `finalizeEmployeeSuccess(ctx)` 搬迁 happy path 完成路径
- [x] 8.4 appendAgentEvent payload 按 source 分支 (normal: toolRounds/citationCount; recovery: recoveredFromError)
- [x] 8.5 hookRegistry.emit completionType 按 source 分支 (normal: response; recovery: recovery)
- [x] 8.6 barrel happy path 改为 `return await finalizeEmployeeSuccess(...)`
- [x] 8.7 typecheck + build 双绿,commit Phase G

## 9. Phase H — recovery path 复用 finalizeEmployeeSuccess

- [x] 9.1 catch 块 recovered 分支折叠为 finalizeEmployeeSuccess({ source: 'recovery', round })
- [x] 9.2 grep recoveredFromError = 1 处 (在 completion.ts) ✓
- [x] 9.3 grep materializeFileDeliverableIfNeeded employee-* 内仅 1 次调用 (在 completion.ts) ✓
- [x] 9.4 typecheck + build 双绿,commit Phase H

## 10. Phase I — 抽 employee-error-finalize.ts + barrel 收尾

- [x] 10.1 新建 `employee-error-finalize.ts`,实现 `finalizeEmployeeFailure(ctx)`,结构化错误 8 字段保留
- [x] 10.2 barrel catch 末段改为 `return finalizeEmployeeFailure(...)`
- [x] 10.3 barrel NBNC = 137 ≤ 200 ✓
- [x] 10.4 每个模块 NBNC ≤ 250 ✓ (max completion 247)
- [x] 10.5 grep 验证 5 个常量各恰好 1 次 declaration ✓
- [x] 10.6 typecheck + build 双绿,commit Phase I
- [x] **scope addition**: 新建 `employee-handoff.ts` (108 NBNC) 让 barrel 命中 ≤200 gate (原 design 把 executeHandoff 留 barrel → NBNC 238 超 gate; Phase I 抽出)

## 11. Repo 级验证 gate

- [x] 11.1 Serial build shared-types → ui-core → core → ui-office → web,全绿
- [x] 11.2 pnpm typecheck 全仓绿 (26/26 tasks)
- [x] 11.3 我们 10 个新/改文件 lint 0 errors (其它 57 errors 是 pre-existing 与本 refactor 无关)
- [x] 11.4 子模块只 import `./employee-node-constants.js`,无内部循环依赖
- [x] 11.5 Callers (index.ts:332 + main-graph.ts:8) zero-modify ✓

## 12. Live post-refactor verification

- [x] 12.1 Chrome DevTools MCP live 跑 "Write a haiku about testing" — 28 event employee-node slice 全对齐 spec,见 report §B1
- [x] 12.2 Live 跑 "create snake.html game" — pm_planner 短路 (pre-existing routing 行为,非 refactor 引起),见 report §B2
- [~] 12.3 handoff skipped (1.3 未跑)
- [x] 12.4 No pre/post diff (Option B) — 直接对齐 spec invariants,34/34 scenarios 覆盖
- [x] 12.5 No mismatch observed

## 13. Static fallback walk-through（for paths live 不能稳定覆盖）

- [x] 13.1 错误 path 静态等价核查 → `live-verification-report.md` §A1
- [x] 13.2 handoff path 静态等价核查 → `live-verification-report.md` §A2

## 14. Commit + Archive

- [~] 14.1 不 squash,保留 11 个 phase commit (proposal → A-I → gate → verification report → live) 供 reviewer 回溯
- [~] 14.2 参见 live-verification-report.md §D+§E 的 phase commit timeline + NBNC 表
- [x] 14.3 archive + canonical spec sync
- [x] 14.4 queue file 更新
- [x] 14.5 D4 prompt
