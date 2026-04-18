## Context

当前 A2A 接入走"外包 department"抽象（`ExternalDepartmentDefinition` / `department_dispatcher` / `assigneeKind:'department'` / `sourceKind:'department'` / `persistDepartmentOnlyPlan` / manager prompt 里独立 external departments section / env hardcoded 3 个 dept seed），全链路通但方向判错。产品真方向：A2A peer = **品牌外观外包员工**，走员工语义；每接一个 A2A 集成产品（OpenClaw=龙虾 / Hermes=女孩 / Codex=其他）对应一个品牌 avatar，发版随代码带**支持列表**，不命中的走 **custom** 通用外包样式。

此为 3-change 第 1 条：schema + dispatch 翻盘、清旧 department 代码。第 2 条做 2D+3D brand avatar 资产和 scene 分支，第 3 条做 Market/Settings 安装入口 + agent card discovery。

**当前被触动的模块清单**（已 ground-truth audit）：

- DB schema：`packages/db-local/src/schema.ts:103-124` employees 表
- Types: `packages/core/src/runtime/repositories.ts:48-61` EmployeeRow / NewEmployee / EmployeeUpdate
- Graph: `packages/core/src/graph/main-graph.ts:362-465` department_dispatcher node + routes
- Nodes: `packages/core/src/agents/{employee,department-dispatcher,manager,step-dispatcher}-node.ts`, `pm-planner/{preflight,plan-persistence}.ts`
- A2A: `packages/core/src/a2a/{a2a-client,a2a-server,a2a-types,external-departments,index}.ts`
- Runtime: `packages/core/src/runtime/runtime-context.ts:43,102`
- Web: `apps/web/src/lib/{external-departments,browser-runtime,tauri-runtime}.ts`
- Events: `packages/shared-types/src/events/*.ts`（含 `assigneeKind` / `sourceKind` 字面量）

## Goals / Non-Goals

**Goals:**
- Employee schema 加 6 列（`is_external` / `a2a_url` / `a2a_token` / `a2a_agent_id` / `brand_key` / `agent_card_json`）落到 **db-local 单端**（drizzle node + tauri sqlite + memory 三后端 repo 映射）。db-platform 是 marketplace（users/listings/reviews/packages）schema，不含 employees，本 change 不动
- `employee-node.ts` 按 `is_external` 分支走 `A2AClient.sendAndWait`，失败路径透传到 task_run + event + deliverable（与内部员工事件顺序等价）
- 彻底删除"外包 department"抽象所有痕迹（列表见 proposal Impact 表）
- **A2A protocol layer 重写到 v1.0**：`a2a-types.ts` / `a2a-client.ts` / `a2a-server.ts` 全部按当前官方 spec 实现（supportedInterfaces 发现 + PascalCase method + TASK_STATE_* enum + 统一 Part）。**不保留 v0.3 兼容**，prerelease 直接切
- 发版前脏数据：按 user feedback `drop dirty data 不写 migration`，schema migration 只加列不改数据
- 第 1 条落地后，**external employee 可以通过 repo.create 手动造出来**跑 live verify；UI 入口等第 3 条

**Non-Goals:**
- 第 1 条不做 brand avatar 资产、不做 scene 分支渲染、不做 zone / 座位 / ceremony 差异化（外包员工第 1 条期间视觉上和内部员工一致，仅用占位 `[external]` 标签；真资产第 2 条）
- 不做 Market / Settings 安装 UI、不做 agent card discovery 流程前端化（第 3 条）
- 不实现 `SendStreamingMessage` / `SubscribeToTask` / `ListTasks` / push notifications / agent card signature 校验（v1.0 高级特性，本 change 只保证核心 `SendMessage` / `GetTask` / `CancelTask` / `GetExtendedAgentCard` 可用）
- 不触动内部员工（`is_external=false`）的现有流程

## Decisions

### 1. Schema：新增 6 列而不是改旧列
**选择**：新 migration 加 `is_external INTEGER NOT NULL DEFAULT 0` + 5 个 nullable text（db-local package-local = `024_employees_external_a2a.sql`；desktop live runtime = `Docs/03_migrations/offisim_migrations_local_v0.1/030_employees_external_a2a.sql`，embed 到 `apps/desktop/src-tauri/src/lib.rs` version 30）。
**否决**：复用 `config_json`（JSON 埋字段）—— 违反 `typed-json-field-parsers` spec 方向，且查询过滤 external employee 效率差。
**否决**：新建 `external_employees` 子表 —— 一对一关系引入 join 成本，且 employee-node 分支逻辑会变复杂。
**说明**：db-platform 不动——它是 marketplace schema，不存 employees（原 proposal 写 "db-local + db-platform 两处 migration" 是 ground-truth audit 前的错误前提）。

