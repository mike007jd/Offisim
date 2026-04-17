## 1. IndexedDB content store (web-only)

- [x] 1.1 新增 `apps/web/src/lib/deliverable-content-idb.ts`：raw IDB wrapper exporting `openDeliverableContentDb(): Promise<IDBDatabase | null>`（private-mode / 拒绝访问时 resolve null + 单次 `console.warn`），`putDeliverableContent(db, id, content)` / `getDeliverableContent(db, id)` / `deleteDeliverableContent(db, id)` / `listDeliverableContentKeys(db)` 四操作；db name `offisim-runtime` / objectStore `deliverable_content`；transaction 都 `await` 完成
- [x] 1.2 在 `apps/web/src/lib/browser-runtime-storage.ts` 加 `createDeliverableContentBridge({ eventBus, db })` 工厂：订阅 `deliverable.created` → `await putDeliverableContent(db, payload.deliverableId, payload.content)`；返回 `{ dispose(): void }` 脱订。db=null 时构造 no-op（仅首次 `console.warn`）
- [x] 1.3 单文件 smoke — 走下游 web live verify（见 5.2）：3 条 put / 3 条 keys / dlv-test-2 content byte-identical (512000) / idb.clear 后 getAllKeys 空

## 2. Repository contract 扩 `listByCompanyWithContent`

- [x] 2.1 `packages/core/src/runtime/repositories.ts` `DeliverableRepository` 接口加 `listByCompanyWithContent(companyId, opts?: { threadId?: string; limit?: number }): Promise<DeliverableRow[]>`；`MemoryRepositoriesSnapshot.deliverables` 类型从 `DeliverableRow[]` 切 `DeliverableSummaryRow[]`
- [x] 2.2 `packages/core/src/runtime/repos/deliverables/drizzle.ts` 实现 `listByCompanyWithContent`：`SELECT *` + `ORDER BY created_at DESC` + `LIMIT`，`kind` 过 `coerceDeliverableKind`；复用既有 `rowToFull` 映射；NBNC 保持 ≤320
- [x] 2.3 `apps/web/src/lib/tauri-repos/deliverables.ts` 镜像同实现；NBNC ≤320
- [x] 2.4 `packages/core/src/runtime/repos/deliverables/memory.ts` 重写：
    - constructor 签名 `(initialRows?: Iterable<DeliverableSummaryRow>, contentLoader?: (id: string) => Promise<string | null>)`
    - 内部 `summaryStore: Map<string, DeliverableSummaryRow>` + `contentCache: Map<string, string>`
    - `insert(NewDeliverable)`：拆 content 进 cache，summary 进 summaryStore（重复 id no-op）
    - `findById(id)`：cache hit 则立即返 full row；miss 且 contentLoader 存在则 await，返回 null 则 content='' + console.warn 一次/id
    - `listByCompany(...)`：返 summary（和现行 scenario 一致，不破坏）
    - `listByCompanyWithContent(...)`：summary 过滤 + 排序 + limit 后，对每行 `ensureContent(row)`（cache hit 或 await loader），`Promise.all` 并行
    - `snapshot(): DeliverableSummaryRow[]` 返 summaryStore 内容（**不含 content**）
    - NBNC ≤320
- [x] 2.5 `packages/core/src/runtime/memory-repositories.ts` `createDeliverablesMemoryRepos(snapshot?, contentLoader?)` 透传第二参数；`createMemoryRepositories(snapshot?, deliverableContentLoader?)` 总工厂签名扩以便 browser-runtime 传入
- [x] 2.6 `pnpm --filter @offisim/core typecheck` 通过

## 3. Browser runtime wire + legacy migration

