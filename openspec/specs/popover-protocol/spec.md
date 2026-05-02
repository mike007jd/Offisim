# popover-protocol Specification

## Purpose
TBD - created by archiving change rebuild-dialog-and-popover-system. Update Purpose after archive.
## Requirements
### Requirement: Single canonical Popover primitive in `@offisim/ui-core`

`packages/ui-core` SHALL ship exactly one Popover primitive at
`packages/ui-core/src/components/popover.tsx`, built on
`@radix-ui/react-popover`. It SHALL export:

- `Popover` — re-export of `PopoverPrimitive.Root`
- `PopoverTrigger` — re-export of `PopoverPrimitive.Trigger`
- `PopoverAnchor` — re-export of `PopoverPrimitive.Anchor`
- `PopoverContent` — `forwardRef` wrapper around
  `PopoverPrimitive.Content` with default styling, default
  `sideOffset={6}`, and `modal-stack.ts` integration
- `PopoverArrow` — re-export of `PopoverPrimitive.Arrow`

`@radix-ui/react-popover` SHALL be added to `packages/ui-core/package.json`
dependencies. Every floating, anchored, dismissable surface in the
product that is NOT a modal dialog SHALL use this primitive.
Hand-rolled positioning, document-level event listeners, hand-rolled
portals, and ad-hoc absolute-positioned div containers for popover-
shaped surfaces SHALL NOT ship.

#### Scenario: Popover primitive is exported
- **WHEN** importing from `@offisim/ui-core`
- **THEN** `Popover`, `PopoverTrigger`, `PopoverAnchor`, `PopoverContent`, and `PopoverArrow` are available exports
- **AND** the underlying file `packages/ui-core/src/components/popover.tsx` exists

#### Scenario: Hand-rolled popovers are removed
- **WHEN** grepping `packages/ui-office/src/**/*.tsx` for `style.left` / `style.top` patterns combined with `pointerdown` document listeners on hand-rolled popover surfaces
- **THEN** zero matches exist in `SopAddStepPopover.tsx` (rewritten to Radix) or any other popover surface

### Requirement: Popovers trap focus and restore focus on close

`PopoverContent` SHALL trap Tab focus inside the rendered content
while open. When the popover dismisses, focus SHALL return to the
element that opened it (the trigger element when used with
`PopoverTrigger`, or the previously focused element when used with
`PopoverAnchor`).

This is the default behavior of `@radix-ui/react-popover`; the
primitive SHALL NOT disable it via `onOpenAutoFocus.preventDefault()`
or `onCloseAutoFocus.preventDefault()` unless an explicit caller
opt-out prop is added (and no such prop is added in this change).

#### Scenario: Tab cycles inside popover
- **WHEN** a popover is open and the user presses Tab
- **THEN** focus moves to the next focusable element inside the popover content
- **AND** when the last element is reached, Tab cycles to the first focusable element

#### Scenario: Focus returns to trigger after dismiss
- **WHEN** a popover is open and the user presses Escape (or clicks outside)
- **THEN** the popover dismisses
- **AND** focus returns to the trigger element

### Requirement: Popovers dismiss on Escape and outside pointer

`PopoverContent` SHALL dismiss when the user presses Escape and SHALL
stop the Escape event from propagating to parent surfaces (so a
popover opened inside a dialog dismisses the popover only, not the
dialog).

`PopoverContent` SHALL dismiss when the user clicks (or taps)
outside the popover bounds. Callers MAY suppress this via
`onInteractOutside={(event) => event.preventDefault()}` for
dirty-state cases.

#### Scenario: Escape dismisses popover only
- **WHEN** a popover is open above a `DialogShell`-backed dialog and the user presses Escape
- **THEN** the popover dismisses
- **AND** the parent dialog remains open
- **AND** the Escape event SHALL NOT fire the dialog's close handler

#### Scenario: Outside click dismisses
- **WHEN** a popover is open and the user clicks outside the popover bounds
- **THEN** the popover dismisses (unless the caller passed `onInteractOutside.preventDefault()`)

#### Scenario: Caller suppresses outside-click dismiss
- **WHEN** a caller passes `onInteractOutside={(event) => event.preventDefault()}` to `PopoverContent`
- **AND** the user clicks outside the popover
- **THEN** the popover SHALL NOT dismiss

