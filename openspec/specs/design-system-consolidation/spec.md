# design-system-consolidation

## Purpose

Touched UI surfaces use a shared set of primitives (`SurfaceCard`, `Toolbar`, `SegmentedControl`, `DialogShell`, `EmptyState`, `ErrorState`, `EntityDropdown`) and constrained visual tokens (spacing, radius, border, typography) rather than duplicating incompatible local patterns. Accent styling (cyan, all-caps, monospaced, heavy glass) is reserved for metadata, active state, or high-priority status, and cards/toolbars use stable dimensions so hover/selected states do not reshuffle layout. Broad page sections are not wrapped as nested floating cards.

## Requirements

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

### Requirement: Visual tokens are constrained on touched surfaces
Touched surfaces SHALL use the design system spacing, radius, border, and typography tokens where available. Large all-caps labels, monospaced text, heavy glass effects, and cyan highlights SHALL be reserved for metadata, active states, or high-priority status rather than applied uniformly across an entire screen.

#### Scenario: Primary content is not all metadata styling
- **WHEN** a touched workspace renders primary headings, form labels, or action text
- **THEN** the text uses normal readable casing and standard typography unless it is metadata

#### Scenario: Accent color indicates priority
- **WHEN** cyan or equivalent bright accent styling appears on a touched screen
- **THEN** it indicates active selection, primary action, status, or focused control rather than decorating every card equally

### Requirement: Cards and toolbars have stable dimensions
Interactive cards, toolbar buttons, segmented controls, board columns, scene controls, and footer actions touched by this change SHALL use stable dimensions or responsive constraints so hover states, selected states, labels, and icons do not shift layout.

#### Scenario: Toolbar state does not resize layout
- **WHEN** the user toggles 2D/3D, Dashboard, Kanban, or Studio tool state
- **THEN** the Header or toolbar layout does not shift enough to hide adjacent controls

#### Scenario: Button labels fit narrow containers
- **WHEN** touched buttons render at `390px` viewport width
- **THEN** labels fit through wrapping, truncation, icon-only affordance with accessible label, or responsive grouping

### Requirement: Nested-card visual hierarchy is avoided
Touched page sections SHALL NOT render broad page sections as floating cards inside larger floating cards. Cards SHALL be reserved for repeated items, dialogs, or genuinely framed tools.

#### Scenario: Workspace body avoids card nesting
- **WHEN** a touched workspace renders its main body
- **THEN** the body uses full-width bands, panels, or constrained layouts rather than nested decorative card shells around every section
