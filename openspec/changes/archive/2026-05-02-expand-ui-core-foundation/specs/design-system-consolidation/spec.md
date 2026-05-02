## MODIFIED Requirements

### Requirement: Shared UI primitives cover repeated surfaces

Touched UI surfaces SHALL use shared or equivalent primitives for application-level atomic components rather than duplicating incompatible local patterns. The required primitive surface SHALL include — in addition to the previously listed `SurfaceCard`, `Toolbar`, `SegmentedControl`, `DialogShell`, `EmptyState`, `ErrorState` — the following ui-core exports:

- `Button` (with `isLoading` for async actions), `Input` / `Textarea` / `SelectTrigger` (with `error` + `helperText`), `Checkbox`, `RadioGroup` + `RadioGroupItem`, `Switch`
- `Tooltip` + `TooltipProvider` (one Provider mounted at the app root), `Popover` + `PopoverTrigger` + `PopoverContent`
- `Avatar` (cosmetic frame; brand-specific avatar dispatchers like `EmployeeAvatar` compose this)
- `Card` + `CardHeader` + `CardTitle` + `CardContent` + `CardFooter`, `Badge` (with `size` variants and `dismissible` affordance), `Progress` (with `size` and `tone`), `Alert`, `DropdownMenu` + `DropdownMenuItem` (with `destructive` variant)

Hand-rolled tooltips (native `title=` on icon-only buttons or status badges), hand-rolled popovers (floating `<div>` with manual outside-click + Escape), hand-rolled radio cards (`<button role="radio">` workaround), and raw HTML form elements (`<button>`, `<input>`, `<textarea>`, `<select>`) SHALL NOT appear on touched surfaces when a ui-core equivalent exists.

#### Scenario: Touched empty states use shared primitive
- **WHEN** SOP, Market, Activity, Studio Properties, or Settings renders an empty/default/error state touched by this change
- **THEN** it uses the shared state primitive or a wrapper with the same title, reason, primary action, and secondary action contract

#### Scenario: Touched dialogs use shared shell
- **WHEN** Company Editor, Employee Creator, Studio, Dashboard, or other touched overlay renders as a modal/dialog
- **THEN** it uses `DialogShell` or an equivalent shared close/focus/action contract

#### Scenario: Touched icon-only buttons use Tooltip not title=
- **WHEN** a touched surface renders an icon-only button or status badge whose meaning would otherwise rely on hover-only tooltip text
- **THEN** it wraps the button in `<Tooltip><TooltipTrigger asChild>...</TooltipTrigger><TooltipContent>...</TooltipContent></Tooltip>` and does NOT use the native `title=` attribute

#### Scenario: Touched popovers use ui-core Popover
- **WHEN** a touched surface renders a floating panel anchored to a click target (e.g. inline editor, dropdown form, color picker)
- **THEN** it uses `Popover` + `PopoverTrigger` + `PopoverContent` (or `PopoverAnchor` for virtual anchoring), not a hand-rolled `<div>` with manual outside-click and Escape handlers

#### Scenario: Touched radio groups use ui-core RadioGroup
- **WHEN** a touched surface renders a single-selection group with rich-card visuals or plain radios
- **THEN** it uses `RadioGroup` + `RadioGroupItem` (with `asChild` for rich cards), not `<button role="radio">` cards

#### Scenario: Touched form fields with errors use error+helperText
- **WHEN** a touched form field needs to indicate a validation error
- **THEN** it sets `error` and `helperText` on `Input` / `Textarea` / `SelectTrigger`, not a separate `<Badge variant="error">` rendered next to the field

### Requirement: Visual tokens are constrained on touched surfaces

Touched surfaces SHALL use the design system spacing, radius, border, and typography tokens where available. Large all-caps labels, monospaced text, heavy glass effects, and cyan highlights SHALL be reserved for metadata, active states, or high-priority status rather than applied uniformly across an entire screen.

Form rows mixing `Input`, `Textarea`, `Select`, and `Button` SHALL baseline-align — `Input` and `SelectTrigger` share `h-9` outer + `py-1.5` inner padding so the text baseline matches.

#### Scenario: Primary content is not all metadata styling
- **WHEN** a touched workspace renders primary headings, form labels, or action text
- **THEN** the text uses normal readable casing and standard typography unless it is metadata

#### Scenario: Accent color indicates priority
- **WHEN** cyan or equivalent bright accent styling appears on a touched screen
- **THEN** it indicates active selection, primary action, status, or focused control rather than decorating every card equally

#### Scenario: Form rows baseline-align Input and Select
- **WHEN** a touched form renders an Input and a Select side by side
- **THEN** their text baselines align within 1px (both `h-9` + `py-1.5`)

### Requirement: Cards and toolbars have stable dimensions

Interactive cards, toolbar buttons, segmented controls, board columns, scene controls, and footer actions touched by this change SHALL use stable dimensions or responsive constraints so hover states, selected states, labels, and icons do not shift layout.

`Button isLoading` SHALL preserve width — the loading spinner replaces the leading-icon slot or appears before text without pushing it; loading state does NOT cause horizontal layout shift on the row.

#### Scenario: Toolbar state does not resize layout
- **WHEN** the user toggles 2D/3D, Dashboard, Kanban, or Studio tool state
- **THEN** the Header or toolbar layout does not shift enough to hide adjacent controls

#### Scenario: Button labels fit narrow containers
- **WHEN** touched buttons render at `390px` viewport width
- **THEN** labels fit through wrapping, truncation, icon-only affordance with accessible label, or responsive grouping

#### Scenario: Loading button does not shift row
- **WHEN** a button on a form row toggles `isLoading` from false to true
- **THEN** the row's other elements do not move; the button width is unchanged

### Requirement: Nested-card visual hierarchy is avoided

Touched page sections SHALL NOT render broad page sections as floating cards inside larger floating cards. Cards SHALL be reserved for repeated items, dialogs, or genuinely framed tools.

#### Scenario: Workspace body avoids card nesting
- **WHEN** a touched workspace renders its main body
- **THEN** the body uses full-width bands, panels, or constrained layouts rather than nested decorative card shells around every section