### 2. Dispatch 分支位置：employee-node 内部分，不新增 graph 节点
**选择**：`employee-node.ts` preflight 后按 `employee.is_external` 分成两条分支 —— external → 新 `employee-a2a-executor.ts` 调 `A2AClient.sendAndWait`；内部 → 现有 LLM adapter 路径。事件顺序（`graph.node.entered` / `employee.state.changed` / `task.state.changed` / `task.subtask.progress` / `deliverable.created`）两条分支等价。
**否决**：新建 `external_employee_dispatcher` graph 节点 —— 和旧 `department_dispatcher` 同构，违反"走员工语义"初衷；graph 复杂度增加无实质收益；`routeFromStepDispatcher` 每次都要判 external 与否。
**约束**：`employee-node.ts` 仍受 `employee-node-boundaries` spec 约束 ≤200 NBNC，分支体抽到新 sibling 模块 `employee-a2a-executor.ts`。

### 3. Plan / Assignment 类型的 union 收缩
**选择**：`PendingAssignment.assigneeKind: 'employee'` only（union 缩成单 literal，或直接删字段保留 employeeId+name）；事件的 `assigneeKind` 同步。旧 `'department'` 字面量全删。
**否决**：保留 union `'employee' | 'department'` 以防后续再出现 —— YAGNI，需要时再加，保留死字面量会误导未来的 Reader。

### 4. Brand Key 值域管理
**选择**：第 1 条不强制枚举值 —— `brand_key` 为 nullable text，允许任意字符串；发版支持列表等第 2 条 avatar 资产落地时同步建立 `BrandRegistry`（支持列表 + custom fallback）。第 1 条期间只用于存储，不做验证或分支。
**理由**：第 1 条不渲染 avatar，brand_key 是纯元数据；提前定 union 会与第 2 条资产清单耦合。

### 5. Manager 感知外包员工
**选择**：外包员工和内部员工同列入"Available employees"段，条目后缀 `[external:<brandKey>]` 标注；删除独立 "Available external departments" section。
**理由**：走员工语义到底，manager 不需要知道"外包"概念，只需要知道这个员工能做什么（roleSlugHint / capabilities）。

### 6. 数据迁移
**选择**：按 user feedback `prelaunch_drop_dirty_data` —— schema migration 只加列，不做 data migration。发版前如 DB 里有旧 test data 包含 department seed，用户手动 reset；不维护兼容层。
**否决**：写 data migration 把旧 external-department seed 按 id 映射成新 external employee record —— seed 是 env 驱动的运行时构造，并未入库（`defineExternalDepartments` 是纯函数，只在 runtime 活），所以 DB 里没有遗留 department record。确认：`grep` `kind.*external_department` 在 DB 只出现在 `ExternalDepartmentDefinition.kind` 类型字面量。

### 7. Live verify 最小路径
**选择**：写一段临时种子脚本（或 REPL 粘贴）调 `repos.employees.create({ ..., is_external: true, a2a_url: 'http://localhost:18800', brand_key: 'custom' })`，然后 chat 触发一个 task；观察 employee-node 日志 / A2A client 先 fetch well-known agent card / resolve JSONRPC endpoint / task_run 流转 / deliverable sourceKind。脚本不进 repo。
**理由**：第 3 条 install UI 要做，但第 1 条要有闭环验证。手动脚本是最小成本方式。
**Peer 兼容性口径**：peer 必须是 **A2A v1.0 原生**（agent card 用 `supportedInterfaces[{protocolBinding:'JSONRPC',protocolVersion:'1.0'}]`；接受 `SendMessage` / `GetTask`；返回 `TASK_STATE_*` 枚举；Part 用 `text`/`raw`/`url`/`data` + `mediaType` + `filename`）。推荐 hermes / codex / gemini / opencode 等官方 spec 兼容 peer。

