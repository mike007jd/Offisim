## MODIFIED Requirements

### Requirement: Touched surfaces have at most one visual container layer inside the shell

The first-batch surfaces — main app shell workspace center, Company creation dialog content, Employee Editor dialog content, Company Profile panel content, and **each Settings sub-tab body (Provider / Runtime / MCP / External)** — SHALL contain at most one visual container layer (e.g. `SurfaceCard`, `Card`, framed panel) inside the surface's own shell. The dialog/panel shell itself counts as zero. Layout primitives that produce only a top divider + heading row without `border`, `background-color`, or `border-radius` (e.g. `SettingsSection` in the Settings workspace) SHALL NOT count as visual container layers. Nested visual containers (card-inside-card-inside-card) SHALL NOT ship on these surfaces.

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

#### Scenario: Settings tab body is not double-carded
- **WHEN** the user opens any Settings sub-tab (Provider / Runtime / MCP / External)
- **THEN** the tab body SHALL contain at most one `SurfaceCard` visual layer (e.g. the desktop-only `VaultDirectorySection` on Runtime tab)
- **AND** individual configuration groups within a tab SHALL use `SettingsSection` (a layout primitive without border/bg/radius), not nested `SurfaceCard`
- **AND** no `Card` from `ui-core` SHALL be rendered inside a `SurfaceCard` in the Settings workspace

## ADDED Requirements

### Requirement: Workspace surface with sticky footer reserves matching bottom padding

Every workspace surface (Office / SOP / Market / Personnel / Activity / Settings) that renders a sticky / fixed footer (e.g. Settings save bar, Personnel save bar, future Activity bulk-action bar) SHALL ensure the surface's own scrollable content area reserves `padding-bottom` ≥ the rendered height of that footer so the last form field, list row, validation message, or interactive control in the surface is fully visible above the footer at every supported viewport (≥ 768px width). The reservation SHALL be expressed as a class or computed style on the scroll container, NOT as a global body-level offset.

#### Scenario: Settings workspace reserves bottom padding for sticky save bar
- **WHEN** the user scrolls any Settings tab content (Provider / Runtime / MCP) to the very bottom at viewport `1440x900`
- **THEN** the last visible form field, list row, or button SHALL be fully above the sticky save bar
- **AND** the bottom padding reserved SHALL be at least the sticky save bar's rendered height

#### Scenario: Tab switch within a workspace does not change outer height
- **WHEN** the user switches between Settings sub-tabs (Provider ↔ Runtime ↔ MCP ↔ External) at viewport `1440x900`
- **THEN** the Settings workspace surface outer container's computed `height` SHALL be identical before and after the tab change
- **AND** content longer than the visible viewport SHALL scroll inside the tab body, not expand the workspace shell

#### Scenario: Footer-less workspace tab does not reserve padding
- **WHEN** the user is on a Settings sub-tab that hides the sticky save bar (External Employees tab)
- **THEN** the content area MAY render without the bottom padding reservation
- **AND** the absence of the reservation SHALL NOT cause the tab body to expand the workspace shell beyond the viewport
