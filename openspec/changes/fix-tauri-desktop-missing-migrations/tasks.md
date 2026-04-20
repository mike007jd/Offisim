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

- [ ] 4.1 用户已存在 DB 的 `user_version` 升级：启动 Tauri 后查 `SELECT user_version FROM pragma_user_version;` = 33
- [ ] 4.2 两张表存在：`SELECT name FROM sqlite_master WHERE type='table' AND name IN ('node_summaries','compact_summaries')` 返回 2 行
- [ ] 4.3 Index 存在：`SELECT name FROM sqlite_master WHERE type='index' AND name LIKE 'idx_node_summaries%' OR name LIKE 'idx_compact_summaries%'` 返回 4 行
- [ ] 4.4 Middleware warning 消失：发一条 chat 消息，DevTools Console 不再出 `Middleware "summarization" before() failed — skipping` + `Middleware "node-context" before() failed — skipping`
- [ ] 4.5 表能被写入：chat 跑完后 `SELECT count(*) FROM node_summaries`（非零或零均 OK，重点是无 `no such table` 错）+ 对 `compact_summaries` 同样
- [ ] 4.6 连锁验证（非核心，归 T2.3 resume 真正落定）：T2.3 fork 9.x 再跑 `把 frontend-design 给你自己 fork 一份` → 观察 `[skill-*]` marker 是否终于触发（如果 readonly 的真正根因是 middleware 降级，本 fix 应同时解）

## 5. 协议台账 + archive gate

- [ ] 5.1 `openspec/protocols-ledger.md` 不触（本 fix 不涉外部协议/SDK）
- [ ] 5.2 Spec 一致性：`repository-backend-boundaries` delta 追加 2 条 requirement（schema↔migration parity 契约 + 两表存在）与代码对齐；archive 前再核
- [ ] 5.3 Tasks 一致性：4.x live verify 每条必须真跑；未跑的不勾
- [ ] 5.4 文档：`packages/core/CLAUDE.md` 的 Repository 三副本同步节 + `apps/desktop/*` 如有文档需要提"drizzle schema ↔ desktop migrations parity"纪律 —— 核查是否需同步

## 6. Verify records（archive 时填）

- [ ] 6.1 4.1 user_version upgrade — ⟨date / runtime / evidence⟩
- [ ] 6.2 4.2 tables exist — ⟨date / runtime / evidence⟩
- [ ] 6.3 4.3 indexes exist — ⟨date / runtime / evidence⟩
- [ ] 6.4 4.4 middleware warning gone — ⟨date / runtime / evidence⟩
- [ ] 6.5 4.5 tables writable — ⟨date / runtime / evidence⟩
- [ ] 6.6 4.6 T2.3 fork 9.x connection — ⟨date / runtime / evidence — 归 T2.3 resume 联动，可能为本 fix 捎带解决 9.x readonly⟩
