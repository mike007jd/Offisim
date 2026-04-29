## MODIFIED Requirements

### Requirement: Single canonical Dialog primitive in `@offisim/ui-core`

`packages/ui-core` SHALL ship exactly one modal Dialog primitive: the
`DialogShell` component declared in
`packages/ui-core/src/components/dialog-shell.tsx`. The legacy `Dialog`
/ `DialogTrigger` / `DialogContent` / `DialogHeader` / `DialogTitle` /
`DialogDescription` / `DialogClose` exports SHALL NOT exist after this
change. `packages/ui-core/src/components/dialog.tsx` SHALL be deleted.
Every product surface (in `@offisim/ui-office`, `apps/web`,
`apps/desktop`) that renders a modal dialog SHALL import `DialogShell`
from `@offisim/ui-core` and render its content through `DialogShell`'s
slot API (`title`, `description`, `footer`, `children`).

`DialogShell` SHALL continue to be backed by `@radix-ui/react-dialog`
and SHALL register with `modal-stack.ts` via `useRegisterModal(stackId,
'dialog')` while open.

#### Scenario: Legacy Dialog exports are gone
- **WHEN** grepping `packages/ui-core/src/index.ts` for the named exports `Dialog`, `DialogTrigger`, `DialogContent`, `DialogHeader`, `DialogTitle`, `DialogDescription`, `DialogClose`
- **THEN** zero matches exist for those names (only `DialogShell` and `DialogShellClose` remain)
- **AND** the file `packages/ui-core/src/components/dialog.tsx` SHALL NOT exist on disk

#### Scenario: Every product dialog imports DialogShell
- **WHEN** grepping `packages/ui-office/src/**/*.tsx` and `apps/**/*.tsx` for `import.*from '@offisim/ui-core'` lines that reference `Dialog`
- **THEN** every match references `DialogShell` (or `DialogShellClose`); no match references the bare `Dialog` import

### Requirement: Dialogs and overlays share close semantics

Every modal dialog and full-screen overlay introduced or touched by this change SHALL use a shared close protocol. Close button, Escape, Cancel, Back, and completion actions SHALL either close through the same overlay/dialog state owner or explicitly block close with a visible dirty/validation reason.

The shared close path for dialogs SHALL be `DialogShell`'s internal
`requestClose` callback: every visible close affordance (the built-in
X button, Escape key handler, backdrop click handler) SHALL call
`requestClose`, which in turn invokes `onRequestClose?.()` and only
proceeds with `onOpenChange(false)` when the callback returns a value
other than `false`.

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

#### Scenario: Every close affordance routes through requestClose
- **WHEN** the user invokes Escape, the backdrop, the built-in X, or any caller-supplied Cancel button on a `DialogShell` instance
- **THEN** the close path SHALL call `requestClose()` first (not `onOpenChange(false)` directly), so any `onRequestClose` callback runs and may block the close

### Requirement: Persistent-edit dialogs implement dirty-check protocol

Every persistent-edit dialog SHALL implement the dirty-check protocol via `onRequestClose`. Specifically, every dialog whose body owns persistent edit state — text input, draft form fields, multi-step wizard, publish draft, install bindings, SOP editor, employee credentials — SHALL pass an `onRequestClose` callback to `DialogShell`. The callback SHALL:

1. Compare the current form state against the initial / committed state.
2. Return `undefined` (or any non-`false` value) when no edits have been made — close proceeds.
3. Show a discard-confirm toast (using the shared `discard-confirm-toast` helper) AND return `false` when edits are present — the toast offers `Keep editing` (default) and `Discard` (closes the dialog by calling `onOpenChange(false)` directly).

The 6 dialogs covered by this change that own persistent edit state are:
`SopEditorDialog`, `SopImportDialog`, `InstallDialog` (`review` /
`bindings` / `error` steps only), `PublishDialog`, `InterviewWizard`,
`ExternalEmployeeInstallDialog`. They SHALL each implement
`onRequestClose` per the protocol above.

Read-only and non-cancellable dialogs SHALL NOT pass `onRequestClose`.
The read-only set covered by this change: `KeyboardShortcutsDialog`
(display only), `InstallDialog` `installing` step (state machine in
flight, additionally uses `closeOnEscape={false}` `closeOnBackdrop=
{false}`), `InstallDialog` `done` step (terminal),
`InteractionPrompt` (`closeOnEscape={false}` `closeOnBackdrop={false}`,
no `onRequestClose`).

