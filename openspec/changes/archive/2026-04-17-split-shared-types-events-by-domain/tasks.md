## 1. Scaffolding

- [x] 1.1 创建 `packages/shared-types/src/events/` + 27 文件（18 spec 列 + 9 orphan domain: install / direct-chat / report / ui / rack-slot / cost / notification / vault / prefab）
- [x] 1.2 基线：`wc -l events.ts`（690）+ 75 exports 清单对照

## 2. 拆分到 domain 文件

- [x] 2.1 `events/core.ts`：`RuntimeEvent<P>` envelope + `EventFamily` union + `RuntimeEntityType` import
- [x] 2.2 `events/employee.ts`：EmployeeStatePayload + 7 CRUD/Workstation/Version/Installed payload
- [x] 2.3 `events/task.ts`：Task 系列 4 payload
- [x] 2.4 `events/meeting.ts`：MeetingStatePayload + MeetingActionCreatedPayload
- [x] 2.5 `events/llm.ts`：LLM 系列 4 payload
- [x] 2.6 `events/graph.ts`：GraphNodeEntered/Exited
- [x] 2.7 `events/boss-route.ts`：BossRouteAction + BossRouteDecidedPayload
- [x] 2.8 `events/interaction.ts`：4 interaction payload
- [x] 2.9 `events/handoff.ts`：Handoff Initiated/Completed
- [x] 2.10 `events/memory.ts`：Memory Created/Accessed payload
- [x] 2.11 `events/workspace.ts`：WorkspaceStaleness + GitAutoCommitted + 5 Knowledge payload
- [x] 2.12 `events/execution.ts`：Execution Resumed/Aborted + ErrorOccurred
- [x] 2.13 `events/conversation.ts`：Synopsis/Compact payload
- [x] 2.14 `events/deliverable.ts`：Deliverable payload
- [x] 2.15 `events/plan.ts`：Plan Created/Step Started/Step Completed/Completed payload
- [x] 2.16 `events/tool.ts`：McpServer/Tool/ToolResult + ToolExecutionTelemetry payload
- [x] 2.17 `events/hr.ts`：3 HR payload
- [x] 2.18 `events/session.ts`：SessionCostBreakdown + SessionCostUpdated
- [x] 2.19 orphan domain：install / direct-chat / report / ui / rack-slot / cost / notification / vault / prefab 各独立文件（spec 允许 "additional file for genuine new event domain"）

## 3. Barrel 瘦身

- [x] 3.1 `events.ts` 改为 27 行 `export * from './events/<domain>.js'`
- [x] 3.2 `wc -l + non-blank-non-comment` = 27 ≤ 60 gate ✓
- [x] 3.3 grep `^export interface .*Payload` in events.ts 零匹配 ✓

## 4. Verification: typecheck + build

- [x] 4.1 `pnpm --filter @offisim/shared-types build` 绿
- [x] 4.2 `pnpm --filter @offisim/ui-core build` 绿
- [x] 4.3 `pnpm --filter @offisim/core build` 绿
- [x] 4.4 `pnpm --filter @offisim/ui-office build` 绿
- [x] 4.5 `pnpm --filter @offisim/web build` 绿
- [x] 4.6 `pnpm typecheck` 26/26 绿

## 5. Verification: spec gates

- [x] 5.1 `ls packages/shared-types/src/events/*.ts` = 27 ≥ 18 ✓
- [x] 5.2 每个 payload 单 owner（grep `^export interface \w+Payload` per-name count = 1）✓
- [x] 5.3 `RuntimeEvent<` 全仓唯一 owner `events/core.ts`（grep 单匹配）✓
- [x] 5.4 全仓 `import type.*from '@offisim/shared-types'` 消费者 typecheck 通过 ✓

## 6. Live runtime verification

- [x] 6.1 web dev server 冷 reload，console error=0
- [x] 6.2 跑 "Say hi in one sentence" → Boss ANALYZING → direct_reply 完整跑完，2.1K tokens / $0.0026 / 8s；boss.route.decided / llm.* / graph.node.* / cost.session.updated 多 domain payload 全链跨包通过
- [x] 6.3 观察记录到 `verify-notes.md`

## 7. 最终 gate

- [x] 7.1 `openspec validate split-shared-types-events-by-domain --strict` 绿
- [x] 7.2 通知用户等 `/opsx:archive`
