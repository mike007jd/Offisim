## Context

`ConversationBudgetService.prepareRequest` 是 `SummarizationMiddleware` 唯一的入口——所有 LLM call 前都会走这里做 history 削减、synopsis 注入、full-compact baseline 管理。

real code（660 NBNC）的分量不在 API 表面（就 1 个 public method），而在内部的三条决策链：

1. **每次 request 都算**：`resolveOptions` + compact tool results + 按 compactBaseline 切 nonSystem + 计算 effectiveTail
2. **阈值触发 synopsis**：LLM call（带 circuit breaker）+ 写 `threads.synopsis_json` + 写 `compactSummaries` + 写 `events` + emit EventBus + `postCompactCleanup`
3. **阈值触发 full-compact**（两个入口：初次 / 已有 baseline 刷新）：circuit-breaker 判定 + LLM call + 写 baseline or 写 skip 行 + emit event

三条链共享 4 个副作用通道（`ctx.repos.threads` / `ctx.repos.compactSummaries` / `ctx.repos.events` / `ctx.eventBus`）和三条 failure streak Map。把这些耦合面切齐是拆分的真正价值，不是为了 "line count < 220" 而拆。

## Goals / Non-Goals

**Goals:**

- barrel `conversation-budget-service.ts` ≤ 180 NBNC，只做 orchestration + 保留 `prepareRequest` / `ConversationBudgetServiceOptions` / `ThreadSynopsisRecord` export
- `synopsis-generator.ts` 独占 synopsis LLM call + heuristic fallback + synopsis failure streak + `conversation.synopsis.updated` 的所有副作用
- `full-compact-orchestrator.ts` 独占两条 full-compact 路径 + baseline 持久化 + full-compact failure streaks + `conversation.compact.completed` 的所有副作用
- `options-resolver.ts` / `message-utils.ts` 是纯函数，无 ctx 副作用
- DB 写顺序、event emit 顺序、payload shape、failure streak 语义 byte-identical

**Non-Goals:**

- 不改 policy 阈值默认值
- 不改 LLM message format / prune algorithm（`pruneLlmMessages` / `compactToolResultMessages` 继续复用，不 fork）
- 不改 event factory 签名 / 不新增 EventBus 事件类型
- 不合并 initial 和 refresh 两条 full-compact 路径（priorSummaryText 来源、sourceMessages slice、persistBaseline 参数、失败分支都有差异，合并会改语义）
- 不引入测试
- 不改消费者：`summarization-middleware.ts` / 两个 runtime / `execution-trace-service.ts` 的 import 和调用保持不动

## Decisions

### D1. 目录定位：`services/conversation-budget/`

**选择**：`packages/core/src/services/conversation-budget/` 放 4 个内部 module；`conversation-budget-service.ts` 作为 barrel 保持原路径。

**理由**：与 `pm-planner-node/` / `office-runtime-provider/` 在 Round 2 里一致的 "barrel + 同名目录" 结构。消费者 import path 不用动。

### D2. `options-resolver.ts` 纯函数化

**选择**：所有 `DEFAULT_*` 常量 + `ResolvedConversationBudgetOptions` interface + `resolveOptions(ctx, defaults)` 函数迁出。签名改为自由函数（以 `defaults` 为第二参数），不绑定 class：

```ts
export function resolveOptions(
  ctx: RuntimeContext,
  defaults: ConversationBudgetServiceOptions,
): ResolvedConversationBudgetOptions
```

**理由**：`resolveOptions` 的唯一输入是 `ctx.runtimePolicy.summarization` + `this.defaults`，从 class 拎出来后就是纯函数，测试友好（本项目不写测但 reasoning 清晰）。

### D3. `message-utils.ts` 纯函数化

**选择**：`buildRequestMessages` 和 `estimateTokens` 作为自由函数导出。两者目前都是 class 内 private method 但不依赖 `this`。

**理由**：同 D2。`estimateTokens` 在 `prepareRequest` 和 `persistCompactBaseline` 两处用，提出来自然去重。

### D4. `SynopsisGenerator` 持有 synopsis failure streak + 所有 synopsis 副作用

**选择**：

```ts
export class SynopsisGenerator {
  private readonly failureStreaks = new Map<string, number>();

  async generate(
    ctx: RuntimeContext,
    input: {
      nonSystemMessages: readonly LlmMessage[];
      existing: ThreadSynopsisRecord | null;
      options: ResolvedConversationBudgetOptions;
    },
  ): Promise<{
    synopsis: ThreadSynopsisRecord;
    summarySource: 'llm' | 'heuristic' | 'circuit_breaker';
    failureStreak: number;
  } | null>;
}
```

内部包含：`SYNOPSIS_SYSTEM_PROMPT` 常量、`normalizeSummary` / `buildHeuristicSummary` / `parseSynopsis` helper、`makeSynopsisEvent`、`postCompactCleanup`（synopsis 成功后要 trim node summaries + clear stale interactions，是 synopsis 副作用的一部分，不是 full-compact 的）。

