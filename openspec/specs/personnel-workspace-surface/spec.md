# personnel-workspace-surface

## Purpose

Personnel is a sixth peer-level workspace addressable by `WorkspaceKey === 'personnel'`. It replaces the legacy `EmployeeEditorDialog` with a three-pane page (employee list rail / detail+preview / 6-tab inspector) that hosts every cross-surface "edit employee" entry and gives future appearance / runtime / skills / memory work a real container instead of a modal. All "edit employee" surfaces — Office Roster (via `EmployeeInspector`), Office keyboard shortcut, Settings → External Employees row — route through a single `routeToPersonnel(employeeId, tab?)` helper that atomically switches `activeWorkspace` to `'personnel'` and writes `selectedEmployeeId` + `activeEmployeeTab` into `WorkspaceSessionState.personnel`. Profile tab carries the prior dialog form intact so users keep edit capability in the C0 → C1 window; Appearance / Runtime / Skills land as labeled placeholder shells; Memory / History reuse the existing `MemoryPanel` and `VersionHistoryTab` primitives. `EmployeeEditorDialog` is removed and `useRegisterModal('employee-editor', ...)` no longer fires.
## Requirements
### Requirement: Personnel is a peer workspace
Personnel SHALL be a first-class peer-level workspace addressable by `WorkspaceKey === 'personnel'`. It SHALL render through the single `AppLayout` shell as `centerContent`, with `agentPanel`, `sceneCanvas`, `chatDrawer`, and `eventLog` set to `null`. There SHALL be exactly six peer-level workspaces — `office | sops | market | personnel | activity-log | settings` — in this canonical order.

#### Scenario: Personnel renders inside AppLayout center
- **WHEN** `activeWorkspace === 'personnel'` and no overlay is open
- **THEN** `AppLayout` SHALL receive `centerContent` populated by `WorkspaceRouter`'s Personnel branch
- **AND** `agentPanel`, `sceneCanvas`, `chatDrawer`, `eventLog` SHALL all be `null`
- **AND** `StatusBar` SHALL remain visible

#### Scenario: Header peer navigation enumerates six peers
- **WHEN** Header renders peer workspace navigation in any workspace mode
- **THEN** the order SHALL be `Office | SOPs | Market | Personnel | Activity | Settings`
- **AND** Personnel SHALL render with the same chip style affordance as the other peers when active

### Requirement: Personnel page uses three-pane IA
The Personnel page SHALL present three regions: a left employee list, a center detail+preview region, and a right inspector with six tabs (`Profile | Appearance | Runtime | Skills | Memory | History`). The layout SHALL collapse responsively per `responsive-app-shell` tier rules.

#### Scenario: Desktop renders three panes side by side
- **WHEN** the viewport is `1440x900` and `activeWorkspace === 'personnel'`
- **THEN** the page SHALL render the list rail, the center detail+preview, and the right tabs inspector concurrently
- **AND** each pane SHALL scroll independently without horizontal page overflow

#### Scenario: Tablet collapses one rail at a time
- **WHEN** the viewport is `1280x800` and `activeWorkspace === 'personnel'` with no employee selected
- **THEN** the list and a "Select an employee" placeholder SHALL render
- **WHEN** an employee is selected at `1280x800`
- **THEN** the list MAY collapse behind a toggle and the detail + tabs inspector SHALL be visible

#### Scenario: Narrow stacks panes vertically
- **WHEN** the viewport is `390x844` and `activeWorkspace === 'personnel'`
- **THEN** the list, detail, and tabs SHALL stack as sequential views with a clear back affordance between levels
- **AND** `document.documentElement.scrollWidth` SHALL be ≤ `window.innerWidth`

### Requirement: Personnel session state is workspace-owned
Personnel UI state SHALL live in a `PersonnelSessionState` slice of `WorkspaceSessionState` containing `selectedEmployeeId: string | null` and `activeEmployeeTab: PersonnelTabId`. `PersonnelTabId` is the union `'profile' | 'appearance' | 'runtime' | 'skills' | 'memory' | 'history'`. All writes SHALL go through `updateWorkspaceState('personnel', updater)`.

