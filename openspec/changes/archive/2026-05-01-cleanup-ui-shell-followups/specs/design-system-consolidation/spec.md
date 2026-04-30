## MODIFIED Requirements

### Requirement: Shared UI primitives cover repeated surfaces
Touched UI surfaces SHALL use shared or equivalent primitives for `SurfaceCard`, `Toolbar`, `SegmentedControl`, `DialogShell`, `EmptyState`, `ErrorState`, and `EntityDropdown` instead of duplicating incompatible local patterns. The `EntityDropdown` primitive lives in `@offisim/ui-core` and renders the recurring "trigger row + scrollable item list + footer action" shape (current consumers: Header company switcher, project selector, Market mode/manage tabs).

#### Scenario: Touched empty states use shared primitive
- **WHEN** SOP, Market, Activity, Studio Properties, or Settings renders an empty/default/error state touched by this change
- **THEN** it uses the shared state primitive or a wrapper with the same title, reason, primary action, and secondary action contract

#### Scenario: Touched dialogs use shared shell
- **WHEN** Company Editor, Employee Creator, Studio, Dashboard, or other touched overlay renders as a modal/dialog
- **THEN** it uses `DialogShell` or an equivalent shared close/focus/action contract

#### Scenario: Entity-shaped dropdowns use shared primitive
- **WHEN** the Header company switcher, project selector, or Market mode/manage tab strip renders a dropdown that lists selectable entities with an active-id indicator and a footer "manage" action
- **THEN** the dropdown is rendered through `EntityDropdown` (or a thin wrapper that consumes it) rather than a hand-rolled `DropdownMenu` markup duplicate
- **AND** the trigger, item list, active-state badge, and footer action share the same accessible structure across all three call sites
