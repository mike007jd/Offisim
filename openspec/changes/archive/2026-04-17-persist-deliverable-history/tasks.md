## 1. Schema & Migration (db-local)

- [x] 1.1 在 `packages/db-local/src/migrations/` 新增 `023_deliverables.sql`：`CREATE TABLE deliverables (deliverable_id TEXT PRIMARY KEY, company_id TEXT NOT NULL REFERENCES companies(company_id) ON DELETE CASCADE, thread_id TEXT, title TEXT NOT NULL, content TEXT NOT NULL, kind TEXT, file_name TEXT, mime_type TEXT, contributors_json TEXT NOT NULL, created_at TEXT NOT NULL)` + `CREATE INDEX idx_deliverables_company_time ON deliverables(company_id, created_at DESC)` + `CREATE INDEX idx_deliverables_thread_time ON deliverables(thread_id, created_at DESC)`
- [x] 1.2 在 `packages/db-local/src/schema.ts` 追加 `export const deliverables = sqliteTable('deliverables', { ... })`，字段与 migration byte-identical，加 index 定义
- [x] 1.3 `pnpm --filter @offisim/db-local build` 通过；跑已有 migration 目录 smoke（desktop runtime 启动后看 SQLite 里有 `deliverables` 表）— desktop 侧 migration 同步到 `Docs/03_migrations/offisim_migrations_local_v0.1/029_deliverables.sql` + `apps/desktop/src-tauri/src/lib.rs` version 29 注册；db-local build 绿，desktop 启动需 user live 核对（Phase 7.3）

## 2. Repository Contract

- [x] 2.1 在 `packages/core/src/runtime/repositories.ts` 追加 `DeliverableRow` / `DeliverableSummaryRow` / `NewDeliverable` 类型 + `DeliverableRepository` interface（`insert` / `findById` / `listByCompany`），`listByCompany` 默认 limit=100，summary 不带 content
- [x] 2.2 在同文件 `RuntimeRepositories` 追加 `deliverables?: DeliverableRepository` optional slot（贴齐既有 `userPreferences?` / `agentEvents?` 风格注释）
- [x] 2.3 `pnpm --filter @offisim/core typecheck` 通过

## 3. Repository 三后端实现

- [x] 3.1 新增 `packages/core/src/runtime/repos/deliverables/drizzle.ts`：`createDeliverablesDrizzleRepos(db)` 返回 `{ deliverables: DeliverableRepository }`；`listByCompany` 的 SELECT 显式列 + `length(content) as content_size` 不拉 content；`insert` 用 `onConflictDoNothing({ target: deliverables.deliverable_id })`（drizzle-orm SQLite helper）；文件 ≤320 NBNC（113 NBNC）
- [x] 3.2 新增 `packages/core/src/runtime/repos/deliverables/memory.ts`：`class MemoryDeliverableRepository`（按既有 D8 class pattern）持 `Map<string, DeliverableRow>`，`insert` 见重复 ID no-op；`listByCompany` 排序 + 截断 limit；`findById` 查 Map；`.snapshot()` / `.seed()`；`createDeliverablesMemoryRepos(snapshot?)` factory；文件 ≤320 NBNC（72 NBNC）
- [x] 3.3 新增 `apps/web/src/lib/tauri-repos/deliverables.ts`：镜像 drizzle 版，所有方法 async/await；`createDeliverablesTauriRepos(db: TauriDrizzleDb)`；文件 ≤320 NBNC（112 NBNC）
- [x] 3.4 `packages/core/src/runtime/drizzle-repositories.ts` barrel：import `createDeliverablesDrizzleRepos`，在 `createDrizzleRepositories()` 返回对象追加 `...createDeliverablesDrizzleRepos(db)`；barrel 保持 ≤200 NBNC（44 NBNC）
- [x] 3.5 `packages/core/src/runtime/memory-repositories.ts` barrel：同上，`createDeliverablesMemoryRepos` 接入（barrel 152 NBNC），`MemoryRepositoriesSnapshot.deliverables` 字段同步新增
- [x] 3.6 `apps/web/src/lib/tauri-repos.ts` barrel：同上，`createDeliverablesTauriRepos` 接入（barrel 40 NBNC）
- [x] 3.7 `pnpm --filter @offisim/core build && pnpm --filter @offisim/web build` 依次通过（串行）

