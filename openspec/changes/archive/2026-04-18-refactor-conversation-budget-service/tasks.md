## 1. Scaffolding

- [x] 1.1 创建 `packages/core/src/services/conversation-budget/` + 4 空文件（`options-resolver.ts` / `message-utils.ts` / `synopsis-generator.ts` / `full-compact-orchestrator.ts`）
- [x] 1.2 基线：`grep -cvE '^\s*(//|$|/\*|\*)' conversation-budget-service.ts` → 660；snapshot public API（`prepareRequest` / `ConversationBudgetServiceOptions` / `ThreadSynopsisRecord`）

## 2. 抽 `options-resolver.ts`

- [x] 2.1 迁 11 个 `DEFAULT_*` 常量 + `ResolvedConversationBudgetOptions` interface + `resolveOptions(ctx, defaults)` 纯函数
- [x] 2.2 barrel 里 `this.resolveOptions(ctx)` → `resolveOptions(ctx, this.defaults)`

## 3. 抽 `message-utils.ts`

- [x] 3.1 迁 `buildRequestMessages(systemMessages, compactBaseline, nonSystemMessages, synopsisMessage?)` + `estimateTokens(messages)` 纯函数
- [x] 3.2 barrel 和后续 orchestrator 里的 `this.buildRequestMessages` / `this.estimateTokens` 改为调用导入的自由函数

## 4. 抽 `synopsis-generator.ts`

- [x] 4.1 新建 class `SynopsisGenerator`，持有 `synopsisFailureStreaks` Map
- [x] 4.2 迁 `SYNOPSIS_SYSTEM_PROMPT` + `generateSynopsis` 主体 → `generate(ctx, { nonSystemMessages, existing, options })`
- [x] 4.3 迁 `normalizeSummary` / `buildHeuristicSummary` / `makeSynopsisEvent` → class private method
- [x] 4.4 迁 `parseSynopsis` → public `parseExisting(raw)` 供 barrel 调用
- [x] 4.5 迁 `postCompactCleanup`（只在 synopsis 成功末尾调）→ class private method
- [x] 4.6 保持 fire-and-forget 语义不变（barrel 侧 await 还是 await，不改）

## 5. 抽 `full-compact-orchestrator.ts`

- [x] 5.1 新建 class `FullCompactOrchestrator`，ctor 注入 `SynopsisGenerator` 引用
- [x] 5.2 持有 `fullCompactFailureStreaks` + `fullCompactFailureMessageCounts` 两 Map
- [x] 5.3 迁 `FULL_COMPACT_SYSTEM_PROMPT` + `generateFullCompactSummary` → private `generateSummary`
- [x] 5.4 迁 `persistCompactBaseline` → private `persistBaseline`
- [x] 5.5 迁 `makeCompactCompletedEvent` → private helper
- [x] 5.6 抽 `tryInitialCompact(ctx, input) → { baseline, nonSystemMessages } | null`，内部包含 circuit breaker 判定 + LLM call + baseline persist 或 skip 行写入；失败分支调注入的 `SynopsisGenerator.generate` 做 fallback summary_text
- [x] 5.7 抽 `tryRefreshCompact(ctx, input) → { baseline, nonSystemMessages } | null`，逻辑同 5.6 但用 `compactBaseline.summaryText` 作 priorSummaryText，失败分支不 fallback synopsis

## 6. barrel delegation

- [x] 6.1 `ConversationBudgetService` ctor 改为 `new SynopsisGenerator()` + `new FullCompactOrchestrator(synopsisGenerator)`
- [x] 6.2 `prepareRequest` 只保留：load thread、compact tool results、split system/non-system、slice、early returns、调 `synopsisGenerator.generate` / `tryInitialCompact` / `tryRefreshCompact`、`buildRequestMessages` + `pruneLlmMessages`
- [x] 6.3 删除 barrel 里的 3 条 Map 和所有已迁出的 method
- [x] 6.4 barrel ≤ 180 NBNC（实测 132），`grep 'SYNOPSIS_SYSTEM_PROMPT\|FULL_COMPACT_SYSTEM_PROMPT\|ctx\.llmGateway\.|ctx\.systemCaller\.chat\|ctx\.eventBus\.emit\|ctx\.repos\.events\.insert' conversation-budget-service.ts` 返回 0 行 ✓

## 7. Verification: typecheck + build

- [x] 7.1 shared-types → ui-core → core → ui-office → web 串行 build 绿
- [x] 7.2 `pnpm typecheck` 绿（web 入口过，26 全链等最终 gate）

## 8. Verification: spec gates

- [x] 8.1 `ls packages/core/src/services/conversation-budget/*.ts` 正好 4 文件 ✓
- [x] 8.2 `grep` synopsis 副作用标识全部命中 synopsis-generator.ts ✓
- [x] 8.3 `grep` full-compact 副作用标识 + `compact_kind: 'full_thread'` 全部命中 full-compact-orchestrator.ts ✓
- [x] 8.4 `grep` DEFAULT_* 全部命中 options-resolver.ts ✓
- [x] 8.5 barrel NBNC 132 ≤ 180 ✓

## 9. Live runtime verification（由 Codex 在 live browser runtime 内完成，直调 `budgetService.prepareRequest()`，synthetic thread `verify-budget-1776484190909`）

- [x] 9.1 synopsis 触发路径（场景 A）：10 条 non-system messages，`triggerTokens` 临时降至 500
- [x] 9.2 `conversation.synopsis.updated` event payload + `events` 行 + `threads.synopsis_json` + `compact_summaries(compact_kind='thread_synopsis')` 全部与 spec 断言 byte-match；返回请求头部含 `## Conversation synopsis` → 详见 `verify-notes.md` 场景 A
- [x] 9.3 full-compact initial 触发（场景 B）：16 条 non-system messages，`fullCompactTriggerMessages=14` / `fullCompactTriggerTokens=500`
- [x] 9.4 `conversation.compact.completed` event + `events` 行 + `threads.compact_baseline_json` + `compact_summaries(compact_kind='full_thread', summary_source='llm', failure_streak=0)` 全部 byte-match；`compactVersion=1`；后续 `prepareRequest()` 请求头仍保留 `## Compact baseline` → 详见 `verify-notes.md` 场景 B
- [x] 9.5 结果回填到 `verify-notes.md`（含 synthetic thread id / event payload / DB 行 / 额外观察）
- [x] 9.6 两处 runtime 临时阈值 override 已 revert（browser-runtime.ts / tauri-runtime.ts）
- [-] 9.7 场景 C (full-compact refresh) / 场景 D (circuit breaker) SKIPPED — A/B 已覆盖 spec 的 4 条 scenario；C/D 为 optional
- [!] 9.8 **Out-of-scope observation**（非本 refactor 引入）：UI chat 路径下 `prepareRequest()` 每次只见到 1 条 non-system message，说明 orchestration 层并未把历史 transcript 灌进 summarization middleware。此现象在重构前即存在，不影响 spec acceptance，但值得单开 change 调查（budget 服务实际无法 self-trigger synopsis/full-compact）

## 10. 最终 gate

- [x] 10.1 `openspec validate refactor-conversation-budget-service --strict` 绿
- [x] 10.2 通知用户等 `/opsx:archive`
