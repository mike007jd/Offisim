## ADDED Requirements

### Requirement: Personnel inspector tabs SHALL use the V3 `.insp-tabs` bottom-rule chip-grammar

The 6-tab inspector (Profile / Appearance / Runtime / Skills / Memory / History) `TabsList` + `TabsTrigger` SHALL render in the V3 prototype's `.insp-tabs` / `.insp-tab` grammar. The tab strip is NOT a bordered, padded container box; it is a single horizontal rail with `border-bottom: 1px solid var(--line)` only, `padding: 0 var(--sp-5)` (16px horizontal, no vertical inner padding), `~44px` tall, `gap: 2px` between triggers, horizontally scrollable when it overflows.

Each `TabsTrigger` SHALL render as an `.insp-tab` chip: `28px` tall, `padding: 0 11px`, `border: 0`, `border-radius: var(--r-sm)` (7px — NOT `--r-md`), transparent background with `var(--ink-3)` text by default; hover applies a faint sunken background and `var(--ink-1)` text; the active trigger applies `background: var(--accent-surface)` with `color: var(--accent)` and a slightly heavier weight. Triggers SHALL NOT render as loose, unbounded text buttons (the prior `text-xs` `TabsTrigger`).

This requirement is `className`-only. The 6 `TabsContent` structure (each `forceMount` + `TABS_RETAIN_STATE_CLASS` + per-tab min-height budget) and the tab-switch layout stability SHALL be unchanged.

#### Scenario: Inspector tabs render as a bottom-rule chip rail

- **WHEN** an employee is selected and the inspector renders
- **THEN** the tab strip is a single rail with a `1px var(--line)` bottom rule and `var(--sp-5)` horizontal padding, with NO surrounding container border or 3px inner box padding
- **AND** each trigger is a `~28px` `var(--r-sm)`-radius chip
- **AND** the active trigger uses `var(--accent-surface)` background with `var(--accent)` text; inactive triggers are transparent with a faint hover background

#### Scenario: Tab content retention is preserved

- **WHEN** switching inspector tabs
- **THEN** all 6 `TabsContent` remain `forceMount` with state retained and the inspector rail height does not jump

### Requirement: Personnel detail header SHALL use V3 `--sp-5 / --sp-7` padding

The detail header SHALL adopt the prototype `.pd-head` padding `var(--sp-5) var(--sp-7)` (12px vertical / 16px horizontal), replacing the prior `px-6 py-4` (24px horizontal / 16px vertical). The header SHALL remain a horizontal information row (avatar left, name/role center, status/source chips right) — its existing horizontal structure is unchanged.

#### Scenario: Detail header padding is compact

- **WHEN** the detail header renders for a selected employee
- **THEN** its padding resolves to `--sp-5` vertical (12px) / `--sp-7` horizontal (16px), not the prior 24px horizontal

### Requirement: Personnel profile fields SHALL follow V3 caps-label + flow rhythm without card wrappers

Profile field groups SHALL render as a caps label (`.insp-sec-label` grammar) followed by a vertical field flow, with NO card wrapper around the group. Inputs SHALL be `~32px` tall with a `4–6px` label-to-field gap, matching the prototype `.prof-sec` / `.fld` / `.inp` grammar. This is the explicit V3 codification of the existing card-less profile layout; it introduces no new fields, no new save path, and no change to `useEmployeeEditor` binding.

#### Scenario: Profile fields are card-less flow

- **WHEN** the Profile tab renders
- **THEN** field groups present a caps label followed by a flow of fields, with no surrounding card container
- **AND** inputs are `~32px` tall with `4–6px` label gaps

### Requirement: Personnel 2D avatar SHALL change from `rounded-full` to a 26% block-style radius

The shared 2D employee avatar — `DicebearAvatar` (rendered for internal employees via the `EmployeeAvatar` wrapper) — currently hard-codes `rounded-full` (a full circle). This change SHALL replace that full-circle radius with a `~26%` block-style border-radius matching the prototype `.av` rule (`border-radius: 26%`).

This is an INTENTIONAL cross-surface change. `DicebearAvatar` is exported from `@offisim/ui-office` and is consumed by `EmployeeAvatar`, which renders on the Office scene roster, the Personnel list/detail/inspector, the Market detail, and the Employee Creator overlay. Editing the `rounded-full` token on `DicebearAvatar` restyles the internal-employee 2D avatar app-wide; this change OWNS that app-wide restyle to a single consistent 26% block style. The change SHALL NOT touch the external `BrandAvatar2D` path or the 3D block-figure renderer.

