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
The `Profile` tab SHALL be functional in this change: it SHALL render the form fields that were previously hosted by `EmployeeEditorDialog` (identity, role, instructions, persona, model preference, tool permissions, workstation, memory snapshot, history list) so users retain end-to-end edit capability. The tab SHALL save through the existing `useEmployeeEditor` `save()` and `updateField()` API. Splitting Profile into more focused tabs (Appearance, Runtime, Skills) is deferred to subsequent changes.

#### Scenario: Saving from Profile tab persists employee changes
- **WHEN** the user changes the role in the Profile tab and clicks Save
- **THEN** `useEmployeeEditor.save()` SHALL run
- **AND** the employee row SHALL update in the repository
- **AND** the list rail SHALL reflect the new role on next render

#### Scenario: Delete confirm renders inline in Profile tab
- **WHEN** the user clicks Delete on the Profile tab
- **THEN** an inline confirm affordance SHALL appear inside the Profile tab content
- **AND** no separate dialog modal SHALL open

#### Scenario: External employee Profile tab keeps read-only banner
- **WHEN** the selected employee has `is_external === 1`
- **THEN** the Profile tab SHALL render the existing read-only banner indicating brand-managed avatar
- **AND** appearance fields SHALL be disabled

### Requirement: Appearance, Runtime, Skills tabs are placeholder shells
The `Appearance`, `Runtime`, and `Skills` tabs SHALL render in this change as labelled placeholder shells that announce their planned capability. They SHALL NOT include forms, controls, or edits; their content is delivered by follow-up changes (`personnel-appearance-live-preview`, `personnel-runtime-engine-binding`, future skills binding work). The tab triggers SHALL be visible and selectable so the IA shell is verifiable.

#### Scenario: Appearance tab renders placeholder copy
- **WHEN** the user activates the Appearance tab
- **THEN** the tab content SHALL render a heading "Appearance" with a one-line description and a status note that live preview ships in a follow-up change
- **AND** SHALL NOT render avatar editor controls

#### Scenario: Runtime tab renders placeholder copy
- **WHEN** the user activates the Runtime tab
- **THEN** the tab content SHALL render a heading "Runtime" with a status note that engine binding ships in a follow-up change

#### Scenario: Skills tab renders placeholder copy
- **WHEN** the user activates the Skills tab
- **THEN** the tab content SHALL render a heading "Skills" with a status note that the in-Personnel skills experience is pending
- **AND** the existing `SkillBindingList` MAY be rendered as read-only context but SHALL NOT support edits

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
