> **Scope (locked 2026-04-18, revised after user decision to not keep v0.3 compat)**: 本 change 合并两件事 — (A) A2A peer 从 external-department 语义翻盘成 external-employee 语义 + (B) A2A protocol layer 从 v0.3.0 **直接重写到 v1.0**（supportedInterfaces / PascalCase methods / TASK_STATE_* / 统一 Part / messageId required）。prerelease = 不保留兼容 shim，不起 follow-up change。live verify peer 必须 **v1.0 原生**（hermes / codex / gemini / opencode）。db-platform 不动（不含 employees 表）。

## 1. Schema & Types (foundation)

- [x] 1.1 db-local: 新 migration `packages/db-local/src/migrations/024_employees_external_a2a.sql` + live desktop `Docs/03_migrations/offisim_migrations_local_v0.1/030_employees_external_a2a.sql`（embed 到 `apps/desktop/src-tauri/src/lib.rs` version 30）加 6 列 (`is_external INTEGER NOT NULL DEFAULT 0` + 5 个 nullable text + `idx_employees_is_external`)，同步 `packages/db-local/src/schema.ts` employees 表定义
- [~] 1.2 ~~db-platform: 新 migration~~ **N/A** — ground-truth audit 发现 db-platform 是 marketplace-side schema（users / listings / reviews / packages），不含 employees 表；employees 只在 db-local。提案此点是凭空写的前提
- [x] 1.3 `packages/core/src/runtime/repositories.ts`: `EmployeeRow` / `EmployeeUpdate` + `packages/install-core/src/types.ts` `NewEmployee`（三处加 6 个字段；EmployeeRow = `is_external: number` + 5 `string | null`，NewEmployee = `is_external?: boolean` + 5 `string | null`）
- [x] 1.4 `pnpm --filter @offisim/shared-types build && pnpm --filter @offisim/db-local build && pnpm --filter @offisim/install-core build && pnpm --filter @offisim/core typecheck` 绿（db-platform 无需 rebuild — 未触动）

## 2. Three-backend repo parity

- [x] 2.1 `packages/core/src/runtime/repos/employees/drizzle.ts`: create 显式映射 6 列；update 通过 `EmployeeUpdate` Pick 扩展天然支持
- [x] 2.2 `packages/core/src/runtime/repos/employees/memory.ts`: create 显式映射 6 列；update signature 放宽到 `Partial<EmployeeRow>` 以 honor 新字段
- [x] 2.3 `apps/web/src/lib/tauri-repos/employees.ts`: create 显式映射 6 列 + 顺手 honor `emp.employee_id ?? randomUUID()`（和 drizzle/memory 对齐）
- [x] 2.4 `pnpm --filter @offisim/core typecheck` 绿（drizzle + memory + tauri 三后端 create/findById 对 6 列的映射语义一致 — drizzle/memory 通过 spread-then-override，tauri 通过显式 insert values）

## 3. Employee-node external branch

- [x] 3.1 创建 `packages/core/src/agents/employee-a2a-executor.ts`: 承载 A2A dispatch 分支全部逻辑 —— peer 从 `EmployeeRow.a2a_url/token/agent_id` 构建、`A2AClient.sendAndWait` 调用、output 提取（base64/text fallback）、deliverable emit（`sourceKind:'employee'`）、事件顺序和内部 finalizeSuccess 对齐（`running→completed` + `task.assignment.changed unassigned` + `task.subtask.progress done` + `employee.state.changed executing→idle` + `task.completed` hook）、失败写结构化 `{error:{code,message,source:'a2a'}}` 到 task_runs.output_json 并触发 `running→failed` / `subtask.progress failed` / `employee idle`
- [x] 3.2 `employee-node.ts`: preflight 后按 `employee.is_external === 1` 分支；外包调 `runEmployeeA2A`，内部走现有 LLM pipeline；barrel 141 NBNC（≤200）
- [x] 3.3 `grep "A2AClient\|sendAndWait" employee-node.ts` → 0 命中

## 4. Delete external-department abstraction

- [x] 4.1 **DELETED** `packages/core/src/a2a/external-departments.ts`
- [x] 4.2 `packages/core/src/a2a/index.ts`: 删 external-departments export，仅保留 A2A 协议层（client/server/types）
- [x] 4.3 `packages/core/src/index.ts` / `packages/core/src/browser.ts`: 删 `defineExternalDepartments` / `formatExternalDepartmentCatalog` / `matchExternalDepartments` / `ExternalDepartment*` 全部 re-export
- [x] 4.4 `packages/core/src/runtime/runtime-context.ts`: 删 `externalDepartments` 字段（`RuntimeContext` 接口 + createRuntimeContext init options 两处）
- [x] 4.5 **DELETED** `apps/web/src/lib/external-departments.ts`
- [x] 4.6 `apps/web/src/lib/browser-runtime.ts`（createBrowserRuntime + createBrowserRuntimeReposOnly 两处）/ `apps/web/src/lib/tauri-runtime.ts` / `apps/web/src/runtime/OffisimRuntimeProvider.tsx` / `packages/ui-office/src/runtime/offisim-runtime-context.tsx` / `packages/ui-office/src/components/layout/RightSidebar.tsx`: 删 `loadExternalDepartments()` / `externalDepartments` 字段 / External Departments sidebar block

