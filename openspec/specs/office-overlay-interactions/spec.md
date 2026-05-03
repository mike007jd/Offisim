# office-overlay-interactions Specification

## Purpose
Define the layout, mutation, and routing contracts for office overlay surfaces such as EmployeeInspector and CompanySwitcher, so overlay bodies stay visually single-layered, footer actions remain reachable across layout tiers, state-changing actions feel immediate but roll back on persistence failure, and switcher dropdowns clearly separate direct selection from management overlays.
## Requirements
### Requirement: Overlay bodies obey single-SurfaceCard nesting limit

Floating inspector / dialog / popup surfaces rendered over the office (`EmployeeInspector`, future overlay overlays anchored to a workspace) SHALL contain at most one outer `SurfaceCard` (or equivalent elevated container). Visual sectioning inside SHALL use internal `border-b` dividers, `SettingsSection` primitives, or disclosure (`<details>` / `Disclosure`) — NOT nested `SurfaceCard` / `Card` / hand-rolled `rounded-* shadow-*` blocks.

This is the overlay-level realization of the existing `panel-and-dialog-sizing` rule "Settings tab body ≤ 1 layer SurfaceCard, no cards-in-cards"; it generalizes the same discipline to any overlay body.

#### Scenario: Inspector renders one elevated surface

- **WHEN** the user opens `EmployeeInspector` for any employee in any state (idle / executing / dismissed / with subtasks / with current focus / with memories)
- **THEN** the rendered DOM contains exactly one elevated SurfaceCard ancestor wrapping the inspector body
- **AND** no descendant of that card adds a second elevated background, border-radius cluster, or `shadow-` class beyond the inline divider / disclosure pattern

#### Scenario: Memories disclosure does not nest a card

- **WHEN** the inspector renders a non-empty `MemoriesSection` and the user expands it
- **THEN** the expanded body uses a disclosure (`<details>` / Headless UI `Disclosure`) embedded in the main inspector card
- **AND** the disclosure body does not introduce its own elevated container

### Requirement: Overlay footer affordances stay reachable across layout tiers

Overlay footers that hold mutating actions (Dismiss / Re-enable / Delete / Archive / etc.) SHALL render every action reachably across desktop / tablet / narrow layout tiers. Affordances SHALL never clip, overflow, or hide behind sibling buttons. When the available width is insufficient for full label rendering, the footer SHALL collapse to icon-only buttons with `aria-label` + `title` set to the action name; if even icon-only rendering would overflow, the footer SHALL wrap to a second row.

#### Scenario: Wide tier renders full button labels

- **WHEN** the inspector renders at desktop width (≥1024 px)
- **THEN** every footer button shows its icon + text label inline
- **AND** all buttons fit on a single row without horizontal scroll

#### Scenario: Narrow tier collapses to icon-only

- **WHEN** the inspector renders at narrow width (≤768 px) and at least three footer actions are visible (e.g. Message / Edit Details / Dismiss)
- **THEN** each button renders icon-only with `aria-label` + `title` matching the original label
- **AND** every action remains tappable without horizontal overflow

#### Scenario: Wrap to a second row when icon-only still overflows

- **WHEN** more footer actions than fit on a single row exist (e.g. four affordances at narrow width)
- **THEN** the footer wraps the overflowing buttons onto a second row with consistent vertical spacing
- **AND** no action is hidden, clipped, or behind an "overflow menu" affordance

### Requirement: Mutating overlay actions are optimistic with rollback

Mutating actions in overlay bodies (e.g. `EmployeeInspector` Dismiss / Re-enable) SHALL apply the local-state mutation BEFORE awaiting the persistence-layer write. The visible label / banner / disabled state SHALL flip in the same render that processed the click, not after the DB round-trip. If the persistence write fails, the local state SHALL roll back to its prior value and the failure SHALL surface through the existing toast / inline error channel — silent swallowing is forbidden.

#### Scenario: Dismiss flips inspector banner immediately

- **WHEN** the user clicks Dismiss on an enabled employee
- **THEN** within the same render tick the inspector banner shows "DISMISSED" and the footer button switches from "Dismiss" to "Re-enable"
- **AND** these flips happen before `repos.employees.update({ enabled: 0 })` resolves

#### Scenario: DB write failure rolls back and surfaces error

- **WHEN** the user clicks Dismiss and `repos.employees.update` rejects
- **THEN** the inspector banner reverts to the pre-click state (no DISMISSED banner; footer button back to "Dismiss")
- **AND** the failure surfaces via the runtime toast / inline error channel with the underlying error message
- **AND** subsequent clicks remain enabled (no permanently-disabled button)

### Requirement: Switcher dropdowns separate switch from manage

Dropdown switchers that list selectable entities (e.g. `CompanySwitcher`, future ProjectSwitcher) SHALL treat row-item selection and management entry as distinct affordances. Selecting a row SHALL invoke the entity's setter directly (`setActiveCompany(id)` / equivalent) and close the menu, with no side trip through the management overlay. Only an explicit footer / sentinel action (e.g. `Manage companies`) SHALL route to the management overlay.

#### Scenario: Selecting a company swaps without overlay

- **WHEN** the user opens the `CompanySwitcher` dropdown and clicks a non-active company row
- **THEN** the active company switches to that row's id and the menu closes
- **AND** no `company-select` overlay is opened or briefly flashed during the transition

#### Scenario: Manage companies routes to picker

- **WHEN** the user clicks the `Manage companies` footer action in the dropdown
- **THEN** the `company-select` overlay opens (creator / picker surface)
- **AND** the overlay routes through the existing `setActiveOverlay('company-select')` channel
