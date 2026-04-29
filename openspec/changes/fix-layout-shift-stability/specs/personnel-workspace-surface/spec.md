## ADDED Requirements

### Requirement: Personnel inspector wrapper declares min-height floor

The right-pane inspector wrapper that contains all six `TabsContent` SHALL declare `min-h-[560px]` so swapping between the six tabs (Profile, Appearance, Runtime, Skills, Memory, History) does NOT change the wrapper's rendered height.

The 560 px floor is derived from the height of the steady-state Appearance tab (the visually tallest fixed-height tab). Tabs whose content grows beyond the floor (Memory, History, Skills with many entries) SHALL scroll inside the tab body via `overflow-y: auto`, NOT expand the wrapper.

#### Scenario: Inspector wrapper computed minHeight is 560 px

- **WHEN** Personnel is open at 1440x900 with an internal employee selected
- **THEN** `getComputedStyle(personnelInspectorWrapper).minHeight` SHALL be `'560px'`
- **AND** the wrapper's `height` SHALL be at least 560 px regardless of which tab is active

#### Scenario: Tab swap leaves outer wrapper height unchanged

- **WHEN** the user clicks through Profile → Appearance → Runtime → Skills → Memory → History at 1440x900
- **THEN** the `height` of the inspector wrapper SHALL NOT change between adjacent tab swaps
- **AND** the surrounding Personnel page (list rail, detail header) SHALL NOT shift

### Requirement: Personnel TabsContent SHALL use `forceMount + TABS_RETAIN_STATE_CLASS`

All six `<TabsContent>` children of the Personnel inspector `<Tabs>` SHALL include the `forceMount` prop and SHALL apply the `TABS_RETAIN_STATE_CLASS` constant from `@offisim/ui-core` (i.e. `'data-[state=inactive]:hidden'` via the SSOT). All six SHALL ALSO declare `min-h-[520px]` per-tab to match the inspector wrapper budget minus trigger row.

This achieves three goals: (a) Profile tab unsaved edits survive tab swap (state preservation); (b) the layout pass runs once on first mount, so swapping tabs is instantaneous and does not bounce the wrapper; (c) the Appearance tab's R3F canvas stays warm and does not re-mount on tab return.

Inline literals of `'data-[state=inactive]:hidden'` SHALL NOT appear in `PersonnelPage.tsx`.

#### Scenario: All six TabsContent declare forceMount + retain-state

- **WHEN** auditing `packages/ui-office/src/components/employees/PersonnelPage.tsx`
- **THEN** every `<TabsContent value="...">` of the inspector `<Tabs>` SHALL include the `forceMount` prop
- **AND** every such `<TabsContent>` SHALL apply `TABS_RETAIN_STATE_CLASS` (e.g. via `cn(...)`)
- **AND** zero matches for the literal `'data-[state=inactive]:hidden'` SHALL exist in the file

#### Scenario: Profile unsaved edits survive tab swap

- **WHEN** the user types text into a Profile tab field, then clicks the Skills tab and back to Profile
- **THEN** the previously typed text SHALL still be present in the Profile tab field
- **AND** no re-initialization of the editor form from `formData` SHALL occur on tab return

#### Scenario: Appearance R3F canvas stays warm

- **WHEN** the user activates Appearance, then swaps to Runtime, then back to Appearance
- **THEN** the R3F canvas SHALL NOT re-mount on the second Appearance activation
- **AND** the visible canvas SHALL display the previously orbited camera position

### Requirement: AppearanceTab 3D Canvas slot declares aspect-ratio before mount

`PreviewCard` content slot for the 3D preview in `AppearanceTab.tsx` SHALL declare `aspect-[256/200] min-h-[200px] max-w-[256px]` on the parent slot. The `<Canvas>` element SHALL NOT declare `style={{ width, height }}` — R3F SHALL fill its parent slot.

This pre-allocates the 3D preview's space before the Three.js renderer mounts, eliminating the 1-2 frame layout flash that currently causes adjacent siblings (the 2D preview, the AvatarCustomizer column) to bump.

#### Scenario: 3D preview slot declares aspect-ratio

- **WHEN** auditing `packages/ui-office/src/components/employees/personnel-tabs/AppearanceTab.tsx`
- **THEN** the `PreviewCard` slot wrapping the 3D `<Canvas>` SHALL declare classes including `aspect-[256/200]`, `min-h-[200px]`, and `max-w-[256px]`
- **AND** `<Canvas>` SHALL NOT declare `style={{ width: 256, height: 200 }}` (only `style={{ background: 'transparent' }}` SHALL remain)

#### Scenario: 2D preview unaffected by 3D canvas mount

- **WHEN** the user activates the Appearance tab from a cold state
- **THEN** the 2D `BrandAvatar2D` / `DicebearAvatar` preview's pixel position SHALL be unchanged between T=0 (tab activated) and T=+200ms (3D canvas painted)

### Requirement: Personnel page grid SHALL use a layout that preserves min-height budget across responsive break

`PersonnelPage.tsx` outer container at the responsive `lg` (1280 px) break SHALL use a layout that maintains the same inspector min-height floor on both sides of the break. The implementation SHALL use a flex column at < lg that switches to a 3-column grid at ≥ lg:

```
className="flex h-full w-full flex-col lg:grid lg:grid-cols-[280px_minmax(0,1fr)_minmax(0,420px)]"
```

The right inspector `<section>` SHALL retain its `min-h-[560px]` regardless of tier; resizing across the 1280 px break SHALL NOT change the inspector's height budget.

#### Scenario: Resize across 1280 px break does not shift inspector height

- **WHEN** the user resizes the Personnel page window between 1270 px and 1290 px width
- **THEN** the inspector tabs region SHALL maintain `min-height: 560px` on both sides of the break
- **AND** the page layout SHALL NOT cause the inspector's height to change in either direction

#### Scenario: Narrow tier stacks panes vertically with same height budget

- **WHEN** the viewport is < 1280 px and Personnel is open
- **THEN** the list rail, center detail, and right inspector SHALL stack vertically (flex column)
- **AND** the inspector pane in the stacked layout SHALL still apply `min-h-[560px]`