## 5. Delete department-dispatcher graph path

- [x] 5.1 **DELETED** `packages/core/src/agents/department-dispatcher-node.ts`
- [x] 5.2 `packages/core/src/graph/main-graph.ts`: 删 `department_dispatcher` node 注册 + `routeFromDepartmentDispatcher` + `routeFromStepDispatcher` 改为 `pendingAssignments.length > 0 ? 'employee' : 'step_advance'` + 相关 edges
- [x] 5.3 `packages/core/src/agents/step-dispatcher-node.ts`: 删 `assigneeKind === 'department'` 排序分支 + `projectAssignments` 的 `'department' continue` + taskStateChanged / taskAssignmentChanged / taskAssignmentDispatched 调用里的 department-ternary 全部改为 `'employee'` 常量

## 6. Delete planner department paths

- [x] 6.1 `packages/core/src/agents/pm-planner/preflight.ts`: 删 `recommendedDepartmentIds` / `validDepartments` 识别逻辑；同步 `pm-planner-types.ts` 删 `ExternalDepartmentDefinition` import + `validDepartments` 字段
- [x] 6.2 `packages/core/src/agents/pm-planner/plan-persistence.ts`: 删 `persistDepartmentPlan` 函数；`pm-planner-node.ts` 删 import + `if (prep.validDepartments.length > 0) return persistDepartmentPlan(prep)` 分支
- [x] 6.3 `packages/core/src/agents/manager-node.ts`: 删 `matchExternalDepartments` / `formatExternalDepartmentCatalog` import + `EXTERNAL_ROUTING_RE` + `hasInternalCapabilityMatch` + `shouldPreferExternal` 分支 + system prompt `"Available external departments"` 整段；`employee-roster.ts` `buildEnrichedEmployeeList` 给 `is_external === 1` 员工加 `[external:<brandKey>]` 后缀
- [x] 6.4 (额外) `packages/core/src/graph/state.ts`: 删 `ManagerDirective.recommendedDepartments` 字段

## 7. Shared-types union collapse

- [x] 7.0 Pre-flight grep 清单已在边做边收（grep assigneeKind/sourceKind/department）；按 shared-types → core → ui-office 顺序推进，每阶段 `pnpm --filter <pkg> build/typecheck` 验证
- [x] 7.1 `packages/shared-types/src/events/{plan,task,deliverable}.ts`: 所有 `'employee' | 'department'` union 收缩为 `'employee'` single-literal（5 处）
- [x] 7.2 `packages/core/src/graph/state.ts`: `AssignmentTargetKind` 收缩为 `'employee'`；`PendingAssignment` / `PlanTask` / `StepTaskOutput` 天然受益；`ManagerDirective.recommendedDepartments` 删字段
- [x] 7.3 `packages/core/src/runtime/repositories.ts` `DeliverableContributor.sourceKind` 收缩为 `'employee'`；`event-factories.ts` 因 payload 类型收缩 consumer 自动收敛（无需改签名）
- [x] 7.4 `packages/ui-office/src/**` consumer 端全清：`task-mappers.ts`（删 department tone 分支）/ `deliverable-mappers.ts`（删 externalCount）/ `plan/TaskItem.tsx`（删 `(external)` 后缀）/ `deliverable/DeliverableCard.tsx`（删 `(external)`）/ `pitch/PitchHall.tsx`（SOP draft 删 department 分支）/ `useDeliverables.ts` + `plan-step-store.tsx` 类型收缩

## 8. Verification (typecheck + build + live)

