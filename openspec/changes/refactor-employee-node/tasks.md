## 1. Pre-refactor live baseline

- [~] 1.1 ~~启动 web dev~~ — **skipped (Option B)**, post-only verification per `baseline-notes.md`
- [~] 1.2 ~~跑一个 file-deliverable 任务~~ — **skipped (Option B)**
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

- [ ] 12.1 重启 web dev，跑 step 1.1 同 prompt 的 normal task，抓 `/tmp/employee-node-post-normal.json`
- [ ] 12.2 跑 step 1.2 同 prompt 的 file-deliverable task，抓 `/tmp/employee-node-post-tool.json`
- [ ] 12.3 若 1.3 抓到了 handoff baseline，重复一次抓 `/tmp/employee-node-post-handoff.json`；否则跳过
- [ ] 12.4 对每对 pre/post JSON 做 normalize-and-diff（jq 排序、UUID/timestamp 替换占位符）；要求 event 序列、event 类型、payload 顶层 key 完全一致；diff 报告写入 `openspec/changes/refactor-employee-node/live-verification-report.md`
- [ ] 12.5 若有任何 mismatch 立即 fix → 回到 phase 重做对应 phase；不允许"差一点但 fix 在 follow-up"

## 13. Static fallback walk-through（for paths live 不能稳定覆盖）

- [x] 13.1 错误 path 静态等价核查 → `live-verification-report.md` §A1
- [x] 13.2 handoff path 静态等价核查 → `live-verification-report.md` §A2

## 14. Commit + Archive

- [ ] 14.1 final commit：把所有 phase commit squash 成一个 `refactor(core): split employee-node into single-responsibility modules`（或保留 phase commits 视 reviewer 偏好）
- [ ] 14.2 commit message body 列出 8 个模块 + 行数变化（1126 → barrel ≤200 + 8 模块）
- [ ] 14.3 用户 sign-off live verification report 后，跑 `/opsx:archive refactor-employee-node`，sync canonical spec 到 `openspec/specs/employee-node-boundaries/spec.md`
- [ ] 14.4 archive 后立即更新 `~/.claude/projects/-Users-haoshengli-Seafile-WebWorkSpace-Offisim/memory/project_next_change_queue.md` 的 D3 status → `[x] archived` + 补 archive commit SHA + scope anchor + 完整 completion log（参考 D2 体例）
- [ ] 14.5 主动提示用户："下一个 queued 条目是 D4（repo triple-copies）。要现在 /opsx:propose 吗？"
