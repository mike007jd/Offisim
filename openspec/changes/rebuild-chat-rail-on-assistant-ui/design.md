## Context

当前 chat：`ChatPanel.tsx`(~400) 顶层容器，`chat-session-store.ts`(~350,zustand SSOT，`getConversationKey(projectId,threadId,employeeId?)`、`reduceChatSession`、`finalizeAssistantMessage`、`genRunId`、localStorage `offisim:chat-session-store:v1`)，`offisim-runtime-context.tsx`(~400,6 层 context：Execution `sendMessage`/`abortExecution`、Interaction、Services `eventBus`、Status `isRunning`/`stage`/`cost`)，`StreamingBubble`/`MessageBubble`/`MarkdownContent`/`SessionModeChip`/`useChatAttachmentStaging`/`chat-attachment-pipeline`/`useDeliverables`/`DeliverableCard`/`ThreadList`/`RightSidebar`(4 tab)。主消费者 `CollaborationRail.tsx`。

assistant-ui（**Phase 0 `establish-v3-design-foundation` 是硬前置**：它在 renderer pin `@assistant-ui/react` + 落 V3 token + shadcn 骨架。本 phase 不假设 ui-office 已装，自己负责 ui-office 侧消费接线——见 D0）：headless primitives（`ThreadPrimitive`/`MessagePrimitive`/`ComposerPrimitive`）+ `useExternalStoreRuntime`（`messages`/`convertMessage`/`onNew`/`onCancel`/`isRunning`/`adapters.threadList`）+ `MessagePrimitive.Parts` render-function 支持 `text`/`reasoning`/`tool-call`/`data-*` 自定义 part。纯 React 客户端。

### Office rail seam — Phase 1 vs Phase 2 ownership

本 phase（Phase 1）拥有右栏**内层对话列**：message thread、composer、inline run-record、thread-list（以及它们到 store / 事件流的 adapter 接线）。**Phase 2（`rebuild-office-shell-v3`）拥有外层壳**：右栏宽度/放置、左栏、StatusBar 删除、舞台 Live 浮层。两者边界以此行为准，不重叠。

## Goals / Non-Goals

**Goals:** chat UI 换 assistant-ui；右栏单轴；SSOT（store+事件流）不动；领域概念（多-speaker/reasoning/tool/run-record/deliverable）保真；既有 chat 不变量全保留。

**Non-Goals:** office shell（Phase 2）；改 store 公开 API / runtime context 结构；新增 chat 功能；attachment 改走 assistant-ui adapter。

## Decisions

### D0 — ui-office 侧的 assistant-ui 消费接线（本 phase 自有，非"已装"）
Phase 0 只在 renderer 落 dep + token + 骨架。本 phase 负责让 ui-office 真能 import：把 `@assistant-ui/react`(+ markdown) 加进 `packages/ui-office/package.json`、同步 desktop renderer vite alias / `@source`、打通 `@offisim/core/web` alias（ui-office 经它消费 store + runtime context）。**不要在文档里宣称 ui-office 已装好**——接线是本 phase 的交付项之一。

### D1 — ExternalStoreRuntime wrap，不重写 runtime
新增 `chat/runtime/OffisimAssistantRuntimeProvider.tsx` + `useOffisimExternalStore.ts`：从 `useChatSessionStore` 选当前 `conversationKey` 的 `messages` + `streaming`，`convertMessage(ChatMessage)→ThreadMessageLike`（role/content；`runId`/`nodeName`/`status` 进 metadata；reasoning→reasoning part；attachments→自定义 attachment part），streaming 中的 assistant 段以 `status:{type:'running'}` 暴露。`onNew` 仅 `sendMessage(text,{conversationKey,runId})` 后立即返回（fire-and-forget，后续 event→reducer→store→re-render 驱动）。`onCancel`→`abortExecution`。`isRunning` 取 runtime Status。
**理由**：assistant-ui 显式支持 own-state + fire-and-forget command 模型；不动 SSOT 即保住多-speaker/路由/隔离等全部既有逻辑。

### D2 — 多-speaker 用多条 assistant message + `joinStrategy:'none'`
一个 run 的每个 finalized speaker 段 = 独立 ThreadMessageLike（`metadata.nodeName`），`useExternalMessageConverter({joinStrategy:'none'})` 防相邻合并；自定义 Message 组件画 speaker badge/头像。
**风险**：分段视觉与 V3 run 观感需 live 校；不行则用 `MessagePrimitive.GroupedParts` 调。

