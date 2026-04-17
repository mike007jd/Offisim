## Context

H1 (`persist-deliverable-history`) 落地 + live verify 后两条结构性 risk 写进 archived design.md 的 R7 / R8：

- **R7**: `MemoryDeliverableRepository.snapshot()` 产出 full rows（含 content），`saveBrowserRuntimeSnapshot` `JSON.stringify` 整个 `MemoryRepositoriesSnapshot` 写 `offisim:browser-runtime-snapshot:v1`。真实用户每公司可达 N=100+ deliverable，典型 20–100 KB / 条，峰值到 ~1 MB / 条（inline clamp 上限）。10 MB + localStorage quota ≈5–10 MB/origin 会 QuotaExceededError，整 snapshot 写入失败 → 整个 repo state（companies / employees / memories / zones / 等 34 个 slot）全丢，不只 deliverables。
- **R8**: `OffisimRuntimeProvider.listRecentDeliverables` 先 `repo.listByCompany` 拿 summary（10 列 metadata + content_size）再 `Promise.all(summaries.map(s => repo.findById(s.deliverable_id)))` 拉 full row。本地 SQLite better-sqlite3 同步，Promise.all 损耗可忽略；但 Tauri plugin SQL 每 findById 是 IPC round-trip（macOS 约 1–3 ms），N=100 串行 100–300 ms，**在 runtime ready 关键路径上阻塞 first meaningful PitchHall render**。Web memory repo 直接 Map.get 快，但也走 Promise.all 链路。

H1 eager hydrate 决策当时写注释："本地 SQLite N+1 廉价，消除 UI lazy 分支"。这判断在 better-sqlite3 和 memory 成立，在 Tauri IPC 不成立。H2 (`unify-deliverable-card-surfaces`) 会把 chat / Kanban / PitchHall 三个 deliverable 表面统一，任意一个表面 mount 都触发一次 hydrate —— N+1 成本会 × 消费者数，R7 quota 会被更频繁刷写放大。先修 hotpath 再做 UI 合一。

**约束：**
- 不引入 Platform DB 改动（policy: marketplace 与 runtime 数据隔离）
- `deliverable-persistence` capability 契约已 archive，对外 API（`useDeliverables() → Deliverable[]`）保持 byte-identical；内部 repo 接口扩，消费者无感
- IDB async 和现行 localStorage 同步 write 模式不兼容 —— content bridge 自管异步生命周期，不阻塞 flush
- desktop Tauri SQLite 天然无 quota 问题，但 N+1 IPC 必须消
- 不做 Platform sync / 加密 / 全文索引（同 H1 non-goal）

## Goals / Non-Goals

**Goals:**
- R7 消除：web localStorage snapshot 不再含 inline deliverable content；N=500 条 × 100KB 也不踩 quota
- R8 消除：`listRecentDeliverables` 单次 repo call 拿回全 rows，Tauri IPC 从 N+1 降到 1
- 契约清晰：`DeliverableRepository` 三个查询方法各司其职（`listByCompany` metadata only / `findById` 单行 full / `listByCompanyWithContent` bulk full）
- 回归安全：H1 live verify 用的 snake.html round-trip 场景在新实现下仍通（browser refresh 后 PitchHall 卡仍渲染）

**Non-Goals:**
- Platform（`db-platform`）表 / API —— 与 H1 一致
- 多 company 跨 session IDB 隔离以外的功能（IDB db name / store 按 `offisim` origin 全局，company_id 存 row 字段）
- 加密 / TTL / content quota（单条超限 H1 已 clamp 1 MB；本 change 不加新 limit）
- UI 表面合并（交给 H2）
- `runtime_events` / `agent_events` 等其他 repo 走同样 IDB 拆分 —— 本轮只针对 deliverable（content 大 + 量大）

## Decisions

### D1: Content 存 IndexedDB vs localStorage 子 key vs 分片 blob

**选择：** IndexedDB，单 objectStore `deliverable_content`，key=`deliverable_id`，value=content string。