**理由**：synopsis failure streak 只在这一条路径用；`postCompactCleanup` 在当前代码里只在 `generateSynopsis` 末尾被调（full-compact 成功写 baseline 时**不调**），所以它属于 synopsis 侧。

### D5. `FullCompactOrchestrator` 持有两条 full-compact 路径 + baseline 持久化

**选择**：

```ts
export class FullCompactOrchestrator {
  private readonly failureStreaks = new Map<string, number>();
  private readonly failureMessageCounts = new Map<string, number>();

  async tryInitialCompact(ctx, input): Promise<{
    baseline: CompactBaselineState;
    nonSystemMessages: readonly LlmMessage[];
  } | null>;

  async tryRefreshCompact(ctx, input): Promise<{
    baseline: CompactBaselineState;
    nonSystemMessages: readonly LlmMessage[];
  } | null>;
}
```

内部包含：`FULL_COMPACT_SYSTEM_PROMPT`、`generateSummary`、`persistBaseline`、`makeCompactCompletedEvent`、skip 行写入 helper（`full_thread_skip` compact_kind）、circuit-breaker helper。`tryInitialCompact` 失败分支还得 fallback 到 synopsis generation——这一步通过 ctor 注入的 `SynopsisGenerator` 引用调用，不把 synopsis 逻辑塞进 orchestrator。

**理由**：两条路径虽然有 priorSummaryText / sourceMessages / 失败 fallback 的差异，但共享 circuit-breaker 判定、skip 行写入、baseline 持久化、event emit 这 4 条基础设施。打包到一起让 full-compact 的决策面集中。

### D6. barrel orchestration pattern

**选择**：

```ts
export class ConversationBudgetService {
  private readonly synopsisGenerator = new SynopsisGenerator();
  private readonly fullCompactOrchestrator = new FullCompactOrchestrator(this.synopsisGenerator);

  constructor(private readonly defaults: ConversationBudgetServiceOptions = {}) {}

  async prepareRequest(ctx: RuntimeContext, request: LlmRequest): Promise<LlmRequest> {
    const options = resolveOptions(ctx, this.defaults);
    // load thread + compactBaseline + compactToolResultMessages
    // compute effective thresholds
    // early return disabled / under threshold
    // optionally synopsisGenerator.generate
    // optionally fullCompactOrchestrator.tryInitialCompact or tryRefreshCompact
    // buildRequestMessages + pruneLlmMessages
  }
}
```

barrel 只做"决定走哪条路径"，不做"路径里的副作用"。所有 `ctx.repos.*` / `ctx.eventBus.emit` / LLM call 都下沉到 generator / orchestrator。

**理由**：barrel 的阅读成本降到"看 policy 分叉"级别；每条 side-effecting 分支有明确 owner。

### D7. initial full-compact 失败 fallback synopsis 的 ownership

**选择**：`FullCompactOrchestrator.tryInitialCompact` 失败分支需要 fallback 做 synopsis。通过 ctor 注入的 `SynopsisGenerator` 引用调用，而不是重新调 barrel 或复制 synopsis 逻辑。调用结果不写入 `existing` 变量链，只用于 skip 行的 `summary_text`。

**理由**：这是 initial full-compact 失败时的语义，不属于 "synopsis 主路径"，但需要 synopsis 能力。注入依赖是最小改动。

## Risks / Trade-offs

- **风险：两条 full-compact 路径拆到 orchestrator 后时序错乱**→ barrel 按原顺序依次调 `synopsisGenerator.generate` → `tryInitialCompact`（含 fallback synopsis）→ `tryRefreshCompact`。spec scenario 用真实 DB 行做验证。
- **风险：failure streak state 拆分后 `ctx.threadId` 在 Map 里错配**→ 三条 Map 都在各自 owner 内，barrel 不再直接访问；构造时 `new` 出 generator + orchestrator 后整个 service 实例生命周期共享，行为等价。
- **风险：`postCompactCleanup` 归属错位**→ 真实代码里它**只**在 `generateSynopsis` 成功路径末尾被调（line 479），不在 `persistCompactBaseline` 路径上。归 `SynopsisGenerator`。spec scenario 固化。
- **风险：`parseSynopsis` 归属**→ 当前 barrel 的 `prepareRequest` 用它解析 `thread.synopsis_json`。挪到 `synopsis-generator.ts` 后 barrel 需要 import 回来调。方案：`SynopsisGenerator` 暴露 `parseExisting(raw)` public method，barrel 调它拿 `existing`。
- **Trade-off：barrel 仍需 import 4 个 module**→ 接受，每个 import 职责清晰。
- **Trade-off：`SynopsisGenerator` 注入到 `FullCompactOrchestrator` 形成单向依赖**→ 接受；反向不成立，不是循环。
- **风险：live verify 成本**→ synopsis 触发需要 ≥80 条 non-system message 或 ≥60k token；full-compact 需要 ≥120 条 + ≥90k token。实测可临时把 `synopsisTriggerMessages` / `fullCompactTriggerMessages` 调到低值强触发，验证完改回。
