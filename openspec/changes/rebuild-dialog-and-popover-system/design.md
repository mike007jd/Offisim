## Context

The repo carries two parallel modal-dialog primitives. The legacy
`packages/ui-core/src/components/dialog.tsx` was authored as a thin shadcn
wrapper around `@radix-ui/react-dialog` with hard-coded layout (one
content column, no sticky regions, hand-placed close button). It is
consumed by 7 product surfaces. The newer
`packages/ui-core/src/components/dialog-shell.tsx` introduced the
three-region (header / body / footer) layout, the `onRequestClose` dirty
guard, and `useRegisterModal` integration with `modal-stack.ts` — but it
shipped late so only `ProjectCreateDialog` and `KeyboardShortcutsDialog`
adopted it. The two-primitive split is the root cause of the failures
documented in the proposal:

- `PublishDialog` is the canonical example of "dialog without sticky
  footer fails on long forms" — the Submit/Download row gets pushed
  off-screen because there is no explicit footer region.
- `InstallDialog` shows the cost of duplicating layout per step — its
  `ErrorContent` lacks Retry not because of a missing state, but because
  a hand-rolled step→render switch makes per-step footer composition
  inconvenient.
- `SopEditorDialog` / `SopImportDialog` lack dirty checks because there
  is no `onRequestClose` on the legacy `Dialog`.
- `SopAddStepPopover` exists because there is no shared Popover primitive
  at all. Authors hand-roll, drop a11y on the floor, and pick the same
  z-index as the dialog overlay.

