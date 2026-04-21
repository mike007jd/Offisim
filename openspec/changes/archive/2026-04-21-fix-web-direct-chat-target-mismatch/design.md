## Context

当前 web direct chat 有两层 target 状态同时存在：

- UI 侧 `officeState.selectedEmployeeId`
- chat/run 侧的 `targetKey`、`errorTargetRef`、`interactionTargetRef`、`lastFailedMessageRef.targetEmployeeId`

T2.3 web live verify 暴露出一个典型错位：用户在 direct chat 里选中 Maya 发消息，但后续 preview 偶发显示 Alex。说明 run 发出后至少有一处路径不是使用“该次发送已解析出的 target”，而是重新从当前 UI 选择或旧 ref 猜目标。

## Goals / Non-Goals

**Goals:**
- 让 web direct chat 的一次发送周期只拥有一个 resolved target employee。
- 确保 pending interaction、retry、follow-up、streaming header 都绑定到发起该 run 的 target。
- 明确“切换选中员工只影响未来消息”的行为边界，避免 UI 当前选择回写历史 run。

**Non-Goals:**
- 不改 core orchestration 的 direct chat 语义。
- 不改 team chat、meeting chat、skill tool 行为本身。
- 不顺手处理其它 chat UX 问题，如双气泡、provider 错误文案、attach-file affordance。

## Decisions

### 1. 发送时一次性捕获 direct-chat target

`ChatPanel` 在 `handleSend()` 内解析出 `resolvedTargetEmployeeId` 后，后续本次 run 的用户消息落盘、`startRun()`、`sendMessage()`、error bookkeeping 都只使用这一个值，不再混用 render 时的 `selectedEmployeeId` / `targetKey`。

为什么：
- 这能把“当前 UI 选中了谁”和“这次已经发出去的 run 属于谁”分离开。
- 比继续让 `targetKey`、`selectedEmployeeId`、`errorTargetRef` 各自推导更稳，也更容易 live verify。

替代方案：
- 继续依赖 `selectedEmployeeId` 作为全链路实时来源。否决，因为用户切人后会把未完成 run 一起漂移。

### 2. pending interaction / retry 优先使用 run-origin target

interaction 和 retry 都必须优先走“发起该 run 时记录下来的 target”：

- pending interaction：优先使用 interaction payload 自带 employeeId；没有时再退回该次失败消息/运行记录里的 target
- retry：只重发到 `lastFailedMessageRef.targetEmployeeId`

为什么：
- preview / confirm 是前一条 run 的继续动作，不应被用户后来切换的当前选中员工劫持。

替代方案：
- 继续用 `interactionTargetRef.current ?? targetKey` 之类的混合回退。否决，因为这类回退本身就是错位来源。

### 3. 切换员工只影响 future run

用户在 direct chat UI 切换 Maya → Alex 时：

- 新发出的消息走新的 selected employee
- 已经在 streaming 的 run、已经挂起的 interaction、失败后的 retry 仍绑定原 target

为什么：
- 这是用户最容易理解、也最符合 preview/confirm 语义的模型。

## Risks / Trade-offs

- [用户在 preview 挂起时切到另一位员工，期待 confirm 跟着切走] → 维持“preview 属于原 run”更安全；如果要给新员工操作，用户必须重新发起一条消息。
- [target bookkeeping 分散在多处 ref，修一处漏一处] → 以“run-origin target”作为统一概念，代码里集中到 send / interaction / retry 三条路径。
- [web 修完但 desktop 没同步] → 本 change 明确只收 web direct chat；如果后续发现 desktop 也有同类 target drift，再单独验证。
