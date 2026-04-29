## 1. Add `@radix-ui/react-popover` dependency + lockfile

- [ ] 1.1 In `packages/ui-core/package.json`, add `"@radix-ui/react-popover": "^1.1.16"` to `dependencies` (use the latest minor matching the existing Radix versions; verify against `https://www.npmjs.com/package/@radix-ui/react-popover` at landing time)
- [ ] 1.2 Run `pnpm install` at repo root to update `pnpm-lock.yaml`
- [ ] 1.3 Verify `node_modules/@radix-ui/react-popover` resolves under `packages/ui-core/node_modules` after install

## 2. Modal-stack extension for popover kind

- [ ] 2.1 In `packages/ui-core/src/lib/modal-stack.ts`, extend `StackEntry['kind']` from `'dialog' | 'overlay'` to `'dialog' | 'overlay' | 'popover'`
- [ ] 2.2 Verify `useRegisterModal(id, kind)` accepts the new kind without further code changes (the function is already kind-generic)
- [ ] 2.3 No change to `useTopmostEscape` — it is kind-blind and continues to work for popovers

## 3. New `Popover` primitive

- [ ] 3.1 Create `packages/ui-core/src/components/popover.tsx` exporting `Popover`, `PopoverTrigger`, `PopoverAnchor`, `PopoverContent`, `PopoverArrow`
- [ ] 3.2 `Popover`, `PopoverTrigger`, `PopoverAnchor`, `PopoverArrow` are direct re-exports of the Radix primitives (`PopoverPrimitive.Root`, `.Trigger`, `.Anchor`, `.Arrow`)
- [ ] 3.3 `PopoverContent` is a `forwardRef` wrapper around `PopoverPrimitive.Content` with: default `sideOffset={6}`, `align="start"`, `className` mixing `cn('z-[60] w-72 rounded-lg border border-white/10 bg-slate-900 p-3 shadow-2xl outline-none data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=open]:fade-in-0 data-[state=closed]:fade-out-0 data-[state=open]:zoom-in-95 data-[state=closed]:zoom-out-95 data-[state=open]:duration-150 data-[state=closed]:duration-250', className)`
- [ ] 3.4 `PopoverContent` accepts an optional `stackId?: string` prop; if omitted, generate `useId()` and pass to `useRegisterModal(open ? id : null, 'popover')` keyed on the controlled `open` state from the Radix `Popover` parent (use `usePopoverContext` if Radix exposes it; otherwise read `data-state` attribute via ref or accept `open` from a sibling render-prop)
- [ ] 3.5 If `usePopoverContext` is not exposed, alternative: introduce a `PopoverContent` prop `onOpenChangeForStack: (open: boolean) => void` and require callers to plumb open state through; document the choice in a `JSDoc` comment on `PopoverContent`. Pre-launch we may also vendor a tiny context locally (`PopoverOpenContext`) wrapping `Popover` to track open state for stack registration — pick whichever is cleaner at implementation time
- [ ] 3.6 Add `Popover` exports to `packages/ui-core/src/index.ts` barrel
- [ ] 3.7 Build `@offisim/ui-core` and confirm typecheck passes

## 4. Extend `DialogShell` (xs preset, animation, a11y, narrow tier)

- [ ] 4.1 In `packages/ui-core/src/components/dialog-shell.tsx`, extend `DialogSize` union to `'xs' | 'sm' | 'md' | 'lg' | 'xl' | 'full'`
- [ ] 4.2 Add `xs: 'max-w-xs'` to the `SIZE_CLASS` map (insert before `sm`)
- [ ] 4.3 Replace `duration-200` on `DialogPrimitive.Content` with `data-[state=open]:duration-150 data-[state=closed]:duration-250`; apply the same pair to `DialogPrimitive.Overlay`
- [ ] 4.4 Replace `w-[calc(100%-2rem)]` on `DialogPrimitive.Content` with `w-[calc(100%-1rem)] sm:w-[calc(100%-2rem)]`
- [ ] 4.5 On the close button (`<button type="button" aria-label="Close">`), replace `h-8 w-8` with `relative h-8 w-8 before:absolute before:inset-[-6px] before:content-[''] sm:before:hidden` so narrow-tier hit area is 44×44 while desktop visible button stays 32×32; verify the `:before` does not capture pointer events incorrectly (set `before:pointer-events-none` if it does)
- [ ] 4.6 Add `useId()` for `titleId` inside `DialogShell`; pass `aria-labelledby={titleId}` to `DialogPrimitive.Content`; wrap any `title` node in `<DialogPrimitive.Title id={titleId}>`
- [ ] 4.7 If `title` is not provided but `description` is, synthesize a visually-hidden `<DialogPrimitive.Title id={titleId} className="sr-only">{visuallyHiddenLabel ?? 'Dialog'}</DialogPrimitive.Title>` to keep `aria-labelledby` non-empty; add new optional prop `visuallyHiddenLabel?: string` to `DialogShellProps`
- [ ] 4.8 Confirm `role="dialog"` and `aria-modal="true"` are set by Radix on `DialogPrimitive.Content` (they are; no explicit attr needed) and add a code comment to that effect on `DialogShell` so future authors don't re-add them
- [ ] 4.9 Build `@offisim/ui-core` and confirm typecheck passes