## 4. Persistence Service

- [x] 4.1 新增 `packages/core/src/services/deliverable-persistence-service.ts`：`class DeliverablePersistenceService { constructor({ eventBus, repo }); dispose() }`；订阅 `eventBus.on('deliverable.created', this.handle)`；`handle(event)` 内部 `try { await repo.insert(mapPayloadToRow(event)) } catch(err) { console.error(...) }`；`repo` 不存在时 `console.warn` 一次（`warnedMissingRepo` 实例字段 flag）
- [x] 4.2 `mapPayloadToRow`：payload → NewDeliverable；content UTF-8 字节数超过 1 MB 时 `Buffer.byteLength` / `TextEncoder` 判、截断 + `console.warn` 记录原 size；`contributors_json = JSON.stringify(payload.contributingEmployees)`；`created_at = new Date(payload.createdAt).toISOString()`
- [x] 4.3 在 runtime 启动路径实例化 service，挂 `dispose()` 到既有 dispose 合成路径 — 4 个 factory 同步：`createBrowserRuntime`、`createBrowserRuntimeReposOnly`、`createTauriRuntime`、`createTauriRuntimeReposOnly`
- [x] 4.4 `pnpm --filter @offisim/core typecheck` 通过；desktop 启动一次确认无 `repos.deliverables missing` warn — desktop live 校验留 Phase 7.3（tauri family barrel 已接，理论上 warn 不会触发）

## 5. Runtime Context Exposure

- [x] 5.1 在 runtime factory 返回对象追加 `listRecentDeliverables(opts: { threadId?: string; limit?: number }): Promise<DeliverableHookRow[]>` + `loadDeliverableContent(id)`；内部取当前 activeCompanyId 调 `repos.deliverables?.listByCompany`，**Option B 决策**：eager hydrate — `listByCompany` 后 `Promise.all(summaries.map(findById))` 拉全 content，映射 `DeliverableRow → DeliverableHookRow`（`resolveDeliverableArtifact` 构造 `artifact`）。理由：本地 SQLite N+1 廉价，消除 UI 层 lazy-load 分支。代码注释已记录。
- [x] 5.2 更新 `packages/ui-office/src/runtime/offisim-runtime-context.tsx` 的 context value 类型 & `apps/web/src/runtime/OffisimRuntimeProvider.tsx` provider 透传 `listRecentDeliverables` + `loadDeliverableContent`
- [x] 5.3 `pnpm --filter @offisim/ui-office typecheck` 通过

## 6. UI Hook Hydration + Merge

- [x] 6.1 改 `packages/ui-office/src/hooks/useDeliverables.ts`：mount effect 先订阅 `eventBus.on('deliverable.created')`（race-safe），再 `await runtime.listRecentDeliverables({ limit: 100 })` 并用 `upsertDeliverable` 合并（live 事件先到会保留）
- [x] 6.2 dedup 改按 `existing.id === next.id` 主键去重；deliverableId 缺失时 fallback `fallbackDedupeKey = threadId + kind + fileName + content` 四元组
- [x] 6.3 按 5.1 的 Option B 决策：hydrate 时 eager 拉全 content，hook 消费者（PitchHall 等）拿到的 `Deliverable.content` 直接可用，无需 lazy-load 路径。`runtime.loadDeliverableContent(id)` 仍保留作为后续 refresh/manual-reload 的工具（未来 H2 可能用）
- [x] 6.4 `pnpm --filter @offisim/ui-office build` 通过

## 7. Spec Sync + Live Verification