**理由：**
- IDB 配额在现代浏览器是 "按 origin 全可用磁盘的 60%"（Chrome / Firefox），远大于 localStorage 5–10 MB 硬限
- Raw IDB API（不引 `idb-keyval` 等依赖）足以覆盖 get / put / delete / clear 四操作，代码量 <60 NBNC
- localStorage 多 key 方案（`offisim:deliverable:content:<id>`）同样受 origin 总 quota 限制，不解决 R7
- Blob / Cache API 过度工程 —— content 是 UTF-8 TEXT，string 直存即可

**备选：** `idb-keyval` 库（添加依赖），IndexedDB 带 schema 迁移（overkill），或 FS Access API（需用户 opt-in）。放弃。

### D2: IDB 写入入口 —— 独立 subscriber vs memory repo 写回

**选择：** 独立 `createDeliverableContentBridge(eventBus)` 订阅 `deliverable.created`，在 `browser-runtime-storage.ts` 同文件。Memory repo 不直接碰 IDB。

**理由：**
- 保持 memory repo 纯（in-memory + 可选 contentLoader callback，不绑 IDB API）
- Bridge 与 `DeliverablePersistenceService` 正交：前者写 IDB content，后者写 memory repo row。两个 subscriber 无依赖
- Dispose 路径对称：`createBrowserRuntimePersistence` 返回的 `{ flush, dispose }` 合入 bridge 的 dispose
- 测试友好：memory repo 在 Node 环境可裸跑（无 IDB polyfill 需求）

**备选：** memory repo 内部 `if (typeof indexedDB !== 'undefined') persistToIdb(...)`。放弃 — Node 测试 + desktop 场景都要加 guard，扩散复杂度。

### D3: Memory repo `findById` 的 content 来源路径

**选择：** `MemoryDeliverableRepository` 构造接 `contentLoader?: (id: string) => Promise<string | null>` callback。内部 `Map<string, DeliverableRow>` 存 summary-shape 行（content 字段 `''`）+ `Map<string, string>` 临时 content cache（live insert 时全量存）。`findById(id)`：
1. 先查内存 contentCache（live insert 来的一定有）
2. miss 则调 contentLoader（web 从 IDB 拉）
3. contentLoader 返回 null 则 row.content 留空，console.warn 一次

**理由：**
- Snapshot round-trip：memory repo 从 summary 恢复，content cache 是空，contentLoader 负责 lazy hydrate — 第一次 findById 触发 IDB read（async），之后内存 cache 命中
- Live event：`DeliverablePersistenceService.insert` 把 full row 塞进 repo，content cache 当场有内容 —— 不等 IDB 写回也能立即 findById
- IDB bridge 写延迟 / 失败不影响 session 内读：内存 cache 优先

**备选：** repo 不缓存 content，每次 findById 都查 IDB。放弃 — session 内重复 read 浪费 IPC-like IDB round-trip。

### D4: `listByCompanyWithContent` 方法信号

**选择：** 新增 `DeliverableRepository.listByCompanyWithContent(companyId, opts?): Promise<DeliverableRow[]>`，保留原 `listByCompany` 返 summary。

**理由：**
- 契约隔离：list-summary 用于 "总览 / 不需要 body" 的未来 listview 场景（例如 H2 kanban 预览）；list-with-content 用于 "hydrate 到 hook 渲染完整卡片"
- 三后端实现一次 SQL：drizzle / tauri `SELECT *` + `ORDER BY created_at DESC`；memory 遍历 Map + contentLoader 批量拉 IDB（`Promise.all` per id，但这是 Web IDB 内部并行，不是 IPC）
- N+1 消除：`OffisimRuntimeProvider.listRecentDeliverables` 单次 repo call，Tauri IPC 从 101 降到 1

**备选：** 把 `listByCompany` 本身改成 summary/full 可选 flag。放弃 — 契约模糊化，scenario 写 "without content" 还是 "with content" 要分叉，现有 `listByCompany excludes content` scenario 就会 MODIFIED。

### D5: IDB 生命周期 —— 每 company 隔离 vs 全局共享

**选择：** 全局共享单 db `offisim-runtime` / store `deliverable_content`，key = `deliverable_id`（UUID 全局唯一）。row metadata 里的 `company_id` 字段是过滤依据，content 层不分。