## 5. Migrate `SopEditorDialog` to `DialogShell`

- [ ] 5.1 In `packages/ui-office/src/components/sop/SopEditorDialog.tsx`, replace import `{ Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle }` with `{ DialogShell }` from `@offisim/ui-core`
- [ ] 5.2 Replace the `<Dialog open={open} onOpenChange={onOpenChange}>...<DialogContent>` wrapper at line 134 with `<DialogShell open={open} onOpenChange={onOpenChange} size="md" title="Create SOP" description="Define a reusable Standard Operating Procedure." footer={<>...</>}>`
- [ ] 5.3 Move the Cancel/Save button row at line 263 into the `footer` prop
- [ ] 5.4 Compute `isDirty = useMemo(() => name.trim().length > 0 || description.trim().length > 0 || steps.some((s, i) => s.label !== '' || (i > 0 && s.dependencies.length > 0)), [name, description, steps])`
- [ ] 5.5 Add `onRequestClose={() => { if (!isDirty) return; const confirmed = confirmDiscardSync(); return confirmed ? undefined : false; }}` — `confirmDiscardSync` is the toast-based discard pattern; if a sync confirm is incompatible with the toast async pattern, factor as: `onRequestClose={() => { if (isDirty) { showDiscardToast(() => onOpenChange(false)); return false; } return undefined; }}` and the toast's Discard action fires `onOpenChange(false)`
- [ ] 5.6 In the success branch of `handleSave`, call `onOpenChange(false)` directly so the dirty-check is bypassed on save (form has been persisted; nothing to discard)
- [ ] 5.7 Remove `max-w-lg max-h-[80vh] flex flex-col` className from the old `<DialogContent>` (now handled by `DialogShell` size + sizing constants)

## 6. Migrate `SopImportDialog` to `DialogShell`

- [ ] 6.1 In `packages/ui-office/src/components/sop/SopImportDialog.tsx`, replace legacy `Dialog` imports with `DialogShell`
- [ ] 6.2 Wrap the body in `<DialogShell open={open} onOpenChange={onOpenChange} size="sm" title={...} description={...} footer={...}>` — the title preserves the `<Download className="h-4 w-4 text-blue-400" /> Import SOP from URL` rendering by passing a node
- [ ] 6.3 Move the conditional Cancel/Import button row from line 132 to the `footer` prop; the row only renders when `preview` is set, so footer is `preview ? <>...</> : null`
- [ ] 6.4 Move the standalone `<Button>Preview</Button>` at line 105 (no `preview` shown yet) inline in the body — it stays in the body section because it gates preview rendering, not save
- [ ] 6.5 Add Enter-key debounce on the URL `<input>` at line 98-100: replace direct `onKeyDown` with a 300ms debounced wrapper using `useRef<NodeJS.Timeout | null>(null)` so paste-with-Enter doesn't double-fire `handlePreview`
- [ ] 6.6 Compute `isDirty = url.trim().length > 0 || previewData !== null`; pass `onRequestClose` matching the same pattern as Section 5.5

## 7. Migrate `InstallDialog` to `DialogShell` + Retry path

