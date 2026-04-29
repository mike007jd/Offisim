## MODIFIED Requirements

### Requirement: Sizing primitive is centralized in `@offisim/ui-core/dialog-shell`

The canonical clamp expression and the Tabs flex-column className convention SHALL live as exported constants in `packages/ui-core/src/components/dialog-shell.tsx`: `DIALOG_SIZING_CLASS`, `DIALOG_TABS_ROOT_CLASS`, and `DIALOG_TABS_CONTENT_CLASS`. Touched dialogs SHALL import these constants rather than re-write the clamp expression or the `flex-1 min-h-0 overflow-y-auto` string. New dialogs added by future phases SHALL also import these constants. The `DialogShell` primitive's inner flex column SHALL itself apply `DIALOG_SIZING_CLASS` so any caller that wraps `DialogShell` inherits the contract for free. The previously listed `EmployeeEditorDialog` audit scenario no longer applies because the dialog has been removed in favor of the Personnel workspace surface; new dialogs that re-introduce a tabbed shell SHALL still import the three sizing constants.

The `DialogShell` primitive SHALL be the only modal Dialog primitive
shipped from `@offisim/ui-core`. The legacy
`packages/ui-core/src/components/dialog.tsx` and its `Dialog` /
`DialogContent` / `DialogHeader` / `DialogTitle` / `DialogDescription`
/ `DialogClose` exports SHALL NOT exist after this change. Every
product dialog SHALL import `DialogShell` from `@offisim/ui-core`.

#### Scenario: Sizing primitive constants are exported
- **WHEN** auditing `packages/ui-core/src/components/dialog-shell.tsx`
- **THEN** the file SHALL export `DIALOG_SIZING_CLASS`, `DIALOG_TABS_ROOT_CLASS`, and `DIALOG_TABS_CONTENT_CLASS` as string constants
- **AND** the file's `DialogShell` component's inner flex column SHALL apply `DIALOG_SIZING_CLASS`

#### Scenario: New tabbed dialog imports the constants
- **WHEN** a new dialog with internal Tabs is added in any future change
- **THEN** that file SHALL import `DIALOG_SIZING_CLASS`, `DIALOG_TABS_ROOT_CLASS`, and `DIALOG_TABS_CONTENT_CLASS` from `@offisim/ui-core`
- **AND** SHALL apply them to `DialogContent`, `Tabs.Root`, and every `TabsContent` respectively
- **AND** no string literal `clamp(360px,60vh,720px)` or `flex-1 min-h-0 overflow-y-auto` SHALL appear inline in the file

#### Scenario: EmployeeEditorDialog audit no longer applies
- **WHEN** searching the repository for `packages/ui-office/src/components/employees/EmployeeEditorDialog.tsx`
- **THEN** the file SHALL NOT exist
- **AND** the sizing audit that previously targeted it SHALL be considered obsolete; the Personnel surface inherits page-level scroll containers rather than a dialog clamp expression

#### Scenario: Legacy Dialog primitive is gone
- **WHEN** searching `packages/ui-core/src/components/` for `dialog.tsx`
- **THEN** the file SHALL NOT exist
- **AND** `packages/ui-core/src/index.ts` SHALL export only `DialogShell` (and `DialogShellClose`) as the Dialog primitive

### Requirement: Dialog size preset map covers `xs` through `full`

The `SIZE_CLASS` map in `dialog-shell.tsx` SHALL declare the following
size keys and Tailwind max-width classes:

| Size key | Tailwind class | Effective max-width |
|---|---|---|
| `xs` | `max-w-xs` | 20rem / 320px |
| `sm` | `max-w-sm` | 24rem / 384px |
| `md` | `max-w-lg` | 32rem / 512px |
| `lg` | `max-w-2xl` | 42rem / 672px |
| `xl` | `max-w-4xl` | 56rem / 896px |
| `full` | `max-w-[min(960px,calc(100vw-2rem))]` | clamp |

The `DialogSize` TypeScript union SHALL be `'xs' | 'sm' | 'md' | 'lg'
| 'xl' | 'full'`. Callers SHALL pick from this set; caller `className`
SHALL NOT override `max-width` (callers MAY adjust other surface
properties such as background colour and border).

