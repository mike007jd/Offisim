## ADDED Requirements

### Requirement: Dialogs and overlays share close semantics
Every modal dialog and full-screen overlay introduced or touched by this change SHALL use a shared close protocol. Close button, Escape, Cancel, Back, and completion actions SHALL either close through the same overlay/dialog state owner or explicitly block close with a visible dirty/validation reason.

#### Scenario: Company Editor closes consistently
- **WHEN** Company Editor is open and no blocking dirty-state confirmation is active
- **THEN** clicking the close button, pressing Escape, or choosing Cancel/Back closes the editor through the same close path

#### Scenario: Dirty dialog blocks close with reason
- **WHEN** a dialog has unsaved changes and the user invokes a close action that would discard work
- **THEN** the dialog SHALL either show a discard confirmation or keep the dialog open with a visible reason

#### Scenario: Close action does not leave hidden overlays active
- **WHEN** a dialog or overlay closes
- **THEN** focusable elements from that closed surface SHALL NOT remain in the tab order
- **AND** keyboard shortcuts SHALL target the newly visible top-level surface

### Requirement: Topmost overlay owns Escape and shortcuts
When any modal dialog or overlay is open, the topmost surface SHALL own Escape handling and Office keyboard shortcuts SHALL NOT mutate underlying workspace state unless the topmost surface explicitly delegates that shortcut.

#### Scenario: Dashboard shortcut suppressed behind dialog
- **WHEN** Company Editor or Employee Creator is open over Office
- **AND** the user presses `Cmd/Ctrl+D`
- **THEN** the dashboard open state SHALL NOT toggle behind the dialog

#### Scenario: Escape closes only the topmost surface
- **WHEN** Keyboard Shortcuts dialog is open above an Office overlay
- **AND** the user presses Escape
- **THEN** only the Keyboard Shortcuts dialog closes and the underlying Office overlay state is preserved

### Requirement: Dialogs contain focus and restore focus
Modal dialogs SHALL trap tab focus while open and restore focus to the invoking control or an equivalent visible control when closed.

#### Scenario: Tab focus stays inside modal
- **WHEN** a modal dialog is open
- **AND** the user cycles focus with Tab or Shift+Tab
- **THEN** focus remains within the modal's interactive controls

#### Scenario: Focus returns after close
- **WHEN** the user opens Dashboard from a visible Header tool entry and then closes it
- **THEN** focus returns to the Dashboard entry or another visible Office tool control

### Requirement: Backdrop behavior is explicit per surface
Each dialog or overlay SHALL declare whether backdrop click closes it. Dirty, destructive, or multi-step creation surfaces SHALL NOT close by backdrop click unless they first confirm discard.

#### Scenario: Wizard backdrop does not lose progress
- **WHEN** a company creation or template wizard has user progress
- **AND** the user clicks outside the wizard surface
- **THEN** progress is not discarded without an explicit confirmation

#### Scenario: Informational dialog backdrop may close
- **WHEN** a non-dirty informational dialog allows backdrop close
- **AND** the user clicks the backdrop
- **THEN** the dialog closes using the shared close path