`EmployeeCreatorOverlay` is the cross-cutting overlay: it is not a modal
dialog (it's a full-screen workspace overlay), but it shares the same
narrow-tier failure mode (avatar pane pushed below fold, two stacked
scrollers, no dirty check on Back).

`@radix-ui/react-popover` is not yet a dependency; this change adds it
to `packages/ui-core/package.json`. Radix versions for `react-dialog`
and `react-dropdown-menu` are pinned at `^1.1.15` and `^2.1.16`; use
the latest minor of `@radix-ui/react-popover` available at landing time
(currently `^1.1.x`).

The pre-launch directive applies: no migration window, no dual-primitive
period, no shim. The legacy file is deleted in the same change that
migrates every consumer.

## Goals / Non-Goals

**Goals:**
- One modal primitive (`DialogShell`) ships in `@offisim/ui-core`. The
  legacy `Dialog` / `DialogContent` exports are gone.
- One Popover primitive (`Popover` / `PopoverContent`) ships in
  `@offisim/ui-core`. `SopAddStepPopover` and any future popover in the
  product use it. Hand-rolled portals / positioning are forbidden.
- Every persistent-edit dialog implements `onRequestClose` returning
  `false` with a discard-confirm path. Read-only dialogs explicitly do
  not.
- Every dialog ships `role="dialog"` + `aria-modal="true"` +
  `aria-labelledby={titleId}` automatically when consumed via the SSOT.
  Caller cannot accidentally drop a11y attrs.
- Dialog open animation is `150ms`, close animation is `250ms`, both via
  Tailwind data-state classes on Overlay + Content.
- Dialog size presets cover `xs` (20rem) / `sm` (24rem) / `md` (32rem) /
  `lg` (42rem) / `xl` (56rem) / `full` (clamp). New `xs` for one-line
  confirms.
- Narrow tier (`≤ 768px width`) renders dialogs without two stacked
  vertical scrollers. Avatar / preview panes inside dialogs stack
  vertically and the form body owns the only scroll. Close button hit
  area ≥ 44×44.
- `EmployeeCreatorOverlay` Back button confirms discard when the form
  has user input.
- `PublishDialog` Submit / Download row stays sticky at the bottom
  regardless of form length.
- `InstallDialog` Error step has Retry that re-enters `loading`.

**Non-Goals:**
- Migrating `EmployeeCreatorOverlay` to `DialogShell`. It is a
  full-screen workspace overlay, not a modal dialog. Scope of this
  change is the narrow-tier layout fix + dirty-check Back, not the
  overlay primitive (`overlay-shell.tsx` already exists; cross-overlay
  consolidation is out of scope).
- Touching Settings / Personnel / Studio surfaces. Those are workspace
  pages, not dialogs.
- Extending `panel-and-dialog-sizing` to cover Settings sub-tabs further
  (already covered by existing requirements).
- Building a dialog-from-popover (combobox-style) primitive. Future
  change if needed.
- Theming / token unification. Change F covers that. We use existing
  Tailwind classes (`bg-slate-900`, `border-white/10`) to keep diff
  surface focused.
- Animation refinement beyond timing (e.g. easing curve customisation).
  Stay with Tailwind defaults.
- Replacing Radix entirely. Radix is the platform for both Dialog and
  the new Popover.

## Decisions

### Decision 1: Delete the legacy Dialog primitive outright

`packages/ui-core/src/components/dialog.tsx` is removed in the same
commit that migrates every consumer. `Dialog`, `DialogTrigger`,
`DialogContent`, `DialogHeader`, `DialogTitle`, `DialogDescription`,
`DialogClose` exports SHALL NOT exist after this change. The
`packages/ui-core/src/index.ts` barrel removes those names; build will
fail anywhere a consumer still imports them.

**Rationale**: pre-launch, no production users, no semver concern. A
deprecation window means two primitives co-exist and new code keeps
landing on the legacy one (proven by every dialog added since
`DialogShell` shipped). Hard cut is cheaper.

**Alternative considered**: keep `Dialog` as a shim that delegates to
`DialogShell`. Rejected — different prop shapes (`Dialog` is open/portal/
overlay/content composition, `DialogShell` is a single component with
named slots), the shim would either require all 7 consumers to migrate
prop names anyway (defeats the point) or accept lossy semantics
(loses the dirty-check / a11y wins). Direct migration is the same diff
size with no behavior compromise.

### Decision 2: `DialogShell` becomes the only modal primitive

`DialogShell` already implements: Radix Dialog backend, `useRegisterModal`
integration, three-region layout (header/body/footer) when title or
footer slot is provided, `onRequestClose` for dirty check,
`closeOnBackdrop` / `closeOnEscape` flags, size preset map, the existing
`DIALOG_SIZING_CLASS` clamp expression on inner flex column.

This change extends it with:

- **`size: 'xs' | 'sm' | 'md' | 'lg' | 'xl' | 'full'`** — adds `xs` →
  `max-w-xs` (320px / 20rem). Use case: 1-line confirm dialogs (Discard
  changes? Delete X?). `sm` (24rem) was the floor; `xs` is the new
  floor.
- **`role="dialog"` + `aria-modal="true"` + `aria-labelledby={titleId}`**
  — Radix `DialogPrimitive.Content` already sets these when a
  `DialogPrimitive.Title` is present, but the shell SHALL pass an explicit
  `aria-labelledby` ID even when the caller renders a custom title node
  via `title={<CustomNode/>}`. Implementation: shell generates `useId()`
  for the title element, sets `aria-labelledby` on Content, wraps the
  custom title in `<DialogPrimitive.Title id={titleId}>`. If caller
  passes only `description` with no title, fall back to
  `aria-describedby={descId}` and synthesize a visually-hidden
  `<DialogPrimitive.Title>` so screen readers still announce a label.
- **Animation `150ms` open / `250ms` close** — both Overlay and Content
  get `data-[state=open]:duration-150 data-[state=closed]:duration-250`.
  The current `duration-200` class is removed.
- **Narrow-tier close button hit area** — replace `h-8 w-8` with
  `relative h-8 w-8 before:absolute before:inset-[-6px] before:content-['']`
  on `≤ 768px` to expand the click target to 44×44 without changing the
  visible button size. Above 768px, the visible 32px target is sufficient
  for mouse / trackpad.
- **`w-[calc(100%-1rem)]` on narrow** — replace `w-[calc(100%-2rem)]`
  with responsive `w-[calc(100%-1rem)] sm:w-[calc(100%-2rem)]` so
  320px viewport gets 304px usable width instead of 256px.

**Rationale**: every gap in the legacy `Dialog` becomes a SHALL on the
shell. No new primitive needed.

**Alternative considered**: extract a third "headless dialog" primitive
and have both the legacy and new layout consume it. Rejected — adds
a layer with no consumers other than the two existing ones; YAGNI.

### Decision 3: New `Popover` primitive on Radix, integrated with modal-stack

`packages/ui-core/src/components/popover.tsx`:

```
Popover           — Radix Root
PopoverTrigger    — Radix Trigger (forwarded)
PopoverAnchor     — Radix Anchor (forwarded; for non-trigger anchoring)
PopoverContent    — wrapped Radix Content with default styling +
                    modal-stack registration
PopoverArrow      — Radix Arrow (forwarded; optional pointer)
```

`PopoverContent` accepts: `side`, `align`, `sideOffset`, `alignOffset`,
`collisionPadding`, `avoidCollisions`, plus `stackId?: string` for
optional explicit stack ID; if omitted, generates a `useId()` and
registers as `kind: 'popover'` while the popover is open.

`modal-stack.ts` already accepts `'dialog' | 'overlay'`. We extend the
`StackEntry['kind']` union to `'dialog' | 'overlay' | 'popover'`. Escape
ordering rule: when a popover is the topmost stack entry, Escape
dismisses the popover and stops propagation. When a dialog is topmost
above a popover (impossible by construction since you can only open a
popover from inside a dialog), the dialog handles Escape first. When
both a popover and a dialog are open and the popover is topmost,
Escape dismisses the popover only.

**z-index policy**: `Popover` content sits at `z-[60]` (above dialog
content at `z-50` but below dialog overlay siblings — actually identical
since Radix renders the popover into its own portal, but the explicit
`z-[60]` makes the layering visible). Hand-rolled popovers using
`z-50` (current `SopAddStepPopover`) are forbidden after this change.

**Rationale**: Radix Popover gives us focus trap, focus restoration,
collision detection, portal rendering, ARIA (`role="dialog"` for the
content, `aria-haspopup="dialog"` on the trigger) for free. Hand-rolling
all of this in 7 callers is the kind of cost the SSOT pattern exists to
prevent.

**Alternative considered**: Floating UI directly. Rejected — Radix
`react-popover` already wraps Floating UI under the hood, and the rest
of `ui-core` is on Radix; consistent platform.

### Decision 4: Sticky three-region layout is the only Dialog layout

`DialogShell`'s inner JSX (`dialog-shell.tsx:143-176`) already renders:

```
flex flex-col [DIALOG_SIZING_CLASS]
├─ header (sticky top via flex; border-b)
├─ body   (min-h-0 flex-1 overflow-y-auto)  ← only scroller
└─ footer (sticky bottom via flex; border-t)
```

This change locks that as the only allowed layout — callers SHALL NOT
pass `className` overrides that change the inner flex chain or add
their own `overflow-y-auto`. Callers SHALL pass header / footer
content via the `title` / `description` / `footer` props, or pass the
entire shell via `children` for non-trivial bodies. The legacy pattern
of putting the whole layout inside `<DialogContent>` is gone.

For surfaces with form-lite content (e.g. `SopImportDialog`), the
existing `description` prop suffices. For richer headers
(`PublishDialog` has an icon + token preview row above the form),
caller can pass a custom node via `title` — shell handles the
`aria-labelledby` ID.

**Footer SHALL NOT scroll**. The body scrolls. Sticky-footer reservation
is automatic because `flex flex-col` + `flex-1 min-h-0` body + fixed-
height footer keeps the footer at the bottom of the dialog max-height.
The `DIALOG_SIZING_CLASS` clamp ensures the dialog never exceeds the
viewport, so the footer never escapes the visible area.

### Decision 5: Dirty-check protocol is mandatory on persistent-edit dialogs

`onRequestClose: () => boolean | undefined` SHALL be implemented when
the dialog body owns persistent edit state (text input, draft form,
multi-step wizard, publish draft, install bindings). The implementation
SHALL:

1. Compare current form state against the initial state passed to the
   dialog.
2. If unchanged, return `undefined` (let close proceed).
3. If changed, invoke `confirmDiscard()` which renders a
   `<ToastBanner variant="warning">` with `Discard changes?` / `Keep
   editing` (default) / `Discard` actions, AND return `false` to keep
   the dialog open.
4. If user clicks `Discard` in the toast, the toast handler calls
   `onOpenChange(false)` directly.

**Read-only dialogs SHALL NOT pass `onRequestClose`.** Read-only set:
`KeyboardShortcutsDialog` (display only), `InstallDialog` in `installing`
step (auto-progressing), `InstallDialog` in `done` step (terminal),
`InteractionPrompt` (decision must be made — uses `closeOnBackdrop=
false` / `closeOnEscape=false` instead).

**Rationale**: dirty-check via callback rather than dialog-internal
state lets each dialog define its own "dirty" rule (e.g. wizard with
12 steps vs single text input). The callback pattern already exists
in `DialogShell`; we lock it as SHALL.

**Alternative considered**: dialog-side `dirty: boolean` prop with
auto-discard-confirm. Rejected — dialog primitive shouldn't render
toasts; toasts are app-level concern. Callback keeps the primitive
focused.

### Decision 6: Animation timing is asymmetric (150ms in / 250ms out)

`DialogShell` Overlay and Content both apply
`data-[state=open]:duration-150` and `data-[state=closed]:duration-250`
classes. Tailwind's `data-[state=closed]:animate-out` plus
`data-[state=closed]:fade-out-0` plus duration class chain produce a
250ms exit fade. The existing `duration-200` is removed.

**Numeric rationale**:
- 150ms open: fast enough to feel snappy. 100ms is too snappy
  (jarring); 200ms is the legacy "balanced" value.
- 250ms close: noticeably slower than open. macOS / Material both
  recommend slower exits. 300ms feels sluggish on dialog dismiss;
  250ms threads the needle.

**Alternative considered**: identical timing (200/200, current). Rejected
— audit complaint is concrete: current close feels rushed. Asymmetric
is the platform-native idiom.

**Alternative considered**: 200ms in / 300ms out. Rejected — the gap is
the same (50ms) but both feel slightly slower; 150/250 is tighter and
matches the macOS HIG sheet animation.

### Decision 7: Size preset matrix locked

`SIZE_CLASS` map in `dialog-shell.tsx`:

```
xs:   max-w-xs           // 20rem / 320px
sm:   max-w-sm           // 24rem / 384px
md:   max-w-lg           // 32rem / 512px (current md)
lg:   max-w-2xl          // 42rem / 672px (current lg)
xl:   max-w-4xl          // 56rem / 896px (current xl)
full: max-w-[min(960px,calc(100vw-2rem))]
```

Caller SHALL pick from this set. `className` MAY adjust visual surface
(border, bg) but SHALL NOT override `max-width`. Enforcement: code
review + the dialog-overlay-protocol spec.

Mapping for the 7 migrating dialogs:
- `SopEditorDialog` → `md` (current `max-w-lg`)
- `SopImportDialog` → `sm` (current `max-w-md` ≈ sm)
- `InstallDialog` → `md` (current `max-w-lg`)
- `PublishDialog` → `xl` (current `max-w-3xl` ≈ xl)
- `InteractionPrompt` → `sm` (current `max-w-lg` over-sized; tighten)
- `InterviewWizard` → `lg` (current `max-w-2xl`)
- `ExternalEmployeeInstallDialog` → `lg` (current `max-w-xl`)

### Decision 8: Popover replaces SopAddStepPopover, anchored to the trigger

Current `SopAddStepPopover.tsx:31-134` takes a screen-space `position:
{x, y}` prop and self-positions absolutely. Caller code in
`SopViewSurface.tsx:99` stores the pointer-event coordinates when the
trigger is clicked.

After this change: `SopAddStepPopover` becomes a thin wrapper around
`Popover` + `PopoverTrigger` (the `+` button on the canvas) +
`PopoverContent` (the form). The `position` prop is removed. The
`SopViewSurface` state simplifies to `editStepId: string | null`
(or whatever flag drives create-vs-edit) — the screen-space coords
go away because Radix anchors to the trigger element.

**Edge case**: in edit mode, the popover should anchor to the step
node on the canvas, not a global `+` button. Implementation: in
`SopDagCanvas`, render an invisible `PopoverAnchor` at the step node's
DOM position when edit-mode is active for that step, then open the
Popover with `<PopoverContent>` rendering the form. Radix supports
non-trigger anchors via `<PopoverAnchor>` exactly for this case.

`zIndex` is set by Radix to a layer above any sibling content. Combined
with the modal-stack registration (`kind: 'popover'`), the popover
nests cleanly under any dialog (a popover opened from inside a
dialog renders into the dialog's portal-rooted content, so z-stacking
is automatically correct).

### Decision 9: EmployeeCreatorOverlay narrow-tier fix is layout-only

The overlay stays a full-screen workspace overlay (it's not a modal
dialog). Three changes:

1. Remove `max-h-[200px]` cap on the avatar pane
   (`EmployeeCreatorOverlay.tsx:152`).
2. On narrow (`< lg`, `< 1024px`), stack vertically: avatar header
   row at top (96px tall: small avatar + name pill + Randomize
   button), form pane below taking the rest of the viewport height
   with the only scrollbar.
3. Back button (`EmployeeCreatorOverlay.tsx:114`) checks `name.trim()
   .length > 0` and triggers a discard-confirm toast before calling
   `onClose` if dirty.

Tailwind responsive classes do all the work:

- Container: `flex h-screen flex-col` (existing) but switch from
  `lg:flex-row` mid-tree at `EmployeeCreatorOverlay.tsx:150`.
- Avatar pane on narrow: `flex h-[120px] shrink-0 flex-row items-center
  gap-3 px-4` (compact horizontal row at top); on lg restore full
  vertical pane.
- Form pane on narrow: `flex-1 overflow-y-auto px-4`; on lg restore
  side panel.

**Rationale**: cap + side-by-side combination is the failure mode.
Stacking with no cap is the simplest fix and matches the IA pattern
already used by other workspace overlays (Studio editor's narrow tier).

**Alternative considered**: convert the overlay to a `DialogShell` size
`full`. Rejected — full-screen overlay semantics differ from modal
dialog (no backdrop, integrates with workspace shell). Conversion
would touch `App.tsx` overlay routing; out of scope.

### Decision 10: InstallDialog Retry path

`useInstallFlow.ts` exposes `restart()` action that resets the state
machine to `loading` for the same `manifestUrl` / package descriptor.
`ErrorContent` in `InstallDialog.tsx` renders both Close and Retry —
Retry calls `restart()`, Close calls `cancel()`.

**Rationale**: the underlying state machine already supports
re-entering `loading`; it just needs an action verb and a button. No
deeper refactor.

**Alternative considered**: re-architect `InstallDialog` to a
component-per-step map with each step owning its own footer. Worth doing
but bigger scope. We do the minimum needed to land Retry; the
component-per-step refactor is folded in (Section 5 of `tasks.md`)
because every step migration to `DialogShell` already requires
extracting per-step footer handling.

## Risks / Trade-offs

[Risk] Hard-deleting `Dialog` exports breaks any consumer we missed.
→ Mitigation: tasks.md Section 12 includes `grep -rn "import.*Dialog.*from
'@offisim/ui-core'"` returning zero matches as a typecheck-equivalent
gate. The migration list is exhaustive (7 surfaces); the grep catches
any drift between this PR and main. Build will fail typecheck if any
remain.

[Risk] Popover Escape ordering interacts badly with dialog Escape
ordering when a popover is opened inside a dialog body.
→ Mitigation: Radix Popover handles Escape locally (preventDefault on
keydown) so the parent Radix Dialog never sees the event. Modal-stack
extension to `kind: 'popover'` is for shortcut gating
(`useAnyModalOpen` etc.), not for Escape ordering. Live verify: open
a popover inside `KeyboardShortcutsDialog` (or any dialog) and confirm
Escape dismisses popover only, leaves dialog open.

[Risk] Asymmetric animation makes the close feel laggy on slower
machines.
→ Mitigation: 250ms is well under the 400ms threshold where users
perceive lag. Tested baseline: 200ms close already feels too fast in
the audit; bumping to 250ms is pro-feel, not anti-perf.

[Risk] Removing the avatar pane height cap on narrow tier causes the
overlay to render taller than the viewport when the form pane has
many sections.
→ Mitigation: form pane gets `flex-1 overflow-y-auto`, becoming the
sole scroller. Avatar header row is fixed-height (120px). Dirty-check
on Back is independent. Live verify on iPhone-width emulation (375px)
and iPad-portrait (768px).

[Risk] Dirty check on `SopEditorDialog` interferes with the existing
`onCreated?.()` callback (auto-close on success).
→ Mitigation: `onCreated` path goes through `onOpenChange(false)`
directly (not through `onRequestClose`), bypassing the dirty check.
Implementation: in the success branch of `handleSave`, call
`onOpenChange(false)` directly instead of going through close protocol.
The discard path (Cancel button / Escape / backdrop) goes through
`onRequestClose`.

[Risk] PublishDialog migration changes diff surface (the `max-h-...
overflow-y-auto` was already there).
→ Mitigation: the new sticky-footer layout replaces the auto scroll
with body scroll + sticky footer. Visual effect: form scrolls behind
sticky footer. Verify the previously hidden Submit/Download row is now
always visible at viewport `1024x600` (laptop landscape mid-size).

[Risk] InstallFlow `restart()` re-enters `loading` but if the original
manifest URL is no longer valid (network died), Retry loops in error.
→ Mitigation: Retry is just a button; user can still click Close.
No infinite loop because each `restart()` is user-initiated.

[Trade-off] Adding `@radix-ui/react-popover` increases bundle size
~6KB gzipped. The replaced hand-rolled popover was ~1KB. Net +5KB.
→ Acceptable. Net win on a11y, focus mgmt, collision detection,
positioning. The bundle already carries 4 other Radix packages;
sharing one more is consistent.

[Trade-off] `xs` size preset adds a row to the SIZE_CLASS map and
nominally widens the surface API.
→ Acceptable. Confirm dialogs are a known pattern; without `xs`
callers either accept too-wide surfaces or hand-roll `className`
overrides — both worse outcomes.

[Trade-off] EmployeeCreatorOverlay dirty-check uses the existing
toast pattern from Settings rather than introducing an inline confirm
modal.
→ Acceptable. Toast is already the discard-confirm idiom in the
codebase (`useToasts` + `<ToastBanner>`); inline confirm modal would
nest a dialog inside an overlay, which the modal-stack supports but
adds visual complexity for a binary choice. Toast keeps the overlay
focused.

## Migration Plan

Pre-launch — no migration code, no shim. Single-PR delivery:

1. Add `@radix-ui/react-popover` to `packages/ui-core/package.json`
   dependencies; run `pnpm install` at repo root to update lockfile.
2. Create `packages/ui-core/src/components/popover.tsx` (Radix wrapper
   + modal-stack `'popover'` registration).
3. Extend `packages/ui-core/src/components/dialog-shell.tsx` (xs preset,
   asymmetric animation timings, narrow hit-area, narrow viewport
   width, contract-bound `aria-labelledby`).
4. Update `packages/ui-core/src/lib/modal-stack.ts` to accept `'popover'`
   in the `StackEntry['kind']` union.
5. Update `packages/ui-core/src/index.ts`:
   - Remove `Dialog`, `DialogTrigger`, `DialogContent`, `DialogHeader`,
     `DialogTitle`, `DialogDescription`, `DialogClose` exports.
   - Add `Popover`, `PopoverTrigger`, `PopoverAnchor`, `PopoverContent`,
     `PopoverArrow` exports.
6. Delete `packages/ui-core/src/components/dialog.tsx`.
7. Build `@offisim/ui-core`. Typecheck of `@offisim/ui-office` will
   fail at every legacy `Dialog` import. Migrate each one in turn:
   `SopEditorDialog` → `SopImportDialog` → `InstallDialog` →
   `PublishDialog` → `InteractionPrompt` → `InterviewWizard` →
   `ExternalEmployeeInstallDialog`.
8. Rewrite `SopAddStepPopover` on Radix Popover; update
   `SopViewSurface.tsx` callsite (drop screen-space coords).
9. Fix `EmployeeCreatorOverlay` narrow tier (remove avatar cap, stack
   vertically, dirty-check Back).
10. Add `restart()` action to `useInstallFlow.ts`; wire Retry button in
    `InstallDialog.ErrorContent`.
11. Run gates (Section 12 of `tasks.md`).
12. Live verification (Section 13 of `tasks.md`) on Tauri release `.app`
    + Web build at narrow / desktop tiers, with VoiceOver / NVDA pass.

No data migration. No checkpoint format change. No event emission
change. Spec updates land with the code in the same PR.
