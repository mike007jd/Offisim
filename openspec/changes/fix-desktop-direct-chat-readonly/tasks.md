## 1. Reproduce + 抓 stack

- [ ] 1.1 确认 Tauri dev (`pnpm --filter @offisim/desktop dev`) 是否复现 direct chat readonly 错。若 dev 复现，后续调试全走 dev；若 dev 不复现仅 release 复现，切 release 链
- [ ] 1.2 确认当前 bundle 是否打了 source map：`cat apps/web/vite.config.ts` 看 `build.sourcemap`；必要时临时 `sourcemap: 'inline'` 重跑 `pnpm --filter @offisim/desktop build`
- [ ] 1.3 打开 DevTools → Sources → `Pause on exceptions` (Caught + Uncaught) → 触发 `@Maya Lin hi`（或任一员工）
- [ ] 1.4 捕获完整 stack trace，把顶帧的文件 / 行 / 赋值语句记录到 `repro-notes.md`
- [ ] 1.5 在控制台上查 target 对象：`Object.isFrozen(target)` / `Object.getOwnPropertyDescriptor(target, '<key>')` / 看 prototype chain，判断冻结来源（显式 `Object.freeze` / Zustand store / frozen SDK export 等）

## 2. 根因判定

- [ ] 2.1 根据 1.x 的证据，把根因归到以下一类：
  - (a) Zustand store 被绕开 action 直写
  - (b) AgentState / snapshot 跨层 mutation
  - (c) React ref / props / frozen config 赋值
  - (d) 三方 SDK 冻结导出对象（最末位嫌疑）
- [ ] 2.2 全仓 grep 同一 mutation pattern，确认是否还有其它路径会触发同类问题；如有，记录但**不扩大 scope**（留 followup change）
- [ ] 2.3 确定 canonical spec 归属：若根因确在 chat-streaming-ux 范畴，保留当前 spec delta；若跨到 `runtime-provider-boundaries` / `employee-node-boundaries` 等其它 capability，修改 `specs/` 结构调到对应 spec

## 3. 修复

- [ ] 3.1 按 2.1 的分类落根因修法：
  - (a) 换成 `useXxxStore.setState(s => ...)` / 既有 action
  - (b) 走既有 reducer / event emit / repo update，不在 render 层直写
  - (c) 产生新对象替换旧对象，不修改冻结对象
  - (d) 包一层 mutable adapter，不改依赖
- [ ] 3.2 **不得**用 `Object.defineProperty(writable:true)` / shallow unfreeze / `structuredClone` 伪装可变来绕过
- [ ] 3.3 顺手检查是否有相邻 "静默在 browser，严格在 JSC" 的 assignment 模式（TS `as any` 绕掉的 readonly 字段赋值等）

## 4. Build / typecheck

- [ ] 4.1 `pnpm --filter @offisim/shared-types build`
- [ ] 4.2 `pnpm --filter @offisim/core build`
- [ ] 4.3 `pnpm --filter @offisim/ui-office build`
- [ ] 4.4 `pnpm --filter @offisim/web build`
- [ ] 4.5 `pnpm --filter @offisim/desktop build`
- [ ] 4.6 （若动了 Rust）`cargo check` + `cargo clippy -- -D warnings`

## 5. Live verify（Tauri release bundle）

- [ ] 5.1 打开 release bundle，Settings 保持 MiniMax provider 已配置
- [ ] 5.2 Direct chat 给员工 A 发 `hi` → 员工真回复，streaming 正常
- [ ] 5.3 Direct chat 给员工 B 发 `hi` → 员工真回复（≥2 个不同员工）
- [ ] 5.4 Team chat 发 `hi` → Boss 正常回复（不回归）
- [ ] 5.5 DevTools Console 全程无 `Attempted to assign to readonly property.` / 新 TypeError

## 6. Spec + archive gate

- [ ] 6.1 根据实际根因回修 `specs/<capability>/spec.md` delta；若落点改到别的 capability，迁移并删空 `chat-streaming-ux` delta
- [ ] 6.2 Archive gate 三查：
  - spec 一致：`specs/` delta 与代码落点对齐
  - tasks 一致：所有 `[x]` 真做了，live verify 真跑了
  - 文档注释一致：若修了共享文件（runtime context / store），相关 CLAUDE.md / JSDoc 跟上
- [ ] 6.3 协议台账 check：本 change 不触 A2A / MCP / SKILL.md 等台账项，无需更新 `openspec/protocols-ledger.md`（archive 前复核一次）
- [ ] 6.4 Verify records：把 1.x 的 stack trace 摘要 + 根因分类 + 修法 + 5.x live evidence 写进 `verify-record.md`

## 7. Commit / archive

- [ ] 7.1 单 commit 收口，message follow repo style
- [ ] 7.2 `/opsx:archive fix-desktop-direct-chat-readonly`
- [ ] 7.3 canonical spec 若有修改，archive tool 会同步；check `openspec/specs/chat-streaming-ux/spec.md` 最终状态
- [ ] 7.4 回写 `isolate-tauri-desktop-llm-credential` tasks.md 的 5.4 / 7.2 从 `[!]` 改 `[x]`，附本 change 的 archive commit SHA
