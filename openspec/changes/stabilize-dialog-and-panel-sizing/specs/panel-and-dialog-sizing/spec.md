## ADDED Requirements

### Requirement: Dialogs declare clamp-based min and max height

Every modal dialog and full-screen overlay touched by this change SHALL declare both `min-height` and `max-height` using viewport-clamp expressions on the outer dialog container, so the outer height never collapses below a readable floor and never exceeds the visible viewport. Recommended canonical clamp on **modal dialogs** (Employee Editor, future small/medium modals): `min-height: clamp(360px, 60vh, 720px)` and `max-height: min(720px, 92vh)`. **Full-screen overlay surfaces** (Company creation wizard, Company Profile / Studio Profile editor) MAY satisfy the contract via `fixed inset-0` positioning or explicit `h-[calc(100vh-…)]` — both pin the outer rendered height to the viewport, which trivially satisfies the floor and ceiling. Surfaces MUST NOT ship without either (a) a viewport-clamp expression on `min-height` + `max-height` or (b) viewport-pinned positioning that yields the same bounded height. Naked `max-height: 100vh` with no min-height SHALL NOT ship for modal dialogs.

#### Scenario: Touched dialog reports clamped height
- **WHEN** Company creation, Employee Editor, or Company Profile dialog is open at viewport `1440x900`
- **THEN** the dialog outer container's computed `min-height` SHALL be at least `360px`
- **AND** the dialog outer container's computed `max-height` SHALL be at most the viewport height

#### Scenario: Tablet viewport stays inside clamp
- **WHEN** the same dialog is open at viewport `1280x800`
- **THEN** the dialog SHALL render between its `min-height` floor and `max-height` ceiling without exceeding the visible viewport
- **AND** content longer than the dialog viewport SHALL scroll inside the dialog rather than expanding the dialog

### Requirement: Tab switches do not change outer dialog height

When a touched dialog contains a `Tabs.Root` (or equivalent tabbed region), switching tabs SHALL NOT change the dialog outer container's rendered height. The internal scroll container — `Tabs.Content` or its first scrollable descendant — SHALL be the only element whose vertical extent or scroll offset changes when tab content length changes.

#### Scenario: Employee Editor tab switch leaves outer height stable
- **WHEN** Employee Editor is open and the user clicks from a short tab (e.g. Profile) to a long tab (e.g. Skills)
- **THEN** the dialog outer container's computed `height` SHALL be identical before and after the tab change
- **AND** the long tab's overflow content SHALL be reachable by scrolling inside the tab content region

#### Scenario: Tabs.Content owns the internal scroll
- **WHEN** a touched dialog renders `Tabs.Content`
- **THEN** that `Tabs.Content` element SHALL have `flex: 1 1 0%`, `min-height: 0`, and `overflow-y: auto`
- **AND** the dialog outer container, `Tabs.Root`, and `Tabs.List` SHALL NOT have `overflow-y: auto`

### Requirement: Dialog flex column chain preserves min-height-zero

Each ancestor between the dialog outer container and the internal scroll container SHALL be a flex column with `min-height: 0` so the scroll container can shrink below its content's intrinsic height. Failing to set `min-height: 0` on any ancestor causes flex children to default to `min-height: auto` and breaks the contract.

#### Scenario: Flex chain audited on touched dialog
- **WHEN** inspecting Company creation, Employee Editor, or Company Profile dialog after this change
- **THEN** every flex-column ancestor from outer dialog through the scroll container SHALL include `min-height: 0` (Tailwind `min-h-0`)

### Requirement: Sticky dialog footer reserves bottom padding

When a touched dialog has a sticky / fixed footer (action row), the internal scroll container SHALL reserve enough `padding-bottom` so the last form field, validation message, or preview is fully visible above the footer at every supported viewport. The reserved padding SHALL be at least the footer's rendered height.

#### Scenario: Last field visible above footer
- **WHEN** the user scrolls a touched dialog's content to the very bottom
- **THEN** the last form field, validation message, or preview SHALL be fully visible above the sticky footer
- **AND** the footer SHALL NOT obscure any content the user is interacting with

### Requirement: Touched surfaces have at most one visual container layer inside the shell

The first-batch surfaces — main app shell workspace center, Company creation dialog content, Employee Editor dialog content, and Company Profile panel content — SHALL contain at most one visual container layer (e.g. `SurfaceCard`, `Card`, framed panel) inside the surface's own shell. The dialog/panel shell itself counts as zero. Nested visual containers (card-inside-card-inside-card) SHALL NOT ship on these surfaces.

#### Scenario: Main shell workspace center has no outer wrapping card
- **WHEN** the user is in any workspace (Office / SOP / Market / Activity / Settings)
- **THEN** the workspace center content SHALL NOT be wrapped by an additional `SurfaceCard` between `AppLayout` and the workspace's own content

#### Scenario: Company creation step renders without nested card
- **WHEN** Company creation dialog is open on any step
- **THEN** the step content SHALL render directly inside the dialog body
- **AND** the step body SHALL contain at most one `SurfaceCard` or equivalent framed container as a visual group divider

#### Scenario: Employee Editor tab body is not double-carded
- **WHEN** any Employee Editor tab is active
- **THEN** the tab body SHALL contain at most one `SurfaceCard` visual layer
- **AND** individual form input groups SHALL NOT each render their own `SurfaceCard`

#### Scenario: Company Profile sections are flat
- **WHEN** Company Profile panel is open
- **THEN** profile sections (basic info / metrics / settings) SHALL render with at most one `SurfaceCard` per section
- **AND** the profile shell itself SHALL NOT be wrapped by a second `SurfaceCard` outside that single layer

### Requirement: Sizing contract is testable via DOM inspection

Every requirement in this capability SHALL be falsifiable by reading computed style on the rendered DOM (no runtime telemetry, no automated test required). Live agent verification SHALL inspect computed `min-height`, `max-height`, `overflow-y`, and `min-height: 0` on the documented selectors.

#### Scenario: Live verify uses computed style
- **WHEN** running live agent verification on a touched dialog
- **THEN** the verifier SHALL read `getComputedStyle(dialogOuter).minHeight`, `.maxHeight`, and the flex chain's `.minHeight` to confirm contract
- **AND** the verifier SHALL not rely on visual eyeballing alone for the height-stability checks
