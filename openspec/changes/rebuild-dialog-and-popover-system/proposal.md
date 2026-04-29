## Why

Offisim ships two parallel modal-dialog primitives with diverging contracts.
`packages/ui-core/src/components/dialog.tsx` (legacy `Dialog` /
`DialogContent` / `DialogHeader`) is consumed by seven product surfaces —
`SopEditorDialog.tsx:134`, `SopImportDialog.tsx:73`, `InstallDialog.tsx:152`,
`PublishDialog.tsx:299`, `InteractionPrompt.tsx:19`, `InterviewWizard.tsx:78`,
`ExternalEmployeeInstallDialog.tsx:220` — and lacks a sticky three-region
layout, lacks the `onRequestClose` dirty-check protocol, lacks `aria-modal` /
`role="dialog"` enforcement on the title link, lacks size presets, and
hard-codes `focus:` on the close button instead of `focus-visible:`. The
newer `dialog-shell.tsx` (`DialogShell`) is consumed by only two surfaces
(`ProjectCreateDialog.tsx:138`, `KeyboardShortcutsDialog.tsx:19`) — and even
that primitive ships an asymmetric 200ms duration, has no `xs` size preset,
and its dirty-check protocol is not declared as a SHALL anywhere.

Concrete failures observed in repo audit:

- **Long-form publish dialog truncates its own footer.** `PublishDialog.tsx:300`
  slaps `max-h-[calc(100vh-2rem)] max-w-3xl overflow-y-auto` directly on
  `DialogContent`. There is no header / body / footer separation, so the
  Submit + Download row at the bottom is pushed off-screen on viewports
  ≤ 768px tall once the inline form grows past one screen. Sticky footer
  is absent.
- **Install flow has no Retry path on error.** `InstallDialog.tsx:55-66`
  `ErrorContent` only renders Close, even though the underlying state
  machine is restartable. The error step is also a hand-rolled `useState`
  step union (`InstallFlowState['step']`) duplicated against the dialog
  step labels; new steps require touching two places.
- **SOP add-step popover is hand-rolled.** `SopAddStepPopover.tsx:31-134`
  positions itself with absolute `style.left/top`, registers its own
  document-level `pointerdown` and `keydown` listeners, has no Radix
  primitive, no focus trap, no `role`, no `aria-labelledby`, Tab moves focus
  out of the form into the underlying canvas, Escape doesn't restore focus
  to the trigger element, and the hard-coded `z-index: 50` overlaps the
  Dialog overlay (`dialog.tsx:18` and `dialog-shell.tsx:117` both use the
  same `z-50`), so a popover opened over a dialog is undefined-stacked.
- **EmployeeCreatorOverlay narrow viewport breaks.** `EmployeeCreatorOverlay.tsx:152`
  caps the avatar pane at `max-h-[200px]` on `<lg` viewports, which forces
  the right pane below the fold; combined with the right-pane scroll
  container at line 186 the user has two stacked scrollers on `≤ 768px`
  viewports. The Back button at line 114 unconditionally calls `onClose`
  with no dirty check even when the user has typed a name.
- **Dirty-check protocol is per-surface implicit.** `DialogShell`'s
  `onRequestClose: () => boolean | undefined` exists (line 51) but only
  `ProjectCreateDialog` uses it. SOP / Install / Publish / Interview
  dialogs all silently discard work on Escape or backdrop click.
- **Animation is asymmetric.** `dialog-shell.tsx:138` ships `duration-200`
  on both open and close. macOS HIG and Material both call for slower
  exits than entries (snap-in, settle-out). 200/200 feels rushed on close.
- **Size presets are incomplete.** `dialog-shell.tsx:15-21` has `sm` →
  `max-w-sm` (24rem), but the smallest practical confirm dialog wants
  `xs` → `max-w-xs` (20rem). Without `xs`, callers either accept too-wide
  surfaces or hand-roll `className` overrides.