### D3 — 领域内容 = 自定义 message part（render-function 形态 = 项目约定）
`reasoning`（原生 reasoning part，折叠）；`tool-call`（原生 tool-call part + 自定义 Tool UI）；`run-record`（`data-runrecord` part：Activity+Plan 折叠卡，读 plan-step-store/activity feed，沉淀进 timeline）；`deliverable`（`data-deliverable` part：复用 `DeliverableCard variant='compact'`，乱序到达由 createdAt 匹配）。注册走 `MessagePrimitive.Parts` 的 render-function 形态——这是本 rail 的项目约定（part 渲染与 thread 同地、不散一张静态 `components` map），**不是因为 `components` prop 被 deprecated**（它没有；只有 `ToolGroup`/`ReasoningGroup`/`ChainOfThought` 分组子字段被 `MessagePrimitive.GroupedParts` 取代，需要分组时用后者）。

### D4 — composer 自研能力嵌进 ComposerPrimitive
`ComposerPrimitive.Root` 内承载：`ChatInput`（Tauri 拖放/textarea 增长/提及）、slash 菜单（现有 registry）、staged attachment chip 行、footer `SessionModeChip`(左) + send/yolo(右,yolo=danger)。**不**采用 assistant-ui attachment adapter —— Tauri vault 持久化管线（`useChatAttachmentStaging`+`chat-attachment-pipeline`）保留，chip 自渲染。

### D5 — ThreadList 用 ExternalStoreThreadListAdapter
`adapters.threadList = { threadId, threads, onSwitchToThread→updateWorkspaceState('office',…selectedThreadId), onRename, onArchive, onDelete }` 包现有 `chat_threads`；auto-title 的 `chat_thread.updated` 事件同步保留。

### D6 — 替换 vs 保留
**替换**：`MarkdownContent`→assistant-ui markdown（shadcn 骨架，重皮肤 V3）；自研 autoscroll→`ThreadPrimitive.Viewport`。**保留**：`ChatInput`/slash/`SessionModeChip`/attachment 管线/`DeliverableCard`/`ThreadList` 数据/多-speaker/conversationKey 路由/run 隔离/store/runtime context。`StreamingBubble` 的高度约束 + reasoning 折叠迁移到 assistant-ui message/reasoning part。

## Risks / Trade-offs

- **assistant-ui pre-1.0 API churn** → pin 版本（Phase 0 已 pin），用 render-function Parts 作为项目约定，分组用 `MessagePrimitive.GroupedParts`（避开已 deprecated 的 `ToolGroup`/`ReasoningGroup`/`ChainOfThought` 分组子字段；`components` prop 本身未 deprecated）。
- **多-speaker 保真** → live 校分段观感；GroupedParts 兜底。
- **streaming-ux 不变量回归**（placeholder discipline / speaker label 全程 / partial-complete-failed / reasoning 渐进）→ adapter 必须逐条保持；live 验证对照 `chat-streaming-ux` spec。
- **单轴右栏 CLS** → 对话列保留 min-height + viewport 内部滚动；live 用浏览器层 DOM 验证无布局跳变。
- **attachment 双管线冲突** → 明确不接 assistant-ui attachment adapter，只用 Tauri 管线。

## Migration Plan

1. ui-office 消费接线（D0）：Phase 0 已在 renderer pin dep；本步把 `@assistant-ui/react`(+ markdown) 加进 ui-office package.json + 同步 renderer vite alias + 打通 `@offisim/core/web` alias，确认 React 19 peer OK。
2. 写 adapter + 自定义 parts（store/runtime 不动）。
3. RightSidebar 去 tab → 单轴；ChatPanel 改用 Provider+Thread。
4. composer 嵌 ChatInput/slash/mode/attachment。
5. ThreadList adapter。
6. 串行 build；live 验主路径。
7. 回滚：新增 runtime 目录 + 改写 3 文件，单 commit 可 revert（store/context 未动，回滚低风险）。

## Open Questions

- assistant-ui markdown 是否需补 LinkPreview 扩展（apply 时评估，缺则保留自研 LinkPreview 作为自定义 part）。
- run-record part 与 Phase 2 的舞台 "Live" 浮层的数据边界（Live 广播运行中、run-record 沉淀；apply 时与 Phase 2 对齐，Phase 1 先做 timeline 内 run-record）。