- [ ] 7.1 In `packages/ui-office/src/components/install/InstallDialog.tsx`, replace legacy `Dialog` imports with `DialogShell`
- [ ] 7.2 Replace the `<Dialog open={isOpen} onOpenChange={...}>...<DialogContent>` at line 152 with `<DialogShell open={isOpen} onOpenChange={(o) => { if (!o) cancel(); }} size="md" title={getDialogTitle(step, !!upgradeDiff)} description={...}>`
- [ ] 7.3 Each step (`loading` / `review` / `bindings` / `installing` / `done` / `error`) renders inside the body region — no per-step footer in this migration; footer logic stays inline within step components (`ManifestReview`, `BindingForm`, `UpgradePreview`, `DoneContent`, `ErrorContent`)
- [ ] 7.4 In `apps/.../packages/ui-office/src/hooks/useInstallFlow.ts`, add a `restart()` action to `InstallFlowActions` that resets the state to `{ step: 'loading', ... }` re-using the original `manifestUrl` / install descriptor
- [ ] 7.5 Update `ErrorContent` at line 55-66 to accept `onRetry: () => void` and render `<Button onClick={onRetry}>Retry</Button>` alongside the existing Close button
- [ ] 7.6 Pass `onRetry={restart}` in the `case 'error':` branch at line 144
- [ ] 7.7 Dirty-check policy for InstallDialog: `loading` / `installing` steps SHALL pass `closeOnEscape={false}` `closeOnBackdrop={false}` and SHALL NOT pass `onRequestClose` (state machine in flight); `review` / `bindings` / `error` / `done` steps SHALL allow normal close. Implement by passing the flags conditionally on `step`
- [ ] 7.8 Verify the existing `step === 'idle' && !isOpen` early-return at line 104 still works after migration

## 8. Migrate `PublishDialog` to `DialogShell` + sticky footer

- [ ] 8.1 In `packages/ui-office/src/components/marketplace/PublishDialog.tsx`, replace legacy `Dialog` imports with `DialogShell`
- [ ] 8.2 Replace the `<Dialog open={open} onOpenChange={onOpenChange}>...<DialogContent className="max-h-[calc(100vh-2rem)] max-w-3xl overflow-y-auto border-white/10 bg-slate-950/95">` at line 299-300 with `<DialogShell open={open} onOpenChange={onOpenChange} size="xl" title="Publish To Market" description="Build a package from an employee or a skill, download the archive, and submit a registry draft that points at an external artifact URL." footer={<>...Submit/Download buttons...</>} className="border-white/10 bg-slate-950/95">`
- [ ] 8.3 Locate the existing Submit / Download / Cancel button row (currently bottom of the form, scrolls with content); extract into a memoized footer node and pass via `footer` prop
- [ ] 8.4 Remove `max-h-[calc(100vh-2rem)] overflow-y-auto` from the dialog content (the `DialogShell` body region scrolls). The dialog `min-h` / `max-h` clamp is handled by `DIALOG_SIZING_CLASS` inside the shell
- [ ] 8.5 Verify the form's vertical content scrolls inside the dialog body and the footer (Submit / Download row) stays sticky at the bottom at viewport `1024x600` and `1280x720`
- [ ] 8.6 Compute dirty: `isDirty = authToken.trim().length > 0 || sourceAssetId !== '' || titleField !== '' || descriptionField !== '' || ...` — use a single `useMemo` over the form fields. Pass `onRequestClose` per Section 5.5

## 9. Migrate `InteractionPrompt` to `DialogShell`

- [ ] 9.1 In `packages/ui-office/src/components/chat/InteractionPrompt.tsx`, replace legacy `Dialog` imports with `DialogShell`
- [ ] 9.2 Replace the `<Dialog open><DialogContent>` at lines 19-20 (high-severity branch) with `<DialogShell open={true} onOpenChange={() => {}} size="sm" closeOnBackdrop={false} closeOnEscape={false} title="Decision required" className="border-white/10 bg-slate-950/95">`
- [ ] 9.3 No `footer` prop — the `<InteractionDecisionCard>` / `<SkillInstallConfirmBubble>` body owns its own action buttons
- [ ] 9.4 No `onRequestClose` because the prompt is non-dismissible until the user picks an option

## 10. Migrate `InterviewWizard` to `DialogShell`

