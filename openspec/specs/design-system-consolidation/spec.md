# design-system-consolidation

## Purpose

Touched UI surfaces use a shared set of primitives (`SurfaceCard`, `Toolbar`, `SegmentedControl`, `DialogShell`, `EmptyState`, `ErrorState`, `EntityDropdown`) and constrained visual tokens (spacing, radius, border, typography) rather than duplicating incompatible local patterns. Accent styling (cyan, all-caps, monospaced, heavy glass) is reserved for metadata, active state, or high-priority status, and cards/toolbars use stable dimensions so hover/selected states do not reshuffle layout. Broad page sections are not wrapped as nested floating cards.
## Requirements
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

Touched surfaces SHALL use the design system spacing, radius, border, typography, color, shadow, z-index, and motion tokens from `@offisim/ui-core/tokens` (the canonical SSOT defined by the `design-token-foundation` capability). Tokens SHALL NOT be re-authored locally as JS objects, CSS custom properties, or arbitrary Tailwind values on touched surfaces.

Large all-caps labels, monospaced text, heavy glass effects, and accent (cyan / blue) highlights SHALL be reserved for metadata, active states, or high-priority status rather than applied uniformly across an entire screen.

Touched surfaces SHALL NOT contain raw hex literals (`#xxxxxx` outside the SSOT or catalog), arbitrary Tailwind shadow values (`shadow-[...]`), arbitrary Tailwind z-index values (`z-[...]`), or hard-coded transition/animation timings that do not reference `MOTION_DURATION` / `MOTION_EASING`. The `pnpm tokens:lint-hex` CI gate SHALL enforce this on the entire `apps/web/src/`, `packages/ui-office/src/`, `packages/ui-core/src/components/`, `packages/ui-core/src/lib/`, `packages/ui-core/src/hooks/`, and `packages/renderer/src/` source trees.

Touched surfaces SHALL render correctly in both `light` and `dark` resolved themes (per `theme-light-dark-switching`). When a touched component uses a semantic token (e.g. `bg-surface`, `text-text-primary`), the value SHALL automatically adapt without per-component `dark:` variant authoring.

#### Scenario: Primary content is not all metadata styling

- **WHEN** a touched workspace renders primary headings, form labels, or action text
- **THEN** the text uses normal readable casing and standard typography unless it is metadata

#### Scenario: Accent color indicates priority

- **WHEN** an accent color appears on a touched screen
- **THEN** it is sourced from `accent` / `accentMuted` / `accentText` / `accentHover` semantic tokens (not from a literal hex or a Tailwind palette literal like `cyan-400`) AND it indicates active selection, primary action, status, or focused control rather than decorating every card equally

#### Scenario: Touched surface tokens come from the SSOT

- **WHEN** auditing the source files of any touched surface for design token consumption
- **THEN** colors / shadows / spacing / radius / typography / motion / z-index values are imported from `@offisim/ui-core/tokens` or applied via Tailwind utility classes whose variables are defined in `apps/web/src/generated/tailwind-theme.css`

#### Scenario: Touched surface renders in both themes

- **WHEN** the user toggles between light and dark themes on a touched surface
- **THEN** every visible element repaints with the matching theme variant — no element stays at the previous theme's color, no element becomes unreadable due to missing variant

#### Scenario: No raw hex on touched surfaces

- **WHEN** running `pnpm tokens:lint-hex` after a touched surface change is committed
- **THEN** the gate exits with code 0 — no raw hex literal exists in the touched files outside `// raw-hex-allowed` escape hatches

#### Scenario: No arbitrary z-index or shadow on touched surfaces

- **WHEN** grepping touched surface files for `z-\[\d+\]` or `shadow-\[`
- **THEN** zero matches — touched surfaces use named `z-base` / `z-elevated` / `z-sticky` / `z-dropdown` / `z-modal` / `z-top` and `shadow-resting` / `shadow-hover` / `shadow-popover` / `shadow-overlay` / `shadow-modal` / `shadow-glow-{accent,success,warning,error}` Tailwind utilities

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

