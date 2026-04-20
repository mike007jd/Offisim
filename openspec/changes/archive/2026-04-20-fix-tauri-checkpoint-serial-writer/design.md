## Context

T1.3 台账早标 `apps/web/src/lib/tauri-checkpoint.ts` 为手抄 upstream `SqliteSaver` 的 fork（⚠️）。T2.3 `add-skills-fork-and-edit` live verify（2026-04-20）在 Tauri desktop 复现 blocker：

- 场景：`fork_skill` tool call path 完全未被触达（instrumentation marker 一个都没 console）
- DevTools 最早错误：`putWrites — tauri-runtime-*.js`，两种 flavor：
  - `Unhandled Promise Rejection: error returned from database: (code: 5) database is locked`
  - `ROLLBACK failed after putWrites error: "error returned from database: (code: 1) cannot rollback - no transaction is active"`
- 连锁症状：`Attempted to assign to readonly property.`（LangGraph 内部 error handler 写某状态字段触发 WebKit frozen）
- 复现路径：Maya direct chat + team chat 两条 entry 都炸

static analysis 定位到 `putWrites` 实现：

```ts
await db.execute('BEGIN IMMEDIATE');
try {
  for (const row of serialized) {
    await db.execute(`INSERT OR REPLACE INTO writes ...`, row);
  }
  await db.execute('COMMIT');
} catch (e) {
  try { await db.execute('ROLLBACK'); } catch (rb) { console.error(...); }
  throw e;
}
```

根因：`@tauri-apps/plugin-sql` 的 `Database.execute` 透传到 Rust 端 sqlx `SqlitePool::execute`，每次从 pool 借连接，**不 pin 同一 conn**。BEGIN 在 conn A 上建 tx，INSERT 可能被 dispatched 到 conn B——conn B 无 tx 就是 autocommit；COMMIT 在 conn C 上 "no transaction to commit"；ROLLBACK 再撞同样。WAL + busy_timeout=5000 只对 pool 初始化时第一条 conn 生效，其它 conn 继承默认 0 busy_timeout，抢锁即报 locked。

## Goals / Non-Goals

**Goals:**

- `putWrites` / `put` / `deleteThread` 在 Tauri desktop 上**可靠**，无 "database is locked" / "no transaction" race
- 不改 Tauri Rust 端 plugin-sql 配置（纯 TS fix）
- 不动 LangGraph upstream API surface（TauriCheckpointSaver extends BaseCheckpointSaver 签名不变）
- 解耦 T2.3 blocker

**Non-Goals:**