- [x] 3.1 `apps/web/src/lib/browser-runtime.ts`：在 `createBrowserRuntime` / `createBrowserRuntimeReposOnly` 顶部 `await openDeliverableContentDb()` 拿 `db`；用 `db ? (id) => getDeliverableContent(db, id) : undefined` 构造 `contentLoader`；`createMemoryRepositories(loadBrowserRuntimeSnapshot() ?? undefined, contentLoader)`
- [x] 3.2 同文件：`createDeliverableContentBridge({ eventBus, db })` 构造进 disposable 列表；与 `DeliverablePersistenceService` 互不干扰（两者并行订阅同一事件）
- [x] 3.3 legacy migration：boot 时读 `loadBrowserRuntimeSnapshot()`，若 `snapshot.deliverables[i].content` 字段非 undefined（老 H1 shape），`void Promise.all(snapshot.deliverables.map(row => row.content ? putDeliverableContent(db, row.deliverable_id, row.content) : null))`。**fire-and-forget**，不阻塞 runtime ready
- [x] 3.4 dispose 路径：`deliverablePersistence.dispose()` 之后 `deliverableContentBridge.dispose()`；db close 随 tab 自动，不显式
- [x] 3.5 `apps/web/src/runtime/OffisimRuntimeProvider.tsx` `listRecentDeliverables`：改调 `repo.listByCompanyWithContent(companyId, opts)`，删除 `Promise.all(summaries.map(s => repo.findById(...)))` N+1 分支；返回数组映射改用 `mapDeliverableFullRowToHookRow`（`mapDeliverableSummaryToHookRow` 在 new hydrate path 下不再调用，保留 export 作未来 listview 用）
- [x] 3.6 `pnpm --filter @offisim/web build` 通过

## 4. Tauri runtime parity (desktop)

- [x] 4.1 `apps/web/src/lib/tauri-runtime.ts` / `tauri-runtime-lite.ts`：不加 IDB bridge（tauri 走 SQLite drizzle repo，不需要 memory repo contentLoader）；确认 `createTauriRepositories` 返 drizzle tauri repo 含新 `listByCompanyWithContent` 方法；不需要其他改动
- [ ] 4.2 desktop runtime live 手测（user）：触发 ≥10 条 deliverable，Chrome DevTools Network 或 Tauri log 观察 `listRecentDeliverables` 单 SQL round-trip（不是 N+1）

## 5. Spec sync + live verify

- [x] 5.1 review-by-reading：`optimize-deliverable-persistence-hotpath/specs/deliverable-persistence/spec.md` 所有 ADDED + MODIFIED scenario 在新代码里都能成立
- [x] 5.2 web live verify（Chrome DevTools MCP @ 5176）：
    - a. 清 localStorage + IDB 起 clean state ✓
    - b. 触发 3 条 deliverable（其中 1 条 ~500 KB）→ localStorage snapshot 34399 B（仅 summary，无 `content` 字段）+ IDB 3 条 key（dlv-test-2 为 512000 字节）✓
    - c. Reload → `value.listRecentDeliverables({limit:100})` 返 3 行 full content（2011 / 512000 / 11 字节）✓
    - d. 清 IDB 保留 localStorage → reload → hook 返 3 条 summary + `content=''`，console.warn 3 次 ✓
    - e. 无 IDB 环境：`openDeliverableContentDb()` catch 路径 warnOnce，bridge/loader 降级（代码路径 review 通过，无对应 live driver）
- [x] 5.3 `pnpm typecheck` 全绿（5 包 serial build 已依次执行：shared-types → ui-core → core → ui-office → web）
- [x] 5.4 `openspec validate optimize-deliverable-persistence-hotpath --strict` 通过

## 6. Close Out

- [x] 6.1 apply commit `8c40b4bf` (feat(core,web): split deliverable content to IndexedDB + bulk list API)
- [x] 6.2 `/simplify` 审 diff → follow-up commit `7d070258` (reuse shared IDB helpers, non-blocking open, drop hot-path clone, prune narrative comments)
- [x] 6.3 `/opsx:archive optimize-deliverable-persistence-hotpath` → canonical spec sync（本次 archive）
- [ ] 6.4 更新 `project_next_change_queue.md`：本 change `[x] archived` + archive SHA；提示下一条 H2 `unify-deliverable-card-surfaces`
