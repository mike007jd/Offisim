## ADDED Requirements

### Requirement: Single-click navigation invariant for shell tabs

The Header peer workspace nav and Settings tab nav SHALL switch the active workspace / tab on the **first** primary left-click (button=0, no modifier keys). The product SHALL NOT require a double-click, second-click, or modifier-click for any same-tier navigation control in these two surfaces. Implementations SHALL NOT introduce `onMouseDown` fallbacks, debouncing wrappers, or capture-phase event blockers as workarounds for missed first-clicks; the first-click guarantee SHALL hold against the actual root cause path (event handler, state reducer, URL serializer, focus / re-mount cycle).

#### Scenario: Header peer workspace nav single-click switches workspace
- **WHEN** the user is on Office workspace at viewport `1440x900` and clicks any other peer-workspace tab (SOPs / Market / Personnel / Activity Log / Settings) once with the primary mouse button and no modifier keys
- **THEN** the app SHALL transition to the clicked workspace within the same React commit cycle (no second click required)
- **AND** `window.location.pathname` SHALL update to the corresponding `workspaceHref(key)` value
- **AND** the visual `aria-current="page"` highlight SHALL move to the clicked tab

#### Scenario: Settings tab nav single-click switches tab
- **WHEN** the user is on Settings → Provider tab and clicks any other Settings tab (Runtime / MCP / External Employees) once with the primary mouse button and no modifier keys
- **THEN** the app SHALL transition to the clicked tab within the same React commit cycle (no second click required)
- **AND** the visual active highlight SHALL move to the clicked tab

#### Scenario: No double-click fallback in shell tab handlers
- **WHEN** auditing `Header.tsx` `activateWorkspaceLink`, `SettingsTabNav.tsx` `onClick`, and any newly introduced shell tab handlers
- **THEN** the source code SHALL NOT contain `onMouseDown`-based selection, manual debounce / throttle, or `setTimeout`-deferred selection introduced as a workaround for first-click loss
- **AND** the change implementation SHALL document the actual identified root cause in either `design.md` or commit messages

### Requirement: Right panel collapse handle is reachable while right rail is expanded

While the right rail (collaboration / chat / tasks panel) is expanded in Office workspace, its `PanelCollapseHandle` SHALL be hit-testable for primary left-click 100% of the time, regardless of which inner Tabs / sub-Tabs are active or which `forceMount` panels are present. The handle SHALL NOT be visually clipped by an ancestor `overflow-hidden` container, and SHALL NOT be intercepted by a sibling stacking context, scroll container, or `forceMount` panel that the user is not currently interacting with. Implementations SHALL NOT raise the handle's `z-index` above 30 as a brute-force fix; the resolution SHALL address the actual hit-test root cause (e.g., constraining `pointer-events` on non-active `forceMount` sub-tab panels).

#### Scenario: Collapse handle works on Chat tab
- **WHEN** the right rail is expanded in Office, the active main tab is `chat`
- **AND** the user clicks the collapse handle once with the primary mouse button
- **THEN** the right rail SHALL collapse on that single click

#### Scenario: Collapse handle works on Tasks tab with Activity subtab active
- **WHEN** the right rail is expanded in Office, the active main tab is `tasks`, and the active sub-tab is `activity`
- **AND** the user clicks the collapse handle once
- **THEN** the right rail SHALL collapse on that single click

#### Scenario: Collapse handle works on Tasks tab with Plan subtab active
- **WHEN** the right rail is expanded in Office, the active main tab is `tasks`, and the active sub-tab is `plan`
- **AND** the user clicks the collapse handle once
- **THEN** the right rail SHALL collapse on that single click

#### Scenario: Collapse handle works on Tasks tab with Outputs subtab active
- **WHEN** the right rail is expanded in Office, the active main tab is `tasks`, and the active sub-tab is `outputs`
- **AND** the user clicks the collapse handle once
- **THEN** the right rail SHALL collapse on that single click

#### Scenario: Tab state preserved after collapse + reopen
- **WHEN** the user is on Tasks → Plan, collapses the right rail, then reopens it
- **THEN** the right rail SHALL re-render with `tasks` as the active main tab and `plan` as the active sub-tab

### Requirement: Notification badge is not clipped by ancestor overflow

The Notification Center unread-count badge SHALL render fully visible while the right side of the Header has any number of slots filled (`apiSettings`, `mode`, `officeTools`, `fileImport`, `notification`). The badge SHALL NOT depend on ancestor `overflow: visible` to render correctly; it SHALL be implemented as an inline visual element of the bell button (e.g., a small ring / chip positioned within the button's content box) so that any ancestor `overflow-hidden` or `overflow-x: clip` setting does not clip it.

#### Scenario: Badge fully visible at desktop with all slots occupied
- **WHEN** viewport is `1440x900`, Office workspace is active, the user has unread notifications, and Header right slots `apiSettings`, `mode`, `officeTools`, `fileImport`, `notification` are all rendered
- **THEN** the unread-count badge SHALL render fully visible (no part clipped) above and to the right of the bell icon glyph

#### Scenario: Badge fully visible in light theme
- **WHEN** the same conditions hold and the active theme is `light`
- **THEN** the badge SHALL render fully visible with sufficient contrast against both the bell icon and the Header background

#### Scenario: Badge does not rely on parent overflow
- **WHEN** auditing the implementation of the unread badge in `NotificationCenter.tsx`
- **THEN** the badge SHALL NOT rely on negative `top` / `right` offsets that escape the bell button's content box AND require the bell button's parent containers to expose `overflow: visible`
- **AND** the change implementation SHALL document the chosen approach (e.g., inline ring, inset chip) in `design.md`

### Requirement: List menu keyboard navigation scrolls active row into view

When the user navigates a vertically-scrollable list menu (slash-command menu, mention menu) via `ArrowDown` or `ArrowUp`, the row corresponding to the new active index SHALL scroll into view via `scrollIntoView({ block: 'nearest' })` so that the active row is always visible without manual scrolling. This requirement applies to any list menu in the chat input that supports keyboard navigation across an item count exceeding the visible viewport of the menu.

#### Scenario: Slash menu ArrowDown beyond visible area scrolls active row
- **WHEN** the user types `/` in the chat input, the slash menu opens, and the visible menu height shows fewer rows than `filteredSlash.length`
- **AND** the user presses `ArrowDown` enough times to move past the last visible row
- **THEN** the menu SHALL scroll so the new active row is visible
- **AND** the active row SHALL be highlighted with the active styling

#### Scenario: Slash menu ArrowUp wraps and scrolls to last row
- **WHEN** the slash menu is open with the first row active and the user presses `ArrowUp`
- **THEN** active index SHALL wrap to the last row
- **AND** the menu SHALL scroll so the last row is visible

#### Scenario: Mention menu ArrowDown beyond visible area scrolls active row
- **WHEN** the user types `@<query>` in the chat input, the mention menu opens, and the visible menu height shows fewer rows than `filteredMentions.length`
- **AND** the user presses `ArrowDown` enough times to move past the last visible row
- **THEN** the menu SHALL scroll so the new active row is visible
