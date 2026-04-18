## Why

产品方向纠正：A2A peer = **品牌外观外包员工**（external employee with brand avatar），不是"外包部门"。旧方向下代码落了一轮 `ExternalDepartmentDefinition` / `department_dispatcher` / `assigneeKind:'department'` / `sourceKind:'department'` 全链路（manager prompt / pm-planner preflight / step-dispatcher / dispatcher node / plan-persistence / deliverable），但产品根本没有"外包 department"概念（只有内部 department 是正常业务抽象）。当前抽象方向错 → 删光，按员工语义重接。这是 3-change 系列第 1 条：schema + dispatch 翻盘；第 2 条做 brand avatar 资产，第 3 条做 Market/Settings 安装入口。

## Scope — transport rewire + v1.0 protocol alignment (合并，prerelease)

本 change 同时做两件事：
1. **A2A peer 从 "external department" 翻盘成 "external employee"**（schema + dispatch + 删 department 语义全链路）
2. **A2A protocol layer 从 v0.3.0 直接升级到 v1.0**（`a2a-types.ts` / `a2a-client.ts` / `a2a-server.ts` 全部重写）

合并进一条 change 的理由：Offisim 尚未上线，按 user feedback `prelaunch_drop_dirty_data` 纪律，**不保留向后兼容层**。没有现网 peer 需要兼容 v0.3.0，保留 v0.3.0 反而会一上线就累积 tech debt。两件事一次性做完，follow-up queue 少一条。

### v1.0 破坏性差异（verified via Context7 `/websites/a2a-protocol`，2026-04-18）

| 维度 | v0.3.0（旧） | v1.0（本 change 目标） |
|---|---|---|
| Agent Card 接入点 | `agentCard.url` + `preferredTransport` | `agentCard.supportedInterfaces[{url, protocolBinding, protocolVersion}]` |
| Agent Card 额外字段 | 无 | `capabilities.{streaming, pushNotifications, stateTransitionHistory, extendedAgentCard}` + `securitySchemes` + `security` + `defaultInputModes` + `defaultOutputModes` |
| JSON-RPC endpoint | 写死 `{base}/a2a/jsonrpc` | 从 agent card 的 JSONRPC interface 解析；默认 `/rpc` |
| JSON-RPC method | `message/send` / `tasks/get` | `SendMessage` / `GetTask` / `CancelTask` / `SendStreamingMessage` / `SubscribeToTask` / `ListTasks` / `GetExtendedAgentCard` |
| Part 结构 | 判别字段 `type: 'text' \| 'file' \| 'data'` | 统一 Part，one-of `text / raw / url / data`，`mediaType`（替 `mimeType`）+ `filename` 通用 |
| Message | 无 messageId | `messageId` 必填 + `contextId/taskId` 可选 + `extensions/referenceTaskIds` |
| Task state 枚举 | `submitted \| working \| input-required \| completed \| failed \| canceled` | `TASK_STATE_SUBMITTED / WORKING / INPUT_REQUIRED / COMPLETED / CANCELED / FAILED / REJECTED / AUTH_REQUIRED / UNKNOWN` |
| Artifact | `{name?, parts}` | `{artifactId, name?, description?, parts, metadata?}` |
| SendMessage result | 直接 Task | One-of `{ task, message }` |

live verify peer 必须是 **v1.0 原生** A2A peer（hermes / codex / gemini / opencode 等按当前官方 spec 实现的 peer）。

## What Changes

