## Why

H1 `persist-deliverable-history` 落地后，live verify 暴露两条隐性 risk（design.md R7 / R8）必须在 H2 UI unification 之前收掉，否则 H2 在真实使用量下会连锁扩散问题：

- **R7 — web localStorage quota 爆裂**：`MemoryDeliverableRepository.snapshot()` 返回 full rows（含 inline content）并进 `offisim:browser-runtime-snapshot:v1` 整体 JSON.stringify。N=100 × 100KB = 10MB，localStorage quota ≈5–10MB/origin，**单次 QuotaExceededError 会把整个 snapshot 写入失败**（employees / memories / zones / 所有 state 一并丢）。`scheduleFlush` 在 eventBus wildcard 上挂 300ms debounce，每次 flush 都重新 full-stringify 10MB — 主线程卡顿。
- **R8 — `listRecentDeliverables` N+1 `findById`**：eager hydrate 在 runtime ready 关键路径 `Promise.all(summaries.map(findById))`。Tauri 每次 findById 是 IPC round-trip（≈1–3ms），N=100 下 100–300ms 串行阻塞 first meaningful PitchHall render。

这条 change 把 deliverable 持久化 hotpath 重写到可持续形态：web content 走 IndexedDB、主 snapshot 只留 metadata；repo 新增 `listByCompanyWithContent` 一次 SQL 拉回全 rows，消除 N+1。desktop SQLite 不受影响但同样享受新 API。

## What Changes

- **MODIFIED** `MemoryRepositoriesSnapshot.deliverables` 字段语义 —— 从 `DeliverableRow[]`（含 content）改成 `DeliverableSummaryRow[]`（metadata + content_size），content 拆出走 IndexedDB。`MemoryDeliverableRepository.snapshot()` 按新契约返回 summary 行；IDB content 存储是可选 overlay（class 构造接 async loader）
- **NEW** web 侧 content store：`apps/web/src/lib/deliverable-content-idb.ts`，key=`deliverable_id`，value=content string。`createBrowserRuntimePersistence` 订阅 `deliverable.created` event 写 IDB；memory repo 构造接 `readContent(id)` 在 `findById` 时 lazy hydrate
- **NEW** `DeliverableRepository.listByCompanyWithContent(companyId, opts?)` 接口方法 —— 一次 SQL（drizzle / tauri）或一次 Map scan（memory）返回 full rows。drizzle/tauri 调整为 `SELECT *` 走索引，memory 直接拼出 full rows。旧 `listByCompany` 保留（metadata-only 契约不变）给未来 listview-only 场景
- **MODIFIED** `OffisimRuntimeProvider.listRecentDeliverables` 改调 `listByCompanyWithContent` 消除 Promise.all findById N+1 + web IDB content lazy hydrate
- 原 `loadDeliverableContent` 保留给 single-row refresh / manual reload 场景
- Live verify：web 生成 ≥5 条大 deliverable（~500KB/条）→ refresh → PitchHall hydrate 不丢数据且 localStorage 不爆；desktop 触发 ≥20 条 → `listRecentDeliverables` 单 SQL round-trip 不 N+1

## Capabilities

### New Capabilities
（无 — 纯 optimization / 契约调整，capability 层沿用 `deliverable-persistence`）

### Modified Capabilities
- `deliverable-persistence`: 调整 "browser localStorage snapshot" requirement — metadata 进主 snapshot，content 拆出走 IndexedDB；新增 `listByCompanyWithContent` 接口要求；修订 hook hydrate 路径不再 N+1

## Impact

**代码：**
- `packages/core/src/runtime/repositories.ts` — `DeliverableRepository` 加 `listByCompanyWithContent` 方法；`MemoryRepositoriesSnapshot.deliverables` 类型切 `DeliverableSummaryRow[]`
- `packages/core/src/runtime/repos/deliverables/{drizzle,memory}.ts` — 各加 `listByCompanyWithContent` 实现；memory class 构造签名扩 `contentLoader?: (id: string) => Promise<string | null>`；`snapshot()` 返回 summary
- `apps/web/src/lib/tauri-repos/deliverables.ts` — 加 `listByCompanyWithContent`
- `apps/web/src/lib/deliverable-content-idb.ts` — **NEW** 轻量 IndexedDB wrapper（`put(id, content)` / `get(id)` / `delete(id)` / `keys()`），无外部依赖用 raw IDB API
- `apps/web/src/lib/browser-runtime-storage.ts` — `saveBrowserRuntimeSnapshot` 无需改（memory repo snapshot 已变 summary）；新增 `createDeliverableContentBridge(eventBus)` 订阅 `deliverable.created` 写 IDB 并在 dispose 时 unsub
- `apps/web/src/lib/browser-runtime.ts` — `createBrowserRuntime` / `createBrowserRuntimeReposOnly` wire IDB bridge + 传 `contentLoader` 给 `MemoryDeliverableRepository`
- `apps/web/src/runtime/OffisimRuntimeProvider.tsx` — `listRecentDeliverables` 改调 `listByCompanyWithContent`，移除 Promise.all findById loop
- `packages/core/src/runtime/memory-repositories.ts` — `createDeliverablesMemoryRepos(snapshot, contentLoader?)` 透传
- `openspec/specs/deliverable-persistence/spec.md` — MODIFIED 修订 R7 scenario、新增 `listByCompanyWithContent` requirement

**不影响：**
- Desktop Tauri SQLite 路径天然无 R7 quota 问题（数据落文件，无大小限）；R8 消 N+1 同样受益
- chat bubble `DeliverableArtifactCard` / PitchHall / KanbanBoard 渲染不改（hook 返回形状相同）
- `DeliverablePersistenceService` 不改（仍订阅 `deliverable.created` 写 repo；IDB bridge 是独立新 subscriber）
- `runtime_events` / `graph_checkpoints` 等其他 snapshot 字段不动

**风险：**
- IDB 是 async，`findById` 变 async OK（已是 Promise 返回），但 `MemoryDeliverableRepository.findById` 内部首次 hit IDB 时 content 可能未写入（race between live event IDB write + findById），需要内存 fallback（存 content 在 class 直到 IDB 写回确认）
- 用户 clear IDB 但不 clear localStorage 会导致 summary 有 content_size ≠ 0 但 findById 返回 null — 行为按"找不到就空卡"处理，console.warn
- `MemoryRepositoriesSnapshot.deliverables` 类型变化是 breaking —— 消费者（核心只有 memory-repositories 和 browser-runtime-storage）同步改就行，外部 0 引用（grep 验证）