- [ ] 10.1 In `packages/ui-office/src/components/employees/InterviewWizard.tsx`, replace legacy `Dialog` imports with `DialogShell`
- [ ] 10.2 Replace the `<Dialog open=...><DialogContent className="max-w-2xl max-h-[90vh] flex flex-col overflow-hidden">` at line 78 with `<DialogShell open={...} onOpenChange={...} size="lg" title={...} description={...} footer={...}>`
- [ ] 10.3 Move wizard step nav buttons (Back / Next / Submit) into the `footer` prop
- [ ] 10.4 Remove the `max-w-2xl max-h-[90vh] flex flex-col overflow-hidden` (now handled by shell + sizing constants)
- [ ] 10.5 Compute wizard dirty: any step's draft state is non-default; pass `onRequestClose` per Section 5.5

## 11. Migrate `ExternalEmployeeInstallDialog` to `DialogShell`

- [ ] 11.1 In `packages/ui-office/src/components/employees/ExternalEmployeeInstallDialog.tsx`, replace legacy `Dialog` imports with `DialogShell`
- [ ] 11.2 Replace the `<Dialog>...<DialogContent className="max-w-xl">` at line 220 with `<DialogShell open={...} onOpenChange={...} size="lg" title={...} description={...} footer={...}>`
- [ ] 11.3 Move install action buttons into `footer`
- [ ] 11.4 Compute dirty on credential / endpoint form fields; pass `onRequestClose` per Section 5.5

## 12. Rewrite `SopAddStepPopover` on Radix Popover