### Requirement: Popovers register with `modal-stack.ts` as `kind: 'popover'`

`PopoverContent` SHALL register the open popover with `modal-stack.ts`
via `useRegisterModal(stackId, 'popover')` while open. The `stackId`
SHALL come from a caller-provided `stackId?: string` prop, falling
back to a generated `useId()` value when omitted.

The `StackEntry['kind']` union in `packages/ui-core/src/lib/modal-stack.ts`
SHALL be extended from `'dialog' | 'overlay'` to `'dialog' | 'overlay' |
'popover'`. `useRegisterModal`, `useTopmostEscape`,
`useAnyModalOpen`, `useIsTopmostModal`, and `useModalStackDepth`
SHALL accept and propagate the new kind without behavior changes
beyond accepting it as a valid input.

`useAnyModalOpen()` SHALL return `true` when any popover is open (so
Office workspace shortcuts gate appropriately while a popover is
visible).

#### Scenario: modal-stack accepts popover kind
- **WHEN** auditing `packages/ui-core/src/lib/modal-stack.ts`
- **THEN** the `StackEntry['kind']` type union SHALL include `'popover'`
- **AND** `useRegisterModal(id, 'popover')` SHALL register the entry without throwing

#### Scenario: Office shortcut gated while popover open
- **WHEN** a popover is open over the Office workspace
- **AND** the user presses an Office workspace shortcut (e.g. `Cmd+D` for dashboard)
- **THEN** `useAnyModalOpen()` SHALL return `true` and the shortcut SHALL NOT mutate workspace state

#### Scenario: Popover stack ID is stable per popover instance
- **WHEN** a popover renders with an explicit `stackId` prop and re-renders for the same logical instance
- **THEN** the registered stack ID SHALL match across renders (no churn from re-generated `useId()` values)

### Requirement: Popovers nest above dialog content via z-index

`PopoverContent`'s default styling SHALL include the tokenized
`z-top` layer, placing the popover above `DialogShell` content
(`z-modal`) so a popover opened inside a dialog renders visually above
the dialog body. Hand-rolled popovers using literal z-index classes
that collide with the dialog overlay SHALL NOT ship.

Because Radix Popover renders into a portal anchored to its parent
and applies its own stacking context, the explicit `z-top` on
`PopoverContent` is a defense-in-depth safeguard, not the only
mechanism — the Radix portal already places the popover above its
parent dialog content.

#### Scenario: Popover stacks above dialog content
- **WHEN** a popover is open inside a dialog at viewport `1440×900`
- **THEN** the popover content's stacking context SHALL be above the dialog content
- **AND** the popover content SHALL NOT be visually obscured by the dialog content

#### Scenario: PopoverContent default class includes tokenized top layer
- **WHEN** auditing `packages/ui-core/src/components/popover.tsx`
- **THEN** the default className passed to `PopoverPrimitive.Content` SHALL include `z-top`

### Requirement: Popovers anchor to a trigger or to a `PopoverAnchor`

`PopoverContent` SHALL position itself relative to either:

- the element rendered by `PopoverTrigger` (default), or
- the element rendered by `PopoverAnchor` when the caller provides
  one (use case: anchor to a non-trigger element such as a SOP step
  card on a canvas).

Caller SHALL NOT pass screen-space `position: { x, y }` props for
absolute positioning. The hand-rolled coordinate-based positioning in
`SopAddStepPopover` (current behavior) SHALL be removed.

#### Scenario: Popover anchors to trigger by default
- **WHEN** a popover is rendered as `<Popover><PopoverTrigger>+</PopoverTrigger><PopoverContent>...</PopoverContent></Popover>`
- **THEN** the popover content SHALL position relative to the trigger element using Radix's `side` / `align` algorithm

#### Scenario: Popover anchors to PopoverAnchor when supplied
- **WHEN** a caller renders `<Popover><PopoverAnchor><div ref={anchorRef}/></PopoverAnchor><PopoverContent>...</PopoverContent></Popover>`
- **THEN** the popover content SHALL position relative to the anchor element, not any trigger

