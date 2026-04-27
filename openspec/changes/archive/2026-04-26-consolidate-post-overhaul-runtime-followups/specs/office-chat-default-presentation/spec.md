## ADDED Requirements

### Requirement: Direct chat target resolution MUST hit `selectedEmployeeId`

When the user is in direct chat mode (`selectedEmployeeId !== null`), every subsequent message send and tool invocation SHALL resolve the `targetEmployeeId` for dispatch to the value of `selectedEmployeeId`. The system SHALL NOT fall back to:
- the previously active employee from a prior chat session
- the first employee in `agents` map
- the boss employee
- any heuristic / mention parser inference

If `selectedEmployeeId` is set but the dispatch path receives a missing or stale target, the system SHALL throw an explicit error rather than silently route to a fallback. This guards against the T2.3-observed bug where `fork_skill` preview occasionally landed on Alex Chen instead of Maya after Maya was selected.

This requirement applies to:
- `sendMessage` from `ChatPanel`
- agent-mediated tool calls (`fork_skill`, `edit_skill_body`, `install_skill_*`, `create_skill_from_scratch`, etc.)
- interaction respond paths (`respondToInteraction`)
- any other chat-originated dispatch entry

#### Scenario: Selected Maya gets the next message

- **WHEN** the user clicks Maya in the agent panel (selectedEmployeeId becomes Maya's ID) and sends a message
- **THEN** the run dispatches to Maya, the run conversation key resolves to Maya's direct chat conversation, and no fallback to active / first / boss employee occurs

#### Scenario: Selected Maya gets the next tool invocation

- **WHEN** the user is in direct chat with Maya and invokes a tool that triggers `fork_skill` preview
- **THEN** the preview bubble shows Maya's avatar/name as the skill target, and the eventual install writes to Maya's vault path, not another employee's

#### Scenario: Missing target throws explicit error

- **WHEN** dispatch is requested with `selectedEmployeeId` set but the dispatch path is missing the target (programming error)
- **THEN** the system throws `Error('Direct chat target missing — selectedEmployeeId not propagated')` rather than silently falling back to a default employee
