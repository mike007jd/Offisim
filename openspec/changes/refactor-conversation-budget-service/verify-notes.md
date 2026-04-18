# Live Verify Handoff — refactor-conversation-budget-service

**目的**：验证 `ConversationBudgetService` 拆分后 synopsis 与 full-compact 两条路径的 event payload + DB 行与重构前 byte-identical。
**代码状态**：typecheck + build + grep gate 全绿，`openspec validate --strict` 绿。待 live 路径覆盖。
**适用环境**：web dev（`pnpm --filter @offisim/web dev`，port 5176）或 desktop dev；用已配置的 MiniMax provider（`.env.local` 里 `MINIMAX_*`）。

---

## 准备：临时降阈值

目的是把"需要 >80 / >120 条消息"压到几轮对话就能触发。阈值通过 `new ConversationBudgetService(opts)` 传入，目前两个消费者都是无参构造：

- `apps/web/src/lib/browser-runtime.ts:293` — `new ConversationBudgetService()`
- `apps/web/src/lib/tauri-runtime.ts:221` — `new ConversationBudgetService()`

**临时改这两处**（同 value）：

```ts
new ConversationBudgetService({
  synopsisTriggerMessages: 8,
  synopsisRefreshMinMessages: 2,
  fullCompactTriggerMessages: 14,
  fullCompactTriggerTokens: 500,
  fullCompactRefreshMinMessages: 3,
  fullCompactFailureThreshold: 2,
})
```

验证完**必须 revert**（两个文件改回 `new ConversationBudgetService()`），不允许 commit 临时阈值。

---

## 场景 A：synopsis 首次触发

**步骤**
1. 起 web dev（或桌面 dev），新建一个空 company 进 chat。
2. 用任意 slash 或自由对话跑 ≥ 10 轮非 system 消息（user + assistant 各算 1 条；ceremony 产生的也算）。
3. 触发 synopsis 时 activity log 应出现 `conversation.synopsis.updated` 事件；DB 侧 `threads.synopsis_json` 该行变成非空 JSON。

**断言**（必须全满足）：

- EventBus 发射 `conversation.synopsis.updated`，payload shape `{ summary: string, version: number, prunedMessageCount: number, totalMessageCount: number }`
- `events` 表多一行 `event_type='conversation.synopsis.updated'`，`payload_json` 字段与 EventBus payload 一致
- `threads.synopsis_json` 反序列化后有 `version / summary / prunedMessageCount / totalMessageCount / updatedAt`
- `compact_summaries` 表多一行 `compact_kind='thread_synopsis'`，`summary_source='llm'`（若 LLM call 成功）
- 首次 `version=1`；若继续对话触发第 2 次，version 升到 2

**查 DB**（vault 或 tauri SQLite；web 端没本地 DB，只能走 activity log 面板 + 浏览器 devtools 的 event 日志）：

```sql
SELECT event_id, event_type, payload_json, created_at
  FROM events
 WHERE event_type IN ('conversation.synopsis.updated','conversation.compact.completed')
 ORDER BY created_at DESC LIMIT 20;

SELECT compact_id, compact_kind, summary_source, messages_compacted, failure_streak
  FROM compact_summaries
 ORDER BY created_at DESC LIMIT 20;

SELECT synopsis_json, compact_baseline_json FROM threads WHERE thread_id = '<当前 threadId>';
```

---

## 场景 B：full-compact initial 触发

**步骤**
1. 接着场景 A 的会话继续聊到 ≥ 16 轮非 system（阈值 14 + 余量）。
2. 触发 full-compact 时 activity log 应出现 `conversation.compact.completed`；`threads.compact_baseline_json` 该行变成非空 JSON。

**断言**：

- EventBus 发射 `conversation.compact.completed`，payload `{ compactId: string, compactVersion: 1, compactedNonSystemMessageCount: number, keptTailNonSystemMessageCount: number, preCompactMessageCount: number, preCompactTokenCount: number }`
- `events` 表对应行 payload_json 与 EventBus 一致
- `compact_summaries` 多一行 `compact_kind='full_thread'`，`summary_source='llm'`，`failure_streak=0`
- `threads.compact_baseline_json` JSON 含 `compactId / compactVersion=1 / compactedAt / summaryText / compactedNonSystemMessageCount / keptTailNonSystemMessageCount`
- 之后的 `prepareRequest` 调用里传给 LLM 的 messages 头部应含 `## Compact baseline\n...`