Dialogs whose success path (e.g. SOP saved, install completed, publish
submitted) closes the dialog SHALL call `onOpenChange(false)` directly
in the success branch — bypassing the dirty-check — because the form
state has been persisted.

#### Scenario: Persistent-edit dialog blocks Escape with discard toast
- **WHEN** a user has typed text into `SopEditorDialog`'s SOP name field and presses Escape
- **THEN** `onRequestClose` SHALL fire, return `false`, and the dialog SHALL remain open with the discard-confirm toast visible

#### Scenario: User discards changes via toast
- **WHEN** the discard-confirm toast is visible and the user clicks `Discard`
- **THEN** the toast handler SHALL call `onOpenChange(false)` and the dialog SHALL close

#### Scenario: User keeps editing
- **WHEN** the discard-confirm toast is visible and the user clicks `Keep editing`
- **THEN** the toast SHALL dismiss and the dialog SHALL remain open with the form state intact

#### Scenario: Success path bypasses dirty check
- **WHEN** the user clicks `Create SOP` in `SopEditorDialog` and the save succeeds
- **THEN** the success branch SHALL call `onOpenChange(false)` directly without invoking `onRequestClose`
- **AND** no discard-confirm toast SHALL appear

#### Scenario: Read-only dialog does not pass onRequestClose
- **WHEN** auditing `KeyboardShortcutsDialog`'s render call to `DialogShell`
- **THEN** no `onRequestClose` prop SHALL be passed
- **AND** Escape SHALL close the dialog immediately

### Requirement: Dialogs declare a11y attributes

Every `DialogShell` instance SHALL produce DOM with:
- `role="dialog"` on the content (set by Radix automatically)
- `aria-modal="true"` on the content (set by Radix automatically)
- `aria-labelledby={titleId}` on the content, where `titleId` is a
  stable id generated by `DialogShell` using `useId()` and applied to
  the title node (`<DialogPrimitive.Title id={titleId}>`)

When the caller passes a `title` prop, the title node SHALL be wrapped
in `<DialogPrimitive.Title id={titleId}>`. When the caller passes only
`description` (no title), `DialogShell` SHALL synthesize a
visually-hidden `<DialogPrimitive.Title id={titleId} className="sr-only">`
populated from a new optional `visuallyHiddenLabel?: string` prop (or
fall back to a generic `Dialog` label) so `aria-labelledby` is never
empty.

Caller-provided `className` overrides SHALL NOT remove these attributes.
The dialog primitive SHALL NOT expose props that disable a11y.

#### Scenario: Dialog content has aria-labelledby resolving to the title
- **WHEN** opening any dialog rendered through `DialogShell`
- **THEN** the `DialogPrimitive.Content` element SHALL have a non-empty `aria-labelledby` attribute
- **AND** the referenced element SHALL exist in the DOM and contain the dialog's title text (visible or visually hidden)

#### Scenario: Title-less dialog still has labelled-by
- **WHEN** opening a dialog whose caller passed only `description` (no `title`)
- **THEN** `DialogShell` SHALL render a visually-hidden `<DialogPrimitive.Title>` and `aria-labelledby` SHALL reference it

#### Scenario: Screen reader announces dialog role and label
- **WHEN** a screen reader (VoiceOver / NVDA) is active and any dialog opens
- **THEN** the announcement SHALL include the role `dialog` and the title text (verified during live verification per `tasks.md` Section 18.6)

### Requirement: Topmost overlay owns Escape and shortcuts

When any modal dialog or overlay is open, the topmost surface SHALL own Escape handling and Office keyboard shortcuts SHALL NOT mutate underlying workspace state unless the topmost surface explicitly delegates that shortcut.

When a popover is opened above a dialog (popover registered with
`modal-stack.ts` as `kind: 'popover'`), the popover SHALL be topmost
and Escape SHALL dismiss the popover only.