**理由：**
- `deliverableId` 由 `generateId('del-')` 生成 UUID v4，天然全局唯一 —— 无冲突
- 用户切 company 时不需要重 open 不同 db
- 清理：未来若加 company 删除或 deliverable 删除，通过 row metadata 的 company_id 筛出 ids，逐个 `store.delete(id)`

**备选：** per-company db。放弃 — 跨 company IDB 交互复杂度远超收益。

### D6: Snapshot 兼容性 —— 既有 localStorage 数据怎么迁移

**选择：** 一次性 migration：新版 browser-runtime 启动时检测 `reposSnapshot.deliverables[*].content` 非空，把 content 批量写入 IDB，然后内存 repo 初始化后 summary 会自然返回 content_size。localStorage 下次 flush 自动 overwrite 为 summary 形态。

**理由：**
- 已存 localStorage 含 content 的行（H1 archived 后的用户）不丢数据
- Migration 一次发生在 `createBrowserRuntime` / `createBrowserRuntimeReposOnly`，fire-and-forget `void persistOldContentToIdb(...)`，不阻塞 runtime ready
- 下次 snapshot write 走新契约，自动收敛

### D7: Content loader 在 desktop 场景是 undefined 吗？

**选择：** Desktop Tauri memory-only 使用不走 memory repo（Tauri runtime 走 drizzle Tauri repo），无此问题。Memory repo 的 `contentLoader` 参数在 desktop / Node 测试默认 `undefined`，`findById` 走纯内存路径（cache 直读）。

**理由：**
- Desktop 从不调 memory repo —— `createTauriRuntime` 用 `createTauriRepositories(db)` 注入 drizzle Tauri repo
- `contentLoader` 只在 browser 环境下注入（`createBrowserRuntime` 里从 `deliverable-content-idb.ts` 取）
- Memory repo 无 IDB 访问时的完整性：live insert 走内存 cache；snapshot-seeded rows 若无 contentLoader 则 content='' 永久 —— 这是"Node 测试纯内存"场景的合理行为

## Risks / Trade-offs

**[R1] IDB 写与 snapshot flush 的一致性窗口**
→ Live event 到 → memory repo full row 入 cache（content 立即可读）→ content bridge 写 IDB（async，~ms 级） → 下次 snapshot flush memory repo summary 入 localStorage。若在 IDB 写完成前浏览器崩溃，localStorage 有 summary 但 IDB 无 content — refresh 后 findById 返回 content='' + console.warn。用户损失该条 content。
→ Mitigation：content bridge 用 `putContent(id, body)` 同步开始 transaction 并 `await tx.done`，事件 handler `await` 这个 write；即 `onEvent → await idb.put → resolve`。崩溃只能丢尚未触发 flush 的 live event，对应本来就没持久化（和 H1 `DeliverablePersistenceService` fire-and-forget 语义一致）。

**[R2] IDB 不可用（隐私模式 / Safari 第三方 iframe / 老浏览器）**
→ Bridge 构造时 `indexedDB.open` 失败 / `databases()` 未定义，`contentLoader` 成 no-op 返 null。memory repo 仅在 live session 内有 content，refresh 后返空。
→ Mitigation：Bridge 有 availability flag，失败时 console.warn 一次 + `contentLoader` 返 null。退化到 H1 前的 "session-only" 行为，不崩不丢错 Toast。

**[R3] IDB 与 localStorage 去同步**
→ 用户 Clear IDB 但未 clear localStorage：snapshot.deliverables 有 summary 但 IDB 无 content。findById 返 row.content=''，hook 里 PitchHall 渲染空卡。
→ Mitigation：`mapDeliverableFullRowToHookRow` 在 content='' 且 fileName 非空时仍可渲染（artifact fallback 到 "file artifact without preview"）。UX 可接受。后续可加 "content missing" 标识但不在本 change scope。