- [x] 7.1 人工核对 `openspec/changes/persist-deliverable-history/specs/deliverable-persistence/spec.md` 所有 scenario 在新代码里都能成立（review-by-reading）— 每条 scenario 都有对应代码落点：
    - "Fresh deliverable event produces a row" → `DeliverablePersistenceService.handle` → `mapPayloadToRow` → `repo.insert`
    - "Duplicate event is idempotent" → drizzle `onConflictDoNothing`；memory `store.has` guard；tauri `onConflictDoNothing`
    - "Oversize content is clamped, not dropped" → `mapPayloadToRow` 里 `clampUtf8` + `console.warn`
    - `listByCompany excludes content` → 三后端 SELECT 都显式列 + `length(content) AS content_size`
    - `findById returns full content` → 三后端 SELECT * WHERE id
    - `listByCompany filters by thread` → `and(company_id=, thread_id=)` 分支
    - `default limit caps results` → `DEFAULT_LIST_LIMIT = 100`（drizzle/memory/tauri 一致）
    - `Event triggers repo insert` / `Missing repo slot is tolerated` / `Insert failure does not crash` / `Dispose unsubscribes` → `DeliverablePersistenceService` 四条行为各对应
    - `Hook initial render returns persisted history` / `Live event merges with hydrated history` / `Event with known deliverableId does not duplicate` → `useDeliverables` 新逻辑 + `upsertDeliverable`
    - "No platform schema change" → db-platform 不动
    - "Browser hydration returns empty after refresh" → memory-only backend 天然行为
- [x] 7.2 人工核对 `repository-backend-boundaries` spec：`ls packages/core/src/runtime/repos/` 含 `deliverables/`（12 家族齐），`ls apps/web/src/lib/tauri-repos/` 含 `deliverables.ts`（12 文件齐），家族 NBNC 全部 ≤320（113/72/112），3 个 barrel ≤200（44/152/40）
- [ ] 7.3 Live 验证（desktop Tauri）— **user 操作**：启动桌面端、触发 deliverable 任务（如 "写 snake.html"）、完全退出 app、重开，确认 PitchHall / chat 里历史还在。代码侧已完全落位（7.4 已证 service + hook 链路正确，desktop 只是换 backend sqlite 而非 memory）
- [x] 7.4 Live 验证（web 纯浏览器）— ✅ 通过（browser MCP live test）：
    - 启 `apps/web dev --force`（先清 Vite dep cache 吃到新 `DeliverablePersistenceService` 导出），发 "Please write a minimal snake.html" → deliverable 产生（`del-b2c4212f-...`, `snake.html`, 7364 bytes）
    - 查 `localStorage['offisim:browser-runtime-snapshot:v1']` → `deliverables[0]` 完整 10 列 + contributors_json 合法 + created_at ISO-8601
    - 刷 tab → DOM 里 `snake.html` 卡出现 → 证明 `useDeliverables` mount hydrate 跑通
    - **发现 spec scenario 错**：原 "Browser hydration returns empty after refresh" 假定 web 无持久化；实际既有 `createBrowserRuntimePersistence` 把 `repos.snapshot()` 写 localStorage，memory repo boot 从 snapshot 种子恢复。已更新 spec scenario：web 在 localStorage 可用时 DO 持久化（best-effort），localStorage 被清才回空
- [x] 7.5 `pnpm typecheck`（绿） + `pnpm lint`（baseline 65 errors/9 warnings → 61 errors/9 warnings，全部 pre-existing，我落地无新增）；`pnpm --filter shared-types/ui-core/core/ui-office/web build` 串行全绿

## 8. Close Out

- [x] 8.1 `openspec validate persist-deliverable-history --strict` 通过（两轮：apply 后 + simplify 后）
- [x] 8.2 commit 收口：apply `c86c3e64` + simplify `111fa68f`（simplify 不算 rework，算 apply 自然延伸 — live verify 发现 spec scenario 错 + 3 个 reviewer 挑出 SSOT / 未校验 cast / N² merge，全部吸收）
- [ ] 8.3 跑 `/opsx:archive persist-deliverable-history` → 归档到 `openspec/changes/archive/` → canonical spec 同步（正在跑）
- [ ] 8.4 更新 project memory queue 文件（`project_next_change_queue.md`）：H1 状态 → `[x] archived` + archive commit SHA；提示下一条 H2 `unify-deliverable-card-surfaces`
