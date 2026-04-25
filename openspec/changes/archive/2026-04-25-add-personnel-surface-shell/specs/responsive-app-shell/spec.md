## ADDED Requirements

### Requirement: Personnel workspace adapts at narrow tablet desktop tiers
The Personnel workspace SHALL render readable layouts at `1440x900`, `1280x800`, and `390x844`. At desktop the list rail, detail+preview, and tabs inspector SHALL render as three concurrent panes. At tablet the user SHALL be able to drill from list → detail+tabs without losing back navigation. At narrow the panes SHALL stack and avoid horizontal document overflow.

#### Scenario: Desktop renders three panes
- **WHEN** viewport is `1440x900` and `activeWorkspace === 'personnel'`
- **THEN** the list, detail+preview, and right tabs inspector SHALL render side by side
- **AND** each pane SHALL be vertically scrollable independently

#### Scenario: Tablet preserves drill navigation
- **WHEN** viewport is `1280x800` and `activeWorkspace === 'personnel'`
- **THEN** the page SHALL remain usable to select an employee and view its tabs without horizontal page scrolling
- **AND** Back navigation SHALL unwind tab → selection per `personnel-workspace-surface`

#### Scenario: Narrow stacks panes and avoids overflow
- **WHEN** viewport is `390x844` and `activeWorkspace === 'personnel'`
- **THEN** `document.documentElement.scrollWidth` SHALL be ≤ `window.innerWidth`
- **AND** the active pane (list, detail, or tabs) SHALL fill the viewport with the others reachable via Back

### Requirement: Personnel page reserves bottom action space
The Profile tab inside Personnel SHALL render any sticky save / delete actions without obscuring the last visible field. Placeholder tabs SHALL not introduce sticky footers.

#### Scenario: Profile tab save bar leaves the last form field visible
- **WHEN** the user scrolls to the bottom of the Profile tab content with unsaved changes
- **THEN** the last form field, validation message, or section heading SHALL remain fully visible above any sticky action bar