- **BREAKING** Employee schema 新增 6 列：`is_external` (bool) / `a2a_url` / `a2a_token` / `a2a_agent_id` / `brand_key` / `agent_card_json`。**只动 db-local**（`packages/db-local/src/migrations/024_employees_external_a2a.sql` + `Docs/03_migrations/offisim_migrations_local_v0.1/030_employees_external_a2a.sql` + `apps/desktop/src-tauri/src/lib.rs` 注册 version 30 + `schema.ts`）。**db-platform 无 employees 表**（它是 marketplace users / listings / reviews / packages schema，不含 per-instance 员工），**不 touch**。`EmployeeRow` / `EmployeeUpdate` 类型同步在 `packages/core/src/runtime/repositories.ts`，`NewEmployee` 在 `packages/install-core/src/types.ts`
- **BREAKING** `employee-node.ts` 按 `is_external` 分支：外包走 `A2AClient.sendAndWait` 替代 LLM adapter，preflight / events / deliverable 输出走一致员工路径
- **BREAKING** 删除 `ExternalDepartmentDefinition` / `external-departments.ts` / `formatExternalDepartmentCatalog` / `matchExternalDepartments` / `defineExternalDepartments` / `RuntimeContext.externalDepartments` / `apps/web/src/lib/external-departments.ts` / `loadExternalDepartments()`
- **BREAKING** 删除 `department-dispatcher-node.ts` + `main-graph.ts` 中 `department_dispatcher` node、`routeFromDepartmentDispatcher`、`routeFromStepDispatcher` 的 department 分支
- **BREAKING** 删除 `pm-planner/preflight.ts` 中 `recommendedDepartmentIds` / `validDepartments` 识别、`pm-planner/plan-persistence.ts` 中 `persistDepartmentOnlyPlan`
- **BREAKING** `PendingAssignment.assigneeKind` / `PlanTaskStep.assigneeKind` / deliverable `sourceKind` / subtask progress `assigneeKind` 的 `'department'` 字面量全部删除（union 收缩为 `'employee'`）
- **BREAKING** `manager-node.ts` system prompt 里 "Available external departments" 整段删除；若外包员工需要在 prompt 中被感知，和内部员工同列（标记 `[external:<brandKey>]`）
- **BREAKING** `step-dispatcher-node.ts` 删除 department-first 排序分支
- shared-types events 域内清理所有 `sourceKind:'department'` / `assigneeKind:'department'` 分支
- **BREAKING** `A2AClient` / `A2ARequestHandler` / `A2A*` types / `packages/core/src/a2a/{a2a-client,a2a-server,a2a-types}.ts` **全部重写到 v1.0**（类名保留，内部实现和 wire format 破坏性升级）。外包员工 dispatch 直接用 v1.0 transport，不再经过 v0.3 → v1 shim
- 数据迁移策略：pre-launch 按用户 feedback `drop dirty data` 执行 —— 不写 data migration，schema migration 直接加列（旧 dept_* seed 数据不会入库，因已删 seed 源）

## Capabilities

### New Capabilities
- `external-employee-a2a-dispatch`: 外包员工调度边界 —— `is_external === true` 的 employee 必须持 `a2a_url` 与 `brand_key`；dispatch 走 `A2AClient` 而非 LLM adapter；deliverable 归属仍是 employee（`sourceKind:'employee'`）；失败路径透传 A2A 错误消息到 task_run + event

### Modified Capabilities
- `employee-node-boundaries`: 新增 external 分支约束 —— `employee-node.ts` 必须按 `is_external` 路由到 `A2AClient` vs LLM adapter，不得在 barrel 内膨胀分支体（抽 `employee-a2a-executor.ts` 或等价模块）
- `repository-backend-boundaries`: `employees` 家族 repo 新增 6 列的 read/write 支持，三后端（drizzle / memory / tauri）同步

## Impact

**代码改动范围**：

