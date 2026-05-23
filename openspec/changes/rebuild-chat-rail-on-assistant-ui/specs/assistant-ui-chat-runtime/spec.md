## ADDED Requirements

### Requirement: Chat rail SHALL render through assistant-ui ExternalStoreRuntime over the existing store as SSOT

The Office chat rail SHALL render via `@assistant-ui/react` primitives wrapped in an `OffisimAssistantRuntimeProvider` built on `useExternalStoreRuntime`. The zustand `chat-session-store` (with its `conversationKey`-keyed `messages` + `streaming` state) and the `offisim-runtime-context` event flow SHALL remain the single source of truth; the runtime adapter SHALL NOT introduce a parallel message store. The store's public API SHALL be unchanged (the adapter is a pure consumer).

The adapter SHALL map: `convertMessage(ChatMessage) → ThreadMessageLike`; `onNew` SHALL fire-and-forget by calling the existing `sendMessage(text, { conversationKey, runId })` and returning immediately (subsequent event → reducer → store updates drive re-render); `onCancel` SHALL call `abortExecution`; `isRunning` SHALL derive from runtime Status.

#### Scenario: Sending a message routes through the existing runtime

- **WHEN** the user submits a composer message in the active conversation
- **THEN** the adapter's `onNew` calls `sendMessage` with the active `conversationKey` + a generated `runId` and returns without awaiting streaming
- **AND** the rendered thread updates from the store as `chat.message_chunk` / finalize events arrive

#### Scenario: Store remains SSOT

- **WHEN** auditing the chat runtime adapter
- **THEN** message state is read from `chat-session-store`; no second message array is maintained by assistant-ui
- **AND** `chat-session-store`'s exported functions/types are unchanged by this change

### Requirement: The adapter SHALL NOT regress existing chat invariants owned by other capabilities

The assistant-ui adapter SHALL NOT regress any invariant already owned by `chat-streaming-ux`, `interaction-modes`, `deliverable-artifact-handoff`, or the run-isolation rules in `workspace-thread-architecture`. Those capabilities remain the single source of truth for their invariants (one assistant message per `conversationKey + runId`; `conversationKey` partitioning of team vs direct chat; run-level isolation of stale-`runId` chunks; multi-speaker segmentation; placeholder discipline; persistent speaker identity during streaming; partial/completed/interrupted/failed distinction; progressive reasoning; team/direct consistency). This requirement adds no new invariant text — it constrains the rendering swap to be behavior-preserving against those owners, and `apply`/live verification SHALL re-check each named capability's spec rather than restate it here.

#### Scenario: Streaming-ux behavior is preserved through assistant-ui rendering

- **WHEN** a multi-speaker run streams (boss → manager → employee) into the rail through the assistant-ui thread
- **THEN** the rendered result still satisfies the `chat-streaming-ux` and `workspace-thread-architecture` invariants it satisfied before the swap (per-speaker segmentation with visible speaker identity, placeholder only before the first chunk, partial vs completed distinct, exactly one assistant message per `conversationKey + runId`)
- **AND** no invariant is newly defined by the adapter; the named owning capabilities govern the assertions

#### Scenario: conversationKey routing preserved

- **WHEN** the user switches between team chat and a direct-to-employee chat
- **THEN** messages render under the correct `conversationKey` and a direct send still requires `selectedEmployeeId` (no fallback target)

### Requirement: Domain content SHALL render as assistant-ui custom message parts

Reasoning, tool calls, run records, and deliverables SHALL render as message parts via the `MessagePrimitive.Parts` render-function form: `reasoning` (collapsible, progressive); `tool-call` (with custom Tool UI); `run-record` (a `data-*` part rendering the Activity + Plan collapsible card, reading from `plan-step-store` / the activity feed, sedimented into the message timeline); `deliverable` (a `data-*` part reusing `DeliverableCard variant='compact'`, tolerant of out-of-order arrival).

The render-function form is the project convention for this rail (it keeps part rendering colocated with the thread and avoids spreading a static `components` map). This is a project styling choice, not a library requirement: `@assistant-ui/react`'s `components` prop itself is supported (only its `ToolGroup` / `ReasoningGroup` / `ChainOfThought` sub-fields are deprecated in favor of `MessagePrimitive.GroupedParts`). Where grouping of adjacent parts is needed, `MessagePrimitive.GroupedParts` SHALL be used rather than the deprecated grouping sub-fields.

#### Scenario: Run record sediments into the timeline

- **WHEN** a run produces plan steps and activity
- **THEN** a collapsible run-record part renders inline in the message timeline (default collapsed) showing Activity + Plan
- **AND** completed deliverables render as compact deliverable parts in the thread

#### Scenario: Parts use the render-function form and current grouping API

- **WHEN** auditing the message rendering
- **THEN** parts are registered through the `MessagePrimitive.Parts` render-function (the project convention)
- **AND** any part grouping uses `MessagePrimitive.GroupedParts`, not the deprecated `ToolGroup` / `ReasoningGroup` / `ChainOfThought` sub-fields

### Requirement: Composer SHALL retain Offisim-native input, slash, mode, and attachment subsystems

The composer SHALL be built on `ComposerPrimitive` but retain the Offisim `ChatInput` (Tauri drag-drop, textarea growth, mentions), the slash-command registry menu, `SessionModeChip` in the composer footer (the single mode entry; 4 modes), and the Tauri attachment staging/persistence pipeline (`useChatAttachmentStaging` + `chat-attachment-pipeline`) with self-rendered staged chips. The assistant-ui attachment adapter SHALL NOT be used (the Tauri vault pipeline owns attachment persistence).

#### Scenario: Composer hosts native subsystems

- **WHEN** the composer renders
- **THEN** slash commands, mention parsing, drag-drop attachment staging, and the footer `SessionModeChip` all function via the existing Offisim code paths inside `ComposerPrimitive`
- **AND** attachment bytes are persisted through the Tauri pipeline, not the assistant-ui attachment adapter

### Requirement: ThreadList SHALL bind to chat_threads via ExternalStoreThreadListAdapter

The thread list SHALL feed assistant-ui through an `ExternalStoreThreadListAdapter` mapping the existing `chat_threads` (`threadId`, `threads`, `onSwitchToThread`, `onRename`, `onArchive`, `onDelete`). Thread switching SHALL write through `updateWorkspaceState('office', prev => ({ ...prev, selectedThreadId }))` (no parallel setter), and auto-title `chat_thread.updated` event sync SHALL be preserved.

#### Scenario: Thread switching uses the canonical state path

- **WHEN** the user selects a different thread in the rail
- **THEN** `selectedThreadId` updates via `updateWorkspaceState('office', …)` and the conversation re-renders under the new thread's `conversationKey`
- **AND** an auto-titled thread's title refresh propagates via `chat_thread.updated`