### 8. v1.0 Agent Card 发现与 endpoint 解析
**选择**：`A2AClient` 构造时只存 `peer.url`（base URL），真正 RPC 前先 `GET {url}/.well-known/agent-card.json` 拉 agent card，从 `supportedInterfaces` 里挑 `protocolBinding === 'JSONRPC'` 的 interface，用它的 `url` 作为 RPC endpoint。Agent card + endpoint 都按 client 实例缓存，避免每次调用都打 well-known。
**否决**：让调用方传完整 RPC endpoint 而不是 base URL —— 违反 v1.0 spec "discovery by agent card" 原则，破坏 peer 迁移能力。
**否决**：启动时一次性 fetch 所有 peer 的 agent card —— 网络开销过大，peer 可能不常用；改成 lazy fetch + 缓存更合理。

### 9. v1.0 TaskState enum 命名
**选择**：TS 类型直接用字面量 `'TASK_STATE_COMPLETED'` 等（匹配 JSON-RPC 线上 wire format），不引入中间常量 enum。
**理由**：JSON-RPC 反序列化直接 assignable，consumer 比较时也直接比字面量；避免常量 enum 在 esbuild / esm 边界上的 tree-shake 问题。

### 10. 保留 v0.3 shim 的问题
**决定**：**不保留**。prerelease 阶段按 user feedback `prelaunch_drop_dirty_data` 直接切，不写兼容层。
**否决过程**：最初 spec 把 "protocol layer 不改" 写成约束，Hermes + Context7 交叉审查后发现 Offisim 现有 transport 是 A2A v0.3.0、当前官方 spec 已是 v1.0，两者 breaking incompatible。兼容方案有三个：(a) 保留 v0.3 用 v0.3 兼容 peer；(b) v0.3 client + v0.3↔v1 shim 接 v1.0 peer；(c) 直接升级 v1.0。用户选 (c)——没现网依赖 = 没兼容负担，直接升级消灭 tech debt。

## Risks / Trade-offs

| Risk | Mitigation |
|---|---|
| Union 收缩导致 shared-types 下游 consumer 全体 typecheck 炸一片 | Tasks.md 分阶段：先改 shared-types 再改下游；consumer 按域拆 grep 批量修；保证每一步 `pnpm --filter <pkg> typecheck` 可增量验证 |
| employee-node 分支体膨胀，顶破 spec 200 NBNC 约束 | 严格抽 `employee-a2a-executor.ts` 承载 A2A 分支；barrel 只做 routing + delegating；PR 前跑 `grep -cvE` 校验 |
| 协议层 `A2AClient` 与内部员工生命周期不匹配（如 LLM 有 cancel token，A2A 有 poll timeout） | 第 1 条 A2A 调用走 `sendAndWait` 带 120s 默认 timeout；cancel / interrupt 第 2/3 条补（不是本条目标） |
| 第 1 条完成后 external employee avatar 视觉空洞（还没 brand 资产） | 占位策略：2D renderer 对 `is_external=true` 画一个带 `[brand_key]` 标签的纯色方块 + 小图标，明确是"未渲染占位"；真资产第 2 条 |
| Delete `external-departments.ts` 可能有 import 没删干净 | `grep external[-_]?department` / `ExternalDepartment` / `matchExternalDepartments` 在 tasks.md 收尾前全 repo 扫一遍，要求 0 命中 |
| `department` 关键字存在于内部业务（company department）语境，误删风险 | 命中 grep 结果人工过一遍，只删 A2A 外包路径，保留内部 department（如公司架构 / Zone 名字 / 部门模板）代码 |

## Migration Plan

1. 先加 schema + 类型（向后兼容：旧 code 读 new cols 为 null / 0）
2. 三后端 repo 同步 new cols 读写
3. `employee-node` 加 external 分支（保留内部 path 原样）
4. `manager-node` prompt 清 departments section（内部员工 prompt 不变）
5. 删 `external-departments.ts` + consumers（此时已无下游）
6. 删 `department-dispatcher-node.ts` + graph edges（union 已用不上）
7. 删 `persistDepartmentOnlyPlan` + `recommendedDepartmentIds` + pm-planner 相关
8. 收缩 `assigneeKind` / `sourceKind` union（shared-types + 所有 consumer）
9. Typecheck 串行四包、build 串行四包、手动造 external employee live verify
10. 如有回归，回滚单 commit；如通过，archive + canonical spec 同步

**Rollback**：本条目不推生产环境（未发版），直接 `git reset` 到 change 之前 commit；DB migration 反向 drop columns 脚本不维护（迁移只加列，旧代码读 new cols 为 null 不影响）。

## Open Questions