#### Scenario: Default session state
- **WHEN** the app starts and no Personnel state has been written yet
- **THEN** `state.personnel.selectedEmployeeId` SHALL be `null`
- **AND** `state.personnel.activeEmployeeTab` SHALL be `'profile'`

#### Scenario: Selecting an employee writes through updateWorkspaceState
- **WHEN** the user clicks an employee row in the Personnel list
- **THEN** the page SHALL call `updateWorkspaceState('personnel', prev => ({ ...prev, selectedEmployeeId: id }))`
- **AND** SHALL NOT use a local `useState` setter for `selectedEmployeeId`

#### Scenario: Switching tabs writes through updateWorkspaceState
- **WHEN** the user clicks the `Skills` tab in the right inspector
- **THEN** the page SHALL call `updateWorkspaceState('personnel', prev => ({ ...prev, activeEmployeeTab: 'skills' }))`

### Requirement: Cross-surface edit routes to Personnel
Every UI surface that exposes "Edit employee" or "Open employee details" SHALL route the user to Personnel via a shared `routeToPersonnel(employeeId, tab?)` helper. The helper SHALL atomically `setActiveWorkspace('personnel')` and `updateWorkspaceState('personnel', prev => ({ ...prev, selectedEmployeeId, activeEmployeeTab: tab ?? 'profile' }))`. No surface SHALL open `EmployeeEditorDialog` or any other modal in response to "edit employee".

#### Scenario: Office Roster edit routes to Personnel
- **WHEN** the user clicks the Edit affordance on an employee card in the Office Roster
- **THEN** `activeWorkspace` SHALL become `'personnel'`
- **AND** `state.personnel.selectedEmployeeId` SHALL equal the clicked employee's id
- **AND** `state.personnel.activeEmployeeTab` SHALL equal `'profile'`
- **AND** no dialog or overlay SHALL open

#### Scenario: EmployeeInspector "open editor" routes to Personnel
- **WHEN** the user activates `onOpenEditor` from `EmployeeInspector`
- **THEN** the same `routeToPersonnel(id, 'profile')` SHALL run
- **AND** the inspector SHALL not call any `EmployeeEditorDialog` open API

#### Scenario: Settings External Employees row edit routes to Personnel
- **WHEN** the user clicks Edit on a row in Settings → External Employees tab
- **THEN** `routeToPersonnel(employeeId, 'profile')` SHALL run

#### Scenario: Office keyboard shortcut for selected employee routes to Personnel
- **WHEN** `activeWorkspace === 'office'`, `office.selectedEmployeeId` is non-null, and the user presses the Edit Employee shortcut
- **THEN** `routeToPersonnel(office.selectedEmployeeId, 'profile')` SHALL run
- **AND** no `EmployeeEditorDialog` SHALL open

### Requirement: Personnel back navigation unwinds tab then selection
`tryWorkspaceInternalBack('personnel', sessionState)` SHALL unwind in this order: (1) if `activeEmployeeTab !== 'profile'`, set tab to `'profile'`; (2) else if `selectedEmployeeId !== null`, clear selection; (3) else return `[false, sessionState]` so workspace-level back navigation runs.

#### Scenario: Back from non-profile tab returns to Profile
- **WHEN** `state.personnel.activeEmployeeTab === 'skills'` and the user activates Back / Escape
- **THEN** `activeEmployeeTab` SHALL become `'profile'`
- **AND** `selectedEmployeeId` SHALL NOT change
- **AND** `activeWorkspace` SHALL remain `'personnel'`

#### Scenario: Back from profile tab clears selection
- **WHEN** `state.personnel.activeEmployeeTab === 'profile'` and `selectedEmployeeId` is non-null
- **THEN** Back / Escape SHALL set `selectedEmployeeId` to `null`
- **AND** `activeWorkspace` SHALL remain `'personnel'`

#### Scenario: Back from empty Personnel exits workspace
- **WHEN** `selectedEmployeeId === null` and the user activates Back
- **THEN** `tryWorkspaceInternalBack` SHALL return `[false, _]` and workspace-level history SHALL pop

### Requirement: Profile tab carries forward existing edit content

