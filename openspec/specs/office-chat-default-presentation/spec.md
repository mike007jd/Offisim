# office-chat-default-presentation Specification

## Purpose
TBD - created by archiving change chat-default-expanded-on-office. Update Purpose after archive.
## Requirements
### Requirement: Right rail defaults to expanded for office on first visit
On first visit to the Office workspace (no persisted user preference) the right rail (`eventLog` slot containing `RightSidebar` with `Chat | Tasks` tabs) SHALL render expanded for any non-narrow viewport (`width > 768px`). The chat input within the right rail SHALL be reachable and clickable without requiring the user to first expand a collapsed bar.

#### Scenario: Desktop first visit shows expanded chat
- **WHEN** the user opens Office at viewport `1440x900` with no `offisim-rightrail-open` value in `localStorage`
- **THEN** the right rail SHALL render at full width (`440px`) with the `Chat` tab active
- **AND** the chat input field SHALL be visible and accept keyboard input without an extra click

#### Scenario: Tablet first visit shows expanded chat
- **WHEN** the user opens Office at viewport `1280x800` with no `offisim-rightrail-open` value in `localStorage`
- **THEN** the right rail SHALL render expanded (not the `44px` collapsed bar)
- **AND** the chat input SHALL be visible and immediately usable

#### Scenario: Narrow viewport keeps right rail collapsed
- **WHEN** the user opens Office at viewport `390x844`
- **THEN** the right rail SHALL remain collapsed (or be replaced by the mobile `ChatDrawer` per existing responsive rules)
- **AND** the default-expanded behavior SHALL NOT apply

### Requirement: Right rail open state persists across sessions
The right rail open/collapsed state SHALL persist across browser sessions via `localStorage` under key `offisim-rightrail-open`. User-initiated collapse SHALL survive page reload.

#### Scenario: User collapse persists after reload
- **WHEN** the user clicks the right rail collapse handle to collapse it
- **AND** the user reloads the page at the same viewport tier
- **THEN** the right rail SHALL render collapsed
- **AND** `localStorage.getItem('offisim-rightrail-open')` SHALL equal `'false'`

#### Scenario: User re-expand persists
- **WHEN** the right rail is collapsed and the user clicks the collapsed bar to expand it
- **AND** the user reloads the page
- **THEN** the right rail SHALL render expanded
- **AND** `localStorage.getItem('offisim-rightrail-open')` SHALL equal `'true'`

#### Scenario: Storage failure falls back to default
- **WHEN** `localStorage` is unavailable or read/write throws
- **THEN** the right rail SHALL initialize using the responsive default (expanded for non-narrow viewports)
- **AND** SHALL NOT throw a user-visible error

### Requirement: Viewport tier change does not override user preference
Changing viewport tier (`mobile ↔ tablet ↔ desktop`) via window resize SHALL NOT override an explicit user preference stored in `localStorage`. Tier change SHALL only apply default rules when no preference is stored.

#### Scenario: Tier change with stored preference keeps preference
- **WHEN** the user has manually collapsed the right rail at desktop width and the persisted preference is `'false'`
- **AND** the user resizes the window from `1440px` width down to `1280px` width
- **THEN** the right rail SHALL remain collapsed
- **AND** the open state SHALL NOT auto-revert to default

#### Scenario: Tier change without stored preference applies new default
- **WHEN** no `offisim-rightrail-open` value is stored in `localStorage`
- **AND** the user resizes the window from `1280px` to `600px` (narrow tier)
- **THEN** the right rail SHALL collapse per the narrow-tier default

### Requirement: Office team chat empty state is low-occupancy
When Office team chat has no messages, no streaming run, no pending interaction, and no selected direct-chat employee, the chat surface SHALL NOT render the full-height `EmptyState` boss-greeting card. The message area SHALL leave whitespace and SHALL keep the chat input area reachable without any text or card occupying the visual center of the message area.

#### Scenario: Empty team chat presents whitespace and reachable input
- **WHEN** Office is open with the right rail expanded, no active project messages, and `selectedEmployeeId === null`
- **THEN** the message area SHALL NOT render the boss-greeting welcome card
- **AND** the chat input field SHALL be visible at the bottom of the right rail and accept text without scrolling

#### Scenario: Direct-chat empty state preserves existing one-line hint
- **WHEN** the user selects an employee for direct chat and no messages exist yet
- **THEN** the message area SHALL render a single line of text indicating the start of conversation with the selected employee
- **AND** SHALL NOT render starter prompt chips

### Requirement: Starter prompt chips render inline above input when present
When `onboardingStarterPrompts` are provided and the chat is in team-chat empty state, the prompts SHALL be rendered as a single chip row immediately above the chat input (`shrink-0` region), not inside the message area. Clicking a chip SHALL send the chip's `text` as a user message.

#### Scenario: Starter chips appear above input
- **WHEN** team chat is empty, `selectedEmployeeId === null`, and `onboardingStarterPrompts` contains 2-3 prompts
- **THEN** the chips SHALL render in a horizontal row directly above `ChatInput`
- **AND** the chip row SHALL NOT push the input below the visible area

#### Scenario: Starter chip click sends as message
- **WHEN** the user clicks a starter prompt chip with `text` `"Draft a launch plan with milestones and owners."`
- **THEN** that text SHALL be sent via the same path as a user-typed message
- **AND** the chip row SHALL hide once the conversation has at least one message

#### Scenario: No starter prompts hides chip row entirely
- **WHEN** `onboardingStarterPrompts` is `undefined` or empty
- **THEN** no chip row SHALL render
- **AND** the input area SHALL be the only element in the chat input region

