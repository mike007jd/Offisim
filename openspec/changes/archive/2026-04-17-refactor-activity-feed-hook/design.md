## Context

`useRuntimeActivityFeed` 是 Activity Log workspace 和 Office RightSidebar 的 Activity 子 tab 的唯一 data source。它订阅 20+ 种 RuntimeEvent，每种映射成统一的 `RuntimeActivityEntry`（id / timestamp / tone / title / detail / tool?）塞进 ring buffer。790 行单 hook 把 mapping 逻辑和 ring buffer 管理混在一个 useEffect 闭包里。

与 Round 1 D1-followup `refactor-ceremony-event-bindings` 解决的 `useCeremonyEventBindings.ts` 935 行巨型 hook 结构性同构——都是"单 hook 订阅 N 种 event，每种 event 有独立业务逻辑"。本 change 沿用相同的"thin barrel + 一事一模块"模式。

## Goals / Non-Goals

**Goals:**

- barrel ≤ 180 NBNC，只做 opts 接收 + ring buffer hook 调用 + 13 个 mapper 订阅装配
- 每个 mapper 文件 ≤ 150 NBNC，单一 event prefix family
- ring buffer 管理独立成 hook，可复用可测
- hook 返回值 shape byte-identical

**Non-Goals:**

- 不改 `RuntimeActivityEntry` schema
- 不改 tone 分配规则 / title 文案
- 不改 ring buffer 容量默认值（200）
- 不引入 activity-level filtering DSL（用户侧过滤由消费者做）
- 不引入测试

## Decisions

### D1. 目录定位：`runtime/activity-feed/`

**选择**：`packages/ui-office/src/runtime/activity-feed/`，下设 `useActivityRingBuffer.ts` + `mappers/*.ts`。

**理由**：activity-feed 是 runtime 消费者的派生视图，语义贴 `runtime/`；子目录聚合 13 mapper + 1 ring-buffer hook。

### D2. Mapper 签名统一 `subscribeX(eventBus, { push }): () => unsubscribe`

**选择**：每个 mapper 文件导出一个 factory：

```ts
export function subscribeTaskMappers(
  eventBus: EventBus,
  sink: { push: (entry: RuntimeActivityEntry) => void },
): () => void;
```

barrel 里 `cleanup.push(subscribeTaskMappers(eventBus, buffer))`。

**理由**：对齐 `ceremony-event-bindings` 的 `subscribe<Name>(eventBus, deps) => unsubscribe` 契约；单一入口聚合同 family 的多路订阅。mapper 内部的 `eventBus.on()` cleanup 聚合成单 unsubscribe 返回。

### D3. `useActivityRingBuffer`：容量可配 + clearOnReset

**选择**：

```ts
export function useActivityRingBuffer(opts?: { capacity?: number }): {
  entries: RuntimeActivityEntry[];
  push: (entry: RuntimeActivityEntry) => void;
  clear: () => void;
};
```

内部用 `useState<RuntimeActivityEntry[]>([])` + `push` callback 内截断到容量上限（FIFO 踢头）。

**理由**：当前 hook 已经是 FIFO 行为（有 `maxEntries` 参数），提取成独立 hook 就复用；capacity 可选参数保 opts 兼容。

### D4. Mapper 内部允许调用辅助 helper 但不导出

**选择**：mapper 文件内部可以定义 private helper（e.g. `describeTaskState(state)` 构造 title），helper 不 export。跨 mapper 共用的 helper（humanizeNodeName / formatDuration）仍住 `lib/agent-display.ts` 或 `lib/format-time.ts`。

**理由**：mapper 是 "一个 event family 的 translation layer"，内部私有即可；公共 helper 早已有单一 owner。

### D5. barrel 的 useEffect 依赖仅 `[eventBus]`

**选择**：barrel 的 useEffect deps 只有 `eventBus`（或等价 stable ref）。mapper 订阅的 cleanup 在 effect teardown 反序跑，对齐 ceremony bindings 模式。

**理由**：保持 stable subscription，避免 opts 变化 re-subscribe（opts 只影响 ring buffer 容量，通过 hook 内部 useEffect 独立处理）。

## Risks / Trade-offs

- **风险：mapper 间 event 顺序敏感**→ 所有 mapper 订阅同一 eventBus，event 按 dispatch 顺序到各 subscriber，mapper 之间无时序耦合；每个 mapper 写 ring buffer 时独立 push 一个 entry。
- **风险：ring buffer 并发写入冲突**→ JS 单线程 + React setState 用 updater function，天然无竞态；拆分前后无新增风险面。
- **风险：extension 漏接新 event**→ spec scenario 枚举 13 个 mapper 文件；新增 event family 必须扩 mapper 或加新文件，barrel grep 也会提醒。
- **风险：live verify 覆盖**→ 20+ event type 一次任务很难全覆盖，spec scenario 枚举 "必覆盖 10 种"，剩余由静态 mapper 文件 walk-through 覆盖。
- **Trade-off：13 文件**→ 接受。每个 mapper 文件 50-120 行，单一责任极其清晰，添加新 event family 只加文件不动 barrel。