| 层 | 文件 | 动作 |
|---|---|---|
| DB schema | `packages/db-local/src/schema.ts` + new migration `024_employees_external_a2a.sql` + desktop live migration `030_employees_external_a2a.sql` embedded via `apps/desktop/src-tauri/src/lib.rs` version 30 | add 6 cols |
| ~~DB schema~~ | ~~`packages/db-platform/src/schema.ts`~~ | **N/A — db-platform 是 marketplace schema，不含 employees 表**（proposal 原始写法是 ground-truth audit 前的错误前提） |
| Types | `packages/core/src/runtime/repositories.ts` (`EmployeeRow` / `NewEmployee` / `EmployeeUpdate`) | add fields |
| Types | `packages/shared-types/src/events/*` (assigneeKind / sourceKind union) | drop 'department' |
| Repo | `packages/core/src/runtime/repos/employees/{drizzle,memory}.ts` | map 6 cols |
| Repo | `apps/web/src/lib/tauri-repos/employees.ts` | map 6 cols |
| Graph | `packages/core/src/graph/main-graph.ts` | drop department_dispatcher node + edges |
| Node | `packages/core/src/agents/employee-node.ts` (+ new `employee-a2a-executor.ts`) | external 分支 |
| Node | `packages/core/src/agents/department-dispatcher-node.ts` | **DELETE** |
| Planner | `packages/core/src/agents/pm-planner/{preflight,plan-persistence}.ts` | drop department paths |
| Manager | `packages/core/src/agents/manager-node.ts` | drop external departments section |
| Dispatch | `packages/core/src/agents/step-dispatcher-node.ts` | drop department sort |
| A2A | `packages/core/src/a2a/external-departments.ts` | **DELETE** |
| A2A | `packages/core/src/a2a/index.ts` + `packages/core/src/index.ts` + `packages/core/src/browser.ts` | drop exports |
| Runtime | `packages/core/src/runtime/runtime-context.ts` | drop `externalDepartments` field |
| Web runtime | `apps/web/src/lib/{browser-runtime,tauri-runtime}.ts` | drop `loadExternalDepartments()` |
| Web seed | `apps/web/src/lib/external-departments.ts` | **DELETE** |

**产品影响**：
- 第 1 条落地后，external employee 没有 UI 安装入口（等第 3 条），**live verify 靠手动造一条 `is_external=true` + `a2a_url=localhost 测试 peer` 的 employee record**（或临时 repo.create 脚本）
- brand avatar 渲染等第 2 条（第 1 条期间外包员工走内部 DiceBear/块人 fallback 或 placeholder；**不得把外包员工塞进 DiceBear seed 派生体系** —— 2D 在第 2 条之前简单画个带 `[brand]` 标签的占位 sprite）
- 不破坏内部员工任何现有流程（manager / pm-planner / dispatcher / employee-node / deliverable 内部员工路径行为保留）

**验证策略**（live agent，无自动化）：
- typecheck / build 串行四包绿（shared-types / core / ui-office / web）
- **Live verify peer 口径**：peer 必须是 **A2A v1.0 原生**（agent card 暴露 `supportedInterfaces[{protocolBinding:'JSONRPC'}]`，接受 `SendMessage` / `GetTask`，返回 `TASK_STATE_*` 枚举，Part 用 `text/raw/url/data` + `mediaType`）。推荐 hermes / codex / gemini / opencode 等当前官方 spec 兼容 peer
- 手动造一条 external employee（`repos.employees.create({ is_external: true, a2a_url, a2a_token, a2a_agent_id, brand_key: 'custom', ... })`），chat 触发一个 task 给该员工，观察：
  - plan 里该员工 assigneeKind='employee'
  - employee-node 日志显示走 `runEmployeeA2A` 分支（而不是 LLM turn runner）
  - A2A client 先 fetch `{a2a_url}/.well-known/agent-card.json`，再用 agent card 解析的 JSONRPC endpoint 调 `SendMessage`
  - task_run status 流转正常（`queued → running → completed`），v1.0 task state 是 `TASK_STATE_COMPLETED`，deliverable `sourceKind:'employee'`
  - 失败路径（A2A endpoint 挂掉 / 任务 `TASK_STATE_FAILED`）`task_runs.output_json` 是 `{error:{code,message,source:'a2a'}}`
- 内部员工一轮 chat 回归无退化（plan / dispatch / deliverable / scene 3D ceremony）