---

## 场景 C：full-compact refresh（optional，如果时间允许）

**步骤**
1. 场景 B 之后继续聊 ≥ 20 轮（压过 `fullCompactRefreshMinMessages=3`）。
2. 触发 refresh full-compact。

**断言**：
- 新 `conversation.compact.completed` 事件，`compactVersion=2`（即 `priorCompactVersion + 1`）
- `compactedNonSystemMessageCount` ≥ 上一次的值
- `compact_baseline_json` 被覆盖为新 baseline

---

## 场景 D：circuit breaker（optional，验证失败路径）

**步骤**
1. 在 `provider-config.ts` 或 settings UI 把 MiniMax key 临时改错（保留格式，只错 value），保证 LLM call 会 throw。
2. 跑到 synopsis 或 full-compact 触发点。

**断言**：
- `compact_summaries` 出现 `summary_source='llm_error'` 行；继续触发多次直到 `failure_streak >= 2`（阈值 2）后出现 `summary_source='circuit_breaker'` 行
- 对应的 `compact_kind` 应是 `thread_synopsis`（synopsis 路径）或 `full_thread_skip`（full-compact 路径）
- `failure_streak` 字段与触发次数对齐

---

## 失败/Pass 判定

**Pass 条件**：场景 A + B 所有断言满足；event payload shape 和 DB 字段与上面列的完全一致。C 和 D 为 optional，能跑更好。

**Fail 立刻回滚**：
- 任何 event payload 缺字段 / 多字段 / 字段名变化
- `compact_summaries` 行 `summary_source` 分类错位
- `threads.synopsis_json` / `threads.compact_baseline_json` 结构变化
- `prepareRequest` 抛未捕获异常
- EventBus 事件发射顺序变化（synopsis 应先于其后的 full-compact 写 DB）

**回滚方式**：`git restore packages/core/src/services/conversation-budget-service.ts && git clean -fd packages/core/src/services/conversation-budget/`

---

## 填回本文件

Codex 跑完后把下列记录追加到本文件末尾（替换掉本节占位）：

```
## Results

- 场景 A: [PASS / FAIL + 原因]
  - 触发时非系统消息数: ___
  - event payload 样本: { ... }
  - compact_summaries 行: { ... }

- 场景 B: [PASS / FAIL + 原因]
  - ...

- 场景 C: [SKIPPED / PASS / FAIL]
- 场景 D: [SKIPPED / PASS / FAIL]

- 阈值临时值已 revert: [YES / NO]
- 准许 archive: [YES / NO]
```

## Results

- 场景 A: PASS（通过 live browser runtime 里的真实 `budgetService.prepareRequest()` 触发；手工 UI chat 路径未能把历史消息送进 `prepareRequest`）
  - synthetic thread: `verify-budget-1776484190909`
  - 触发时非系统消息数: `10`
  - event payload 样本: `{"summary":"ScenarioA: Exchange between user and assistant, each message contains the phrase \"alpha beta gamma delta epsilon\" repeated 12 times.","version":1,"prunedMessageCount":2,"totalMessageCount":10}`
  - `events` 行样本: `{"event_type":"conversation.synopsis.updated","payload_json":"{\"summary\":\"ScenarioA: Exchange between user and assistant, each message contains the phrase \\\"alpha beta gamma delta epsilon\\\" repeated 12 times.\",\"version\":1,\"prunedMessageCount\":2,\"totalMessageCount\":10}","created_at":"2026-04-18T03:49:55.589Z"}`
  - `threads.synopsis_json` 样本: `{"version":1,"summary":"ScenarioA: Exchange between user and assistant, each message contains the phrase \"alpha beta gamma delta epsilon\" repeated 12 times.","prunedMessageCount":2,"totalMessageCount":10,"updatedAt":"2026-04-18T03:49:55.589Z"}`
  - `compact_summaries` 行样本: `{"compact_kind":"thread_synopsis","summary_source":"llm","messages_compacted":2,"failure_streak":0,"pre_compact_message_count":10,"pre_compact_token_count":1294}`
  - 返回请求头样本: 第一条 system message 为 `## Conversation synopsis\n...`，尾部保留 `msg 3..10`