**[R4] `MemoryRepositoriesSnapshot.deliverables` 类型 breaking**
→ 外部 consumer 只有 `memory-repositories.ts` 内部 + `browser-runtime-storage.ts`。grep `MemoryRepositoriesSnapshot['deliverables']` / `.deliverables` 在 repo 零外部引用。
→ Mitigation：本 change 一次性同步类型 + snapshot 生成点；因 H1 刚落、MemoryRepositoriesSnapshot.deliverables 字段存在时长 <24h，用户环境 localStorage 大概率仍空，D6 migration 即使跑空 no-op 也正确。

**[R5] Desktop Tauri 享受 R8 消 N+1，但不享受 R7（SQLite 不爆 quota）**
→ Trade-off：方案覆盖 Tauri R8 但 R7 天然不存在。Memory repo 路径的 R7 修复是 web-only。
→ Mitigation：可接受。desktop 已是"真"持久化，web 是 "best-effort" 持久化，两侧 R8 优化对称、R7 只针对有问题的 web。

**[R6] N+1 改单次 SQL 后 SELECT * 返大 rowset 是否撑爆 IPC / 内存**
→ Tauri plugin SQL 一次返 100 × ~100KB = 10 MB JSON via IPC。macOS 测下 IPC 消息上限足够（实际观察 >50 MB 单次也通），但 JSON parse 阻塞主线程。
→ Mitigation：limit 默认 100 条，消费者 `listRecentDeliverables` 显式传；用户要拿更多（未来 H2 "show all deliverables" 功能）应做分页，本 change 不提前造。

## Migration Plan

1. **IDB store + bridge 先落**：`apps/web/src/lib/deliverable-content-idb.ts` + `browser-runtime-storage.ts` 加 `createDeliverableContentBridge` —— 独立可测、不改 repo 契约
2. **repo 契约扩**：`packages/core/src/runtime/repositories.ts` 加 `listByCompanyWithContent` 方法；`MemoryRepositoriesSnapshot.deliverables` 切 `DeliverableSummaryRow[]`；`MemoryDeliverableRepository` 构造接 `contentLoader?`
3. **三后端实现**：drizzle + tauri 加 `listByCompanyWithContent`（一次 SQL），memory 加 + snapshot 返 summary + findById 走 contentLoader 路径
4. **Runtime wire**：`createBrowserRuntime` / `createBrowserRuntimeReposOnly` 构造 IDB bridge + 透传 contentLoader；`OffisimRuntimeProvider.listRecentDeliverables` 改调 `listByCompanyWithContent`；删除 Promise.all findById loop
5. **Migration 一次性**：检测老 localStorage snapshot 带 content 的行，`void persistOldContentToIdb(oldSnapshot)` 把 content 写 IDB
6. **Spec 同步**：MODIFY `openspec/specs/deliverable-persistence/spec.md` 的 browser snapshot requirement + 新增 `listByCompanyWithContent` requirement
7. **Live verify**：
   - web：生成 3 条大 deliverable（~500KB 各），refresh 不丢；快速连发 10 条观察 localStorage size 线性不爆
   - desktop Tauri 真机（user step）：触发多条 deliverable，观察 `listRecentDeliverables` timing < 50ms
8. **typecheck + serial build 全绿** → archive

**回滚策略：**
- git revert 整个 change：repo 契约回到 H1 archived，但 localStorage 可能已有新契约的 summary 行；revert 后 memory repo 构造会收到 `deliverables: DeliverableSummaryRow[]`（缺 content 字段），`MemoryDeliverableRepository` 旧版 constructor 期望 `DeliverableRow[]`，运行时会 content='' 但不崩。手动清 localStorage 即可恢复干净状态。

## Open Questions

- **OQ1**：H2 落地后是否保留 `listByCompany` summary-only 接口？——本 change 保留作为 future listview 钩子，H2 propose 时再看是否真有消费者。若无，H2 或之后可 deprecate。
- **OQ2**：IDB 老数据清理策略 —— 用户删 deliverable 或切 company 时是否同步 `store.delete(id)`？当前 H1 没有删除路径；未来有时在此 IDB store 上加对应 hook。先不做。
- **OQ3**：content bridge 失败（IDB write rejected）是否 surface 到 UI？同 H1 decision 一致：`console.error`，不 toast。下条迭代（如果出现真报错频发）再考虑。