#### Scenario: Dashboard shortcut suppressed behind dialog
- **WHEN** Company Editor or Employee Creator is open over Office
- **AND** the user presses `Cmd/Ctrl+D`
- **THEN** the dashboard open state SHALL NOT toggle behind the dialog

#### Scenario: Escape closes only the topmost surface
- **WHEN** Keyboard Shortcuts dialog is open above an Office overlay
- **AND** the user presses Escape
- **THEN** only the Keyboard Shortcuts dialog closes and the underlying Office overlay state is preserved

#### Scenario: Popover topmost over dialog dismisses on Escape first
- **WHEN** a Popover is open inside a dialog body and the user presses Escape
- **THEN** the popover SHALL dismiss
- **AND** the parent dialog SHALL remain open

### Requirement: Dialogs contain focus and restore focus

Modal dialogs SHALL trap tab focus while open and restore focus to the invoking control or an equivalent visible control when closed.

`DialogShell`'s built-in close button (the X) SHALL use `focus-visible`
classes only — `focus-visible:outline-none focus-visible:ring-2
focus-visible:ring-cyan-400/40` — so the focus ring is not shown on
mouse click. The legacy `dialog.tsx`'s `focus:ring-...` pattern SHALL
NOT ship.

#### Scenario: Tab focus stays inside modal
- **WHEN** a modal dialog is open
- **AND** the user cycles focus with Tab or Shift+Tab
- **THEN** focus remains within the modal's interactive controls

#### Scenario: Focus returns after close
- **WHEN** the user opens Dashboard from a visible Header tool entry and then closes it
- **THEN** focus returns to the Dashboard entry or another visible Office tool control

#### Scenario: Close button uses focus-visible only
- **WHEN** a user clicks the close X with the mouse
- **THEN** no focus ring SHALL appear on the close button
- **AND** when the user Tab-focuses to the close X, the focus ring SHALL appear

### Requirement: Backdrop behavior is explicit per surface

Each dialog or overlay SHALL declare whether backdrop click closes it. Dirty, destructive, or multi-step creation surfaces SHALL NOT close by backdrop click unless they first confirm discard.

`DialogShell` already exposes `closeOnBackdrop?: boolean` (default
`true`). When `true`, backdrop click SHALL invoke `requestClose`,
honoring the dirty-check protocol. When `false`, backdrop click SHALL
be a no-op — useful for `InteractionPrompt` (high severity) and
`InstallDialog` `installing` step.

#### Scenario: Wizard backdrop does not lose progress
- **WHEN** a company creation or template wizard has user progress
- **AND** the user clicks outside the wizard surface
- **THEN** progress is not discarded without an explicit confirmation

#### Scenario: Informational dialog backdrop may close
- **WHEN** a non-dirty informational dialog allows backdrop close
- **AND** the user clicks the backdrop
- **THEN** the dialog closes using the shared close path

#### Scenario: Non-cancellable dialog ignores backdrop
- **WHEN** an `InteractionPrompt` (high severity) or `InstallDialog` `installing` step is open and the user clicks the backdrop
- **THEN** the dialog SHALL NOT close
- **AND** no discard-confirm toast SHALL appear

### Requirement: Dialog open and close animation timings

`DialogShell` SHALL declare asymmetric open and close animation timings of 150 ms and 250 ms respectively. Specifically, `DialogPrimitive.Overlay` and `DialogPrimitive.Content` SHALL each declare `data-[state=open]:duration-150` and `data-[state=closed]:duration-250` Tailwind classes. The legacy symmetric `duration-200` MUST NOT ship.

#### Scenario: Open animation completes in 150 ms
- **WHEN** the user opens any `DialogShell`-backed dialog and observes the open animation in dev-tools Performance trace
- **THEN** the overlay fade-in and content zoom-in SHALL complete in approximately 150 ms

#### Scenario: Close animation completes in 250 ms
- **WHEN** the user closes any `DialogShell`-backed dialog
- **THEN** the overlay fade-out and content zoom-out SHALL complete in approximately 250 ms

#### Scenario: Dialog source declares both duration classes
- **WHEN** auditing `dialog-shell.tsx`
- **THEN** both Overlay and Content `className` strings SHALL include `data-[state=open]:duration-150` and `data-[state=closed]:duration-250`
- **AND** no occurrence of `duration-200` SHALL exist in the file
