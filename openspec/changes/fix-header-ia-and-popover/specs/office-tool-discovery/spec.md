## ADDED Requirements

### Requirement: Header selected state is unique to peer workspace navigation
The Header SHALL render the active peer workspace as the only "selected chip" style indicator. Office-scoped tools that expose an active panel state (Dashboard, Kanban) SHALL use a visually weaker indicator than peer workspace selection so users can distinguish workspace navigation from panel toggles.

#### Scenario: Peer workspace selected uses chip style
- **WHEN** a peer workspace is the active workspace in Office
- **THEN** its nav entry SHALL render with a filled chip style (border + background + highlighted text) and `aria-current="page"`
- **AND** no Office-scoped tool entry SHALL render the same filled chip style at the same time

#### Scenario: Office tool active uses subordinate indicator
- **WHEN** an Office tool with `isActive=true` (Dashboard or Kanban panel open) is rendered in the Office tool group
- **THEN** the active state SHALL be expressed by an icon tint plus a non-chip indicator (such as an underline or dot), not by a filled chip border + background
- **AND** the tool button SHALL retain `aria-pressed="true"` for assistive technology

#### Scenario: Inactive office tool stays neutral
- **WHEN** an Office tool with `isActive=false` is rendered
- **THEN** the button SHALL render in the neutral icon-only style with no border, background, or active indicator
- **AND** `aria-pressed="false"` SHALL be present

### Requirement: Dashboard and Kanban panels are mutually exclusive
The Office workspace SHALL allow at most one panel-style overlay (Dashboard or Kanban) to be active at a time. Activating one panel while the other is open SHALL close the other. Studio and Add Employee are dialog/overlay entries with different semantics and SHALL NOT participate in this exclusion.

#### Scenario: Opening Kanban while Dashboard is open closes Dashboard
- **WHEN** the Boss Dashboard overlay is currently open in Office
- **AND** the user activates the Kanban tool entry (visible button or keyboard shortcut)
- **THEN** the Kanban overlay SHALL open
- **AND** the Boss Dashboard overlay SHALL close
- **AND** only the Kanban tool entry SHALL show its active indicator

#### Scenario: Opening Dashboard while Kanban is open closes Kanban
- **WHEN** the Kanban overlay is currently open in Office
- **AND** the user activates the Dashboard tool entry (visible button or keyboard shortcut)
- **THEN** the Boss Dashboard overlay SHALL open
- **AND** the Kanban overlay SHALL close
- **AND** only the Dashboard tool entry SHALL show its active indicator

#### Scenario: Studio and Add Employee do not affect panel state
- **WHEN** the Boss Dashboard or Kanban overlay is open
- **AND** the user activates Studio or Add Employee
- **THEN** the open Dashboard or Kanban overlay SHALL remain open
- **AND** Studio / Add Employee SHALL open their own dialog or overlay independently

### Requirement: Office tool overflow popover is viewport-aware
When Office tools exceed the visible threshold, the overflow menu SHALL render through a portal attached to `document.body` so it is not clipped by parent stacking context, and its position SHALL avoid overflowing any viewport edge by collision-aware placement.

#### Scenario: Overflow menu defaults to right-aligned below trigger
- **WHEN** the user activates the Office tool overflow trigger
- **AND** the menu fits to the right and below the trigger inside the viewport
- **THEN** the menu SHALL render right-aligned to the trigger and below it

#### Scenario: Overflow menu flips to left-aligned when right edge would overflow
- **WHEN** the user activates the Office tool overflow trigger
- **AND** rendering right-aligned would place the menu past the viewport's right edge
- **THEN** the menu SHALL flip to left-aligned to the trigger

#### Scenario: Overflow menu flips above when bottom would overflow
- **WHEN** the user activates the Office tool overflow trigger
- **AND** rendering below the trigger would place the menu past the viewport's bottom edge
- **THEN** the menu SHALL flip to render above the trigger

#### Scenario: Overflow menu stays inside viewport on resize or scroll
- **WHEN** the overflow menu is open
- **AND** the viewport is resized or the page scrolls
- **THEN** the menu SHALL remain visible inside the viewport, repositioning if necessary
- **AND** the menu MAY close if it cannot remain anchored to the trigger (for example, if the trigger scrolls out of view)