- [ ] 12.1 In `packages/ui-office/src/components/sop/SopAddStepPopover.tsx`, replace the entire file contents with a Radix-backed wrapper
- [ ] 12.2 New props: `{ open: boolean; onOpenChange: (open: boolean) => void; trigger?: React.ReactNode; anchor?: React.ReactNode; initialValues?: StepFormValues; submitLabel?: string; onSubmit: (values: StepFormValues) => void; }` — `position: { x, y }` is removed
- [ ] 12.3 Render structure: `<Popover open={open} onOpenChange={onOpenChange}>` containing either `<PopoverTrigger asChild>{trigger}</PopoverTrigger>` (when caller supplies a trigger element) or `<PopoverAnchor>{anchor}</PopoverAnchor>` (when anchoring to a non-trigger DOM node like a SOP step card on the canvas)
- [ ] 12.4 `<PopoverContent side="bottom" align="start" className="w-[280px] p-3" stackId={`sop-step-popover-${editStepId ?? 'create'}`}>` containing the existing form (label / role / instruction / Cancel / Submit)
- [ ] 12.5 Drop the `popoverRef` / `pointerdown` / `keydown` / `style.left/top` clamping code — Radix handles all of this
- [ ] 12.6 The `inputRef` auto-focus on mount stays (or use Radix's `onOpenAutoFocus={(e) => e.preventDefault()}` then ref-focus inside `useEffect` to keep current behavior; pick whichever is shorter)
- [ ] 12.7 Update the parent `SopViewSurface.tsx` callsite at line 99: change `addStepPopover` state from `{ canvasX, canvasY, ... } | null` to `{ editStepId: string | null; isOpen: boolean }` (drop the coords); render `<SopAddStepPopover open={addStepPopover?.isOpen ?? false} onOpenChange={...} anchor={anchorEl} initialValues={...} onSubmit={...} />` where `anchorEl` is rendered as an invisible `<div ref={anchorRef} className="absolute" style={{ left: stepNode.x, top: stepNode.y }} />` overlay positioned at the SOP step's canvas-space coords for edit mode, or anchored to the `+` button for create mode
- [ ] 12.8 Verify Tab key keeps focus inside the popover, Escape dismisses it (and only it, when a parent dialog is also open), and outside-click dismisses unless a parent component calls `onInteractOutside.preventDefault()`

## 13. Fix `EmployeeCreatorOverlay` narrow tier + dirty Back

- [ ] 13.1 In `packages/ui-office/src/components/employees/EmployeeCreatorOverlay.tsx:152`, remove `max-h-[200px]` from the avatar pane className
- [ ] 13.2 Below the `lg` breakpoint (`<1024px`), restructure the `flex flex-col lg:flex-row` body (line 150) so the avatar pane renders as a 120px-tall horizontal header row above the form pane: avatar pane gets `flex h-[120px] shrink-0 flex-row items-center justify-between gap-3 px-4 lg:h-auto lg:w-[45%] lg:flex-col lg:justify-center`; replace the `flex flex-col items-center gap-6` inner div with a responsive layout — narrow shows a 64px avatar + name + Randomize side-by-side, lg restores the existing tall stack with 300px avatar
- [ ] 13.3 The right form pane at line 186 keeps `flex-1 overflow-y-auto` and works as the single scroller on narrow
- [ ] 13.4 Compute `isDirty = name.trim().length > 0 || seedManuallyEdited`; in the Back button `onClick` at line 114, replace direct `onClose()` with: `if (isDirty) { showDiscardToast(() => onClose()); } else { onClose(); }` — `showDiscardToast` uses the existing `useToasts` hook from `ui-office`
- [ ] 13.5 Verify keyboard Escape (already wired via `useTopmostEscape` at line 74) fires the same dirty-check; refactor `onClose` callback passed to `useTopmostEscape` to wrap with the dirty-check, OR pass a single `handleClose` function that owns the dirty-check and use it in both Back and Escape paths

## 14. Delete legacy `Dialog` primitive

- [ ] 14.1 Delete `packages/ui-core/src/components/dialog.tsx` (entire file)
- [ ] 14.2 Remove from `packages/ui-core/src/index.ts`: `Dialog`, `DialogTrigger`, `DialogContent`, `DialogHeader`, `DialogTitle`, `DialogDescription`, `DialogClose` exports
- [ ] 14.3 `grep -rn "import.*Dialog.*from '@offisim/ui-core'" packages/ apps/` SHALL match only `DialogShell` after this; zero matches for `Dialog,` / `DialogContent` / `DialogHeader` / `DialogTitle` / `DialogDescription` / `DialogClose` / `DialogTrigger`
- [ ] 14.4 `grep -rn "from '@radix-ui/react-dialog'" packages/ apps/` SHALL match only `packages/ui-core/src/components/dialog-shell.tsx` after this (legacy file gone, no other consumers)

## 15. Discard-confirm toast helper (shared)

- [ ] 15.1 Audit existing `useToasts` API in `packages/ui-office/src/hooks` (or equivalent location) — confirm whether a `showDiscardConfirm({ message, onDiscard, onKeep })` shape exists; if not, add a thin helper `packages/ui-office/src/lib/discard-confirm-toast.ts` exporting `showDiscardConfirm({ ... })` that wraps `useToasts().push(<ToastBanner variant="warning"...>)`
- [ ] 15.2 The toast SHALL render: title `Discard changes?`, body `Your unsaved edits will be lost.`, primary action `Keep editing` (dismisses toast, leaves dialog open), secondary action `Discard` (calls `onDiscard()` which closes the dialog)
- [ ] 15.3 Toast auto-dismiss SHALL be disabled (sticky until user picks); dismiss-on-Escape on the toast bubbles to the dialog's `onRequestClose` and is allowed
- [ ] 15.4 All 6 dirty-check dialogs migrated in Sections 5–11 SHALL import this helper

## 16. Spec / docs / changelog sync

- [ ] 16.1 Confirm `openspec/changes/rebuild-dialog-and-popover-system/specs/dialog-overlay-protocol/spec.md` matches the requirements promised in `proposal.md` Capabilities section
- [ ] 16.2 Confirm `openspec/changes/rebuild-dialog-and-popover-system/specs/panel-and-dialog-sizing/spec.md` adds `xs` size + narrow-tier requirements without contradicting the existing `panel-and-dialog-sizing` spec for non-dialog surfaces
- [ ] 16.3 Confirm `openspec/changes/rebuild-dialog-and-popover-system/specs/popover-protocol/spec.md` declares the new capability with all SHALL clauses
- [ ] 16.4 Update `packages/ui-office/CLAUDE.md` if the dialog migration changes any documented import path (none expected; surfaces still import from `@offisim/ui-core`)
- [ ] 16.5 Update `packages/ui-core/CLAUDE.md` (or create) noting the legacy `Dialog` removal and the new `Popover` primitive — list the canonical imports
- [ ] 16.6 If `openspec/protocols-ledger.md` tracks Radix versions / a11y guarantees, update the row noting `@radix-ui/react-popover` as a new dependency

## 17. Build + verify gates (serial per CLAUDE.md)

- [ ] 17.1 `pnpm --filter @offisim/shared-types build`
- [ ] 17.2 `pnpm --filter @offisim/ui-core build`
- [ ] 17.3 `pnpm --filter @offisim/core build`
- [ ] 17.4 `pnpm --filter @offisim/ui-office build`
- [ ] 17.5 `pnpm --filter @offisim/ui-office typecheck`
- [ ] 17.6 `pnpm --filter @offisim/web typecheck`
- [ ] 17.7 `pnpm --filter @offisim/web build`
- [ ] 17.8 `pnpm --filter @offisim/desktop build` — release `.app` builds
- [ ] 17.9 `npx biome check .` — zero new errors
- [ ] 17.10 `pnpm harness:contract` — green (no harness changes expected; this is a UI change)
- [ ] 17.11 `grep -rn "import.*Dialog.*from '@offisim/ui-core'" packages/ apps/` returns only `DialogShell` matches (Section 14.3 verification)

## 18. Live verification (release Tauri app + browser)

> **Coverage status**: every dialog migration touches user-visible
> dismiss / submit / a11y paths, so all verifications below SHALL be
> live-tested. Harness coverage is not applicable (UI primitives, no
> graph state). Web verification covers narrow-tier (browser dev-tools
> emulation at 320px / 768px / 1024px / 1440px). Tauri release
> verification covers the desktop credential / install / publish flows
> that web cannot exercise (e.g. real `keychain` calls).

### 18.1 Dialog migration matrix (per dialog: Escape / backdrop / X / Cancel / Submit)

For each migrated dialog, exercise all five close paths and confirm the
documented behavior. Mark per-dialog cells:

- [ ] 18.1.1 `SopEditorDialog` — open from SOP workspace `+ Create`, type a name, press Escape → discard toast appears, click `Keep editing` → dialog stays open with form intact, click `Discard` → dialog closes
- [ ] 18.1.2 `SopEditorDialog` — type valid SOP, click `Create SOP` → dialog closes via success path (no discard toast); confirm SOP appears in sidebar
- [ ] 18.1.3 `SopEditorDialog` — backdrop click with empty form → closes immediately (no dirty); backdrop click with text in name → discard toast appears
- [ ] 18.1.4 `SopImportDialog` — paste URL, press Enter → preview fetches once (not twice from debounce); click X with preview shown → discard toast; click Cancel after preview → discard toast
- [ ] 18.1.5 `InstallDialog` — trigger install, force a network error (offline mode), `error` step appears with Retry + Close; click Retry → re-enters `loading`; click Close → dialog closes
- [ ] 18.1.6 `InstallDialog` — `installing` step, press Escape → no close (state machine in flight, `closeOnEscape={false}`)
- [ ] 18.1.7 `PublishDialog` — open from Marketplace, fill long form past 1 screen at viewport 1024×600 → confirm Submit / Download row stays sticky at bottom; scroll body up/down → footer stays put; press Escape with form filled → discard toast
- [ ] 18.1.8 `InteractionPrompt` (high-severity) — trigger an interaction prompt, press Escape → no close (must answer); click backdrop → no close
- [ ] 18.1.9 `InterviewWizard` — open, fill step 1, press Escape → discard toast; click Discard → wizard closes; reopen, fill all steps, click Submit → wizard closes via success path
- [ ] 18.1.10 `ExternalEmployeeInstallDialog` — fill credentials, press Escape → discard toast; complete install via Submit → dialog closes via success path

### 18.2 Popover migration

- [ ] 18.2.1 Open SOP workspace, click `+ Add step` on canvas → popover anchors to button; type label, press Escape → popover closes, focus returns to `+` button
- [ ] 18.2.2 Open SOP workspace, double-click an existing step (or whichever gesture triggers edit) → popover anchors to step node; submit → step updates, popover closes
- [ ] 18.2.3 Tab inside the popover → focus cycles within label / role / instruction / Cancel / Submit; Tab on Submit → cycles back to label
- [ ] 18.2.4 Open SOP popover, then open KeyboardShortcutsDialog (Cmd+/) → dialog renders above popover; press Escape → popover dismisses first, dialog stays open; press Escape again → dialog dismisses
- [ ] 18.2.5 Click outside the popover → popover dismisses

### 18.3 Narrow tier (320px / 768px) — both web and Tauri release

- [ ] 18.3.1 At browser viewport 320px (iPhone SE width), open `SopEditorDialog` → dialog renders with `w-[calc(100%-1rem)]` (304px wide), close button hit area test: click within 6px of button edge counts as click (verified via 44×44 hit zone)
- [ ] 18.3.2 At browser viewport 768px (iPad portrait), open `EmployeeCreatorOverlay` → avatar pane renders as 120px horizontal header above form; form scrolls vertically as the only scroller; no two stacked scrollbars; type a name → click Back → discard toast appears
- [ ] 18.3.3 At browser viewport 320px, open `PublishDialog` → dialog renders, body scrolls, footer (Submit / Download / Cancel) stays visible at bottom
- [ ] 18.3.4 At Tauri release window resized to ≤ 768px width, open `EmployeeCreatorOverlay` and verify item 18.3.2 reproduces in the desktop shell

### 18.4 Animation timing

- [ ] 18.4.1 Open any dialog with the dev-tools Performance tab recording → confirm Overlay + Content fade in over ~150ms; close → confirm fade out over ~250ms
- [ ] 18.4.2 Subjective: open and close `KeyboardShortcutsDialog` rapidly 5 times → close motion feels noticeably more deliberate than open (no stutter)

### 18.5 Keyboard-only navigation

- [ ] 18.5.1 With keyboard only (no mouse), open `SopEditorDialog` via the SOP workspace `+ Create` keyboard shortcut → focus enters the first input; Tab through every field and the footer Cancel / Save buttons; Shift+Tab cycles backwards; focus stays within the dialog
- [ ] 18.5.2 Escape closes the dialog; focus returns to the trigger button on the SOP workspace
- [ ] 18.5.3 Repeat for `SopImportDialog`, `InstallDialog`, `PublishDialog`, `InterviewWizard`, `ExternalEmployeeInstallDialog`

### 18.6 Screen reader (VoiceOver on macOS Tauri release; NVDA on Windows browser)

- [ ] 18.6.1 With VoiceOver active, open `SopEditorDialog` → VO announces "Create SOP, dialog" (the `aria-labelledby` resolves to the title); body content is reachable via VO arrows
- [ ] 18.6.2 With VoiceOver active, open `InteractionPrompt` (high-severity) → VO announces "Decision required, dialog"
- [ ] 18.6.3 With VoiceOver active, open `SopAddStepPopover` from the SOP canvas → VO announces "Add step, dialog" (Radix Popover content uses `role="dialog"` semantically); arrow keys navigate the form fields
- [ ] 18.6.4 If NVDA is available, repeat 18.6.1 and 18.6.3 in Web build at `localhost:5176`

### 18.7 Modal-stack regression

- [ ] 18.7.1 Open `KeyboardShortcutsDialog` over Office workspace, press Cmd+D → dashboard does NOT toggle behind the dialog (existing contract, must still hold)
- [ ] 18.7.2 Open a popover from inside `SopEditorDialog` (e.g. an inline help popover if the migration adds one; otherwise skip), press Escape → popover dismisses first, dialog stays open
- [ ] 18.7.3 Close all overlays → `useAnyModalOpen()` returns `false`; Office shortcuts re-enable

## 19. Cleanup + final audit

- [ ] 19.1 Confirm `packages/ui-core/src/components/dialog.tsx` does NOT exist on disk
- [ ] 19.2 Confirm zero `import.*from '@offisim/ui-core'` lines mention `Dialog` (without `Shell`) in product code
- [ ] 19.3 Confirm `packages/ui-office/src/components/sop/SopAddStepPopover.tsx` no longer references `style.left` / `style.top` / `document.addEventListener('pointerdown')` / `document.addEventListener('keydown')`
- [ ] 19.4 Confirm `EmployeeCreatorOverlay.tsx:152` no longer contains `max-h-[200px]`
- [ ] 19.5 Confirm `PublishDialog.tsx:300` no longer contains `max-h-[calc(100vh-2rem)] overflow-y-auto`
- [ ] 19.6 Confirm `dialog-shell.tsx` exports an `xs` size in `SIZE_CLASS` and animation timings are `duration-150` / `duration-250`
- [ ] 19.7 Run `pnpm --filter @offisim/ui-core typecheck && pnpm --filter @offisim/ui-office typecheck` final pass — zero errors
