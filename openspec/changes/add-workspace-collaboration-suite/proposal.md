## Why

V3 设计稿新增第 5 个 nav pill「Workspace」—— 飞书/Teams 式企业业务软件层，与 Office 互补（看现场 vs 用企业软件）。内部飞书三栏 `app-rail(64px) | list(320px) | detail`。**本 change 只交付 deep half**（真正的净新增产品价值）：第 5 peer workspace 接入（nav pill + URL routing + tier 布局）、suite shell（app-rail + split/single body）、**Messenger**（深·同源 `chat_threads`，复用现有 chat 表面）、**Approvals OA**（深·4 种真实审批·净新增价值最大·复用现有 interaction 表）。**目前仅规格未实现**（`offisim-workspace-prototype.html`）。调查确认：deep half 的数据全复用现有表（`chat_threads` / `graph_threads` 撑 Messenger；`active_thread_interactions` / `interaction_history` / `tool_permission_approvals` 撑 Approvals），**无新表**，仍是前端 scope。这是 V3 重做最后、最大的一条，依赖 Phase 0（token）+ Phase 1（chat 结构可复用给 Messenger）。

deep half 是一个内聚单元、共用同一条 release `.app` live-verify gate。四个浅 read-only app（Docs / Contacts / Calendar·Meetings / Workplace）+ 未定义的第 7 个「More」app 彼此独立、低风险，会拖住高价值 deep half 的验收，因此移出本 change（见末尾「Deferred to follow-up change」）。

## What Changes

- **第 5 个 peer workspace**：`WorkspaceKey` 加 `'workspace'`（插在 `personnel` 后）；nav pill + url-routing parser/serializer + `WorkspaceRouter` 接入；消费 `useLayoutTier()` 做 tier 布局。
- **suite shell**：`.suite`（64px app-rail + `.suite-body`）；app-rail 切换；`.suite-body` split（320 list + detail）承载本 change 的两个深 app（Messenger / Approvals）。app-rail 在 deep half 阶段只点亮 Messenger / Approvals 两个 entry；浅 app entry 与单宽布局随 follow-up 落地。
- **Messenger（深）**：team group chat + direct chat + system bot channel，**同源 `chat_threads`**（conversationKey `<projectId>::<threadId>[::<employeeId>]` 解析 team vs direct）；复用 Office chat 的 message 流/composer 结构（Phase 1 assistant-ui 产物可复用）。Messenger 的 thread 选择 **clamp 到 Office 的 `selectedThreadId` SSOT**（`updateWorkspaceState('office', …)`），与 Office 共享同一选中态，防止两表面选中漂移。
- **Approvals OA（深·净新增价值最大）**：4 种真实审批（`permission_request` / `plan_review` / `agent_question` / `skill_install_confirm`）的 OA 式信箱（list + detail + 审批表单 + To-do/Done 过滤），数据走 `active_thread_interactions`（pending）+ `interaction_history`（resolved）+ `tool_permission_approvals`（**已有表，ToolPermissionEngine allow/ask/deny 语义复用**）。审批动作走现有 interaction resolve 路径（不改引擎、不双写）。
- **无新表**：deep half 全复用现有 schema。

**不在范围**：四个浅 read-only app（Docs / Contacts / Calendar·Meetings / Workplace）+ 第 7 个「More」app（→ follow-up）；新数据库表；core runtime / interaction 引擎行为（只读消费 + 触发既有 resolve）；surface 配色（Phase 0）。

## Capabilities

### New Capabilities
- `workspace-collaboration-suite`: 第 5 个 peer workspace 的 deep-half 契约 —— suite shell（app-rail + split body）、nav/routing 接入、Messenger（深·`chat_threads`，clamp Office `selectedThreadId` SSOT）、Approvals OA（深·4 审批·既有 interaction 表）、无新表约束。浅 app 与第 7 app 不在本 capability 范围。

## Impact

- 代码（净新增）：`packages/ui-office/src/components/workspace/`（suite shell + Messenger + Approvals 组件）；`Header.tsx`（WorkspaceKey + nav pill）；`url-routing/`（workspace + `?app=` 解析）；`WorkspaceRouter`。Messenger 复用 chat/message 组件 + Office `selectedThreadId` SSOT；Approvals 读 interaction repo。
- 数据：**无新表**（`chat_threads` / `graph_threads` / `active_thread_interactions` / `interaction_history` / `tool_permission_approvals` 全现有）。
- blast radius：扩 `WorkspaceKey`（6→7）波及 nav/routing/tier 决策（responsive-app-shell 决策表需加一行 —— 在本 capability 内声明 tier 布局，apply 时同步 `PEER_WORKSPACE_ITEMS`）。Messenger/Approvals 深接 = 读现有 repo（不改引擎）。**与 office-shell 耦合点**：Messenger 复用 Office 的 `selectedThreadId` SSOT，apply 时不得另起独立 setter，否则两表面选中漂移。
- scope 风险：净新增 surface 体量大，已收窄到 deep half；浅 app 移出以解锁 deep half 验收。Approvals「净新增价值最大」但数据已有 → 仍前端为主。
- 验收 gate：typecheck + 串行 build；release `.app` live 验：nav 5th pill + routing / suite app-rail（Messenger + Approvals 两 entry）切换 / Messenger 接 chat_threads 真实会话（且与 Office 同步选中）/ Approvals 4 审批真实数据 + 审批动作生效 / tier 响应式 / 6 旧 workspace 不回归。

## Deferred to follow-up change

以下移出本 change，留作独立 follow-up（彼此独立、低风险、纯只读，单独验收）：

- **Docs**（公司 deliverable 库，read-only by contributor/source）—— 源是现有 `deliverables` 表（带 `contributors_json`），**不是新表**；不需要 `library_documents` 之外的新结构。
- **Contacts**（`employees` by zone + runtime presence，read-only）。
- **Calendar·Meetings**（`meeting_sessions` + meeting action items，read-only）—— 含 meeting action-items 源确认。
- **Workplace**（launcher：live 计数聚合 + 导航 tiles）。
- **第 7 个「More」app**（prototype 中预留、未定义）—— 待规划，不在本 change 也不在上述四浅 app 范围。