The `Profile` tab SHALL render the form fields that were previously hosted by `EmployeeEditorDialog` *except for appearance editing*: identity (name / role / status / workstation assignment), persona (expertise, style, communication frequency, risk preference, decision style, custom instructions), config (provider / model / temperature / max tokens / skill bindings / tool permissions), and the system-prompt preview disclosure. The tab SHALL save through the existing `useEmployeeEditor` `save()` and `updateField()` API. Appearance editing has moved to the `Appearance` tab.

#### Scenario: Saving from Profile tab persists employee changes
- **WHEN** the user changes the role in the Profile tab and clicks Save
- **THEN** `useEmployeeEditor.save()` SHALL run
- **AND** the employee row SHALL update in the repository
- **AND** the list rail SHALL reflect the new role on next render

#### Scenario: Delete confirm renders inline in Profile tab
- **WHEN** the user clicks Delete on the Profile tab
- **THEN** an inline confirm affordance SHALL appear inside the Profile tab content
- **AND** no separate dialog modal SHALL open

#### Scenario: Profile tab does not host AvatarCustomizer
- **WHEN** the Profile tab renders for either an internal or external employee
- **THEN** no `AvatarCustomizer` component SHALL render inside the Profile tab
- **AND** no `data-testid="external-avatar-disabled"` banner SHALL render inside the Profile tab
- **AND** the user SHALL find appearance controls in the `Appearance` tab instead

### Requirement: Appearance, Runtime, Skills tabs are placeholder shells

The `Skills` tab SHALL render as a labelled placeholder shell that announces its planned capability. It SHALL NOT include forms, controls, or edits; its content is delivered by a follow-up change. The tab trigger SHALL be visible and selectable so the IA shell is verifiable.

The `Appearance` tab is no longer a placeholder shell — see capability `personnel-appearance-live-preview`.

The `Runtime` tab is no longer a placeholder shell — see capability `personnel-runtime-engine-binding`.

#### Scenario: Skills tab renders placeholder copy
- **WHEN** the user activates the Skills tab
- **THEN** the tab content SHALL render a heading "Skills" with a status note that the in-Personnel skills experience is pending
- **AND** the existing `SkillBindingList` MAY be rendered as read-only context but SHALL NOT support edits

#### Scenario: Appearance tab is no longer a placeholder
- **WHEN** the user activates the Appearance tab
- **THEN** the tab content SHALL render the live customizer + preview surface defined in capability `personnel-appearance-live-preview`
- **AND** SHALL NOT render the `PlaceholderTab` shell

#### Scenario: Runtime tab is no longer a placeholder
- **WHEN** the user activates the Runtime tab
- **THEN** the tab content SHALL render the binding control surface defined in capability `personnel-runtime-engine-binding`
- **AND** SHALL NOT render the `PlaceholderTab` shell

### Requirement: Memory and History tabs preserve existing content
The `Memory` and `History` tabs SHALL render the same content the dialog previously rendered for those sections. No new editing behavior is introduced in this change.

#### Scenario: Memory tab renders existing memory snapshot
- **WHEN** the user activates the Memory tab
- **THEN** the panel SHALL render the same memory snapshot view shown by `EmployeeEditorDialog` prior to this change

#### Scenario: History tab renders existing run history list
- **WHEN** the user activates the History tab
- **THEN** the panel SHALL render the same run history list shown by `EmployeeEditorDialog` prior to this change

### Requirement: EmployeeEditorDialog is removed
`EmployeeEditorDialog` SHALL not exist in the codebase as an importable component or as a render branch. `useEmployeeEditor` MAY remain as a hook for the Profile tab but SHALL NOT expose dialog-only fields (`isOpen`, `close`) when reused outside Personnel.

#### Scenario: No remaining import of EmployeeEditorDialog
- **WHEN** grepping the repository for `EmployeeEditorDialog` outside `git log`, archived openspec changes, and dist artifacts
- **THEN** zero matches exist

#### Scenario: AppGlobalDialogs no longer mounts EmployeeEditorDialog
- **WHEN** auditing `apps/web/src/components/app-shell/AppGlobalDialogs.tsx`
- **THEN** the file SHALL NOT contain `<EmployeeEditorDialog />` or accept an `employeeEditor` prop wired to it

#### Scenario: useRegisterModal not called for employee-editor
- **WHEN** auditing the codebase for `useRegisterModal('employee-editor', ...)`
- **THEN** zero matches exist

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

