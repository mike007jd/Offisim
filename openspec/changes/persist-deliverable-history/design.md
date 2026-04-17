## Context

**当前状态：**
- `deliverable.created` 事件由 core 图节点 emit，payload 含 `deliverableId`(UUID) / `threadId` / `title` / `content` / `kind?` / `fileName?` / `mimeType?` / `contributingEmployees[]` / `createdAt`（`RuntimeEvent` envelope 额外给 `companyId`）。
- 事件落地只走两条路径：(1) `VaultSyncService` 无反应（订阅前缀是 `employee.` / `memory.` / `relationship.`，不碰 deliverable）；(2) `useDeliverables()` React state 内存保存。runtime reinit 或 tab close 即全丢。
- `runtime_events` 表由 `EventRepository.insert()` 写入，但 **只有 `conversation-budget-service` 等两处主动调用**，通用 event bus 没接管，deliverable 事件根本不进这张表。
- `RuntimeRepositories` 11 个家族已按 `repository-backend-boundaries` spec 切到 per-family 子目录（`drizzle` / `memory` / `tauri` 三后端 ≤320 NBNC）。
- 产品层 H2（`unify-deliverable-card-surfaces`）要让 Tasks / chat / deliverable 卡讲同一个故事；前提是有一个 queryable 的历史层。

**约束：**
- 不引入新 Platform 端表（marketplace 和 runtime 数据隔离）
- 遵循三后端同步（repository-backend-boundaries spec）
- `HookRegistry`（sync）vs `EventBus`（async）的 gotcha — 持久化不能阻塞流控
- 内容 inline TEXT，但要对超大 content（> 1 MB）做字节保护

## Goals / Non-Goals

**Goals:**
- 新增 `deliverables` SQLite 表 + `DeliverableRepository` contract，按 company/thread/时间查
- 新增 `deliverables` 家族三后端实现，NBNC ≤ 320
- 新增 `DeliverablePersistenceService`，订阅 `eventBus.on('deliverable.created')` 把 payload 写入 repo
- `useDeliverables()` hook mount 时读取历史 hydrate，再 merge 实时事件，dedup 用 `deliverableId`
- `repository-backend-boundaries` spec 家族扩到 12，保持契约等价

**Non-Goals:**
- Platform（`db-platform`）表 / API —— marketplace 不混 runtime 数据
- 纯浏览器（无 Tauri）端的持久化 —— memory repo session 内有效，刷新即空；文档化为已知 gap
- Vault 文件自动导出 —— PitchHall 已有用户触发的 "Save Locally"，不自动
- 加密 / 全文索引 / 版本化 —— 本轮不做
- UI 产品面合并（Tasks / chat / deliverable 的三表面统一）—— 交给 H2
- `runtime_events` 表和审计链路改造 —— 保持隔离

## Decisions

### D1: 独立 `deliverables` 表 vs 复用 `runtime_events`

**选择：** 独立表。

**理由：**
- `runtime_events` 是 **不透明 JSON 审计流**，payload_json 是 `any`，查"列某公司所有 deliverable"得 `JSON_EXTRACT` 全表扫，生产不可用。
- deliverable 是结构化制品（有 fileName / mimeType / content 字节大小），和"事件流"语义不同。
- 已存 `fileHistory` 表是对照组（结构化制品 + inline content），precedent 成立。

**备选：** 在 `runtime_events` 上加索引 + JSON 列提取。放弃：字符串列索引脆弱，schema 变动传染审计流。

### D2: `content` 字段 inline TEXT vs vault 文件 + path pointer

**选择：** inline TEXT，单条 clamp 1 MB。

**理由：**
- 产品实测 deliverable 典型 20–100 KB，outlier 500 KB。inline 在 SQLite 里几百 MB 内都没事。
- Vault 是用户触发的导出路径，不是 runtime 默认写入。引入 vault-first 会多一套 `vault_path` 回读协议 + vault 未挂载时的 fallback，复杂度远超收益。
- clamp 1 MB：写入前检查 `content.byteLength`，超过则截断 + emit `deliverable.persisted.truncated` warning log，不崩。

