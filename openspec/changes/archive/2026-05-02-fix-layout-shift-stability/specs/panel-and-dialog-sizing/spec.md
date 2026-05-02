## MODIFIED Requirements

### Requirement: Tab switches do not change outer dialog height

When a touched dialog contains a `Tabs.Root` (or equivalent tabbed region), switching tabs SHALL NOT change the dialog outer container's rendered height. The internal scroll container — `Tabs.Content` or its first scrollable descendant — SHALL be the only element whose vertical extent or scroll offset changes when tab content length changes.

Additionally, every `Tabs.Content` inside a touched dialog SHALL declare a `min-height: 320px` floor (via `DIALOG_TABS_CONTENT_CLASS`) so that an empty or async-loading tab body does NOT visibly deflate the dialog while content is pending.

#### Scenario: Employee Editor tab switch leaves outer height stable

- **WHEN** Employee Editor is open and the user clicks from a short tab (e.g. Profile) to a long tab (e.g. Skills)
- **THEN** the dialog outer container's computed `height` SHALL be identical before and after the tab change
- **AND** the long tab's overflow content SHALL be reachable by scrolling inside the tab content region

#### Scenario: Tabs.Content owns the internal scroll

- **WHEN** a touched dialog renders `Tabs.Content`
- **THEN** that `Tabs.Content` element SHALL have `flex: 1 1 0%`, `min-height: 320px`, and `overflow-y: auto`
- **AND** the dialog outer container, `Tabs.Root`, and `Tabs.List` SHALL NOT have `overflow-y: auto`

#### Scenario: Empty tab body does not deflate dialog

- **WHEN** a tab body inside a touched dialog renders no content (placeholder shell or async-loading state)
- **THEN** the active `Tabs.Content` SHALL maintain a rendered `height` of at least 320 px
- **AND** the dialog outer container SHALL NOT visibly shrink during the empty-body window

## ADDED Requirements

### Requirement: `DIALOG_TABS_CONTENT_CLASS` SHALL declare min-height floor of 320 px

The `DIALOG_TABS_CONTENT_CLASS` constant exported from `packages/ui-core/src/components/dialog-shell.tsx` SHALL be the literal string `'flex-1 min-h-[320px] overflow-y-auto'`. The previous value `'flex-1 min-h-0 overflow-y-auto'` SHALL be replaced; `min-h-0` is incompatible with the layout-shift contract because it allows tab bodies to collapse to zero on empty content.

The 320 px value is empirical, derived from the floor of all current dialog tab bodies (Project create ≈ 220 px, Studio Asset inspector ≈ 280 px, Settings legacy dialogs ≈ 320 px). Future dialog tab bodies SHALL design within this floor or revisit the constant in a follow-up change.

#### Scenario: Constant value matches contract

- **WHEN** auditing `packages/ui-core/src/components/dialog-shell.tsx`
- **THEN** `DIALOG_TABS_CONTENT_CLASS` SHALL be exported as `'flex-1 min-h-[320px] overflow-y-auto'`
- **AND** zero matches for the legacy literal `'flex-1 min-h-0 overflow-y-auto'` SHALL exist in the file

#### Scenario: Change F may revisit the floor

- **WHEN** a future change identifies a dialog tab body that legitimately requires < 320 px floor (e.g. a tiny confirm dialog with Tabs)
- **THEN** that change MAY update the constant value with a written rationale
- **AND** SHALL re-audit all existing callers for the new floor

### Requirement: `TABS_RETAIN_STATE_CLASS` SHALL be exported as the SSOT for state-preserving Tabs

`packages/ui-core/src/components/dialog-shell.tsx` SHALL export a sibling constant `TABS_RETAIN_STATE_CLASS` with value `'data-[state=inactive]:hidden'`. This constant SHALL be used in conjunction with the Radix `forceMount` prop on `<TabsContent>` to keep all Tabs mounted in the DOM and toggle visibility — the canonical pattern for state-preserving Tabs and layout-stable Tabs.

Touched dialogs and panels that use state-preserving Tabs SHALL apply this constant via `cn(...)` rather than inlining the literal `'data-[state=inactive]:hidden'`.

The two SSOT constants pair as follows:

- `forceMount + TABS_RETAIN_STATE_CLASS`: state-preserving (Personnel inspector, RightSidebar, Settings sub-tabs, future Tabs with embedded canvas / iframe / heavy content).
- `DIALOG_TABS_CONTENT_CLASS` alone (no `forceMount`): default Radix unmount, cheap rebuild, no shift / state concern.

Both constants SHALL be documented via JSDoc in `dialog-shell.tsx` describing when to use which.

#### Scenario: Constant is exported and importable

- **WHEN** importing `TABS_RETAIN_STATE_CLASS` from `@offisim/ui-core`
- **THEN** the import SHALL resolve to a `string` constant equal to `'data-[state=inactive]:hidden'`
- **AND** the constant SHALL be co-exported with `DIALOG_TABS_CONTENT_CLASS` and `DIALOG_TABS_ROOT_CLASS`

#### Scenario: JSDoc documents the policy pair

- **WHEN** auditing `packages/ui-core/src/components/dialog-shell.tsx`
- **THEN** JSDoc on `TABS_RETAIN_STATE_CLASS` SHALL describe its pairing with `forceMount` for state-preserving Tabs
- **AND** JSDoc SHALL reference the `layout-shift-stability` capability for the rationale

#### Scenario: Touched callers use the constant, not literals

- **WHEN** auditing `packages/ui-office/src/components/employees/PersonnelPage.tsx` and `packages/ui-office/src/components/layout/RightSidebar.tsx` after this change
- **THEN** zero matches for the literal string `'data-[state=inactive]:hidden'` SHALL exist
- **AND** every `<TabsContent forceMount>` SHALL apply `TABS_RETAIN_STATE_CLASS` via `cn(...)`

### Requirement: Motion duration SHALL bind to `--motion-duration-base` token (interim)

The 200 ms duration applied to dialog enter/exit (currently the literal `duration-200` Tailwind class at `dialog-shell.tsx:138`) SHALL be documented via JSDoc as the literal binding of the `--motion-duration-base` custom property declared in `apps/web/src/index.css`. The Tailwind class SHALL remain literal in this change (no Tailwind theme rewrite); Change F (`unify-design-token-system`) is responsible for rebinding the class to a Tailwind theme token that resolves to the variable.

Three custom properties SHALL be declared in `apps/web/src/index.css` `:root`:

- `--motion-duration-fast: 120ms`
- `--motion-duration-base: 200ms`
- `--motion-duration-slow: 320ms`
- `--motion-easing-standard: cubic-bezier(0.2, 0, 0, 1)`

The `list-item-in` keyframe in the same CSS file SHALL bind to `var(--motion-duration-base)` and `var(--motion-easing-standard)`.

#### Scenario: Motion tokens declared

- **WHEN** auditing `apps/web/src/index.css` `:root` block
- **THEN** the four motion custom properties SHALL be declared
- **AND** the `list-item-in` keyframe rule SHALL use `var(--motion-duration-base)` and `var(--motion-easing-standard)`

#### Scenario: DialogShell duration documented

- **WHEN** auditing `packages/ui-core/src/components/dialog-shell.tsx` near the `duration-200` Tailwind class
- **THEN** a JSDoc note SHALL document that 200 ms maps to `var(--motion-duration-base)` and that Change F will rebind via Tailwind theme
- **AND** the literal `duration-200` Tailwind class SHALL remain as-is until Change F lands

### Requirement: New panels with internal Tabs SHALL import the SSOT constants from `@offisim/ui-core`

Any new panel, dialog, or workspace surface added in future changes that includes a `Tabs.Root` SHALL import `TABS_RETAIN_STATE_CLASS` and / or `DIALOG_TABS_CONTENT_CLASS` from `@offisim/ui-core` rather than inline the class strings.

Inline literals of `'data-[state=inactive]:hidden'` or `'flex-1 min-h-[320px] overflow-y-auto'` outside the SSOT module SHALL be flagged in code review.

#### Scenario: Future Tabs caller imports constants

- **WHEN** a new component with internal Tabs is added in a future change
- **THEN** the file SHALL import the SSOT constants from `@offisim/ui-core`
- **AND** SHALL apply them via `cn(...)` or direct className binding
- **AND** zero inline literals of the SSOT class strings SHALL appear in the file