- **Legacy `DialogPrimitive.Close` uses wrong focus class.** `dialog.tsx:41`
  still applies `focus:ring-...` instead of `focus-visible:ring-...`,
  meaning the close button shows the ring on mouse-click as well — Change
  E targets the broader migration, but this change at minimum fixes the
  close button (it'll otherwise round-trip through the deprecation window).
- **Tabs-inside-dialog contract is undeclared.** `panel-and-dialog-sizing`
  spec exists for tabs in the Settings workspace and Employee Editor,
  but the Dialog version of that contract is implicit. Change A targets
  the workspace side; this change locks the dialog side.

We are pre-launch, no back-compat. This change rebuilds the dialog and
popover system end-to-end: collapses the two dialog primitives into one,
introduces a Radix-backed `Popover` primitive (no hand-rolled portals),
forces dirty-check + a11y + animation + sizing contracts as SHALL, and
migrates every product surface in one pass.

## What Changes

- **Delete the legacy `Dialog` primitive at `packages/ui-core/src/components/dialog.tsx`.**
  Remove the file, remove every export from `packages/ui-core/src/index.ts`
  (`Dialog`, `DialogTrigger`, `DialogContent`, `DialogHeader`, `DialogTitle`,
  `DialogDescription`, `DialogClose`). Pre-launch, no deprecation window —
  every consumer migrates in the same change.
- **`DialogShell` becomes the only modal primitive.** Extend it with: an
  `xs` size preset (`max-w-xs` = 20rem), declared `headerSlot` / `bodySlot`
  / `footerSlot` regions (sticky header + scrolling body + sticky footer)
  already implicit in the current shell but now contract-bound, asymmetric
  animation (`open: 150ms`, `close: 250ms`), and explicit `role="dialog"`
  + `aria-modal="true"` + `aria-labelledby={titleId}` enforced even when
  the caller passes only a custom header node.
- **Introduce `Popover` primitive at `packages/ui-core/src/components/popover.tsx`**,
  built on `@radix-ui/react-popover`. Adds the dependency to
  `packages/ui-core/package.json` (`@radix-ui/react-popover`). Exports
  `Popover`, `PopoverTrigger`, `PopoverContent`, `PopoverAnchor`, plus a
  `usePopoverModalRegistration(id)` helper that integrates with
  `modal-stack.ts` so Popover Escape ordering nests under any open Dialog.
- **Migrate every product Dialog surface to `DialogShell`.** Concrete file
  changes:
  - `packages/ui-office/src/components/sop/SopEditorDialog.tsx:134` → wrap
    in `DialogShell size="md"`, move Cancel/Create row into `footer` slot,
    add `onRequestClose` returning `false` when `name` / `description` /
    any `step.label` differs from initial.
  - `packages/ui-office/src/components/sop/SopImportDialog.tsx:73` → wrap
    in `DialogShell size="sm"`, move Preview / Cancel / Import row into
    `footer`, add Enter-key debounce on the URL input (300ms) so paste +
    Enter doesn't double-fire `handlePreview`, add dirty check when
    `previewData` is set.
  - `packages/ui-office/src/components/install/InstallDialog.tsx:152` →
    wrap in `DialogShell size="md"`, extract a typed step component map
    (eliminating the `switch (step)` body) so each step component owns
    its own footer; `ErrorContent` gets a Retry button that calls a new
    `restart` action on `useInstallFlow.ts` (the existing state machine
    can re-enter `loading` from `error`).
  - `packages/ui-office/src/components/marketplace/PublishDialog.tsx:299` →
    wrap in `DialogShell size="xl"` (replacing `max-w-3xl`), move the
    inline `max-h-[calc(100vh-2rem)] overflow-y-auto` off `DialogContent`
    so the body region scrolls and Submit/Download row stays sticky in
    `footer`. Add dirty check on form fields.
  - `packages/ui-office/src/components/chat/InteractionPrompt.tsx:19` →
    wrap in `DialogShell size="sm"`, no footer (decision card owns its
    own buttons), `closeOnBackdrop={false}` because the prompt blocks
    the agent turn.
  - `packages/ui-office/src/components/employees/InterviewWizard.tsx:78` →
    wrap in `DialogShell size="lg"`, move `max-h-[90vh] flex flex-col` to
    rely on shell's `DIALOG_SIZING_CLASS`, add dirty check across wizard
    steps.
  - `packages/ui-office/src/components/employees/ExternalEmployeeInstallDialog.tsx:220` →
    wrap in `DialogShell size="lg"`, add dirty check on credential form.
- **Rewrite `SopAddStepPopover` on Radix Popover.** Replace the hand-rolled
  positioning + listener pair (`SopAddStepPopover.tsx:31-134`) with
  `Popover` + `PopoverContent` from the new primitive. Anchor element
  comes from the trigger (the `+` button on `SopDagCanvas`); positioning
  uses Radix's `side` / `align` props. Focus trap, focus restoration, and
  Escape are handled by Radix. Caller passes the new `StepFormValues`
  back via the existing `onSubmit`. The screen-space `position` prop goes
  away because the Popover anchors to the trigger.
- **Fix `EmployeeCreatorOverlay` narrow tier.** Drop `max-h-[200px]` on
  the avatar pane (`EmployeeCreatorOverlay.tsx:152`). Below the lg
  breakpoint stack vertically with the right pane fully scrollable and
  the avatar collapsed to a 96px header avatar + name pill. Add dirty
  check to the Back button (`EmployeeCreatorOverlay.tsx:114`) — when
  `name.trim().length > 0` show the discard confirm toast pattern from
  Settings before calling `onClose`.
- **Lock dirty-check protocol as SHALL.** Any dialog whose body owns
  persistent edit state (text input, draft form, multi-step wizard,
  publish draft) SHALL pass `onRequestClose` and SHALL return `false`
  with a discard-confirm toast invocation when there is unsaved work.
  Read-only dialogs (KeyboardShortcuts, InstallProgress in `installing`
  step, Done step) SHALL NOT pass `onRequestClose`.
- **Lock animation timings.** `DialogShell` SHALL render with
  `data-state=open` duration `150ms` and `data-state=closed` duration
  `250ms` using the existing Tailwind `data-[state=open]:animate-in
  data-[state=closed]:animate-out` plumbing plus explicit
  `data-[state=open]:duration-150 data-[state=closed]:duration-250`
  classes on both Overlay and Content.
- **Lock size presets.** Add `xs` → `max-w-xs` (20rem) to `SIZE_CLASS`.
  Existing `sm` (24rem) / `md` (32rem) / `lg` (42rem) / `xl` (56rem) /
  `full` clamp stay. The full preset stays at `min(960px,calc(100vw-2rem))`.
- **Min touch target on close button.** `DialogShell` close button SHALL
  have `min-h-[44px] min-w-[44px]` hit area on narrow tier (≤ 768px) per
  WCAG 2.5.5; current `h-8 w-8` (32px) only meets desktop. Implementation
  uses `h-8 w-8 sm:h-8 sm:w-8` plus `before:` pseudo expanding hit area
  to 44px on narrow.
- **Migrate every legacy `Dialog` import in one pass.** Grep step in tasks
  enforces zero remaining `import { Dialog,` from `@offisim/ui-core` after
  the migration; legacy file deletion blocks landing if any caller
  remains.

## Capabilities

### New Capabilities

- `popover-protocol`: every floating, anchored, dismissable surface that
  is NOT a modal dialog (SOP add-step, future menu picker, future
  inline-edit popovers) SHALL be built on the shared `Popover` primitive
  in `@offisim/ui-core` (Radix backed). Hand-rolled positioning, ad-hoc
  document listeners, hand-rolled portals are forbidden. Popover SHALL
  trap focus inside its content, restore focus to the trigger on
  dismiss, dismiss on Escape (consuming the event so it does not
  bubble to a parent dialog or workspace), dismiss on outside pointer
  (unless `onInteractOutside.preventDefault()`), and integrate with
  `modal-stack.ts` so an open Popover is gated as a `popover` kind under
  any open dialog/overlay. z-index nests above dialog content but
  below dialog overlay siblings.

### Modified Capabilities

- `dialog-overlay-protocol`: tightens the existing close-semantics
  contract. Adds: only one Dialog primitive (`DialogShell`) ships in
  `@offisim/ui-core`; `Dialog` / `DialogContent` / `DialogHeader` /
  `DialogTitle` / `DialogDescription` / `DialogClose` exports SHALL NOT
  exist after this change. Adds a SHALL for dirty-check on persistent
  edit dialogs. Adds explicit a11y SHALL clauses (`role="dialog"`,
  `aria-modal="true"`, `aria-labelledby`). Adds animation timing SHALL
  (150ms open / 250ms close). Adds focus-visible SHALL for the close
  button.
- `panel-and-dialog-sizing`: tightens dialog three-region contract
  (sticky header + scrolling body + sticky footer SHALL be the only
  layout `DialogShell` ships). Adds `xs` → `max-w-xs` size preset to
  the canonical SIZE_CLASS map. Adds narrow-tier (`≤ 768px`) responsive
  contract: dialog SHALL render with `w-[calc(100%-1rem)]` (current
  `w-[calc(100%-2rem)]` is too narrow at 320px viewport), avatar/preview
  panes inside dialogs SHALL stack vertically with the form body fully
  scrollable, two stacked vertical scrollers SHALL NOT ship. Adds
  min-touch-target SHALL on the close button (44×44 hit on narrow).

## Impact

- **Code (delete)**: `packages/ui-core/src/components/dialog.tsx` (entire
  file).
- **Code (modify ui-core)**: `packages/ui-core/src/components/dialog-shell.tsx`
  (add `xs` preset, asymmetric animation timings, narrow-tier hit area,
  contract-bound a11y attrs); `packages/ui-core/src/index.ts` (remove
  legacy Dialog exports, add Popover exports); `packages/ui-core/package.json`
  (add `@radix-ui/react-popover` dep).
- **Code (new ui-core)**: `packages/ui-core/src/components/popover.tsx`
  (Radix wrapper + modal-stack integration).
- **Code (modify ui-office)**: 7 dialog migrations
  (`SopEditorDialog.tsx`, `SopImportDialog.tsx`, `InstallDialog.tsx`,
  `PublishDialog.tsx`, `InteractionPrompt.tsx`, `InterviewWizard.tsx`,
  `ExternalEmployeeInstallDialog.tsx`) + 1 popover rewrite
  (`SopAddStepPopover.tsx`) + 1 overlay narrow-tier fix
  (`EmployeeCreatorOverlay.tsx`) + 1 install-flow Retry action
  (`useInstallFlow.ts`) + 1 SopDagCanvas wiring change
  (`SopViewSurface.tsx` for the popover anchor).
- **Code (modify apps)**: none. `apps/web` and `apps/desktop` re-export
  Office UI; the migration is contained within `@offisim/ui-core` +
  `@offisim/ui-office`.
- **Spec**: 1 NEW capability (`popover-protocol`), 2 MODIFIED capabilities
  (`dialog-overlay-protocol`, `panel-and-dialog-sizing`).
- **No back-compat**: legacy `Dialog` exports are deleted, not aliased.
  Hand-rolled `SopAddStepPopover` is rewritten in place. Migration is
  one PR.
- **Live verification**: Tauri release build + each migrated dialog opened,
  Escape / backdrop / Cancel / X / Submit paths exercised, dirty-check
  discard-confirm verified, narrow-tier 320px / 768px breakpoints checked,
  popover focus trap + Escape ordering verified under an open dialog,
  VoiceOver / NVDA pass on Tauri release confirming `role="dialog"` +
  `aria-labelledby` are announced, keyboard-only navigation through every
  dialog form path. Live verification matrix in `tasks.md` Section 13.
