## ADDED Requirements

### Requirement: Workspace SHALL be the fifth peer workspace integrated into nav, routing, and tiers

`WorkspaceKey` SHALL gain `'workspace'` (positioned after `personnel`). The Workspace peer SHALL render a nav pill (same chip style as other peers when active), participate in URL routing (`workspace` + an `?app=` segment for the active app), and consume `useLayoutTier()` for its tier layout. `PEER_WORKSPACE_ITEMS` SHALL include it; the existing six workspaces SHALL be unaffected.

#### Scenario: Workspace pill navigates and routes

- **WHEN** the user selects the Workspace nav pill
- **THEN** the Workspace surface opens, the URL serializes `workspace` (+ the active `?app=`), and Back/Forward round-trips
- **AND** the active pill uses the same chip style as the other peers

### Requirement: Workspace SHALL render a飞书-style app-rail + suite-body shell

The Workspace surface SHALL render a `.suite` shell: a 64px app-rail (app entries with selected state) plus a `.suite-body` split layout (320px list + detail). In this change the app-rail SHALL light up the two deep apps — Messenger and Approvals OA. Escape SHALL drill back within the suite.

#### Scenario: App-rail switches apps

- **WHEN** the user activates an app-rail entry (Messenger or Approvals OA)
- **THEN** the suite-body switches to that app in split mode with the entry showing selected state

### Requirement: Messenger SHALL be backed by chat_threads as SSOT and reuse the Office selected-thread state

The Messenger app SHALL render team group chat, direct chat, and a read-only system bot channel from `chat_threads` as SSOT. team vs direct SHALL be derived from the conversationKey (`<projectId>::<threadId>` = team; `<projectId>::<threadId>::<employeeId>` = direct). Messenger SHALL reuse the existing chat message/composer surface (no new chat engine; no new tables). Messenger thread selection SHALL be clamped to the same `OfficeSessionState.selectedThreadId` SSOT path used by Office — selection SHALL be written via `updateWorkspaceState('office', …)` and SHALL NOT introduce a separate setter; if suite selection is ever decoupled from Office it SHALL be declared as an explicit suite-scoped selection field (never an implicit fork), to pre-empt divergent-selection between the two surfaces.

#### Scenario: Messenger lists and opens threads from chat_threads

- **WHEN** the user opens Messenger
- **THEN** the list shows `chat_threads` (recent first, searchable) and opening one shows its message stream
- **AND** a direct conversation is keyed by the employee-segmented conversationKey

#### Scenario: Messenger and Office share selected-thread state

- **WHEN** the user selects a thread in Messenger
- **THEN** the selection is written through `updateWorkspaceState('office', …)` to `OfficeSessionState.selectedThreadId`
- **AND** Office and Messenger reflect the same selected thread (no divergent selection)

### Requirement: Approvals OA SHALL surface the four real approval kinds from existing interaction tables

The Approvals OA app SHALL surface the four real approval kinds — `permission_request`, `plan_review`, `agent_question`, `skill_install_confirm` — as an OA-style inbox (list + detail + per-kind approval form + To-do/Done filters), reading from `active_thread_interactions` (pending) + `interaction_history` (resolved) + `tool_permission_approvals` (permission requests). To-do SHALL map to unresolved interactions in `active_thread_interactions`; Done SHALL map to resolved interactions in `interaction_history`. No CC/carbon-copy filter SHALL be provided: the interaction model has no recipient/approver field (the only actor-ish field, `requestedByNode`, identifies the requesting graph node, not a human recipient), so CC has no data source; a recipient model is deferred to the follow-up. Approval actions SHALL route through the existing interaction resolve path (ToolPermissionEngine allow/ask/deny semantics); the change SHALL NOT add tables or alter the interaction engine.

#### Scenario: Approvals lists and resolves the four kinds

- **WHEN** the user opens Approvals OA
- **THEN** pending + resolved interactions render grouped by the four kinds (`permission_request`, `plan_review`, `agent_question`, `skill_install_confirm`) with To-do/Done filters
- **AND** acting on a pending approval routes through the existing interaction resolve path (no new table, no engine change)
