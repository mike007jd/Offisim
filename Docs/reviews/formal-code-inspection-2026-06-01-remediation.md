# Formal Code Inspection Remediation

日期：2026-06-01  
来源：`Docs/reviews/formal-code-inspection-2026-06-01.md`

## 处理结论

本轮按当前架构决策处理：Offisim 继续保持 Tauri v2 桌面产品 + React renderer + Hono platform；direct desktop chat 走 Offisim harness/gateway/provider bridge，不新增普通 SDK lane。

## Finding 状态

| Finding | 状态 | 处理 |
| --- | --- | --- |
| F-01 Publish submit 非原子 | 已修复 | draft guarded update 与 moderation job insert 进入同一个 Drizzle transaction；post-commit 后再处理 job。 |
| F-02 AI SDK runtime 口径冲突 | 已闭环 | 不迁移普通 Vercel AI SDK lane；harness 中过期的 Tauri engine adapter 文件断言改为存在才检查，保持当前产品口径。 |
| F-03 Office/Workspace runtime 重复 | 已修复 | 抽出 shared desktop chat runtime，Office 和 Workspace 共享 provider send、abort、error、attachment、cost/event 记录路径。 |
| F-04 附件只显示不进 prompt | 已修复 | staged file 读取 bytes/hash/kind；小文本/数据附件内联进 provider prompt，二进制/metadata-only 明确标注不可读。 |
| F-05 direct chat history 不持久化 | 已修复 | Office direct chat message 写入 `agent_events`，`useMessages` 从事件恢复 transcript；Workspace Messenger chat 也写入同一事件源并从 `workspace_chat.message` 恢复 transcript。 |
| F-06 direct provider bridge 不写 `llm_calls` | 已修复 | provider response 解析 OpenAI/Anthropic usage，direct chat 调用写入 `llm_calls`；无 usage 时显示 unknown，不伪装 `$0.00`。 |
| F-07 `useDeliverables` 缺 company guard | 已修复 | 增加 `enabled: companyId !== null`，queryFn 对 no-company 返回空列表。 |
| F-08 Workspace fixture seam | 已修复为 release 口径 | Workspace rail 继续显示 Preview 标识；Messenger chat 的 direct send/transcript 已接入真实 desktop runtime + `agent_events`，其他 Workspace suite fixture apps 仍不声明完整业务运行时。 |
| F-09 Market listing N+1 | 已修复 | platform `/market/search` 返回卡片所需 version/artifact/requirements/permissions/lineage/previews，renderer 首屏不再逐条 detail/download 聚合。 |
| F-10 local deliverable 写入边界 | 已修复 | `save_deliverable_to_local` 改为 canonical parent + root guard + no-follow leaf open + post-write check。 |
| F-11 Tauri Drizzle transaction gap | 已修复关键路径 | 增加 tx-scoped sqlite proxy backend；install/materialize 使用 `asyncTransact((txRepos) => ...)`，避免事务内调用 standalone repo。 |
| F-12 超大模块理解成本 | 已完成本轮高价值拆分 | 对本报告触发的高风险重复 runtime 做共享抽取；二审追加将 Workspace Messenger 的发送/附件/持久化线程抽到 `WorkspaceAssistantThread.tsx`，主 `MessengerApp.tsx` 回落到列表/系统频道/路由职责。未做全仓六大文件机械拆分，避免无业务收益的大范围 churn。 |
| F-13 search wildcard / 新品排序 | 已修复 | LIKE wildcard 转义；默认 relevance 加 exact/prefix/title boost、social proof 与 newness floor。 |
| F-14 rate limiter 多实例 gate | 已修复生产路径 | 新增 `platform_rate_limit_buckets` Postgres 共享 bucket 表与 `OFFISIM_RATELIMIT_STORE=postgres` 后端；`OFFISIM_PLATFORM_MULTI_INSTANCE=1` 的生产启动会强制要求共享 store 和 `DATABASE_URL`。 |
| F-15 MCP registry 原子写 | 已修复 | registry persist 使用 tmp + fsync + rename；malformed registry 会保留 `.bad.<timestamp>` 文件后再空状态启动。 |

## 验证证据

- `pnpm --filter @offisim/desktop-renderer typecheck`
- `pnpm --filter @offisim/platform typecheck`
- `pnpm --filter @offisim/db-platform typecheck`
- `pnpm --filter @offisim/core typecheck`
- `pnpm --filter @offisim/install-core typecheck`
- `pnpm --filter @offisim/registry-client typecheck`
- `cargo check` in `apps/desktop/src-tauri`
- `pnpm typecheck`
- `pnpm exec biome check --write` on touched TS/TSX/MTS/MJS remediation files
- `pnpm check:ui-hygiene`
- `pnpm harness:deterministic`
- `pnpm harness:chat-attachment-roundtrip`
- `pnpm platform:auth-harness`
- `pnpm platform:migration:drift`
- `pnpm --filter @offisim/db-platform build`
- `pnpm --filter @offisim/platform build`
- `pnpm --filter @offisim/desktop-renderer build`
- `pnpm --filter @offisim/desktop build`
- `git diff --check`
- `gitnexus_detect_changes(scope: all)` returned `critical` because tx-aware repository creation touches shared desktop repo flows; this matches the intended F-11 blast radius and was covered by typecheck, deterministic harness, release build, and release app verification.

Release app produced and verified:

- `/Users/haoshengli/Seafile/WebWorkSpace/Offisim/apps/desktop/src-tauri/target/release/bundle/macos/Offisim.app`
- Computer Use attached the release app at `tauri://localhost`.
- Verified Office shell, Workspace Preview marker, Workspace Messenger thread/composer, Market search result filtering, and release app close via Computer Use.

## Gate Notes

`pnpm lint` still fails on existing unrelated formatter/a11y findings in untouched design-system/app files. Changed files pass targeted Biome checks; this remediation does not expand into whole-repo formatting churn.

F-12 is now closed for the high-value split that this remediation actually touched; it is not a claim that every large historical module has been mechanically decomposed. The completed behavior fixes are F-01, F-03, F-04, F-05, F-06, F-07, F-09, F-10, F-11, F-13, F-14, and F-15. F-02 is an architecture口径 closure, and F-08 remains closed by a precise release Preview label plus real Messenger chat persistence rather than by pretending every Workspace app is production-runtime-backed.

## 二审追加修复记录

- Workspace Messenger chat: `apps/desktop/renderer/src/surfaces/workspace/workspace-message-events.ts` 使用现有 `agent_events` 事件源持久化 `workspace_chat.message`，release runtime 下发送前写入用户消息、provider 响应后写入员工消息，重启/切换线程可恢复 transcript。
- F-12 structure: `WorkspaceAssistantThread.tsx` 承接 Workspace chat composer、attachments、runtime send、deliverable actions、run record and transcript rendering；`MessengerApp.tsx` 不再混放 runtime send/persistence 逻辑。
- Platform rate limiting: `packages/db-platform/migrations/0003_platform_rate_limit_buckets.sql` 与 schema 新增共享 bucket；`apps/platform/src/middleware/rate-limit.ts` 保留 memory default，但生产多实例可切到 Postgres row-lock token bucket，并做过期 bucket 清理。
- Deployment gate: `apps/platform/src/startup.ts` 和 `scripts/harness-platform-auth-boundaries.mts` 覆盖 `OFFISIM_PLATFORM_MULTI_INSTANCE=1` 必须使用 Postgres shared store 的启动门禁。
