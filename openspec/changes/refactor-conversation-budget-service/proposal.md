## Why

`packages/core/src/services/conversation-budget-service.ts` 660 NBNC 单 class `ConversationBudgetService`。一个 public method `prepareRequest(ctx, request)` 要同时做：resolve options、load thread、compact tool results、split system / non-system、slice 按 compactBaseline、synopsis 生成决策 + LLM call + event、initial full-compact orchestration（circuit breaker + 失败 fallback）、refresh full-compact orchestration（circuit breaker）、最终 assemble + prune。

Class 内部还揉着：3 条 failure-streak Map、2 个 system prompt 常量、11 个 DEFAULT_* 常量、13 个 private method（含 `generateSynopsis` ~120 NBNC 和 `persistCompactBaseline` ~70 NBNC 两个大块）。任何一条 policy 微调（改阈值 / 改 circuit breaker / 改 heuristic fallback）都要把 660 行通读。对齐 Round 2 `pm-planner-node-boundaries` / `offisim-runtime-provider-boundaries` 的 "thin barrel + single-responsibility sibling modules" 模式。

**注意：这条 proposal 是 2026-04-18 重写过的**。第一版按 `processBeforeCall / processAfterCall / getSynopsis` + `SynopsisStore Map` 的假设写的，与真实代码不一致（真实 API 是 `prepareRequest`，synopsis 持久化在 DB 而非内存 Map）。已按真实代码结构重新拆分。

## What Changes

- **Thin barrel**：`conversation-budget-service.ts` 保留 `ConversationBudgetService` class + `prepareRequest(ctx, request)` public method + `ConversationBudgetServiceOptions` + `ThreadSynopsisRecord` export。方法体只做 high-level orchestration，不含 LLM call / DB 写 / event 构造。
- **4 个 sibling module**（`packages/core/src/services/conversation-budget/`）：
  - `options-resolver.ts` — `resolveOptions(ctx, defaults) → ResolvedConversationBudgetOptions` 纯函数 + 所有 `DEFAULT_*` 常量
  - `message-utils.ts` — `buildRequestMessages(...)` + `estimateTokens(messages)` 纯函数
  - `synopsis-generator.ts` — class `SynopsisGenerator` 拥有 `synopsisFailureStreaks` Map、`SYNOPSIS_SYSTEM_PROMPT`、`generate(ctx, ...) → { synopsis, summarySource, failureStreak } | null`、DB 写 + `conversation.synopsis.updated` event emit、heuristic fallback + circuit breaker
  - `full-compact-orchestrator.ts` — class `FullCompactOrchestrator` 拥有 `fullCompactFailureStreaks` + `fullCompactFailureMessageCounts` 两 Map、`FULL_COMPACT_SYSTEM_PROMPT`、`tryInitialCompact(...)`、`tryRefreshCompact(...)`、`persistBaseline(...)`、`conversation.compact.completed` event emit、skip row DB 写

- **消费者无改动**：`new ConversationBudgetService(opts)` 构造 + `prepareRequest(ctx, request)` 调用签名不变。`ConversationBudgetServiceOptions` / `ThreadSynopsisRecord` 的 export 位置不变。
- **可观测行为不变**：DB 写顺序（`threads.updateSynopsis` / `threads.updateCompactBaseline` / `compactSummaries.create` / `events.insert`）、EventBus emit 顺序、event payload shape、synopsis / baseline 内容、failure streak 递增语义，全部 byte-identical。

## Capabilities

### New Capabilities

- `conversation-budget-service-boundaries`

### Modified Capabilities

（无）

## Impact

- **目录新增**：`packages/core/src/services/conversation-budget/{options-resolver,message-utils,synopsis-generator,full-compact-orchestrator}.ts`
- **barrel 重写**：`conversation-budget-service.ts` 660 → ≤ 180 NBNC
- **消费者代码不动**：`summarization-middleware.ts` / `tauri-runtime.ts` / `browser-runtime.ts` / `execution-trace-service.ts` 引用保持原路径
- **验证**：串行 build + typecheck + grep gate + live 长会话触发 synopsis / compact 一次，对比事件序列和 DB 行
- **无依赖升级 / 无 API 断裂 / 无 DB migration**