- **Q (第 2 条前置)**：brand key 的值域（预设 + custom）要不要在第 1 条 tasks.md 里就列出支持列表白名单常量，还是第 2 条落？倾向第 2 条，因为白名单和 avatar 资产清单一一对应。
- **Q (未提前决)**：external employee 的 `workstation_id` / zone 分配语义 —— 是和内部员工一样按 roleSlugHint 分 zone？还是第 2 条专门设计？倾向**和内部一致**（走员工语义到底），第 1 条不动 zone 逻辑。
- **Q**：A2A endpoint 报错时 task_run 的 `output_json` 写什么？倾向写结构化 error `{ error: { code, message, source: 'a2a' } }`，让第 3 条 install UI 能渲染；第 1 条先落 JSON 格式，UI 展示第 3 条做。

## Resolved / Surfaced during implementation

- **db-platform employees 列是错误前提**：ground-truth audit 时发现 `packages/db-platform/` 是 marketplace schema（users / listings / reviews / packages / api_tokens …），根本不含 employees 表。本 change 只动 db-local（task 1.2 标 N/A，spec.md `repository-backend-boundaries` delta 没写 db-platform，proposal 原文已改订）。
- **A2A protocol 版本 mismatch（Hermes + Context7 交叉验证 2026-04-18）→ 直接升级 v1.0 合并进本 change**：Offisim 原始 `a2a-client.ts` / `a2a-types.ts` 实现的是 **A2A v0.3.0** 口径（`agentCard.url` / `preferredTransport` / `message/send` / `tasks/get` / 小写 TaskState / role `'user' \| 'agent'` / endpoint 写死 `/a2a/jsonrpc`）。A2A 当前官方 spec 已经是 **v1.0**，破坏性升级了 Agent Card（`supportedInterfaces[]`）、JSON-RPC method 命名（PascalCase `SendMessage` / `GetTask` / `CancelTask` / `SendStreamingMessage` 等）、TaskState 枚举（`TASK_STATE_COMPLETED` 形态）、Part 结构（统一 one-of `text/raw/url/data` + `mediaType`）、新增 `securitySchemes` / `security` / `defaultInputModes` / `defaultOutputModes`。**用户裁定**：prerelease 不背兼容负担，合并进本 change 一次升完。原计划的 follow-up change `upgrade-a2a-protocol-to-v1` 已取消（不再需要）。spec.md 对应 requirement 已改为 "protocol layer rewritten to v1.0"。
- **Vite stale pre-bundle (2026-04-18 live verify 第 2 轮发现)**：Hermes 复测时 `dispatch branch` log fresh 显示（证明 `employee-node` dist 是新的）但 `D.repos.employees.create({ is_external: true, ... })` 创建的 row 丢掉 6 个新字段（证明 `memory-repositories` 是旧的）。根因：`@offisim/core/browser` 在 Vite `optimizeDeps.include` 列表里被 pre-bundle 到 `node_modules/.vite/deps/`，pnpm workspace dep 的源码/dist 更新不会让 Vite 自动失效这个缓存；而 `employee-node` 走的是 `@offisim/core/dist/graph/main-graph.js` **直接 dist 路径**，不经过 optimizeDeps，所以一直 fresh。两条路径的非对称让现象看起来像 runtime bug 但其实是构建缓存。修：`apps/web/vite.config.ts` `optimizeDeps.force = command === 'serve'`，dev 下每次起 server 强制 re-bundle。今后改 `packages/core` source + rebuild 后，直接 `pnpm dev` 就是 fresh，不用手动 `rm -rf node_modules/.vite`。
- **A2A peer CORS preflight (2026-04-18 live verify 第 2 轮发现)**：浏览器直连 localhost peer 时，Authorization header 会触发 CORS preflight (`OPTIONS`)。原始 peer stub 不支持 OPTIONS，返回 501，导致 `A2AClient.getAgentCard()` 失败成 `a2a_transport: Failed to fetch`——dispatch 已选 `route:'a2a'` 但 wire 没打通。修：重写 `/tmp/offisim-a2a-peer.py`（skill-local，不进 repo），加 `do_OPTIONS` 204 响应 + 所有响应带 `Access-Control-Allow-Origin: http://localhost:5176` + `Allow-Methods: GET, POST, OPTIONS` + `Allow-Headers: Authorization, Content-Type`。第 3 条 install UI 做完后，官方分发给用户的 peer / desktop-hosted peer 也必须满足这条 CORS 契约，否则 web 用户用不了。加入 `external-employee-a2a-dispatch` spec Requirement。