#### Scenario: SIZE_CLASS includes xs preset
- **WHEN** auditing `dialog-shell.tsx`'s `SIZE_CLASS` constant
- **THEN** the map SHALL include the entry `xs: 'max-w-xs'`
- **AND** the `DialogSize` type SHALL include `'xs'` in its union

#### Scenario: Confirm-style dialog uses xs
- **WHEN** a future small confirm dialog (e.g. delete confirmation) is added
- **THEN** the caller SHALL pass `size="xs"` to `DialogShell` rather than overriding `className` with `max-w-xs`

#### Scenario: PublishDialog uses xl preset
- **WHEN** auditing `packages/ui-office/src/components/marketplace/PublishDialog.tsx`
- **THEN** the `DialogShell` invocation SHALL pass `size="xl"`
- **AND** the file SHALL NOT contain `max-w-3xl` or `max-h-[calc(100vh-2rem)]` directly on `DialogShell` content

### Requirement: Dialogs ship a sticky three-region layout

Every dialog rendered through `DialogShell` SHALL render with the
following region structure inside the inner flex column:

1. **Header region** (top, sticky): rendered when `title`,
   `description`, or `showCloseButton` is set; contains title,
   description, and the close X button. The header SHALL have
   `border-b` (visual divider) and SHALL NOT scroll.
2. **Body region** (middle, scrolls): rendered for `children`;
   `flex-1 min-h-0 overflow-y-auto` so it is the only scrollable
   region in the dialog.
3. **Footer region** (bottom, sticky): rendered when `footer` is
   provided; contains action buttons (Cancel, Submit, etc.). The
   footer SHALL have `border-t` (visual divider) and SHALL NOT scroll.

Caller-provided `className` SHALL NOT introduce additional
`overflow-y-auto` on `DialogShell`'s outer content. The only scroll
container in a dialog SHALL be the body region.

The body region SHALL reserve enough bottom padding so the last form
field, validation message, or preview is fully visible above the
sticky footer at every supported viewport. Because `DIALOG_SIZING_CLASS`
clamps the dialog max-height to the viewport and the body uses
`flex-1 min-h-0`, the footer is automatically sticky at the dialog
bottom; the spacing requirement is satisfied by the body's natural
bottom padding (`py-4` per current shell implementation) without
additional reservation.

#### Scenario: Dialog body owns the only scroll
- **WHEN** opening any dialog with a long body (e.g. `PublishDialog` filled past 1 viewport height)
- **THEN** the dialog body region SHALL scroll vertically
- **AND** the dialog header, footer, and outer content SHALL NOT scroll
- **AND** `getComputedStyle(headerEl).overflowY` SHALL be `'visible'` and `getComputedStyle(footerEl).overflowY` SHALL be `'visible'`

#### Scenario: Footer stays visible while body scrolls
- **WHEN** the user scrolls the body region of `PublishDialog` to the bottom at viewport `1024×600`
- **THEN** the footer (Submit / Download / Cancel button row) SHALL remain visible at the bottom of the dialog
- **AND** the last form field SHALL be reachable above the footer

#### Scenario: PublishDialog inline overflow is removed
- **WHEN** auditing `PublishDialog.tsx`
- **THEN** the file SHALL NOT apply `max-h-[calc(100vh-2rem)]` or `overflow-y-auto` directly to `DialogShell`'s content
- **AND** the Submit / Download row SHALL be rendered via `DialogShell`'s `footer` prop, not inline at the bottom of the body

### Requirement: Dialogs declare clamp-based min and max height

Every modal dialog and full-screen overlay touched by this capability SHALL declare both `min-height` and `max-height` using viewport-clamp expressions on the outer dialog container, so the outer height never collapses below a readable floor and never exceeds the visible viewport. Recommended canonical clamp on **modal dialogs** (Employee Editor, future small/medium modals): `min-height: clamp(360px, 60vh, 720px)` and `max-height: min(720px, 92vh)`. **Full-screen overlay surfaces** (Company creation wizard, Company Profile / Studio Profile editor) MAY satisfy the contract via `fixed inset-0` positioning or explicit `h-[calc(100vh-…)]` — both pin the outer rendered height to the viewport, which trivially satisfies the floor and ceiling. Surfaces MUST NOT ship without either (a) a viewport-clamp expression on `min-height` + `max-height` or (b) viewport-pinned positioning that yields the same bounded height. Naked `max-height: 100vh` with no min-height SHALL NOT ship for modal dialogs.

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

