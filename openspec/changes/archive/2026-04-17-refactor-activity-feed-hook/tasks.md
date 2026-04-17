## 1. Scaffolding

- [x] 1.1 创建 `packages/ui-office/src/runtime/activity-feed/` + `mappers/` 子目录 + types/ring-buffer/13 mapper 文件
- [x] 1.2 基线：`wc -l use-runtime-activity-feed.ts`（790）+ eventBus.on 分布 + mapper 清单对照

## 2. 抽 `useActivityRingBuffer`

- [x] 2.1 `runtime/activity-feed/useActivityRingBuffer.ts`：`{ entries, push, clear }` + FIFO 容量截断 + tool burst merge 保留
- [x] 2.2 默认 capacity = 6 对齐既有行为（proposal/tasks 写的 200 不符合 pre-change 代码实际，按代码走）
- [x] 2.3 全仓 `useState<RuntimeActivityEntry\[\]>` 只在此文件 ✓

## 3. 拆 13 个 mapper 文件

- [x] 3.1 `mappers/task-mappers.ts`（task.assignment.dispatched）
- [x] 3.2 `mappers/graph-mappers.ts`（graph.node.entered / exited）
- [x] 3.3 `mappers/llm-mappers.ts`（llm.call.started / completed）
- [x] 3.4 `mappers/interaction-mappers.ts`（requested / resolved / restored / mode.changed）
- [x] 3.5 `mappers/handoff-mappers.ts`（handoff.initiated）
- [x] 3.6 `mappers/memory-mappers.ts`（memory.created）
- [x] 3.7 `mappers/deliverable-mappers.ts`（deliverable.created）
- [x] 3.8 `mappers/workspace-mappers.ts`（workspace.staleness / git.auto.committed / knowledge.index.completed）
- [x] 3.9 `mappers/conversation-budget-mappers.ts`（synopsis.updated / compact.completed）
- [x] 3.10 `mappers/execution-mappers.ts`（execution.resumed / error.occurred）
- [x] 3.11 `mappers/plan-mappers.ts`（plan.created / plan.step.completed）
- [x] 3.12 `mappers/tool-mappers.ts`（tool.execution.telemetry / mcp.tool.called）
- [x] 3.13 `mappers/cost-mappers.ts`（cost.session.updated / hr.recommendation）
- [x] 3.14 签名统一 `subscribeXMappers(eventBus, sink): () => unsubscribe`；sink = `ActivityMapperSink`（push + setHeadline + setTotalCostUsd + trackLlm{Start,End} + readActiveLlmModel + trackTool{Start,End}），barrel 通过 useMemo 稳定提供

## 4. Barrel 瘦身

- [x] 4.1 `use-runtime-activity-feed.ts` 改成：ring-buffer hook 调用 + sink useMemo + 13 `subscribe*` 装配 + reset-on-isRunning + tick timer + activeTools/headline useMemo + return 5-field shape
- [x] 4.2 删除原 useEffect 里的 20+ eventBus.on 和 payload→entry 映射 ✓
- [x] 4.3 NBNC = 176 ≤ 180 gate ✓
- [x] 4.4 barrel grep `eventBus.on` 零匹配 ✓

## 5. Verification: typecheck + build

- [x] 5.1 shared-types → ui-core → core → ui-office → web 串行 build 全绿
- [x] 5.2 `pnpm typecheck` 26/26 绿

## 6. Verification: spec gates

- [x] 6.1 `ls mappers/*.ts` 正好 13 文件 ✓
- [x] 6.2 cross-mapper import 零匹配（各 mapper 只 import `../activity-types` + runtime-activity-formatters + lib helper）

## 7. Live runtime verification

- [x] 7.1 dev server 冷启动，Chat workspace 打开，activity rail 显示 "Boss analyzing" 初态
- [x] 7.2 发 "Write a haiku about morning coffee" → Boss 走 delegate_manager 全链（analyze → route → plan → dispatch → execute → report → deliver）；headline 随 graph.node.entered 推进；rail 产出 "X finished" / "Step N completed" / "X completed call" 等 entries（DOM 文本匹配通过）
- [x] 7.3 tone 分色 + title 文本与重构前一致
- [x] 7.4 capacity 行为保留（ring buffer maxEntries 默认 6，applyPush 代码 byte-identical 搬自旧 pushEntry）
- [x] 7.5 观察记录到 `verify-notes.md`

## 8. 最终 gate

- [x] 8.1 `openspec validate refactor-activity-feed-hook --strict` 绿
- [x] 8.2 通知用户等 `/opsx:archive`
