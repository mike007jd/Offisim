## MODIFIED Requirements

### Requirement: Global dialogs host is a single component
The render branches for `InstallDialog`, `CompanyEditor`, `KeyboardShortcutsDialog`, and both `CompanyCreationWizard` modes (`populate-existing` + `create-new`) SHALL live in `apps/web/src/components/app-shell/AppGlobalDialogs.tsx`. `App.tsx` SHALL NOT contain these JSX branches. `EmployeeEditorDialog` SHALL NOT be rendered from this file because the dialog has been removed in favor of the Personnel workspace.

#### Scenario: Dialog branches moved
- **WHEN** grepping `apps/web/src/App.tsx` for `<InstallDialog` / `<CompanyCreationWizard`
- **THEN** zero matches exist — they live in `AppGlobalDialogs.tsx`

#### Scenario: EmployeeEditorDialog branch removed
- **WHEN** grepping `apps/web/src/components/app-shell/AppGlobalDialogs.tsx` for `EmployeeEditorDialog`
- **THEN** zero matches exist
- **AND** the file SHALL NOT accept an `employeeEditor` prop or any equivalent dialog-state input

#### Scenario: Wizard dual-mode branch preserved
- **WHEN** `isOffice && activeOverlay === null`
- **THEN** `AppGlobalDialogs` renders `CompanyCreationWizard mode="populate-existing"` — same trigger as pre-refactor
- **WHEN** `companyWizardMode === 'create-new'`
- **THEN** `AppGlobalDialogs` additionally renders `CompanyCreationWizard mode="create-new"` with `onDismiss` wired