**备选：** 单独 `deliverable_content` 表解耦元数据和 body。放弃：本轮无必要，两个表的 JOIN 拖慢 listByCompany。

### D3: 主键 `deliverable_id` + `INSERT OR IGNORE` 幂等

**选择：** PRIMARY KEY 直接用 payload 的 `deliverableId`（已是 UUID），写入用 `INSERT OR IGNORE`。

**理由：**
- event 可能重放（hook 双订阅 / 重入）；INSERT OR IGNORE 让写入天然幂等。
- 不追求"更新"语义 —— 本轮 deliverable 是一次性制品，没有 edit。

**备选：** UPSERT by `(thread_id, file_name, content_hash)`。放弃：引入 hash 计算且语义不清（改了内容算新还是旧？）。

### D4: 写入触发点：`EventBus` 订阅服务 vs `HookRegistry` hook

**选择：** `EventBus.on('deliverable.created')`，新 `DeliverablePersistenceService` 管理订阅。

**理由：**
- `HookRegistry` 是 **串行 await**，持久化失败会阻塞图节点流控 —— 不可接受。
- `EventBus` fire-and-forget，和 `VaultSyncService` / `NotificationBridge` 一致 pattern。
- 服务自管生命周期：runtime 初始化时实例化，dispose 时 unsub。失败走 `console.error` + 不重试（本轮不做重试队列）。

**备选：** `event-persister.ts` 复用。放弃：该文件现在只有 `deriveSeverity()` helper，没有写入主循环；硬接会改变既有语义。

### D5: UI hydrate 路径 —— runtime context 暴露查询函数

**选择：** 在 `OffisimRuntimeContext` value 上加 `listRecentDeliverables(opts): Promise<DeliverableRow[]>`，内部调 `repos.deliverables.listByCompany(companyId, { limit })`。

**理由：**
- 让 UI 不直接握有 `repos` 引用（未来换 backend 不需要改 React）
- `listRecentDeliverables` 名字就表达"最近 N 条"，契合 H2 deliverable list 的消费场景
- `useDeliverables` hook 在 mount effect 里先 await 历史 → `setDeliverables(history)` → 再 subscribe live events merge

**备选：** hook 直接从 `runtime.repos.deliverables` 调。放弃：暴露内部层、未来破坏面大。

### D6: Dedup 改用 `deliverableId` 主键

**选择：** `useDeliverables` 按 `deliverable.id === incoming.id` 去重；老的 `(threadId + kind + fileName + content)` 四元组去重作 fallback（兼容漏 id 的极端路径）。

**理由：**
- payload 里 `deliverableId` 已是 UUID，就是天然去重键
- 历史 hydrate + live 事件合并必须用稳定 ID，否则会双渲染同一个 deliverable

### D7: 新家族加入 `RuntimeRepositories` 走 optional slot

**选择：** `RuntimeRepositories.deliverables?: DeliverableRepository`，和 `userPreferences?` / `agentEvents?` / `recoveryKnowledge?` 一致。

**理由：**
- 三后端分批落地允许旧 backend 暂时不实现（memory / tauri 后接，drizzle 先接）
- `DeliverablePersistenceService` 在订阅前先 `if (!repos.deliverables) return;` 守卫，缺失时 no-op（服务装载仍成功）
- 本轮 tasks 会把三后端一次全落齐，但 contract 保持 optional 以和既有模式一致

**备选：** 做 required + 强制 memory/tauri 实现。放弃：会放大本轮 scope；后续家族 optional pattern 是既成事实。

## Risks / Trade-offs