- [x] 8.1 串行 `pnpm --filter @offisim/shared-types build && pnpm --filter @offisim/ui-core build && pnpm --filter @offisim/core build && pnpm --filter @offisim/ui-office build && pnpm --filter @offisim/web build` 全绿（web build 含 typecheck，tauri-runtime + browser-runtime + ui-office 全 clean）
- [x] 8.2 全 repo grep（排除 `dist/` / `node_modules/` / `openspec/`）：`ExternalDepartment|matchExternalDepartments|defineExternalDepartments|formatExternalDepartmentCatalog|loadExternalDepartments|departmentDispatcherNode|department_dispatcher|routeFromDepartmentDispatcher|persistDepartmentOnlyPlan|persistDepartmentPlan|recommendedDepartmentIds|recommendedDepartments` → 0 命中
- [x] 8.3 全 repo grep `(assigneeKind|sourceKind)\s*[:=]\s*['\"]department['\"]` → 0 命中
- [x] 8.4 Live verify **PASS**（2026-04-18，Hermes + v1.0 peer stub `/tmp/offisim-a2a-peer.py`）：D.repos.employees.create(is_external:true, a2a_url:'http://127.0.0.1:18800', ...) → row keys count 18，6 个 external 字段全在。浏览器 fetch log 看到 `GET /.well-known/agent-card.json` + `POST /a2a/v1`，peer log 记到 options/get/options/post + rpc method: SendMessage
- [x] 8.5 Live 观察 **PASS**：console 依次打出 `dispatch branch route: 'a2a'` / `Fetching agent card` / `SendMessage peer agentId: general-task`。lastTaskRun `status: completed` + `output_json: {"content": <echoed text>}`。事件链 `assigneeKind:'employee'` + `employee.state.changed idle→executing→idle`。A2A v1.0 wire 打通，endpoint 挂掉时 executor fallback 到 `{error:{code:'a2a_transport',source:'a2a'}}` 已于前一轮（CORS 挡住时）验证
- [x] 8.6 Live 回归 **PASS**：内部员工 direct chat 正常走 LLM path（`/api/llm-proxy/v1/messages`），无退化
- [x] 8.7 （额外 blocker 发现+修）Vite stale pre-bundle：workspace dep (`@offisim/core/browser`) 经 `optimizeDeps` pre-bundle 缓存到 `node_modules/.vite/deps/`，pnpm workspace rebuild 不触发失效，导致 `employee-node` fresh 但 `memory-repositories` stale。`apps/web/vite.config.ts` `optimizeDeps.force = command === 'serve'` 在 dev 下无条件 re-bundle，根除该类 symmetry 问题
- [x] 8.8 （额外）A2A peer CORS：浏览器直连 localhost peer 必须过 preflight，`/tmp/offisim-a2a-peer.py` 重写带 `do_OPTIONS` + `Access-Control-Allow-*` headers + v1.0 PascalCase 方法 + `TASK_STATE_COMPLETED` 响应

## 10. A2A protocol layer v0.3 → v1.0 rewrite (合并 scope)

- [x] 10.1 `packages/core/src/a2a/a2a-types.ts` 全部重写：`A2APart` 改统一 one-of（`text/raw/url/data` + `mediaType` + `filename`）；`A2AMessage.messageId` required；`A2ATaskState` 改 9-value `TASK_STATE_*` enum；`A2AAgentCard` 加 `supportedInterfaces[{url, protocolBinding, protocolVersion}]` + `capabilities.{streaming, pushNotifications, stateTransitionHistory, extendedAgentCard}` + `securitySchemes` + `security` + `defaultInputModes` + `defaultOutputModes` + `provider/iconUrl/version/documentationUrl/skills/signatures`；新增 `A2AAgentInterface` / `A2AAgentCapabilities` / `A2ASendMessageResult`；删除 `A2ATextPart` / `A2AFilePart` / `A2ADataPart`
- [x] 10.2 `packages/core/src/a2a/a2a-client.ts` 全部重写：endpoint 改为 lazy resolve（先 fetch well-known agent card + 缓存 + 从 `supportedInterfaces` 挑 JSONRPC interface）；method 名改 PascalCase（`SendMessage` / `GetTask` / `CancelTask`）；`sendAndWait` 统一 `{task, message}` one-of（message-only reply wrap 成 synthetic completed task）；poll terminal states 扩到 `TASK_STATE_COMPLETED/FAILED/CANCELED/REJECTED`
- [x] 10.3 `packages/core/src/a2a/a2a-server.ts` 全部重写：method 分发切 PascalCase（`SendMessage` / `GetTask` / `CancelTask` / `GetExtendedAgentCard`）；agent card GET 直接回 v1.0 card；task 响应用 `TASK_STATE_*` + `artifactId` + 统一 Part
- [x] 10.4 `employee-a2a-executor.ts` 更新：Part 提取改成读 `part.text` / `part.raw` / `part.mediaType` / `part.filename`；terminal state check 改 `!== 'TASK_STATE_COMPLETED'`；error code 用 `a2a_<state.toLowerCase()>` 形式
- [x] 10.5 `packages/core/src/a2a/index.ts` + `packages/core/src/index.ts` + `packages/core/src/browser.ts` exports 同步（加 `A2AAgentInterface` / `A2AAgentCapabilities` / `A2ASendMessageResult`，删 `A2ATextPart` / `A2AFilePart` / `A2ADataPart`）
- [x] 10.6 串行 build 全绿：`shared-types → core → ui-office → web`，无 typecheck error

## 9. Archive & spec sync

- [x] 9.1 `/opsx:archive` 本 change — `external-employee-a2a-dispatch` 新增（6 requirements: schema carries 6 cols / dispatch via A2AClient / event+deliverable shape preserved / external-department abstraction removed / A2A protocol layer rewritten to v1.0 / peer CORS compatibility），`employee-node-boundaries` + `repository-backend-boundaries` delta 合并。archive dir: `openspec/changes/archive/2026-04-18-rewire-a2a-as-external-employee/`
- [x] 9.2 更新 MEMORY.md `Open Issues` 下的 Phase 2b 条目第 1 条打勾 + archive commit SHA
- [x] 9.3 单 commit 收口（refactor/core + breaking）
