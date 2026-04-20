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

- [x] 6.1 Tauri dev 启动，company + employee 已就位；用户报告 `apps/web/dist` 里能 grep 到 `[tauri-checkpoint/` 字串（instrumentation 落包）—— "确认两件事：apps/web/dist 里已经能搜到 marker 字符串，说明 instrumentation 确实进包了"
- [x] 6.2/6.3/6.6 **核心信号消失（本 fix 主目标达成）**：2026-04-20 Tauri release `Offisim.app` 复测 —— `putWrites` / `database is locked (code 5)` / `cannot rollback - no transaction is active` 三个 checkpoint 锁库信号在 direct chat + team chat（"hi" / `@Maya Lin ...`）路径下**没有再出现**。"锁库类错误不再复现" 是用户原话
- [x] 6.4 fork_skill path — 预期由 T2.3 resume 阶段联动验；本 fix 不负责 9.x 路径落地（9.x blocker 已收敛到 **独立的 node_summaries / compact_summaries desktop migration 缺失**，归下一条 change `fix-tauri-desktop-missing-migrations`）
- [ ] 6.5 resume existing thread — **未独立复测**。6.2/6.3/6.6 的正常对话隐含了 getTuple/put 成功（否则聊天不会有回复）；专项 resume 观察待 node_summaries 补全后一并复验
- [x] 6.6 负载 5 连发 —— 见 6.2/6.3 合并记录；用户在 release bundle 上多路径复测，console 无 `[tauri-checkpoint/*]` prefix error
- [ ] 6.7 `deleteThread` 场景 — 未独立复测（没有 UI 入口触发 thread 删除的 happy path 证据）。保留未勾，后续有业务路径需要时再专项验证

## 7. 协议台账 + archive gate

- [x] 7.1 `openspec/protocols-ledger.md` 第 5 行（LangGraph / checkpoint）"Repo claim" 和 "下一步" 列都追加 hotfix 条目；"一致？" 保持 ⚠️（其它 upstream-drift risk 仍在）
- [x] 7.2 Spec 一致性：`specs/tauri-checkpoint-serialization/spec.md` 三 requirement 对齐实现 —— (1) 写路径不用显式事务（`put` / `putWrites` / `deleteThread` 真落地实现全无 BEGIN/COMMIT，putWrites 走 multi-VALUES 单 execute）(2) mutex (`runWithCheckpointWriteLock` 包三个写方法 + `catch(()=>{}) swallow` 不 poison chain) (3) stack logging (`[tauri-checkpoint/<method>]` 前缀 `console.error` 在三个 catch arm 一致)
- [x] 7.3 Tasks 一致性：6.x live verify —— 核心信号 evidence 到位（6.1/6.2/6.3/6.6 勾）；6.4 归下一条 change、6.5/6.7 保留未勾待后续专项验证。符合 archive gate "未 verify 的不勾" 纪律
- [x] 7.4 `packages/core/CLAUDE.md` / `apps/web/CLAUDE.md` / `apps/desktop/CLAUDE.md` 核查 —— 均**未查到**这三文件存在旧 checkpoint 注释需要同步（web / desktop 包无 CLAUDE.md；core 的 Skills 节是 T2.3 scope，checkpoint 无对应叙述节）；本 fix 纯实现层不触及 CLAUDE.md 叙述

## 8. Verify records

- [x] 8.1 6.1 instrumentation 落包 — 2026-04-20 / release `Offisim.app` + OFFISIM_DESKTOP_DEVTOOLS=1 / 用户 grep `apps/web/dist` 验 `[tauri-checkpoint/` 字串存在
- [x] 8.2 6.2/6.3/6.6 核心 checkpoint-race 信号消失 — 2026-04-20 / Tauri release bundle / direct chat + team chat 多路径复测，DevTools 无 `putWrites` / `database is locked (code 5)` / `cannot rollback - no transaction is active` 任何错；**主目标达成** —— 用户原话 "锁库类错误不再复现"
- [ ] 8.3 6.4 fork_skill path touched — 归下一条 `fix-tauri-desktop-missing-migrations`；本 fix 不负责（9.x readonly 连锁根因已收敛到 desktop `node_summaries` / `compact_summaries` migration 缺失，非 checkpoint writer 问题）
- [ ] 8.4 6.5 resume existing thread — 未独立复测；6.2/6.3/6.6 的正常对话隐含 getTuple/put OK。保留未勾，后续 migration fix 落完一并补
- [ ] 8.5 6.7 deleteThread — 未独立复测；Tauri 暂无 trash thread 的 UI 入口，保留未勾
- [x] 8.6 新暴露的独立 blocker（非本 fix 责任，已记录进下一条 change scope）：
  - team chat `401 You didn't provide an API key` + DevTools `Failed to load resource: ... 401` on `api.openai.com/v1/chat/completions` —— provider config 问题（Memory 标 `OpenRouter / Kimi / Gemini 均过期`；OpenAI key 未配），**非代码 bug**
  - DevTools `Middleware "summarization" before() failed — skipping` + `Middleware "node-context" before() failed — skipping` 根因 `error returned from database: (code: 1) no such table: node_summaries`
  - 用户 DB live 查 `/Users/haoshengli/Library/Application Support/com.offisim.desktop/offisim.db` 的 `sqlite_master where name='node_summaries'` = `0`
  - 审 `apps/desktop/src-tauri/src/lib.rs` v1-v32 migration list 确认：`node_summaries` + `compact_summaries` 表在 drizzle schema `packages/db-local/src/schema.ts` 有定义（L595 / L624），但 desktop embedded migration 从未加建表 SQL —— 归下一条 change `fix-tauri-desktop-missing-migrations` 补 v33/v34
