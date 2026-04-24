## ADDED Requirements

### Requirement: Shared UI primitives cover repeated surfaces
Touched UI surfaces SHALL use shared or equivalent primitives for `SurfaceCard`, `Toolbar`, `SegmentedControl`, `DialogShell`, `EmptyState`, and `ErrorState` instead of duplicating incompatible local patterns.

#### Scenario: Touched empty states use shared primitive
- **WHEN** SOP, Market, Activity, Studio Properties, or Settings renders an empty/default/error state touched by this change
- **THEN** it uses the shared state primitive or a wrapper with the same title, reason, primary action, and secondary action contract

#### Scenario: Touched dialogs use shared shell
- **WHEN** Company Editor, Employee Creator, Studio, Dashboard, or other touched overlay renders as a modal/dialog
- **THEN** it uses `DialogShell` or an equivalent shared close/focus/action contract

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
