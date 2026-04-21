## MODIFIED Requirements

### Requirement: Team and direct chat behave consistently
Streaming behavior (placeholder discipline, label visibility, partial/completed distinction) SHALL be identical between team chat and direct-employee chat modes. Additionally, the direct-chat entry path SHALL reach the LLM transport layer without mutating any frozen or readonly runtime object — the conversation snapshot, agent state, store state, and any provider-config SSOT SHALL only be updated through their declared mutation channels (store actions, reducers, clone-and-replace). This invariant SHALL hold under the stricter JavaScriptCore semantics used by Tauri's macOS webview, where `Object.freeze`-ed targets throw `TypeError` on assignment instead of silently no-op-ing as they do under Chromium dev. For web direct chat specifically, the employee identity resolved at send time SHALL remain stable across the entire run lifecycle: user message append, streaming bubble label, pending interaction preview, follow-up routing, and retry SHALL all refer to the same target employee.

#### Scenario: Same streaming discipline in direct chat
- **WHEN** the user enters direct chat with a specific employee and sends a message
- **THEN** the streaming bubble obeys the same rules as team chat: placeholder only in the pre-chunk gap, real content streams in, speaker label is the employee's name throughout

#### Scenario: Direct chat reaches transport on Tauri release bundle
- **WHEN** the user opens a Tauri release bundle (macOS webview / JavaScriptCore), opens direct chat with any employee, and sends a message
- **THEN** no `TypeError: Attempted to assign to readonly property.` is thrown in the pre-transport path; the request reaches `llm_fetch` and the streaming bubble begins accumulating content as in team chat

#### Scenario: Direct-chat preview target matches the employee selected at send time
- **WHEN** the user sends a web direct-chat message while Maya is selected and that run emits a `skill_install_confirm` interaction
- **THEN** the preview bubble SHALL identify Maya as the target employee
- **AND** it SHALL NOT switch to Alex or any previously selected employee unless the user starts a brand-new run targeting that employee

#### Scenario: Retry reuses the failed run target
- **WHEN** a web direct-chat run targeting Maya fails, the user switches the UI selection to Alex, and then invokes retry
- **THEN** the retried run SHALL still target Maya
- **AND** the streaming bubble label, preview bubble, and follow-up message SHALL stay on Maya's conversation rail