### Requirement: Dialog renders responsively on narrow viewports (≤ 768 px)

`DialogShell` SHALL render with responsive width classes so 320px
viewports get usable interior width:

- Below the `sm` Tailwind breakpoint (`< 640px`), the dialog content
  SHALL apply `w-[calc(100%-1rem)]` (16px gutter on each side).
- At the `sm` breakpoint and above, the dialog content SHALL apply
  `sm:w-[calc(100%-2rem)]` (32px gutter on each side).

The built-in close X button SHALL meet WCAG 2.5.5 minimum touch target
(44×44 CSS pixels) on narrow tier:

- The visible button SHALL be `h-8 w-8` (32×32) for visual restraint.
- A `before:` pseudo-element SHALL extend the hit area to 44×44 on
  narrow tier (`before:absolute before:inset-[-6px]
  before:content-['']`), with the pseudo restricted to narrow tier
  via `sm:before:hidden` so desktop trackpad users get the visible
  32×32 only.
- The pseudo-element SHALL NOT capture pointer events outside the
  intended hit zone (`before:pointer-events-auto` only within the
  inset-[-6px] box; if needed, use `before:pointer-events-none` plus
  an outer wrapper).

Dialogs whose body composes side-by-side panes (e.g. avatar +
form) SHALL stack the panes vertically below the `lg` breakpoint
(`< 1024px`) so only one vertical scroller exists. Two stacked
vertical scrollers SHALL NOT ship in any dialog or full-screen
overlay covered by this change.

#### Scenario: Dialog interior width on iPhone-SE viewport
- **WHEN** a `DialogShell`-backed dialog is open at viewport `320×568` (iPhone SE)
- **THEN** the `DialogPrimitive.Content` element's computed `width` SHALL be `304px` (`100% - 1rem`)
- **AND** the dialog content SHALL have `≥ 16px` gutter on each side

#### Scenario: Close button hit area on narrow tier
- **WHEN** the dialog is open at viewport `≤ 640px` and the user clicks within `6px` of the visible close X edge
- **THEN** the close action SHALL fire (the `before:` pseudo-element extends the hit area)
- **AND** at viewport `> 640px` the hit area SHALL match the visible 32×32 button (no extension)

#### Scenario: EmployeeCreatorOverlay narrow tier stacks vertically
- **WHEN** `EmployeeCreatorOverlay` is open at viewport `≤ 1024px`
- **THEN** the avatar pane SHALL render as a horizontal header row at the top (height `≤ 120px`)
- **AND** the form pane SHALL render below the avatar pane with `flex-1 overflow-y-auto`
- **AND** there SHALL be exactly one vertical scrollbar in the overlay (the form pane's scrollbar)
- **AND** the avatar pane SHALL NOT have `max-h-[200px]` (the cap that previously capped the avatar pane on narrow tier is removed)

#### Scenario: EmployeeCreatorOverlay Back button checks dirty
- **WHEN** the user has typed any character into the name field of `EmployeeCreatorOverlay` and clicks Back
- **THEN** a discard-confirm toast SHALL appear (using the shared `discard-confirm-toast` helper)
- **AND** clicking `Discard` in the toast SHALL call the `onClose` prop
- **AND** clicking `Keep editing` SHALL dismiss the toast and leave the overlay open

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

### Requirement: Sizing contract is testable via DOM inspection

Every requirement in this capability SHALL be falsifiable by reading computed style on the rendered DOM (no runtime telemetry, no automated test required). Live agent verification SHALL inspect computed `min-height`, `max-height`, `overflow-y`, and `min-height: 0` on the documented selectors.

#### Scenario: Live verify uses computed style
- **WHEN** running live agent verification on a touched dialog
- **THEN** the verifier SHALL read `getComputedStyle(dialogOuter).minHeight`, `.maxHeight`, and the flex chain's `.minHeight` to confirm contract
- **AND** the verifier SHALL not rely on visual eyeballing alone for the height-stability checks
