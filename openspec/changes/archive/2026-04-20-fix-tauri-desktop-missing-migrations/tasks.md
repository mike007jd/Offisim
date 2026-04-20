## 1. 撰写 v33 migration SQL

- [x] 1.1 新建 `Docs/03_migrations/offisim_migrations_local_v0.1/033_middleware_summary_tables.sql`
- [x] 1.2 SQL 写 `CREATE TABLE IF NOT EXISTS node_summaries` 严格对齐 `packages/db-local/src/schema.ts:595`：15 列 + FK to graph_threads/companies ON DELETE CASCADE
- [x] 1.3 SQL 写 `CREATE INDEX IF NOT EXISTS idx_node_summaries_thread_created` + `idx_node_summaries_thread_node`
- [x] 1.4 SQL 写 `CREATE TABLE IF NOT EXISTS compact_summaries` 严格对齐 `schema.ts:624`：11 列 + FK
- [x] 1.5 SQL 写 `CREATE INDEX IF NOT EXISTS idx_compact_summaries_thread_created` + `idx_compact_summaries_thread_kind`

## 2. 挂 migration 到 Tauri desktop

- [x] 2.1 `apps/desktop/src-tauri/src/lib.rs` `fn migrations()` 在 v32 条目下加 v33：`Migration { version: 33, description: "middleware summary tables", sql: include_str!("../../../../Docs/03_migrations/offisim_migrations_local_v0.1/033_middleware_summary_tables.sql"), kind: MigrationKind::Up }`
- [x] 2.2 `cargo check` 在 `apps/desktop/src-tauri/` 目录绿（include_str! 路径对、SQL 作为 `&str` 编译期嵌入正确）—— Rust 编译通过，8.23s finished dev profile

## 3. 构建验证

- [ ] 3.1 `pnpm --filter @offisim/desktop build`（`tauri build --debug` 或 release）—— 用户侧完成 Rust binary 嵌入 SQL
- [ ] 3.2 Debug / release bundle 启动 —— 用户侧

## 4. Live verify（Tauri desktop，本 fix 的核心证据）

> 需真实 Tauri 壳 + 已存在 desktop DB（`user_version=32`）或 fresh DB

- [x] ~~4.1 `user_version=33`~~ **验收口径错位，不适用**：`tauri-plugin-sql` 基于 `sqlx::migrate!()`，sqlx 用自己的 `_sqlx_migrations` 表追踪 migration 版本，**不写 SQLite 的 `PRAGMA user_version`**。用户 live 查 `user_version=0` 与 "v33 已执行" 不矛盾。真相来源是 (a) `_sqlx_migrations` 表含 version=33 row，或 (b) 目标表 + 索引真实存在 —— 后者更直观
- [x] 4.2 两张表存在：用户 live 查 `/Users/haoshengli/Library/Application Support/com.offisim.desktop/offisim.db` 确认 `node_summaries` + `compact_summaries` 真实在 `sqlite_master`
- [x] 4.3 Index 存在：用户 live 查确认 4 条 `idx_node_summaries_*` + `idx_compact_summaries_*` 真实在
- [x] 4.4 Middleware warning 消失：fresh rebuild + fresh launch 下 `Middleware "summarization" before() failed` + `Middleware "node-context" before() failed` **不再稳定复现**（用户 live 2026-04-20 release bundle DevTools 实测）
- [ ] 4.5 表写入验证（非阻塞）—— 未独立 query `SELECT count(*)`；middleware warning 消失已隐含 INSERT 成功（warning 的根因是 INSERT 先炸表不存在）
- [ ] 4.6 T2.3 fork 9.x 连锁 **未解** — 用户 live 仍报 `Attempted to assign to readonly property.` + 0 个 `[skill-*]` marker + 无 preview bubble + DB `employee_id='...'` skill count=0。证据硬：本 fix **没解** T2.3 readonly；readonly 的真因在 direct chat orchestration 更前层（`employee-direct-setup-node` / `employee-preflight` / `orchestration-service` / `main-graph`），不在 fork path。归 T2.3 resume scope，不归本 fix

