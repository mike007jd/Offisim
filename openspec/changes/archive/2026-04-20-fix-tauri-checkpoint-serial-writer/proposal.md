## Why

`apps/web/src/lib/tauri-checkpoint.ts`（T1.3 标 ⚠️ 的自维护 SqliteSaver fork）在 Tauri desktop 下会触发两种 SQLite 写入错误 —— `database is locked (code 5)` 和 `ROLLBACK failed ... cannot rollback - no transaction is active` —— 根因是 `putWrites` / `deleteThread` 用 `db.execute('BEGIN IMMEDIATE')` / `db.execute('INSERT ...')` / `db.execute('COMMIT')` 三条独立调用模拟事务，但 `@tauri-apps/plugin-sql` 底层的 sqlx `SqlitePool` **不保证跨 execute 调用复用同一连接**。一旦 pool 把 BEGIN、INSERT、COMMIT 分发到不同连接，事务就裂开：INSERT 在没有 active tx 的 conn 上跑成 autocommit；COMMIT 报 "no transaction"；并发 putWrites 又因为只有一条 conn 上真的拿到写锁而撞 locked。T2.3 fork/edit live verify（2026-04-20）在 Tauri desktop 上就是被这条雷卡死——fork_skill 的 instrumentation marker 一个都没触发，所有前缀 error 都指向 `putWrites — tauri-runtime-*.js`。修这条不光解 T2.3 blocker，也同时治所有 LangGraph flow 上的 checkpoint 写入漂移（meeting / handoff / resume 都踩过类似）。

## What Changes

- **BREAKING（非 API，是内部事务语义）**：`TauriCheckpointSaver.putWrites` 不再用 `BEGIN IMMEDIATE` / 逐行 INSERT / `COMMIT` 三段式；改为单条 multi-VALUES `INSERT OR REPLACE INTO writes ... VALUES (...), (...), ...` 在一次 `db.execute` 调用里原子落库（SQLite `INSERT OR REPLACE` 的多值 VALUES 本身即原子，无需显式 tx）
- **BREAKING（同上）**：`TauriCheckpointSaver.deleteThread` 不再用显式 tx；改为两条顺序 DELETE（`checkpoints` 先删，`writes` 后删）——孤儿 writes 行在 `getTuple` 的 JOIN 逻辑下天然不可见，不会污染读路径
- **新增进程级 async write mutex**：`put` / `putWrites` / `deleteThread` 三条写方法共享一个 `Promise` 链串行，保证任意时刻最多一个 checkpoint write 在 pool 里活动。WAL 的 multiple-reader-single-writer 语义照常生效
- **新增诊断 logging**：`put` / `putWrites` / `deleteThread` 的 catch 路径 `console.error` 带 stack，便于未来 Tauri-only 漂移被早期发现
- **Pragma 补齐**：`getTauriDb` 每次初始化时 `PRAGMA busy_timeout=5000` 只对首条 conn 生效；改为在每次 `db.execute` 写入前**不重复设**（mutex 已串行化），但保留首次设作 belt-and-braces

## Capabilities

### New Capabilities
- `tauri-checkpoint-serialization`: Tauri desktop 下 LangGraph `TauriCheckpointSaver` 的写事务语义 —— 为什么不用显式 BEGIN/COMMIT，为什么要进程级 mutex，`put` / `putWrites` / `deleteThread` 三个写方法的原子性契约

### Modified Capabilities
无（这是实现层 fix，不触及任何现有 spec 的 requirement）

## Impact

- **apps/web/src/lib/tauri-checkpoint.ts**：`put` / `putWrites` / `deleteThread` 内部实现重写（~80 行 diff）；新 module-level `writeLock` 共享 Promise chain helper
- **apps/web/src/lib/tauri-db.ts**：不改
- **openspec/protocols-ledger.md**：第 5 行 "LangGraph / checkpoint" 的 "下一步" 列更新 —— T1.3 追加 "2026-04-20 TauriCheckpointSaver 写事务重写：合并 multi-VALUES INSERT + 进程级 async mutex 串行写；显式事务裂开的 race 已消"；"一致？" 保持 ⚠️（其它 upstream-drift 风险仍在）
- **packages/core/CLAUDE.md**：无需改（这是 apps/web 层）
- **不影响**：`packages/core/src/skills/*`（T2.3 的代码路径）、`packages/core/src/runtime/*`（drizzle / memory repos）、web browser runtime（不走 Tauri checkpoint）
- **Unblocks**：T2.3 `add-skills-fork-and-edit` 的 9.1-9.10 live verify；任何其它被 putWrites race 挡住的 desktop Tauri 流程
