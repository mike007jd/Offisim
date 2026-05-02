## ADDED Requirements

### Requirement: Settings tab nav does not render an inner collapse toggle

`SettingsTabNav` SHALL NOT render a collapse / expand toggle button on its vertical orientation. The Settings workspace SHALL rely on the existing workspace-level collapse handle (the right rail / left rail collapse mechanism on the app shell) for any panel-level collapse semantics; an additional inner collapse control on the Settings tab nav is redundant and visually conflicts with a back affordance. As a result, `SettingsTabNav` SHALL NOT accept `collapsed` or `onToggleCollapse` props, and SHALL NOT compute a `verticalCollapsed` visual state.

#### Scenario: Vertical Settings tab nav has no collapse button
- **WHEN** the Settings workspace renders at viewport `1440x900` with the vertical tab nav (`orientation='vertical'`)
- **THEN** `SettingsTabNav` SHALL render only the 4 Settings tab buttons (Provider / Runtime / MCP / External Employees)
- **AND** there SHALL NOT be any additional `<button>` rendered above the tab list for collapse / expand purposes
- **AND** there SHALL NOT be any chevron-only icon button at the top of the nav that toggles the nav width

#### Scenario: SettingsTabNav props do not expose collapse handlers
- **WHEN** auditing the public props of `SettingsTabNav` exported from `packages/ui-office/src/components/settings/SettingsTabNav.tsx`
- **THEN** the props type SHALL NOT include `collapsed?: boolean` or `onToggleCollapse?: () => void`
- **AND** no internal `verticalCollapsed` derived value SHALL be computed
- **AND** no consumer (`SettingsPage`, `SettingsWorkspaceSurface`, or `useSettingsWorkspaceController`) SHALL pass collapse-related props to it
