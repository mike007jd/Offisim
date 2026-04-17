## 1. Scaffolding

- [ ] 1.1 创建 `packages/core/src/services/conversation-budget/` + 5 空文件
- [ ] 1.2 基线：`wc -l conversation-budget-service.ts`（699）+ public method 清单对照 + events emit 点枚举

## 2. 抽 `SynopsisStore`

- [ ] 2.1 `services/conversation-budget/synopsis-store.ts`：class `SynopsisStore { get / upsert / clear }`，内部 Map
- [ ] 2.2 ThreadSynopsisRecord interface 保留在 barrel 里 export

## 3. 抽 pure-function modules

- [ ] 3.1 `prune-policy.ts`：`pruneMessages({ messages, config, synopsisSummary? }) → { messages, prunedCount }`
- [ ] 3.2 `tool-result-compactor.ts`：`compactToolResults({ messages, config }) → { messages, compactedCount }`
- [ ] 3.3 `policy.ts`：`evaluatePolicy({ messageCount, lastSynopsisMessageCount, hasSynopsis, config }) → { shouldPrune, shouldCompact, shouldRefreshSynopsis }`

## 4. 抽 `SynopsisGenerator`

- [ ] 4.1 `synopsis-generator.ts`：class `SynopsisGenerator(ctx)` owns LLM call + emit `conversationSynopsisUpdated`
- [ ] 4.2 保持 fire-and-forget 语义（不阻塞 before-call 路径）

## 5. Service class delegation

- [ ] 5.1 `ConversationBudgetService` constructor 内建 `store` / `generator`；method body 委托
- [ ] 5.2 `processBeforeCall` 调 `evaluatePolicy` + 按 decision 依次调 `pruneMessages` / `compactToolResults`
- [ ] 5.3 `processAfterCall` 检查 policy decision → fire generator.refresh fire-and-forget
- [ ] 5.4 `getSynopsis(threadId)` 直接 delegate `store.get(threadId)`
- [ ] 5.5 ≤ 220 NBNC

## 6. Verification: typecheck + build

- [ ] 6.1 shared-types → ui-core → core → ui-office → web 串行 build 绿
- [ ] 6.2 `pnpm typecheck` 26/26 绿

## 7. Verification: spec gates

- [ ] 7.1 `ls services/conversation-budget/*.ts` 正好 5 文件
- [ ] 7.2 grep "messageCount >= maxNonSystemMessages" 等阈值比较全仓只在 `policy.ts`
- [ ] 7.3 grep `Map<string, ThreadSynopsisRecord>` 全仓只在 `synopsis-store.ts`

## 8. Live runtime verification

- [ ] 8.1 跑多轮长对话（> 20 turn）或临时降 `maxNonSystemMessages=5` 强触发 prune
- [ ] 8.2 观察 `conversation.synopsis.updated` / `conversation.compact.completed` event 发射，payload 与重构前对齐
- [ ] 8.3 auto-compact 触发 + synopsis 刷新 时序与阈值一致
- [ ] 8.4 观察记录到 `verify-notes.md`（含重构前 baseline 事件序列截图或 log）

## 9. 最终 gate

- [ ] 9.1 `openspec validate refactor-conversation-budget-service --strict` 绿
- [ ] 9.2 通知用户等 `/opsx:archive`
