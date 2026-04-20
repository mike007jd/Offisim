## 1. 诊断 + write mutex helper

- [x] 1.1 读完 `apps/web/src/lib/tauri-checkpoint.ts`，确认 `put` / `putWrites` / `deleteThread` 三个写方法位置；审 `getTauriDb` singleton 无 re-init 风险
- [x] 1.2 在 `tauri-checkpoint.ts` module level 加 `let checkpointWriteChain: Promise<unknown>` + `runWithCheckpointWriteLock<T>` helper（catch(() => {}) swallow prior error；不 poison chain）
- [x] 1.3 加 `logCheckpointError(method: string, err: unknown): void` helper（`console.error('[tauri-checkpoint/<method>]', stack)`，同样 try/catch 包 console 调用防极端边界）

## 2. `putWrites` 改单 execute multi-VALUES INSERT

- [x] 2.1 去掉 `BEGIN IMMEDIATE` / `COMMIT` / `ROLLBACK` 三段 execute
- [x] 2.2 把 `serialized` 的 N 行合成一条 SQL：`INSERT OR REPLACE INTO writes (cols) VALUES ($1...$8), ($9...$16), ...` —— counter `base + col` 递增生成 `$idx`，`flatParams` `serialized.flat()` 风格手铺
- [x] 2.3 `writes.length === 0` 早返（LangGraph 可能传空 writes，虽罕见）
- [x] 2.4 参数占位符统一 `$idx` 与文件其它 execute（`put` / `getTuple`）一致
- [x] 2.5 包 `runWithCheckpointWriteLock`，catch + log + rethrow

## 3. `deleteThread` 去事务

- [x] 3.1 去掉 `BEGIN IMMEDIATE` / `COMMIT` / `ROLLBACK` 三段
- [x] 3.2 顺序两条 execute：`DELETE FROM checkpoints ...` → `DELETE FROM writes ...`；第二条失败不 block 第一条的效果
- [x] 3.3 包 `runWithCheckpointWriteLock`，catch + log + rethrow

## 4. `put` 加 mutex + log（未变原 SQL 语义）

- [x] 4.1 现有 `put` 是单条 `INSERT OR REPLACE INTO checkpoints ... VALUES ($1..$7)` execute，本身已原子；只包 `runWithCheckpointWriteLock` + catch/log/rethrow 保 belt-and-braces 一致性
- [x] 4.2 确认 `put` 的 `serde.dumpsTyped` 串行两次（`Promise.all`）在 mutex 外 OK（不涉 DB 写，只 serialize），mutex 只包最终 execute

## 5. 单元检查（无自动化测试，靠 typecheck + build）

- [x] 5.1 `pnpm --filter @offisim/web typecheck` 跑完 —— tauri-checkpoint.ts 无新错；**两条 pre-existing 错**（`OffisimRuntimeProvider.tsx:135` `Expected 4 arguments, but got 3` + `SkillInstallConfirmBubble.tsx:43` `Function lacks ending return statement`）是 main HEAD 已有状态（web tsconfig 比 ui-office 严格的 exhaustiveness 判定差异），非本 fix 引入，非本 fix 责任
- [x] 5.2 `pnpm --filter @offisim/web build` 绿，`index-*.js` bundle 从 main HEAD 的 1,596.05 kB 到本 fix 后 1,596.05 kB（字节级别一致，mutex helper ~80 行被 treeshake / 压缩后对 bundle 净零）

## 6. Live verify（Tauri desktop，本 fix 的核心证据）

> 需真实 Tauri 壳；web runtime 不走 TauriCheckpointSaver

- [ ] 6.1 Tauri dev 启动，company + employee 已就位；确认 `apps/web/dist` 里能 grep 到 `[tauri-checkpoint/` 字串（instrumentation 落包）
- [ ] 6.2 Basic chat roundtrip：直接跟任一员工 direct chat 发 "hi"，观察 DevTools Console 无 `putWrites` / `database is locked` / `cannot rollback` 任何错误；聊天正常回复
- [ ] 6.3 Team chat: `@Maya Lin hi`，同样 console 干净、回复正常
- [ ] 6.4 高压场景（触发 T2.3 blocker 同一路径）：company-scope skill `frontend-design` 已装；Maya direct chat `把 frontend-design 给你自己 fork 一份。` → 观察 **fork_skill tool 应跑到**（假设 T2.3 stash 已 pop 且 instrumentation 就位，但本 change archive 阶段 T2.3 不 pop — 这条**留给 T2.3 resume**做）
- [ ] 6.5 回归：resume 既有 thread（有 checkpoint 的），观察 `getTuple` + `put` 正常；无 console error
- [ ] 6.6 负载：连续发 5 条 chat 消息（boss+manager+employee 三层都会写 checkpoint），DevTools 持续观察 `[tauri-checkpoint/*]` prefix 无任何 error
- [ ] 6.7 删 thread 场景：用 chat panel trash（或相当入口）删任一已存 thread，观察 `deleteThread` 无 error + 二次读该 thread 返空

## 7. 协议台账 + archive gate

- [x] 7.1 `openspec/protocols-ledger.md` 第 5 行（LangGraph / checkpoint）"Repo claim" 和 "下一步" 列都追加 hotfix 条目；"一致？" 保持 ⚠️（其它 upstream-drift risk 仍在）
- [x] 7.2 Spec 一致性：`specs/tauri-checkpoint-serialization/spec.md` 三 requirement 对齐实现 —— (1) 写路径不用显式事务（`put` / `putWrites` / `deleteThread` 真落地实现全无 BEGIN/COMMIT，putWrites 走 multi-VALUES 单 execute）(2) mutex (`runWithCheckpointWriteLock` 包三个写方法 + `catch(()=>{}) swallow` 不 poison chain) (3) stack logging (`[tauri-checkpoint/<method>]` 前缀 `console.error` 在三个 catch arm 一致)
- [ ] 7.3 Tasks 一致性：6.x live verify 每条必须有 evidence（console 截图 / dump / 聊天回复截图）；未跑的不勾
- [x] 7.4 `packages/core/CLAUDE.md` / `apps/web/CLAUDE.md` / `apps/desktop/CLAUDE.md` 核查 —— 均**未查到**这三文件存在旧 checkpoint 注释需要同步（web / desktop 包无 CLAUDE.md；core 的 Skills 节是 T2.3 scope，checkpoint 无对应叙述节）；本 fix 纯实现层不触及 CLAUDE.md 叙述

## 8. Verify records（archive 时填）

- [ ] 8.1 6.1 — ⟨date / evidence⟩
- [ ] 8.2 6.2 basic direct chat — ⟨date / evidence⟩
- [ ] 8.3 6.3 team chat — ⟨date / evidence⟩
- [ ] 8.4 6.4 fork_skill path touched — ⟨date / evidence — 接 T2.3 resume 时联动⟩
- [ ] 8.5 6.5 resume existing thread — ⟨date / evidence⟩
- [ ] 8.6 6.6 5 消息连发 — ⟨date / evidence⟩
- [ ] 8.7 6.7 deleteThread — ⟨date / evidence⟩
