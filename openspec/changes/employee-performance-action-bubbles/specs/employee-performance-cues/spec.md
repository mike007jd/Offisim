## ADDED Requirements

### Requirement: Runtime events produce employee presentation cues
The system SHALL map real runtime events and scene intents into employee presentation cues. Each cue SHALL include employee identity when available, action type, short bubble text, priority, TTL, source event type, source event id or stable key, and creation timestamp. The system MUST NOT create freeform roleplay text that is not grounded in the source event.

#### Scenario: Task dispatch creates a dispatch cue
- **WHEN** `task.assignment.dispatched` is observed with an employee id and step label
- **THEN** the scene SHALL create a dispatch cue for that employee with short text based on the step label
- **AND** the cue SHALL include source event identity so duplicate dispatch events do not create duplicate visible bubbles

#### Scenario: Tool telemetry creates an action cue
- **WHEN** `tool.execution.telemetry` is observed for search, read, edit, or shell activity
- **THEN** the scene SHALL create a tool-action cue for the owning employee with a distinct action type and short templated text
- **AND** the cue SHALL avoid exposing full paths, full commands, secrets, code, or long tool arguments

#### Scenario: LLM stream is bounded to reporting preview
- **WHEN** `llm.stream.chunk` is observed for boss, manager, or boss summary content
- **THEN** the scene MAY create or update a reporting cue using a truncated preview
- **AND** chunks from ordinary employee tool output or reasoning SHALL NOT become freeform employee dialogue

### Requirement: Cue priority resolves one main bubble per employee
The system SHALL show at most one primary employee bubble at a time for each employee. When multiple active cues exist for the same employee, the selected cue SHALL follow this priority order: failed or blocked, waiting for user decision, review or report, active tool, dispatch or handoff, ambient.

#### Scenario: Blocked cue overrides active tool cue
- **WHEN** an employee has an active tool cue
- **AND** `employee.state.changed` changes that employee to `blocked` or `failed`
- **THEN** the blocked or failed cue SHALL replace the tool cue immediately

#### Scenario: Waiting cue is not hidden by later dispatch chatter
- **WHEN** an employee is waiting on a user interaction cue
- **AND** a lower-priority dispatch or tool cue arrives before the waiting cue resolves
- **THEN** the waiting cue SHALL remain the primary bubble

#### Scenario: Lower priority cue appears after high priority expiry
- **WHEN** a high-priority cue expires or resolves
- **AND** a lower-priority cue is still within its TTL
- **THEN** the lower-priority cue MAY become the primary bubble for that employee

### Requirement: Cue text is concise and privacy safe
Employee bubble text SHALL be concise, business-readable, and privacy safe. Default templated text SHALL target short phrases and MUST be truncated to a bounded length. The scene MUST NOT display full code, secrets, long shell commands, long paths, raw provider payloads, or long tool parameters in bubbles.

#### Scenario: Long task label is truncated
- **WHEN** a task label exceeds the configured bubble length
- **THEN** the visible bubble SHALL show a shortened version ending with an ellipsis or equivalent truncation marker

#### Scenario: Secret-like text is redacted
- **WHEN** a cue source includes text containing secret-like tokens such as API keys, bearer tokens, or private key blocks
- **THEN** the bubble text SHALL replace the sensitive part with a redacted placeholder

### Requirement: Presentation state cleans up stale cues
Employee presentation state SHALL remove stale cues on TTL expiry, employee return to idle, company switch, scene unmount, and explicit resolved interaction events. Handoff and waiting cues SHALL resolve when their matching completion or resolved event arrives.

#### Scenario: Company switch clears old bubbles
- **WHEN** the active company changes
- **THEN** all cue state from the previous company SHALL be cleared before rendering the new company scene

#### Scenario: Interaction resolved clears waiting cue
- **WHEN** `interaction.resolved` is observed for an employee waiting cue
- **THEN** the waiting cue SHALL be removed or replaced by a short resolved cue

#### Scenario: Expired cue disappears
- **WHEN** a cue has exceeded its TTL
- **THEN** the cue SHALL no longer be selected as the employee primary bubble

### Requirement: 3D scene renders employee performance cues
The 3D office scene SHALL render active employee cues as per-employee bubbles, icons, state emphasis, and existing route or flow-line feedback where applicable. Far-distance rendering MAY collapse bubbles into compact icon/badge form, but it MUST preserve the business status category.

#### Scenario: Tool cue shows employee-specific action
- **WHEN** an employee starts a search, read, edit, or shell tool action
- **THEN** that employee's 3D marker SHALL show a short action bubble or compact action badge
- **AND** other employees SHALL NOT display the same bubble unless they have their own cue

#### Scenario: Handoff shows both route and bubble
- **WHEN** `handoff.initiated` is observed with source and target employees
- **THEN** the 3D scene SHALL show a handoff route between those employees where positions are known
- **AND** at least one involved employee SHALL show a handoff bubble until completion or TTL expiry

#### Scenario: Waiting cue is visually distinct
- **WHEN** an employee is waiting for approval or clarification
- **THEN** the 3D scene SHALL show a waiting bubble and visual emphasis distinct from ordinary work

### Requirement: 2D fallback preserves employee cue meaning
The 2D canvas fallback SHALL render the same active employee cue meaning as the 3D scene using concise bubbles, icons, or badges above the employee avatar. It MAY omit 3D-only movement detail, but it MUST preserve who is doing what, who is waiting, who is blocked, and who is handing off.

#### Scenario: 2D shows active tool cue
- **WHEN** the scene is in 2D mode and an employee has an active tool cue
- **THEN** the employee avatar SHALL show a short bubble or badge describing the tool category

#### Scenario: 2D shows blocked cue over ordinary state
- **WHEN** the scene is in 2D mode and an employee has both ordinary work state and blocked cue state
- **THEN** the blocked cue SHALL be the visible primary bubble or badge

#### Scenario: 2D and 3D share cue source
- **WHEN** switching from 3D to 2D during an active cue
- **THEN** the visible 2D cue SHALL correspond to the same source event and priority as the 3D cue