- 不解决上游 T1.3 "fork 对比 upstream SqliteSaver drift 监测机制"（归 T1.3 roadmap 后续）
- 不解决其它 repo 层 tauri-repos 的类似 race（tauri-repos/*.ts 只做单条 INSERT/SELECT，不组事务，天然安全；但若后续加组合事务需同款 fix）
- 不改 `getTauriDb` singleton 架构
- 不做 performance benchmark（mutex 让写序列化，per-checkpoint 写延迟增加 O(N_pending_writers)；产品可接受，LangGraph 单线程执行节点本身就不并发大）

## Decisions

### D1 — 消除显式事务，改多值 INSERT

**Chosen**: `putWrites` 把所有 `serialized` 行合成一条 `INSERT OR REPLACE INTO writes (cols) VALUES (a1,...,h1), (a2,...,h2), ...` 的单 SQL 语句，在一次 `db.execute(sql, flatParams)` 里跑。

**Alternatives considered:**

- **同连接事务 + multi-statement SQL**: `db.execute('BEGIN; INSERT; INSERT; COMMIT')` 一次。SQLite `sqlite3_exec` 支持，但 sqlx 的 parameter binding 在 multi-statement 下行为不稳（`$1` 是全局还是 per-statement 不保证）。拒。
- **每次 execute 前设 busy_timeout**: 会变成 `PRAGMA busy_timeout=5000; <real sql>` 双语句。同样的 binding 问题。拒。
- **降 pool max_connections 到 1**: 需改 Rust 端 tauri plugin-sql init。超出 TS-only fix scope。拒。

**Why**: 多值 VALUES 是 SQLite 原生原子，单 execute 调用借一条 conn 一次跑完，不需要显式 tx。`putWrites` 本来就是"一次 checkpoint 的若干 writes 一起落"的语义，完美匹配。`writes` 表 PK 是 `(thread_id, checkpoint_ns, checkpoint_id, task_id, idx)`，`INSERT OR REPLACE` 天然幂等，重复跑不出错。

### D2 — `deleteThread` 不用事务

**Chosen**: 顺序两条 execute：`DELETE FROM checkpoints WHERE thread_id=$1` → `DELETE FROM writes WHERE thread_id=$1`。如果第二条失败，孤儿 writes 行留着，但 `getTuple` 的主查询 JOIN `checkpoints + writes ON (thread_id, checkpoint_ns, checkpoint_id)`，没 checkpoint 就读不到；孤儿 writes 不污染任何读路径。

**Alternatives considered:**

- `DELETE FROM checkpoints; DELETE FROM writes` 一条 multi-statement execute: 同 D1 risk。拒。
- 按 writes 表 `ON DELETE CASCADE`：要改 Rust 端 migration，超范围。拒。

**Why**: 孤儿 row 在读路径不可见，一致性代价为 0。最差情况 = `writes` 表在长期使用下略膨胀，由后续 GC（如果有）或手动 VACUUM 处理；`deleteThread` 本身是线程删除，不高频。

### D3 — 进程级 async write mutex

**Chosen**: module-level `let writeChain: Promise<unknown> = Promise.resolve()`。`put` / `putWrites` / `deleteThread` 入口：

```ts
const run = <T>(fn: () => Promise<T>): Promise<T> => {
  const next = writeChain.catch(() => {}).then(fn);
  writeChain = next.catch(() => {});
  return next;
};
```

所有三个写方法包 `run(async () => { ... })`。

**Why**:

- 即使 D1+D2 已经消除显式事务，多个 LangGraph node 并发可能同时发起 `put`（checkpoint state）+ `putWrites`（channel writes）。pool 在同时给两条 execute 借不同 conn 时，WAL writer 锁仍可能撞。mutex 把这个可能降到 0，**端对端无并发 writer**。
- 读路径（`getTuple` / `list`）不包 mutex，继续享受 WAL 的 multiple-readers。
- 代码开销极小（~8 行 helper）。比 `async-mutex` 包依赖轻。
- 失败的 write 不污染 chain（`catch(() => {})` swallow，不让后续 call 继承错误）。

### D4 — 写路径错误 logging

**Chosen**: `put` / `putWrites` / `deleteThread` 内部 try/catch 把 `console.error('[tauri-checkpoint/<method>]', err.stack)` 带 stack 落 DevTools，再 rethrow。LangGraph 上层拿到 rejection 照常走 error handler。

**Why**: 本 fix 的动因就是 stack 起源隐藏（Tauri 早期 error 不带调用链上下文）；以后再炸可以秒定位。开销忽略（error path 才跑）。

### D5 — `tauri-db.ts` PRAGMA 处置

**Chosen**: 不改。`WAL` + `busy_timeout=5000` 首条 conn 设了就设了，mutex 保证不会再有并发 writer 让 busy_timeout 派上用场，留作 belt-and-braces。

**Alternatives considered:**

- 暴露 `executeWritePragmas` helper 每次 execute 前跑：wrap overhead，mutex 已消除 busy race。拒。

**Why**: Minimum diff principle。PRAGMA 设偏多不如设一次让 pool 按需继承（虽然我们知道它不继承，但也没更好办法 TS-only）。

## Risks / Trade-offs

**[mutex 让写吞吐下降]** → LangGraph 默认就单线程执行节点，同一 thread_id 内天然不并发写；跨 thread 的 checkpoint 写会被 mutex 串起来。实测 hot path 是单 chat session，瓶颈不在 checkpoint 写。接受。

**[多值 VALUES 的参数爆炸]** → 一次 `putWrites` 的 writes 数量 ≤ LangGraph 一个 node 的输出 channel 数（实际 <10）；每行 8 列 → 最多 ~80 参数。SQLite 默认参数上限 `SQLITE_MAX_VARIABLE_NUMBER=999`（旧版）或 32766（3.32+）。远够。接受。

**[orphan writes 行膨胀]** → `deleteThread` 罕用；即使孤儿存在，读路径不可见。`VACUUM` 可清理；非紧急。接受。

**[mutex 在模块级是进程级单例]** → Tauri desktop 一个 webview 一个进程，mutex 覆盖全部 checkpoint 写入。Web browser 走 `browser-runtime` 不进 TauriCheckpointSaver，不受影响。正确。

**[未来加新写方法不自觉走 mutex]** → 新方法如果在 TauriCheckpointSaver 里落且直接 `await db.execute`，会绕过 mutex。mitigation：在 spec 的 scenario 里明确 "任何新写方法必须 run(lock)"；代码注释也标。

## Migration Plan

- 无 DB migration（SQL shape 不改，`writes` / `checkpoints` 表结构不动）
- 无 schema breaking（JS 调用方照常调 `put` / `putWrites` / `deleteThread`）
- Rollback：代码级 revert 即可；旧 `BEGIN IMMEDIATE` 路径恢复后 race 风险回到本 fix 前

## Open Questions

无。`sqlx` SqlitePool 不 pin conn 的行为是 sqlite driver 默认的，Tauri plugin-sql v2 未暴露 pin API——等上游改了再回来删 mutex（优先级低）。
