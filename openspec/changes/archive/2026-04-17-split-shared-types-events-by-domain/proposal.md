## Why

`packages/shared-types/src/events.ts` 690 行聚合了全仓所有 event payload interface（conversation / employee / task / meeting / llm / graph / interaction / handoff / workspace / execution / deliverable / boss-route / tool / memory / session-cost / plan / hr / mcp / notification / session 等 20+ type family）。单文件每次加新事件就得 scroll 几百行找"插入点"；review 新 event 也要一口气吞 690 行。和 D 系列热点不同，这不是"一个组件吃多职责"而是"一个 types module 吃多 domain"——结构性成本偏中等但持续累积。

## What Changes

- **按 domain 拆分文件**（`packages/shared-types/src/events/` 子目录，index re-export）：
  - `events/core.ts` — `RuntimeEvent<P>` envelope + `EventFamily` union + `RuntimeEntityType` 相关基础 type
  - `events/employee.ts` — `EmployeeStatePayload` 等
  - `events/task.ts` — `TaskStatePayload` / `TaskAssignmentPayload` / `TaskAssignmentDispatchedPayload` / `TaskSubtaskProgressPayload`
  - `events/meeting.ts` — `MeetingStatePayload`
  - `events/llm.ts` — `LlmCallStartedPayload` / `LlmCallCompletedPayload` / `LlmUsageRecordedPayload` / `LlmStreamChunkPayload`
  - `events/graph.ts` — `GraphNodeEnteredPayload` / `GraphNodeExitedPayload`
  - `events/boss-route.ts` — `BossRouteAction` / `BossRouteDecidedPayload`
  - `events/interaction.ts` — `InteractionRequestedPayload` / `InteractionResolvedPayload` / `InteractionRestoredPayload` / `InteractionModeChangedPayload`
  - `events/handoff.ts` — `HandoffInitiatedPayload` / `HandoffCompletedPayload`
  - `events/memory.ts` — `MemoryCreatedPayload` / memory.reflection.completed
  - `events/workspace.ts` — `WorkspaceStalenessDetectedPayload` / `GitAutoCommittedPayload` / `KnowledgeIndexCompletedPayload`
  - `events/execution.ts` — `ExecutionResumedPayload` / `ErrorOccurredPayload` / `ExecutionAbortedPayload`
  - `events/conversation.ts` — `ConversationSynopsisUpdatedPayload` / `ConversationCompactCompletedPayload`
  - `events/deliverable.ts` — `DeliverableCreatedPayload`
  - `events/plan.ts` — `PlanCreatedPayload` / `PlanStepCompletedPayload`
  - `events/tool.ts` — `ToolExecutionTelemetryPayload` / `McpToolCalledPayload`
  - `events/hr.ts` — `HrRecommendationPayload`
  - `events/session.ts` — `SessionCostUpdatedPayload`
- **`events.ts` 变 barrel**：≤ 60 NBNC，只做 `export * from './events/*'` 和 import 必要的 types 给 `RuntimeEvent` 泛型用。外部消费者 `import type { X } from '@offisim/shared-types'` 路径不变。
- **`shared-types/index.ts`**：保持现有 `export * from './events.js'`，不改消费者。
- **可观测行为不变**：types 纯编译期概念，运行时无影响。

## Capabilities

### New Capabilities

- `shared-types-event-domains`

### Modified Capabilities

（无）

## Impact

- **目录新增**：`packages/shared-types/src/events/` 下 17 个 domain 文件
- **文件重写**：`events.ts` 690 → ≤ 60 NBNC（纯 re-export barrel）
- **消费者无改动**：全仓 `import type { XPayload } from '@offisim/shared-types'` 全部可用；`shared-types/events.js` 直接 import 路径也保留 barrel export
- **验证**：typecheck 全绿 + build 全绿即为等价证明（types 纯编译期）；全仓 grep 新 barrel export 列表 byte-identical pre-change
- **无依赖升级 / 无 API 断裂 / 无 DB migration**
