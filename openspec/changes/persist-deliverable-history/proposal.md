## Why

员工 `deliverable.created` 事件里的 file 产物（HTML / Markdown / CSV / JSON …）当前只活在 `useDeliverables()` 的 React state 里，runtime 一 reinit、tab 一刷新、app 一重开就全部丢失。`deliverable-artifact-handoff` spec 解决了"事件到 chat 卡片"的投递问题，但没写持久化。结果是：PitchHall、chat artifact card、Tasks tab 每次都要重新触发任务才能看到任何东西，产品层的"过程即价值"承诺立不住。

H2 `unify-deliverable-card-surfaces`（Tasks / chat / deliverable 三个表面讲同一个故事）必须建立在可查询的 history 之上；H1 先把 capability 层补齐：一张表、一个 repo、一条写入路径、一条 hydrate 路径。不做产品表面改造。

## What Changes

- 新增 SQLite 表 `deliverables`（db-local migration `023_deliverables.sql`），inline `content` 字段，按 `company_id`/`thread_id`/`created_at` 索引
- 新增 `DeliverableRepository` contract（`packages/core/src/runtime/repositories.ts`），`RuntimeRepositories` 追加 `deliverables?` slot
- 新增 `deliverables` 仓库家族三后端实现：`packages/core/src/runtime/repos/deliverables/{drizzle,memory}.ts` + `apps/web/src/lib/tauri-repos/deliverables.ts`，每文件 ≤320 NBNC
- 新增 `DeliverablePersistenceService`（core 侧），订阅 `eventBus.on('deliverable.created')` 写入 `deliverables` repo；和 `VaultSyncService` 的订阅模式保持一致（服务自管生命周期，runtime 启动时挂载、dispose 时 unsub）
- 更新 `useDeliverables()` hook（ui-office）：mount 时先用 runtime 暴露的 `listDeliverables({ companyId, limit })` hydrate 历史，再订阅 live 事件 merge；去重 key 扩到 `deliverableId`（payload 里已有 UUID）
- **MODIFIED** `repository-backend-boundaries` spec：11 家族 → 12 家族，新增 `deliverables` 家族一行、其 3 后端文件契约
- 已存 `runtime_events` 表不动（仍是 opaque JSON 审计流），deliverable 作为有 schema 的一类制品走独立表

## Capabilities

### New Capabilities
- `deliverable-persistence`: 定义 `deliverable.created` 事件到本地 SQLite `deliverables` 表的写入契约、`DeliverableRepository` 查询契约、以及 `useDeliverables()` 启动 hydrate 行为。只覆盖 capability 层（表、repo、事件→repo 写入、hook hydrate），不定义 UI 表面合并（H2 的事）。

### Modified Capabilities
- `repository-backend-boundaries`: 家族列表从 11 扩到 12，`deliverables` 家族加入 per-family 子目录 + 三后端 ≤320 NBNC 契约；家族表增加 `deliverables -> deliverables` 一行。

## Impact

**代码：**
- `packages/db-local/src/schema.ts` + `migrations/023_deliverables.sql` — 新表、新迁移
- `packages/core/src/runtime/repositories.ts` — 追加 `DeliverableRepository` / `NewDeliverable` / `DeliverableRow` 类型，`RuntimeRepositories.deliverables?`
- `packages/core/src/runtime/repos/deliverables/{drizzle,memory}.ts` — 新家族 2 文件
- `apps/web/src/lib/tauri-repos/deliverables.ts` — Tauri 镜像
- `packages/core/src/runtime/drizzle-repositories.ts` / `memory-repositories.ts` / `apps/web/src/lib/tauri-repos.ts` — barrel 追加新家族 factory 调用
- `packages/core/src/services/deliverable-persistence-service.ts` — 新服务，订阅 EventBus 写入 repo
- `packages/core/src/runtime/*.ts`（runtime 启动路径）— 实例化 `DeliverablePersistenceService` 并注册 dispose
- `packages/ui-office/src/hooks/useDeliverables.ts` — hydrate + merge 逻辑

**不影响：**
- Platform（`db-platform`）不动；marketplace 和运行时数据不混
- Web 纯浏览器模式（无 Tauri）本轮不做持久化，历史仍空 —— 文档化为已知 gap，H2 再定
- `DeliverableArtifactCard`、`PitchHall` 渲染不改
- `deliverable-artifact-handoff` spec 不动（纯 UI 契约）
- `runtime_events` 表和审计链路不动

**风险：**
- `content` 字段 inline TEXT，理论单个 deliverable 上限几百 KB；需要在 migration 之外约束写入路径做最大字节数保护（按 1 MB clamp 截断 + 打 warning 日志，不崩）
- 老 session 升级后无历史数据，冷启动首次 hydrate 为空 —— 预期行为，不做回填迁移
- `RuntimeRepositories.deliverables?` 保持 optional 兼容 memory/tauri 分批上线（和既有 `userPreferences?` / `agentEvents?` 一致）
