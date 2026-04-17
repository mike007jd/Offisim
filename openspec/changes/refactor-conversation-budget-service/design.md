## Context

`ConversationBudgetService` 在 LLM call 前后做两件事：call 前根据 policy 决定是否 prune / compact history（避免 context overflow）；call 后决定是否异步触发 synopsis refresh。699 行里揉着：

1. Synopsis store（per-thread Map）
2. Prune policy evaluation（messageCount 阈值 + synopsis 存在性）
3. Tool result compact（`compactToolResultMessages` 上层包装）
4. Synopsis generation（LLM call + event emit）
5. Auto-compact trigger 判定

当前 class 把这 5 件事的 state + method 都揉在 class body 里，修改任何一条 policy 都得通读。Round 1 `employee-node-boundaries` 的 `finalizeEmployeeSuccess({ source: 'normal' | 'recovery' })` 消除重复路径的模式在这里也适用。

## Goals / Non-Goals

**Goals:**

- `ConversationBudgetService` class 瘦到 ≤ 220 NBNC，只做 public method + delegate
- 每个内部 module ≤ 180 NBNC，单一责任
- Prune / compact / synopsis event 行为 byte-identical

**Non-Goals:**

- 不改 policy 阈值默认值
- 不改 LLM message format / prune algorithm（`pruneLlmMessages` / `compactToolResultMessages` 继续复用，不 fork）
- 不改 event factory 签名
- 不引入测试

## Decisions

### D1. 目录定位：`services/conversation-budget/`

**选择**：新目录 `packages/core/src/services/conversation-budget/` 下放 5 个内部 module。`conversation-budget-service.ts` 继续作为 barrel（class 定义 + 委托）。

**理由**：和 `services/` 里其他 service（`deliverable-persistence-service.ts` 等）保持同级；子目录聚合 internal 模块。

### D2. `SynopsisStore` 是纯 state container

**选择**：`synopsis-store.ts` export class `SynopsisStore` with `get(threadId) / upsert(threadId, record) / clear()`. 无外部依赖，无事件发射。

**理由**：store 单一职责方便替换（未来如果 synopsis 要持久化进 SQLite，只改 store，不改 policy / generator）。

### D3. `PrunePolicy` / `ToolResultCompactor` 是纯函数 module

**选择**：

```ts
// prune-policy.ts
export interface PruneInput { messages: LlmMessage[]; config: {...}; synopsisSummary?: string; }
export interface PruneResult { messages: LlmMessage[]; prunedCount: number; }
export function pruneMessages(input: PruneInput): PruneResult;

// tool-result-compactor.ts
export interface CompactInput { messages: LlmMessage[]; config: {...}; }
export interface CompactResult { messages: LlmMessage[]; compactedCount: number; }
export function compactToolResults(input: CompactInput): CompactResult;
```

**理由**：输入/输出数据结构，无副作用；易于 refactor policy（未来加新 rule 改这一个 module）；测试友好（即使本项目不写测试，将来复用到别处时方便）。

### D4. `SynopsisGenerator` 持有 LLM client 引用

**选择**：

```ts
export class SynopsisGenerator {
  constructor(private readonly ctx: RuntimeContext) {}
  async refresh(threadId: string, messages: LlmMessage[]): Promise<ThreadSynopsisRecord>;
}
```

内部调 `ctx.llmGateway` + emit `conversationSynopsisUpdated` event。

**理由**：synopsis generation 是有副作用的 async 操作（LLM call + event），适合 class 封装（未来如果 swap 成 cheaper model，改这个 class）。

### D5. `Policy` module 是纯决策函数

**选择**：

```ts
// policy.ts
export interface PolicyInput {
  messageCount: number;
  lastSynopsisMessageCount: number;
  hasSynopsis: boolean;
  config: ConversationBudgetServiceOptions;
}
export interface PolicyDecision {
  shouldPrune: boolean;
  shouldCompact: boolean;
  shouldRefreshSynopsis: boolean;
}
export function evaluatePolicy(input: PolicyInput): PolicyDecision;
```

**理由**：把阈值判断从 class body 拎出，单测可行（即使不写测试，reasoning 清晰）；改 policy 只改这个文件。

### D6. Service class 委托模式

**选择**：`ConversationBudgetService` class 构造时 new 内部 modules：

```ts
export class ConversationBudgetService {
  private readonly store = new SynopsisStore();
  private readonly generator: SynopsisGenerator;
  constructor(ctx: RuntimeContext, private readonly opts: ConversationBudgetServiceOptions = {}) {
    this.generator = new SynopsisGenerator(ctx);
  }

  async processBeforeCall(request: LlmRequest): Promise<LlmRequest> {
    const policy = evaluatePolicy({...});
    let messages = request.messages;
    if (policy.shouldPrune) messages = pruneMessages({...}).messages;
    if (policy.shouldCompact) messages = compactToolResults({...}).messages;
    return { ...request, messages };
  }

  // ...
}
```

**理由**：保持 class 语法但内部逻辑全 delegate。Class 的 public method 契约不变。

## Risks / Trade-offs

- **风险：synopsis refresh 时序**→ async LLM call 继续 fire-and-forget（不阻塞 `processBeforeCall`），由 generator 自己管。拆分前后无时序变化。
- **风险：policy 阈值默认值漂移**→ `ConversationBudgetServiceOptions` defaults 必须保持一致；tasks 里 explicit 对照 baseline 数值。
- **风险：event emit 重复或漏触发**→ `synopsisUpdated` / `compactCompleted` 事件的 emit 点只在 SynopsisGenerator 内，service 委托不再自己 emit。通过 spec scenario 固化。
- **风险：live verify 成本**→ synopsis 只在长对话（>20 轮）触发；auto-compact 更久。可能需要人工长会话或临时降低阈值验证。spec scenario 要求 "长对话触发 auto-compact 至少 1 次"。
- **Trade-off：6 文件替代 1 文件**→ 接受。
