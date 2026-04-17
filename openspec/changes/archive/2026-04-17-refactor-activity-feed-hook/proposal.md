## Why

`packages/ui-office/src/runtime/use-runtime-activity-feed.ts` 790 行单 hook 聚合 20+ event 订阅：task / graph / llm / interaction / handoff / memory / deliverable / workspace / conversation-budget / tool-telemetry / error / execution / git / knowledge-index / session-cost / plan-step。每种 event payload 都需要 map 成 `RuntimeActivityEntry`（tone + title + detail + timestamp），map 逻辑堆在一个 useEffect 里，扩展新 event type 要改整个 hook。与 `useCeremonyEventBindings` 原 935 行的"跨层事件拼装"结构性问题同构——按 event prefix 拆成 single-responsibility mapper 是唯一可持续路径。

## What Changes

- **Thin barrel**: `use-runtime-activity-feed.ts` 压到 ≤ 180 NBNC，只做：接 opts → 调 ring-buffer hook → 装配 mapper 订阅 → return entries。
- **Ring-buffer hook**: `runtime/activity-feed/useActivityRingBuffer.ts` — 固定容量（默认 200）FIFO ring、`push(entry)` / `clear()` / `entries` 暴露。
- **Mapper 模块** (`runtime/activity-feed/mappers/` 子目录，按 event prefix 一事一文件)：
  - `task-mappers.ts` — `task.assignment.dispatched` / `task.state.changed` / `task.subtask.progress`
  - `graph-mappers.ts` — `graph.node.entered` / `graph.node.exited`
  - `llm-mappers.ts` — `llm.call.started` / `llm.call.completed` / `llm.stream.chunk`（选择性过滤）
  - `interaction-mappers.ts` — `interaction.requested` / `interaction.resolved` / `interaction.restored` / `interaction.mode.changed`
  - `handoff-mappers.ts` — `handoff.initiated` / `handoff.completed`
  - `memory-mappers.ts` — `memory.created` / `memory.reflection.completed`
  - `deliverable-mappers.ts` — `deliverable.created`
  - `workspace-mappers.ts` — `workspace.staleness.detected` / `git.auto.committed` / `knowledge.index.completed`
  - `conversation-budget-mappers.ts` — `conversation.synopsis.updated` / `conversation.compact.completed`
  - `execution-mappers.ts` — `execution.resumed` / `error.occurred`
  - `plan-mappers.ts` — `plan.created` / `plan.step.completed`
  - `tool-mappers.ts` — `tool.execution.telemetry` / `mcp.tool.called`
  - `cost-mappers.ts` — `session.cost.updated` / `hr.recommendation`
- **Mapper 函数签名**: 每个 mapper 导出 `subscribeXMappers(eventBus, { push }): () => unsubscribe`，类似 ceremony event-handlers 模式。
- **可观测行为不变**：activity feed 里的 entry 序列、tone 分色、title / detail 文本、时间戳、ring buffer 容量行为 byte-identical。

## Capabilities

### New Capabilities

- `activity-feed-composition`

### Modified Capabilities

（无）

## Impact

- **目录新增**：`packages/ui-office/src/runtime/activity-feed/{useActivityRingBuffer.ts, mappers/<13 files>.ts}`
- **文件重写**：`use-runtime-activity-feed.ts` 790 → ≤ 180
- **消费者无改动**：`useRuntimeActivityFeed(opts)` hook 签名 + return 类型不变，`ActivityLogPage` 和 `ActivityRail` 等消费者 0 修改
- **验证**：live runtime 跑一轮任务，对比 activity feed 里 entry 序列与重构前对齐；覆盖 20+ event type 的至少 10 种
- **无依赖升级 / 无 API 断裂 / 无 DB migration**
