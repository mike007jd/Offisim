## Why

`packages/db-local/src/schema.ts` 的 drizzle 定义里存在两张表 `node_summaries`（L595）和 `compact_summaries`（L624），它们是 `NodeContextMiddleware` + `ConversationBudget summarization` 两个 middleware 的**持久化依赖**。web 端 drizzle `pushSchema` 会按 schema.ts 自动建；**desktop 端 `apps/desktop/src-tauri/src/lib.rs` 的 `fn migrations()` 只嵌入了 v1-v32 的 SQL migration 文件，这两张表从来没被建过**。2026-04-20 Tauri release live verify 直接在用户 DB 里查到 `sqlite_master where name='node_summaries'` = 0 / `compact_summaries` = 0，DevTools 明确报 `Middleware "summarization" before() failed — skipping` + `Middleware "node-context" before() failed — skipping`，根因 `no such table`。middleware chain catch 吞了异常只 log warning，不直接 block LLM call；但 summarization / node-context 失败意味着 agent 的 prompt 上下文降级（budget + context pack 两段都空），极大概率连锁触发 T2.3 fork_skill 9.x 观察到的 `Attempted to assign to readonly property` —— LLM 产生异常 response 形态后 LangGraph state handler 写某 frozen 字段。全面 audit `schema.ts` 39 表 vs desktop migrations 42 CREATE TABLE，**只有这两张表缺**，其它齐。纯 migration 漏加，非架构问题。

## What Changes

- 新增 `Docs/03_migrations/offisim_migrations_local_v0.1/033_middleware_summary_tables.sql`：建 `node_summaries` + `compact_summaries` 两张表 + 各自 2 条 index，schema 与 drizzle 定义 byte-identical（含列类型 / 默认值 / FK to `graph_threads`/`companies` 的 ON DELETE CASCADE）
- 扩 `apps/desktop/src-tauri/src/lib.rs` 的 `fn migrations()` 加 v33 条目 `include_str!("033_middleware_summary_tables.sql")`
- **对已存在 desktop DB（当前 `user_version=32`）**：Tauri plugin-sql 首次跑 v33 时自动 apply（sqlx 的 user_version 驱动 migration runner 默认行为），用户 DB 下次启动即建表，无需手工迁移
- Web browser 端不受影响（drizzle `pushSchema` 按 schema.ts 原本就建，两表已存在）

## Capabilities

### New Capabilities
无（这是实现层 migration 补齐，不触及任何现有 spec 的 requirement 语义）

### Modified Capabilities
- `repository-backend-boundaries`: 现有 spec 讨论三后端（drizzle / memory / tauri）同步契约。本次补齐是恢复 tauri 后端与 drizzle schema 的表 parity——不改 spec 里已有 requirement，但会**加一条新 requirement**标 drizzle schema 定义的每张表都必须在 desktop migrations SQL 里有对应建表语句（parity 契约），防止以后 schema 加表但 migration 漏加重蹈这次

## Impact

- **`Docs/03_migrations/offisim_migrations_local_v0.1/033_middleware_summary_tables.sql`**：新建（~50 行 SQL）
- **`apps/desktop/src-tauri/src/lib.rs`**：`fn migrations()` 加一条 Migration entry（~6 行 diff）
- **`openspec/specs/repository-backend-boundaries/spec.md`**：archive 时追加 1 条 "drizzle schema ↔ desktop migrations parity" requirement
- **不影响**：web browser runtime、drizzle schema、memory repos、tauri-repos TS 实现（`compactSummaryRepository` / `nodeSummaryRepository` 接口本来就期待这两张表存在）
- **Unblocks**：T2.3 fork/edit 9.x live verify（middleware 不再 before() warn → LLM 正常生成 tool calls → `[skill-*]` marker 能落触发）；所有 Tauri desktop 下 middleware-dependent 流程（NodeContextMiddleware + ConversationBudget）
- **Rust rebuild 必需**：用户 Tauri 需要重跑 `pnpm --filter @offisim/desktop build`，因为 migration SQL 通过 `include_str!` 在编译期嵌入 binary