#### Scenario: SopAddStepPopover no longer uses screen-space coords
- **WHEN** auditing `packages/ui-office/src/components/sop/SopAddStepPopover.tsx`
- **THEN** the file SHALL NOT include a `position: { x: number; y: number }` prop or `style.left` / `style.top` values
- **AND** the file SHALL render `<Popover>` / `<PopoverContent>` from `@offisim/ui-core`

### Requirement: Popovers SHALL render `role="dialog"` semantics from Radix

`PopoverContent` SHALL render with `role="dialog"` (Radix's default)
and SHALL include `aria-labelledby` (or equivalent) when a label is
provided in the popover body — typically via the first heading
element. Callers SHALL provide a sensible heading or `aria-label` so
screen readers announce the popover purpose.

#### Scenario: Popover has dialog role
- **WHEN** opening any popover rendered through `PopoverContent`
- **THEN** the rendered DOM SHALL have `role="dialog"` on the content element

#### Scenario: SOP add-step popover announces purpose
- **WHEN** a screen reader is active and the user opens `SopAddStepPopover`
- **THEN** the announcement SHALL include the popover's purpose (e.g. "Add step, dialog")

### Requirement: Popovers ship the same animation timings as dialogs

`PopoverContent` SHALL apply Tailwind data-state classes:
`data-[state=open]:animate-in data-[state=closed]:animate-out
data-[state=open]:fade-in-0 data-[state=closed]:fade-out-0
data-[state=open]:zoom-in-95 data-[state=closed]:zoom-out-95
data-[state=open]:duration-150 data-[state=closed]:duration-250`.

This matches the dialog timing (150ms open / 250ms close) so a
popover opened inside or above a dialog feels consistent.

#### Scenario: Popover animation matches dialog timing
- **WHEN** auditing `packages/ui-core/src/components/popover.tsx`
- **THEN** the default className for `PopoverContent` SHALL include `data-[state=open]:duration-150` and `data-[state=closed]:duration-250`
- **AND** the className SHALL include the same `animate-in` / `animate-out` / `fade-in-0` / `fade-out-0` / `zoom-in-95` / `zoom-out-95` data-state classes used by `DialogShell`

### Requirement: SopAddStepPopover SHALL be the first migration consumer

`packages/ui-office/src/components/sop/SopAddStepPopover.tsx` SHALL
be rewritten in this change to consume the new `Popover` primitive.
The rewrite SHALL:

- Replace the hand-rolled `<div ref={popoverRef} style={...}>` with
  `<Popover><PopoverTrigger>...</PopoverTrigger><PopoverContent>...
  </PopoverContent></Popover>` (or use `PopoverAnchor` for non-
  trigger anchoring).
- Remove the screen-space `position: { x, y }` prop and the
  `Math.min(...)` window-edge clamping logic.
- Remove the manual `document.addEventListener('pointerdown', ...)`
  and `window.addEventListener('keydown', ...)` listeners — Radix
  handles outside-click and Escape internally.
- Drop the manual `inputRef.current?.focus()` `useEffect` if Radix's
  `onOpenAutoFocus` default suffices; otherwise keep the manual focus
  but execute it after Radix has set up the focus trap (e.g. inside
  `onOpenAutoFocus={(event) => { event.preventDefault();
  inputRef.current?.focus(); }}`).
- Update the `SopViewSurface.tsx` callsite (current state shape
  `addStepPopover: { canvasX, canvasY, editStepId } | null`) to drop
  the canvas coordinates and use the trigger / anchor pattern.

#### Scenario: SopAddStepPopover uses Popover primitive
- **WHEN** auditing the rewritten `SopAddStepPopover.tsx`
- **THEN** the file SHALL import `Popover`, `PopoverTrigger` (or `PopoverAnchor`), and `PopoverContent` from `@offisim/ui-core`
- **AND** the file SHALL NOT contain `position: {`, `style.left`, `style.top`, or top-level `document.addEventListener` calls

#### Scenario: SopViewSurface drops popover coords
- **WHEN** auditing `packages/ui-office/src/components/sop/SopViewSurface.tsx`
- **THEN** the popover state shape SHALL NOT contain `canvasX` / `canvasY` fields
- **AND** the popover anchor SHALL be either the `+ Add step` button (create mode) or a `PopoverAnchor` overlay positioned at the SOP step DOM node (edit mode)