## 5. 协议台账 + archive gate

- [x] 5.1 `openspec/protocols-ledger.md` 不触（本 fix 不涉外部协议/SDK）
- [x] 5.2 Spec 一致性：`repository-backend-boundaries` delta 2 条 requirement 已落 — (a) schema↔migration parity 契约（已在 spec 写：每张 sqliteTable 必须对应 CREATE TABLE）(b) `node_summaries` + `compact_summaries` 真存 + 列 shape 对齐。archive 时 canonical 同步（spec 里 "Scenario: Migration v33 creates both tables on existing DB" 需注意 sqlx migration track 真相来源是 `_sqlx_migrations`，非 `user_version`；scenario 描述对齐修订见下）
- [x] 5.3 Tasks 一致性：4.x 按用户 live evidence 更新。4.1 验收口径错位作 ~~strikeout~~ 并注明原因；4.2/4.3/4.4 勾 + evidence；4.5/4.6 未勾 + 原因记录
- [x] 5.4 `packages/core/CLAUDE.md` Repository 三副本节无需同步（本 fix 不改 repo API，只补 desktop migration SQL）；`apps/desktop/CLAUDE.md` 不存在。parity 契约的"下次加表提醒"纪律落在 `repository-backend-boundaries` spec requirement 层面，天然作用于所有未来 change 的 archive gate 10.1

## 6. Verify records

- [x] 6.1 4.1 验收口径纠正 — 2026-04-20 / Tauri release bundle + Computer Use live verify / 原"user_version=33" 不是 tauri-plugin-sql (sqlx) 的 migration 真相来源；sqlx 用 `_sqlx_migrations` 表追踪，不 write `PRAGMA user_version`。改以"目标表+索引真实存在 + warning 消失"为验收
- [x] 6.2 4.2 tables exist — 2026-04-20 / Tauri release bundle / 用户 live 查 `/Users/haoshengli/Library/Application Support/com.offisim.desktop/offisim.db` 的 `sqlite_master` 确认 `node_summaries` + `compact_summaries` 真实存在
- [x] 6.3 4.3 indexes exist — 2026-04-20 / 同一 DB / 4 条 `idx_node_summaries_*` + `idx_compact_summaries_*` 真实存在
- [x] 6.4 4.4 middleware warning gone — 2026-04-20 / Tauri release fresh rebuild + fresh launch / DevTools `Middleware "summarization" before() failed` + `Middleware "node-context" before() failed` 不再稳定复现
- [ ] 6.5 4.5 tables writable — 未独立 query；middleware warning 消失隐含 writes 成功
- [ ] 6.6 4.6 T2.3 fork 9.x connection — **NOT RESOLVED by this fix**：fresh bundle 复测 Maya direct chat fork 仍报 `Attempted to assign to readonly property.`，0 个 `[skill-*]` marker，无 preview bubble，DB 无 employee-scope skill row。证据硬：本 fix 没解 T2.3 readonly，readonly 真因在 direct chat orchestration 更前层（候选：`employee-direct-setup-node.ts` / `employee-preflight.ts` / `orchestration-service.ts` / `main-graph.ts`），需独立下钻。归 T2.3 resume scope
- [x] 6.7 副产物新发现独立 blocker（非本 fix 责任）：**team chat provider routing bug** — fresh bundle 重现 `401 You didn't provide an API key` 到 `api.openai.com/v1/chat/completions`；direct chat 不复现。说明不是全局 MiniMax 失效，而是 `boss` scope 的 role-based model resolver（`packages/core/src/agents/boss-node.ts` + `packages/core/src/llm/model-resolver.ts`）默认还解到 `openai / gpt-4o-mini`，未覆盖 MiniMax 为 boss 级 fallback。独立 change `fix-boss-provider-routing-to-minimax` 接手