#### Scenario: Avatar uses block-style radius app-wide

- **WHEN** an internal-employee 2D avatar (`DicebearAvatar`) renders anywhere it is mounted (Personnel list / detail / inspector, Office scene roster, Market detail, Employee Creator)
- **THEN** its corner radius is `~26%` (block style), not `rounded-full`
- **AND** the radius is consistent across every surface that mounts `DicebearAvatar`

## MODIFIED Requirements

### Requirement: AppearanceTab 3D Canvas slot declares aspect-ratio before mount

`PreviewCard`'s content slot for the 3D preview in `AppearanceTab.tsx` SHALL pre-allocate the preview's space before the Three.js renderer mounts (`aspect-ratio: 256 / 200`, `min-height: 200px`, `max-width: 256px`), eliminating the 1–2 frame layout flash that would otherwise bump adjacent siblings (the 2D preview, the AvatarCustomizer column). The current implementation delivers this geometry through the named CSS class `avatar-preview-card` (defined in `apps/desktop/renderer/src/index.css` as `aspect-ratio: 256 / 200; max-width: 16rem; min-height: 12.5rem`) applied to the `PreviewCard` slot, NOT through inline Tailwind literals `aspect-[256/200] min-h-[200px] max-w-[256px]`. Either form satisfies this requirement so long as the slot resolves to the 256×200 aspect with the 200px / 256px floors. The `<Canvas>` element SHALL NOT declare `style={{ width, height }}` — R3F SHALL fill its parent slot; only `style={{ background: 'transparent' }}` SHALL remain.

#### Scenario: 3D preview slot declares aspect-ratio

- **WHEN** auditing `packages/ui-office/src/components/employees/personnel-tabs/AppearanceTab.tsx`
- **THEN** the `PreviewCard` slot wrapping the 3D `<Canvas>` SHALL resolve to `aspect-ratio: 256 / 200` with `min-height` 200px and `max-width` 256px (today via the `avatar-preview-card` class)
- **AND** `<Canvas>` SHALL NOT declare `style={{ width: 256, height: 200 }}` (only `style={{ background: 'transparent' }}` SHALL remain)

#### Scenario: 2D preview unaffected by 3D canvas mount

- **WHEN** the user activates the Appearance tab from a cold state
- **THEN** the 2D `BrandAvatar2D` / `DicebearAvatar` preview's pixel position SHALL be unchanged between T=0 (tab activated) and T=+200ms (3D canvas painted)

### Requirement: Personnel page grid SHALL use a layout that preserves min-height budget across responsive break

`PersonnelPage.tsx`'s outer container SHALL use a layout that maintains the same inspector min-height budget on both sides of the responsive break: a flex column at the narrow/tablet tier that switches to a 3-column desktop grid at the desktop tier. The 3-column desktop track SHALL be `280px | minmax(0,1fr) | minmax(0,420px)` (collapsing the left list rail to `64px` when collapsed). The current implementation expresses these grid tracks through named CSS classes — `grid-personnel-desktop-expanded`, `grid-personnel-desktop-collapsed`, `grid-personnel-tablet-expanded`, `grid-personnel-tablet-collapsed` (defined in `apps/desktop/renderer/src/index.css`) — selected by tier + collapse state, NOT through an inline `lg:grid-cols-[280px_minmax(0,1fr)_minmax(0,420px)]` literal. Either form satisfies this requirement so long as the desktop track resolves to `280px | 1fr | 420px` (or `64px | 1fr | 420px` collapsed) and the layout stacks vertically below the desktop break.

The right inspector pane SHALL retain a stable min-height floor regardless of tier; resizing across the desktop break SHALL NOT change the inspector's height budget. (The literal `min-h-[560px]` floor from the prior base wording is not present as an inline class in current code; this requirement asserts the behavioral floor — the inspector height does not change across the break — rather than a specific literal.)

#### Scenario: Resize across the desktop break does not shift inspector height

- **WHEN** the user resizes the Personnel page window across the desktop break (around 1280px width)
- **THEN** the inspector tabs region SHALL maintain a stable min-height on both sides of the break
- **AND** the page layout SHALL NOT cause the inspector's height to change in either direction

#### Scenario: Narrow tier stacks panes vertically with same height budget

- **WHEN** the viewport is below the desktop break and Personnel is open
- **THEN** the list rail, center detail, and right inspector SHALL stack vertically (flex column)
- **AND** the inspector pane in the stacked layout SHALL still apply the same min-height budget