- 场景 B: PASS（同一 synthetic thread 延续；`compactVersion=1`，并验证后续请求头出现 `## Compact baseline`）
  - 触发时非系统消息数: `16`
  - event payload 样本: `{"compactId":"fcb-88610cf1-c864-4b8f-bf42-e4d64c77b1a3","compactVersion":1,"compactedNonSystemMessageCount":8,"keptTailNonSystemMessageCount":8,"preCompactMessageCount":16,"preCompactTokenCount":2070}`
  - `events` 行样本: `{"event_type":"conversation.compact.completed","payload_json":"{\"compactId\":\"fcb-88610cf1-c864-4b8f-bf42-e4d64c77b1a3\",\"compactVersion\":1,\"compactedNonSystemMessageCount\":8,\"keptTailNonSystemMessageCount\":8,\"preCompactMessageCount\":16,\"preCompactTokenCount\":2070}","created_at":"2026-04-18T03:50:04.345Z"}`
  - `threads.compact_baseline_json` 样本: `{"compactId":"fcb-88610cf1-c864-4b8f-bf42-e4d64c77b1a3","compactVersion":1,"compactedAt":"2026-04-18T03:50:04.345Z","summaryText":"User Objective: None specified - this appears to be a test or benchmarking scenario with no meaningful task. Active Scenario: ScenarioB (separate from prior ScenarioA) - 16 message exchange using identical repetitive placeholder content pattern. Current State: Complete exchange of 8 USER/ASSISTANT message pairs in ScenarioB. No processing or work performed. Key Observation: All messages contain the phrase \"alpha beta gamma delta epsilon\" repeated 12 times with sequential numbering (msg 1 through msg 16). No decisions made, no files involved, no actionable items. Unresolved: No real user objective has been provided. This appears to be test data for benchmarking or validation purposes.","compactedNonSystemMessageCount":8,"keptTailNonSystemMessageCount":8}`
  - `compact_summaries` 行样本: `{"compact_kind":"full_thread","summary_source":"llm","messages_compacted":8,"failure_streak":0,"pre_compact_message_count":16,"pre_compact_token_count":2070}`
  - 返回请求头样本: 第一条 system message 为 `## Compact baseline\n...`，后续 follow-up `prepareRequest()` 头部仍保留同一 baseline

- 场景 C: SKIPPED
- 场景 D: SKIPPED

- 额外观察:
  - 按 handoff 原文只改 `synopsisTriggerMessages/fullCompactTrigger*` 不足以在当前 web dev 环境复现。原因有两层：
  - `runtime.runtimeCtx.runtimePolicy.summarization.keepRecentMessages=30`，所以若不额外把 `maxNonSystemMessages/tailNonSystemMessages` 压低，10/16 条消息不会越过 early-return。
  - `runtime.runtimeCtx.runtimePolicy.summarization.triggerTokens=60000`，若不在 live session 内临时改成 `500`，synopsis 路径不会触发。
  - 手工 UI chat / task 路径下，实测 `prepareRequest()` 看到的 `non-system message` 计数始终是 `1`；也就是说当前 browser orchestration 没有把历史 transcript 送入该 middleware。这个现象与本次 refactor 是否等价无关，但会让“靠聊天轮次触发 A/B”这条 verify recipe 在 web 端失效。
  - browser runtime 默认没有为当前 `runtimeCtx.threadId` 建立 `threads` repo 行；为了断言 `threads.synopsis_json` / `threads.compact_baseline_json`，我在 live session 内为 synthetic thread 手动 `repos.threads.create(...)` 了一行。

- 阈值临时值已 revert: YES
- 准许 archive: NO