**[风险 R1] inline `content` 超大对象拖慢 listByCompany**
→ Mitigation: listByCompany 默认 `SELECT deliverable_id, thread_id, title, file_name, mime_type, LENGTH(content) AS content_size, created_at` 不拉 content；拉详情走独立 `findById(id)` 返回完整 row。UI hydrate 列表视图只需要 metadata，打开卡片时按需加载 content。

**[风险 R2] 写入失败时用户不可见**
→ Mitigation: 本轮服务 catch 异常只 `console.error`，不 toast；H2 做 UI 时再考虑错误 surface。记作 Open Question。

**[风险 R3] `repository-backend-boundaries` spec 家族列表改动**
→ Mitigation: 用 MODIFIED Requirements 把家族表从 11 行扩到 12 行，其余 Scenario / NBNC 约束不变。archive 时 spec diff 清晰可 review。

**[风险 R4] 浏览器端 memory repo 只活一个 session**
→ Mitigation: 文档化为已知 gap。H2 / 未来 web-persistence change 再补。本轮在 proposal / CLAUDE.md / queue 文件里留明确文字，不做假兜底。

**[风险 R5] Content 超过 1 MB 被静默截断**
→ Mitigation: 写入时检查字节数，超过则截断前 1 MB + emit `vault.sync.failed`-风格事件（可选，本轮先 console.warn），不崩不丢事件。写入路径必须用 `Buffer.byteLength` 判 UTF-8 字节而非 `string.length`。

**[风险 R6] 老 session 升级后没有历史**
→ Mitigation: 不做数据回填（runtime_events 的 deliverable 事件从没完整落过，没得回填）。文档说明首次上线历史为空是预期。

**[风险 R7] Web 端 localStorage snapshot quota 爆裂**
→ `MemoryDeliverableRepository.snapshot()` 返回 full rows（含 content）并进 `offisim:browser-runtime-snapshot:v1`。N=100 × 100KB = 10MB，浏览器 localStorage quota ≈5–10MB/origin，大 deliverable 多了会 `QuotaExceededError` 把整个 snapshot 写入失败（连锁影响 employees / memories / zones 等状态持久化）。
→ Mitigation 本轮：现实使用量有限（产品暂无大批量生成场景），live 单条 7KB 验证通过。后续独立 change（`optimize-deliverable-persistence-hotpath` 或等价）拆 web snapshot：metadata 走主 snapshot，content 走单独 IndexedDB key 或仅保留最近 N 条。desktop 不受影响（SQLite 存储）。

## Migration Plan

1. **db-local migration `023_deliverables.sql`**: `CREATE TABLE IF NOT EXISTS deliverables (...)` + 索引
2. **core 侧 contract + 三后端 repo 实现** + barrel 追加新 family factory
3. **`DeliverablePersistenceService`** 挂到 runtime 启动序列，dispose 挂到 runtime dispose
4. **runtime context** 暴露 `listRecentDeliverables`
5. **`useDeliverables`** hook hydrate + merge
6. **spec 同步**：`repository-backend-boundaries` delta 改家族表；`deliverable-persistence/spec.md` 新 spec 落契约
7. **live 验证** —— desktop 用真任务触发 deliverable，关应用再开，PitchHall / chat 能显示历史

**回滚策略：**
- migration 本身可逆（DROP TABLE），但既有数据会丢（本轮预期无生产数据依赖）
- 代码改动走 git revert；barrel 聚合点回到未加家族的状态

## Open Questions

- **OQ1**：持久化失败是否要 surface 到 UI？本轮倾向不 surface（和 `VaultSyncService` 行为一致，只有 `target: activate` 才强走 toast）。H2 再看。
- **OQ2**：`contributingEmployees` 是否应作为规范化表（`deliverable_contributors`）？本轮先 JSON blob inline `contributors_json` 字段，简单查询足够；等规范化需求出现再拆。
- **OQ3**：`listRecentDeliverables` 签名是否带 `threadId` 过滤？本轮加 `{ companyId, threadId?, limit? }`，H2 按 thread 分组时直接能用。
