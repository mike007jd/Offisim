## Why

V3 设计稿把 Office 右栏定为**单轴纯对话**（`.chat-head` / `.messages` / `.run-record` / `.conv-outputs` / `.composer`，无 tab bar），且这次重做要求 chat UI 不再 hand-roll、改用 `assistant-ui`（ChatGPT 级 chat primitives + ExternalStoreRuntime）。当前 chat 是约 3862 行自研件（ChatPanel/ChatInput/MessageBubble/StreamingBubble/MarkdownContent + zustand store + 6 层 runtime context），且右栏是 4-tab 结构（Chat/Inspector/Tasks/Git）。Phase 1 把 chat 换成 assistant-ui（zustand store + 事件流仍是 SSOT，仅 wrap）并把右栏改成单轴。是 V3 全前端重做的第二阶段（依赖 Phase 0 的 V3 token）。

## What Changes

- **接入 assistant-ui ExternalStoreRuntime（wrap 现有 SSOT）**：新增 `OffisimAssistantRuntimeProvider`，用 `useExternalStoreRuntime` 读现有 `chat-session-store`（zustand，保持 SSOT，公开 API 零改）+ `offisim-runtime-context` 事件流。`convertMessage` 把 `ChatMessage`→`ThreadMessageLike`；`onNew` fire-and-forget → 现有 `sendMessage(conversationKey,…)`；`onCancel`→`abortExecution`；`isRunning` 取自 runtime status。
- **领域内容映射成自定义 message part**（用 `MessagePrimitive.Parts` render-function 形态，作为本 rail 的项目约定；assistant-ui 的 `components` prop 本身不 deprecated，只是其 `ToolGroup`/`ReasoningGroup`/`ChainOfThought` 分组子字段被 `MessagePrimitive.GroupedParts` 取代，需要分组时用后者）：`reasoning`（折叠）/ `tool-call` / `run-record`（Activity+Plan 折叠卡，沉淀进 timeline）/ `deliverable`（复用 `DeliverableCard variant='compact'`）。
- **右栏改单轴**：`RightSidebar` 去掉 Chat/Inspector/Tasks/Git 四 tab，改 `.chat-head` + `.messages`(assistant-ui Thread) + `.conv-outputs`(thread-scoped deliverables) + `.composer`。Inspector 已路由 Personnel；Git widget 搬左栏属 Phase 2；Tasks 内容化为 run-record + outputs。
- **composer 保留 Offisim 自研能力**：`ChatInput`（Tauri 拖放 + textarea 增长）、slash command registry、`SessionModeChip`（footer 左，唯一 mode 入口）、附件 staging chip 全嵌进 `ComposerPrimitive`；send/yolo 按钮。
- **ThreadList 接 assistant-ui**：`ExternalStoreThreadListAdapter` 包现有 `chat_threads`（threadId/threads/onSwitch/onRename/onArchive/onDelete），保留 `conversationKey` 路由 + auto-title 事件同步。
- **assistant-ui 用 Phase 0 落的骨架**：shadcn registry 的 thread/markdown 组件重皮肤到 V3 token；markdown 改用 assistant-ui markdown（替换自研 `MarkdownContent`），autoscroll 用 `ThreadPrimitive.Viewport`（替换自研 scroll 逻辑）。LinkPreview 作为自定义保留。
- **保留不变**：多-speaker（每 speaker 段独立 ThreadMessageLike + `nodeName` metadata + `joinStrategy:'none'`）、`conversationKey + runId` 单 assistant message 收敛、run-level 隔离、Tauri attachment 持久化管线、interaction modes、deliverable/plan SSOT。

**不在范围**：office shell / 左栏 git widget / 状态栏 / 运行轴浮层（Phase 2）；surface 配色（Phase 0 已 revalue）。

## Capabilities

### New Capabilities
- `assistant-ui-chat-runtime`: assistant-ui ExternalStoreRuntime adapter 契约 —— 桥接 SSOT、自定义 message part 注册、保留子系统（attachment/slash/mode/threadlist）、以及"adapter 必须保持既有 chat 不变量（streaming-ux / run-isolation / interaction-modes / deliverable）"的约束。

### Modified Capabilities
- `office-chat-default-presentation`: 右栏从 **Chat/Inspector/Tasks/Git 四 tab**（Tasks tab 内含 Activity 永显 + Plan/Board 条件渲染的堆叠 section，非内层 tab）改为**单轴对话列**（无 tab bar）；base spec 里仍断言 tab 结构的 4 条 requirement——`Right rail defaults to expanded …`（保留为 MODIFIED，去掉 tab 措辞）、`RightSidebar outer Tabs … min-height floor` / `RightSidebar TabsContent … forceMount + TABS_RETAIN_STATE_CLASS` / `StreamingBubble … bound height`（三条 REMOVED）——被本 change reconcile；layout-shift 稳定性改由对话列保留 min-height + assistant-ui viewport 内部滚动承接（ADDED）；StreamingBubble 高度约束改表达在 assistant-ui message/reasoning part 上，沿用 `max-h-stream-content` / `max-h-reasoning-content` 语义 token class（ADDED）。

## Impact

- 代码：新增 `packages/ui-office/src/components/chat/runtime/`（adapter + 自定义 parts）；改写 `ChatPanel.tsx`(~80%)、`RightSidebar.tsx`(去 tab)、`ChatInput.tsx`(绑 adapter)；`chat-session-store.ts` 公开 API 0 改（adapter 内部消费）；`offisim-runtime-context` 不改结构。
- 依赖：**Phase 0（`establish-v3-design-foundation`）是硬前置**——它在 renderer 装入 `@assistant-ui/react`(+ markdown) 并落 V3 token + shadcn 骨架。本 phase 不假设 ui-office 侧已装；本 phase 自己负责 ui-office 的消费接线：把 `@assistant-ui/react` 加进 `packages/ui-office/package.json` 依赖、补 desktop renderer 的 vite alias，并打通 `@offisim/core/web` alias 接线（ui-office 通过它消费 runtime/store）。
- blast radius：主消费者 `apps/desktop/renderer/src/components/office-shell/CollaborationRail.tsx`（import ChatPanel/RightSidebar）→ AppMainShell；`offisim-runtime-context` 被 30+ 文件消费但本 phase 不改其结构。
- 验收 gate：typecheck + 串行 build；release `.app` live 验 chat 主路径（发送/流式/多-speaker/工具/交付物/附件/mode/thread 切换/中止）+ 单轴右栏无 CLS。由用户/Codex 跑。
