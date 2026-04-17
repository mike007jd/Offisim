## Why

`packages/core/src/services/conversation-budget-service.ts` 699 行单 class `ConversationBudgetService` 承担：thread synopsis 管理（version + summary + prunedCount）、LLM prune policy（maxNonSystemMessages + tailNonSystemMessages）、tool result compaction（keepRecent + maxContentChars）、synopsis trigger 判定、auto-compact 判定、synopsis 生成 LLM call 编排、事件发射（`conversationSynopsisUpdated` / `conversationCompactCompleted`）。单文件里 10+ method + 5+ config option 耦合，修改任何一条 policy 都要读全文件。对齐 Round 1 `employee-node-boundaries` 的 "barrel + single-responsibility sibling modules" 模式。

## What Changes

- **Thin service class**: `ConversationBudgetService` 保留 public API（`processBeforeCall(request)` / `processAfterCall(response)` / `getSynopsis(threadId)`），但内部委托给 4 个 single-responsibility module。
- **4 个新 module** (`packages/core/src/services/conversation-budget/` 子目录)：
  - `synopsis-store.ts` — `ThreadSynopsisRecord` Map 管理（getByThread / upsert / version bump），无业务 policy
  - `prune-policy.ts` — 根据 config 对 LLM messages 做 prune（wrap `pruneLlmMessages` + wrapping logic）
  - `tool-result-compactor.ts` — 对 tool result message 做 content compact（wrap `compactToolResultMessages`）
  - `synopsis-generator.ts` — 触发 LLM call 生成 synopsis summary + 发 event（纯 orchestration，不动 LLM adapter）
- **Policy evaluator**: `conversation-budget/policy.ts` — 输入 `{ messageCount, hasRecentSynopsis, lastSynopsisMessageCount }`，输出 `{ shouldPrune: boolean, shouldCompact: boolean, shouldRefreshSynopsis: boolean }`。决策纯函数。
- **保留**：`ConversationBudgetServiceOptions` interface + `ThreadSynopsisRecord` interface 在 service 文件里 export（消费者兼容）。
- **可观测行为不变**：prune / compact / synopsis event 发射序列、synopsis 内容、synopsis refresh trigger 时机、auto-compact 阈值行为全部 byte-identical。

## Capabilities

### New Capabilities

- `conversation-budget-service-boundaries`

### Modified Capabilities

（无）

## Impact

- **目录新增**：`packages/core/src/services/conversation-budget/{synopsis-store,prune-policy,tool-result-compactor,synopsis-generator,policy}.ts`
- **文件重写**：`conversation-budget-service.ts` 699 → ≤ 220 NBNC（保留 class + public methods，method body 委托给 sibling）
- **消费者无改动**：`new ConversationBudgetService(opts)` 构造 + `processBeforeCall` / `processAfterCall` / `getSynopsis` 调用都不变
- **验证**：live runtime 跑多轮长对话（触发 auto-compact 和 synopsis refresh），对比事件序列、synopsis 内容、prune message count 与重构前一致
- **无依赖升级 / 无 API 断裂 / 无 DB migration**
