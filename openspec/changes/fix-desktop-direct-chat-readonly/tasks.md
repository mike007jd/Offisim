## 1. Reproduce + 抓 stack

- [x] 1.1 release bundle 复现 direct chat readonly；当前调试链按 release 走（2026-04-21）
- [x] 1.2 确认当前 bundle 默认无 source map；改为 UI 内暴露 stack + 本地 bundle slice 定位
- [x] 1.3 打开 DevTools → Sources → `Pause on exceptions` (Caught + Uncaught) → 触发 `@Maya Lin hi`；Web Inspector 本身未给出有用源码帧
- [x] 1.4 捕获 stack trace，并把顶帧 / 赋值语句记录到 `repro-notes.md`
- [x] 1.5 判定冻结来源：Safari/JSC 下 LangGraph `retry.js` 对 caught error 做 `error.pregelTaskId = ...` 赋值，命中 readonly / non-extensible Error 对象

## 2. 根因判定

- [x] 2.1 根据 1.x 的证据，把根因归到以下一类：
  - (a) Zustand store 被绕开 action 直写
  - (b) AgentState / snapshot 跨层 mutation
  - (c) React ref / props / frozen config 赋值
  - (d) 三方 runtime / SDK 对异常对象的赋值（LangGraph retry metadata 写 caught error）
- [x] 2.2 全仓 grep 同一类 runtime invariant；额外发现 `task_runs.status` seed 值漂移（`pending` / `planned`）并一并收口到 schema 允许值 `queued`
- [x] 2.3 根因底层在 LangGraph pregel retry metadata 写入路径；用户可见契约（desktop direct-chat 不再 readonly crash，消息能进 transport）仍落在 `chat-streaming-ux` scenario 层，spec delta 不迁。底层 patch 属实现细节，不需要独立 capability spec

## 3. 修复

- [x] 3.1 按 2.1 的分类落根因修法：
  - (a) 换成 `useXxxStore.setState(s => ...)` / 既有 action
  - (b) 走既有 reducer / event emit / repo update，不在 render 层直写
  - (c) 产生新对象替换旧对象，不修改冻结对象
  - (d) 对 `@langchain/langgraph` retry metadata 写入做 best-effort patch，避免 readonly error 覆盖原异常；同时把本地 `task_runs` 初始状态统一到 `queued`
- [x] 3.2 未使用 `Object.defineProperty(writable:true)` / shallow unfreeze / `structuredClone` 伪装可变
- [x] 3.3 检查到相邻 schema drift：planner / replan / direct chat 的非法 task status 初始值，并已修正

## 4. Build / typecheck

- [x] 4.1 `pnpm --filter @offisim/shared-types build`
- [x] 4.2 `pnpm --filter @offisim/core build`
- [x] 4.3 `pnpm --filter @offisim/ui-office build`
- [x] 4.4 `pnpm --filter @offisim/web build`
- [x] 4.5 `pnpm --filter @offisim/desktop build`
- [ ] 4.6 （若动了 Rust）`cargo check` + `cargo clippy -- -D warnings`

## 5. Live verify（Tauri release bundle）

- [x] 5.1 打开 release bundle；当前 runtime provider 实际为 `google/gemma-3-4b-it:free`
- [ ] 5.2 Direct chat 给员工 A 发 `hi` 已进入真实执行路径（task run 创建成功，员工状态 executing），readonly 已消失；**provider 层 `Connection error` 阻断员工回复，未拿到自然语言 reply** — blocked on external provider, re-verify 待 provider 修复后
- [ ] 5.3 Direct chat 给员工 B 发 `hi` → 员工真回复（≥2 个不同员工） — blocked on 5.2 provider
- [ ] 5.4 Team chat 发 `hi` → Boss 正常回复 — boss 进入 LLM call，但 provider 同样 `Connection error`，本 change 不回归（team chat path 在本 change 未动）
- [x] 5.5 release bundle 复测全过程未再出现 `Attempted to assign to readonly property.`；剩余错误为 provider connection failure，和本 change scope 无关

## 6. Spec + archive gate

- [x] 6.1 实际根因仍落在当前 capability；spec delta 无需迁移
- [x] 6.2 Archive gate 三查：
  - spec 一致：`specs/` delta 与代码落点对齐
  - tasks 一致：所有 `[x]` 真做了，live verify 真跑了；因 provider connection error 阻断的项保持 `[ ]` 而非伪完成
  - 文档注释一致：若修了共享文件（runtime context / store），相关 CLAUDE.md / JSDoc 跟上
- [x] 6.3 协议台账 check：本 change 不触 A2A / MCP / SKILL.md 等台账项；已复核 `openspec/protocols-ledger.md`，无需更新
- [x] 6.4 Verify records：把 1.x 的 stack trace 摘要 + 根因分类 + 修法 + 5.x live evidence 写进 `verify-record.md`

## 7. Commit / archive

- [ ] 7.1 单 commit 收口，message follow repo style
- [ ] 7.2 `/opsx:archive fix-desktop-direct-chat-readonly`
- [ ] 7.3 canonical spec 若有修改，archive tool 会同步；check `openspec/specs/chat-streaming-ux/spec.md` 最终状态
- [ ] 7.4 回写 `isolate-tauri-desktop-llm-credential` tasks.md 的 5.4 / 7.2 从 `[!]` 改 `[x]`，附本 change 的 archive commit SHA
