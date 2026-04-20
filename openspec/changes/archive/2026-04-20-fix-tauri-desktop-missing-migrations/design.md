## Context

2026-04-20 Tauri release live verify（`fix-tauri-checkpoint-serial-writer` hotfix 下）暴露：

- DevTools：`Middleware "summarization" before() failed — skipping` + `Middleware "node-context" before() failed — skipping`
- 根因：`error returned from database: (code: 1) no such table: node_summaries`
- 用户 live 查 DB：`sqlite_master where name='node_summaries'` = 0 / `compact_summaries` = 0

我 audit `packages/db-local/src/schema.ts` 的全部 39 个 `sqliteTable(...)` 定义 vs `Docs/03_migrations/offisim_migrations_local_v0.1/*.sql` 42 处 `CREATE TABLE`（含 3 个 `*_new` temp rename tables），用 `sort -u` diff 结果**只有 `node_summaries` + `compact_summaries` 两张**在 drizzle schema 有但 desktop migration 缺，其它全齐。

这两张表的 drizzle 定义写得很完整（FK to `graph_threads`/`companies` + ON DELETE CASCADE + 2 复合 index 各一张），只是从没写成 SQL 文件、没加进 `lib.rs` 的 migrations 列表。web browser 端 drizzle `pushSchema` 走 schema.ts 直接建，tauri desktop 端走 embedded SQL migrations，两条路径分叉导致 desktop-only 漏。

`NodeContextMiddleware` 和 `ConversationBudget` 的 summarization middleware 都直接 `INSERT INTO node_summaries / compact_summaries`，表缺就抛。middleware chain `catch` 后只 log warning 不 block LLM call，但 agent 的 prompt 上下文两段都空（pack + summary 各 ~1000/700 char budget 全丢），LangGraph state 可能触发异常分支的 frozen 字段 mutation → `Attempted to assign to readonly property`（T2.3 fork 9.x 的真正连锁根因假设）。

## Goals / Non-Goals

**Goals:**
- 建 `node_summaries` + `compact_summaries` 两张表在 desktop DB
- 维持 drizzle schema parity（列类型 / 默认值 / FK / index 全部 byte-equivalent）
- 建立 **schema ↔ migration parity 契约**，记进 `repository-backend-boundaries` spec，防止以后同类漏加
- 不影响 web browser runtime（drizzle pushSchema 路径不碰）

**Non-Goals:**
- 不补 `graph_checkpoints` / `checkpoints` / `writes` 等 LangGraph 专属表（它们不在 drizzle schema 里，是 langgraph-checkpoint-sqlite 自管）—— 这是 design choice 而非漏
- 不重 migrate 已存 DB 的数据（两表新建，无旧数据迁移）
- 不改 middleware 容错语义（before/after 失败 skip warning 正确，别处处理）
- 不触 T2.3 fork 9.x 其它可能的 readonly 路径——等本 fix apply 后再验证是否消除

## Decisions

### D1 — 单个 v33 migration 建两张表

**Chosen**: 新建 `033_middleware_summary_tables.sql` 一个 migration 建两张表 + 4 条 index。

**Alternatives considered:**
- 拆 v33 + v34 各一张表：版本号更细，但两表语义同类（middleware 持久化），同批失败同批成功语义一致，分开无收益
- 追加到现有某条 migration（如 v8 memory_system）：破坏 "migration 只加不改" 纪律，已用户 DB user_version=8 不会 re-apply，完全不解

**Why**: 同类同批原子，migration 历史可读。

### D2 — SQL 与 drizzle byte-equivalent

**Chosen**: SQL 手写但严格对照 drizzle 定义：
- 列名 / 类型（`text` → TEXT, `integer` → INTEGER）
- `.notNull()` → `NOT NULL`
- `.default(0)` → `DEFAULT 0`
- `.primaryKey()` → `PRIMARY KEY`
- `.references(...onDelete: 'cascade')` → `REFERENCES ... ON DELETE CASCADE`
- 2 个复合 index 按 drizzle `index('...').on(...)` 原名原列

**Why**: drizzle runtime 对列名 / 类型的认知来自 schema.ts；SQL 不对齐会导致 drizzle 查询预期列类型与 DB 实际类型不符。byte-equivalent 保证 tauri-repos drizzle 实例的 `select/insert` 都能 work。

### D3 — `PRAGMA foreign_keys = ON` 不在 migration 里重复设

**Chosen**: 相信 plugin-sql 的全局 session PRAGMA（或 migration 顺序保证 FK 目标表先建）。`graph_threads` 在 v1（`001_core_tables.sql`）+ `companies` 也是 v1，v33 跑时两表必在。

**Alternatives considered:**
- v33 头加 `PRAGMA foreign_keys = ON` —— sqlx 默认每条 conn 不继承 PRAGMA，这层是 plugin-sql 内部控制。不重复设。

**Why**: 减少噪声，FK 目标表已存在，依赖链正确。

### D4 — schema ↔ migration parity 契约上 spec

**Chosen**: archive 时在 `repository-backend-boundaries` spec 追加一条新 requirement，显式规定 drizzle schema 里每一张 `sqliteTable(...)` 定义都必须在 desktop migrations SQL 文件里有对应 `CREATE TABLE`（或在 rename/alter migration 里有 table presence），防止以后新加表时重蹈。

**Alternatives considered:**
- 加 CI 自动 check：当前 repo 已删所有自动化测试（memory + CLAUDE.md 纪律），不加回来
- 纯靠 code review：本次漏就是 review 没抓到，不够硬

**Why**: spec 级纪律让后续 change 的 archive gate 10.1（spec 一致性）覆盖这条；review 时 reviewer 照 spec 对。

## Risks / Trade-offs

**[已存在 DB 首次跑 v33 时若 plugin-sql migration runner 有 bug]** → sqlx migrate API 成熟，`add_migrations(...)` + `user_version` drive 是 Tauri plugin-sql 主路径，升级 v32 → v33 按顺序跑是标准流。低风险。

**[FK CASCADE 删除 graph_thread 时连带删 node_summaries/compact_summaries]** → 符合语义（thread 没了 summary 无意义）。drizzle 定义本就这样，按原 intent 落。

**[index 名字冲突]** → 名字来自 drizzle `idx_node_summaries_thread_created` 等，全局唯一，无冲突。

## Migration Plan

- 对已存在用户 DB（`user_version=32`）：Tauri 启动时 plugin-sql 读 embedded migrations → 跑 v33 建表 → `user_version=33`。无数据迁移。无回滚需求。
- Rollback：代码级 revert `lib.rs` + 删 v33 SQL 文件；用户 DB 里的两空表保留不会 block（drizzle select 空表 OK）
- Fresh DB：v1-v33 按序全跑，两表和其它同批建
