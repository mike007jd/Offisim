## MODIFIED Requirements

### Requirement: Sizing primitive is centralized in `@offisim/ui-core/dialog-shell`

The canonical clamp expression and the Tabs flex-column className convention SHALL live as exported constants in `packages/ui-core/src/components/dialog-shell.tsx`: `DIALOG_SIZING_CLASS`, `DIALOG_TABS_ROOT_CLASS`, and `DIALOG_TABS_CONTENT_CLASS`. Touched dialogs SHALL import these constants rather than re-write the clamp expression or the `flex-1 min-h-0 overflow-y-auto` string. New dialogs added by future phases SHALL also import these constants. The `DialogShell` primitive's inner flex column SHALL itself apply `DIALOG_SIZING_CLASS` so any caller that wraps `DialogShell` inherits the contract for free. The previously listed `EmployeeEditorDialog` audit scenario no longer applies because the dialog has been removed in favor of the Personnel workspace surface; new dialogs that re-introduce a tabbed shell SHALL still import the three sizing constants.

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
