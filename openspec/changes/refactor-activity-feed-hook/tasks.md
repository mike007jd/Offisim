## 1. Scaffolding

- [ ] 1.1 创建 `packages/ui-office/src/runtime/activity-feed/` + `mappers/` 子目录 + 14 空文件
- [ ] 1.2 基线：`wc -l use-runtime-activity-feed.ts`（790） + `grep -c 'eventBus.on'` + mapper 清单对照

## 2. 抽 `useActivityRingBuffer`

- [ ] 2.1 `runtime/activity-feed/useActivityRingBuffer.ts`：`{ entries, push, clear }` + FIFO 容量截断
- [ ] 2.2 默认 capacity 200 对齐既有行为
- [ ] 2.3 全仓 `useState<RuntimeActivityEntry\\[\\]>` grep 只在此文件

## 3. 拆 13 个 mapper 文件

- [ ] 3.1 `mappers/task-mappers.ts`（task.assignment / task.state / task.subtask）
- [ ] 3.2 `mappers/graph-mappers.ts`（graph.node.entered / exited）
- [ ] 3.3 `mappers/llm-mappers.ts`（llm.call.started / completed / stream.chunk filtered）
- [ ] 3.4 `mappers/interaction-mappers.ts`（interaction.requested / resolved / restored / mode.changed）
- [ ] 3.5 `mappers/handoff-mappers.ts`（handoff.initiated / completed）
- [ ] 3.6 `mappers/memory-mappers.ts`（memory.created / memory.reflection.completed）
- [ ] 3.7 `mappers/deliverable-mappers.ts`（deliverable.created）
- [ ] 3.8 `mappers/workspace-mappers.ts`（workspace.staleness / git.auto.committed / knowledge.index）
- [ ] 3.9 `mappers/conversation-budget-mappers.ts`（synopsis.updated / compact.completed）
- [ ] 3.10 `mappers/execution-mappers.ts`（execution.resumed / error.occurred）
- [ ] 3.11 `mappers/plan-mappers.ts`（plan.created / plan.step.completed）
- [ ] 3.12 `mappers/tool-mappers.ts`（tool.execution.telemetry / mcp.tool.called）
- [ ] 3.13 `mappers/cost-mappers.ts`（session.cost.updated / hr.recommendation）
- [ ] 3.14 所有 mapper 签名统一 `subscribeXMappers(eventBus, { push }): () => unsubscribe`

## 4. Barrel 瘦身

- [ ] 4.1 `use-runtime-activity-feed.ts` 改成：调 `useActivityRingBuffer` → useEffect 装配 13 mapper → cleanup 反序 → return `{ entries, clear }`
- [ ] 4.2 删除原 useEffect 里的 20+ eventBus.on 和 payload→entry 映射
- [ ] 4.3 ≤ 180 NBNC gate
- [ ] 4.4 barrel grep `eventBus.on` 零匹配

## 5. Verification: typecheck + build

- [ ] 5.1 shared-types → ui-core → core → ui-office → web 串行 build 全绿
- [ ] 5.2 `pnpm typecheck` 绿

## 6. Verification: spec gates

- [ ] 6.1 `ls mappers/*.ts` 正好 13 文件
- [ ] 6.2 cross-mapper import 零匹配

## 7. Live runtime verification

- [ ] 7.1 dev server 起，Activity workspace 打开空列表
- [ ] 7.2 发一轮 task 产出 deliverable；观察 feed 依次出现 graph.node.entered / plan.created / task.assignment.dispatched / tool telemetry / deliverable.created / boss_summary / llm.call.completed 对应 entries
- [ ] 7.3 每 entry tone / title / detail 与重构前对齐（凭 baseline 截图）
- [ ] 7.4 capacity 测试：手动（临时调 capacity=5）或多轮任务堆 300+ entry，验证 ring buffer 截断正确
- [ ] 7.5 观察记录到 `verify-notes.md`

## 8. 最终 gate

- [ ] 8.1 `openspec validate refactor-activity-feed-hook --strict` 绿
- [ ] 8.2 通知用户等 `/opsx:archive`
