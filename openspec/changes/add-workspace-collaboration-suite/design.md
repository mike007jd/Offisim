## Context

净新增 surface（prototype `offisim-workspace-prototype.html` 1341 行）。本 change 只取 **deep half**：第 5 peer workspace + suite shell + Messenger(深) + Approvals OA(深)。当前 `WorkspaceKey = office|sops|market|personnel|activity-log|settings`（`Header.tsx:23`，nav `PeerWorkspaceNav` `:518`）。URL routing `lib/url-routing/` + `useUrlSync`。

数据（全现有，`packages/db-local/src/schema.sql`）：`chat_threads`(:344) + `graph_threads`(:319) 撑 Messenger；`active_thread_interactions`(:401，pending) + `interaction_history`(:411，resolved，`kind` ∈ `permission_request`/`plan_review`/`agent_question`/`skill_install_confirm`，`status` ∈ pending/approved/rejected) + `tool_permission_approvals`(:542) 撑 Approvals。`InteractionKind` union 真相在 `packages/shared-types/src/interactions.ts:30`。

prototype：`.suite grid 64px 1fr`；`.suite-body` split `320 1fr`；Messenger team/direct/system；Approvals 4 kind（permission / plan / question / install）+ To-do/Done 过滤。

## Goals / Non-Goals

**Goals:** 第 5 peer workspace + suite shell + Messenger(深) + Approvals OA(深)，全复用现有数据，无新表。

**Non-Goals:** 四个浅 app（Docs / Contacts / Calendar·Meetings / Workplace）+ 第 7「More」app（→ follow-up）；新 DB 表；interaction/permission 引擎行为（只读 + 触发既有 resolve）；surface 配色(Phase 0)。

## Decisions

### D1 — 第 5 peer workspace 接入
`WorkspaceKey` 加 `'workspace'`；nav pill（Office 后）；url-routing 加 `workspace` + `?app=messenger|approvals`（浅 app 的 `?app=` 值随 follow-up 加入）；`WorkspaceRouter` 挂 suite；消费 `useLayoutTier`。同步 `PEER_WORKSPACE_ITEMS`。

### D2 — suite shell
`.suite`（64px app-rail + body）；app-rail entry + 选中态；body split（320 list + detail）。deep half 阶段 app-rail 点亮 Messenger / Approvals 两 entry；单宽（single）布局与浅 app entry 随 follow-up 落地。Escape 在 suite 内 drill-back。

### D3 — Messenger 深（chat_threads SSOT）
list = `chat_threads` by `updated_at DESC` + 搜索；detail 切 team（`<projectId>::<threadId>`）/ direct（`<projectId>::<threadId>::<employeeId>`）/ system channel（NotificationCenter 复表面 readonly）。**复用 Phase 1 chat/message/composer 组件**（不新造 chat 引擎）。**thread 选择 clamp 到 Office 的 `OfficeSessionState.selectedThreadId` SSOT** —— Messenger 的选中通过 `updateWorkspaceState('office', prev => ({ ...prev, selectedThreadId }))` 写入，与 Office 共享同一 selected-thread 状态，**不另起独立 setter**；若 product 决定 suite 选中要与 Office 解耦，必须显式声明一个 suite-scoped 选中态字段（不得隐式分叉），以预防两表面选中漂移 bug。

### D4 — Approvals OA 深（既有 interaction 表）
list = `active_thread_interactions`(pending) + `interaction_history`(resolved)，按 `kind` 分 4 type + **To-do/Done 过滤**（To-do = `active_thread_interactions` 未解决；Done = `interaction_history` 已解决）；detail = 各 kind 审批表单（`permission_request`→`tool_permission_approvals` allow/ask/deny scope；`plan_review`→approve/reject；`agent_question`→option/freeform；`skill_install_confirm`→confirm）。审批动作走现有 interaction resolve 路径（不改引擎,只触发）。

**CC 过滤已删**：interaction 模型里没有 cc/carbon-copy/recipient/approver 概念（grep = 0；唯一 actor-ish 字段 `requestedByNode` 标识发起的 *graph node*，不是人类收件人；本地单用户场景下人类用户恒为唯一审批人）。prototype 第三个「CC'd」tab 无真实数据源，本 change 不实现；如要落地需先引入 interaction 的 recipient/审批人模型 —— 留作 follow-up，不在本 change 范围。

## Risks / Trade-offs

- **体量大（净新增 surface）** → 已收窄到 deep half（Messenger + Approvals 核心价值）；四浅 app + 第 7 app 移出到 follow-up，解锁 deep half live-verify。
- **扩 WorkspaceKey 波及 nav/routing/tier 决策** → 同步 `PEER_WORKSPACE_ITEMS` + url parser + tier 布局；live 验 6 旧 workspace 不回归。
- **Messenger/Approvals 深接读现有 repo** → 只读/触发 resolve,不改引擎;Approvals 审批动作复用现有 interaction resolve（防双写/越权）。
- **Messenger 与 office-shell 耦合（中）** → 复用 Office `selectedThreadId` SSOT；apply 时严禁另起 `setSelectedThreadId`，否则 Office 与 Messenger 选中漂移。
- **chat 组件复用依赖 Phase 1** → Phase 1 assistant-ui 产物作 Messenger detail 基础;Phase 1 未落则 Messenger 用同 store 自渲染。

## Migration Plan

1. WorkspaceKey + nav pill + routing + WorkspaceRouter 接入。
2. suite shell（app-rail + body split）。
3. Messenger（chat_threads list/detail，复用 chat 组件，clamp Office `selectedThreadId`）。
4. Approvals OA（interaction list/detail + 4 审批表单 + To-do/Done 过滤）。
5. 串行 build + live 验。
6. 回滚：净新增 `workspace/` 目录 + nav/routing 扩展,单 commit 可 revert（不动现有 6 workspace）。

## Open Questions

- Messenger 是否完全复用 Phase 1 assistant-ui chat detail，还是 suite 内独立渲染同 store（不影响 SSOT 决策 —— 无论哪种都走 Office `selectedThreadId`）。

（四浅 app 的 Docs deliverable 源、Meetings action-items 源、第 7 app 定义、CC/recipient 模型等 open question 随它们一起移到 follow-up change。）
