## MODIFIED Requirements

### Requirement: Boss system prompt SHALL include the active company's employee roster

Boss prompt assembly SHALL receive the active company's employee roster on every chat path.
This covers team-chat, direct-chat, yolo-chat, sop-driven, and
human-in-loop. The roster SSOT is the active company's `employees`
rows; both surfaces SHALL read from the same resolver, never from
divergent caches or divergent active-company snapshots.

#### Scenario: Team-chat Boss addresses the same employees the personnel rail shows

- **GIVEN** an active company with ≥2 employees including `Alex Chen`
- **WHEN** the user asks Boss in **team chat** (no specific @-mention)
  a question that requires employee context (e.g., "who is on the
  team?", "what does Alex do?")
- **THEN** Boss SHALL respond using the same employee roster the
  personnel rail is rendering
- **AND** Boss SHALL NOT respond with phrasing equivalent to "no
  employee database access" or "I cannot see that employee" when the
  rail lists that employee for the same active company

#### Scenario: Team-chat and direct-chat Boss prompts are roster-equivalent

- **WHEN** the same active company is open in both team-chat and
  direct-chat (any direct target)
- **THEN** the assembled Boss employee roster SHALL be byte-equivalent
  across the two paths
- **AND** SHALL NOT diverge based on `selectedThreadId` shape or
  `conversationKey` employee segment presence

### Requirement: Boss employee-context regressions SHALL emit an observable runtime event

The runtime SHALL emit a typed observable event whenever the Boss
prompt assembly produces an employee roster that diverges from the
personnel rail's view of the same active company. The event SHALL
fire regardless of which chat path triggered the assembly.

#### Scenario: Event fires when team-chat Boss roster is empty but rail is non-empty

- **WHEN** Boss prompt assembly on the team-chat path produces a
  zero-employee or stale roster
- **AND** the personnel rail simultaneously renders ≥1 employee for the
  same active company
- **THEN** the runtime SHALL emit a boss-roster-divergence event
- **AND** the event payload SHALL include `path: 'team-chat'`, the
  rail's employee count, the assembled roster's employee count, and
  the active company id used by each side
