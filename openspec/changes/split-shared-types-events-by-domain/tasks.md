## 1. Scaffolding

- [ ] 1.1 创建 `packages/shared-types/src/events/` + 18 空文件
- [ ] 1.2 基线：`wc -l events.ts`（690）+ `grep '^export' events.ts` 完整 payload/interface/type 清单存盘对照

## 2. 拆分到 18 个 domain 文件

- [ ] 2.1 `events/core.ts`：`RuntimeEvent<P>` envelope + `EventFamily` union + 基础 type re-import
- [ ] 2.2 `events/employee.ts`：EmployeeStatePayload
- [ ] 2.3 `events/task.ts`：Task 系列 4 payload
- [ ] 2.4 `events/meeting.ts`：MeetingStatePayload
- [ ] 2.5 `events/llm.ts`：LLM 系列 4 payload
- [ ] 2.6 `events/graph.ts`：GraphNodeEntered/Exited
- [ ] 2.7 `events/boss-route.ts`：BossRouteAction + BossRouteDecidedPayload
- [ ] 2.8 `events/interaction.ts`：4 interaction payload
- [ ] 2.9 `events/handoff.ts`：Handoff Initiated/Completed
- [ ] 2.10 `events/memory.ts`：Memory payload
- [ ] 2.11 `events/workspace.ts`：Workspace/Git/Knowledge payload
- [ ] 2.12 `events/execution.ts`：Execution Resumed/Error/Aborted
- [ ] 2.13 `events/conversation.ts`：Synopsis/Compact payload
- [ ] 2.14 `events/deliverable.ts`：Deliverable payload
- [ ] 2.15 `events/plan.ts`：Plan Created/Step payload
- [ ] 2.16 `events/tool.ts`：Tool telemetry + MCP tool payload
- [ ] 2.17 `events/hr.ts`：HR payload
- [ ] 2.18 `events/session.ts`：Session cost payload

## 3. Barrel 瘦身

- [ ] 3.1 `events.ts` 改为 `export * from './events/<domain>.js'` × 18
- [ ] 3.2 `wc -l + non-blank-non-comment` ≤ 60 gate
- [ ] 3.3 grep `^export interface .*Payload` in events.ts 零匹配

## 4. Verification: typecheck + build

- [ ] 4.1 `pnpm --filter @offisim/shared-types build` 绿
- [ ] 4.2 `pnpm --filter @offisim/ui-core build`
- [ ] 4.3 `pnpm --filter @offisim/core build`
- [ ] 4.4 `pnpm --filter @offisim/ui-office build`
- [ ] 4.5 `pnpm --filter @offisim/web build`
- [ ] 4.6 `pnpm typecheck` 26/26 绿

## 5. Verification: spec gates

- [ ] 5.1 `ls packages/shared-types/src/events/*.ts` ≥ 18 文件
- [ ] 5.2 grep `^export interface \\w+Payload` in each domain 文件 payload 单 owner（无跨文件重复）
- [ ] 5.3 `RuntimeEvent<` 全仓唯一 owner in `events/core.ts`
- [ ] 5.4 全仓 `import type.*from '@offisim/shared-types'` 消费者 typecheck 通过即证 re-export 完整

## 6. Live runtime verification

- [ ] 6.1 web dev server 冷启动，查 0 console type error
- [ ] 6.2 跑一轮 task 确认 event payload runtime 字段完整（types 等价于运行时无影响）
- [ ] 6.3 观察记录到 `verify-notes.md`

## 7. 最终 gate

- [ ] 7.1 `openspec validate split-shared-types-events-by-domain --strict` 绿
- [ ] 7.2 通知用户等 `/opsx:archive`
