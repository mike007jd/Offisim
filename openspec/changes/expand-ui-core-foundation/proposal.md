## Why

`packages/ui-core` is the only sanctioned home for application-level atomic
components, but the current set is incomplete: 6 commonly-needed primitives
(`Checkbox`, `Radio`/`RadioGroup`, `Switch`, `Tooltip`, `Popover`, `Avatar`)
do not exist, so feature code ad-hoc rolls them — `SopAddStepPopover` hand
rolls a popover with raw `<input>` / `<select>` / `<textarea>` inside a
floating div with manual outside-click and Escape; `RuntimeBindingControl`
fakes a radiogroup out of `<button role="radio">` cards because there is
no shared radio primitive; chat / settings / install all rely on native
`title=` tooltips. Existing primitives also have unfinished surfaces:
`Button` has no `isLoading` state (every async submit screen reinvents it),
`Input` / `Textarea` / `Select` have no `error` / `helperText` / inline
validation contract, `Badge` has no size variant or dismissible affordance,
`DropdownMenuItem` has no `destructive` variant, `Card` has no `CardFooter`,
`Progress` has no size or semantic-tone variants. Several focus rings still
use `focus:` instead of `focus-visible:` (Select trigger / Select item /
DropdownMenuItem / Dialog Close button) so a mouse click leaves a sticky
ring on the active element; `Input.py-1` (h-9) vs `SelectTrigger.py-2`
(also h-9 but visually heavier) drift the form-row baseline by 4px.

The audit also surfaced that `apps/web/src/components` has zero raw
`<button>` / `<input>` and zero ui-core imports — the application shell
already routes everything through ui-core via `ui-office`. So the SSOT
contract is real, but ui-core has been treated as a "closed set" and people
work around gaps rather than extend it. We need to (1) close the gaps so
nobody has an excuse to leave the SSOT, (2) lock in the SSOT contract as a
spec requirement, and (3) clean up a11y inconsistencies that have piled up
across primitives.

Pre-launch — no back-compat shims, single complete delivery.

## What Changes

- **Add 6 missing primitives** built on Radix Primitives where possible so
  a11y semantics, keyboard, and portal/positioning are not hand-rolled:
  - `Checkbox` (`@radix-ui/react-checkbox`) with `indeterminate` state and
    label association
  - `Radio` + `RadioGroup` (`@radix-ui/react-radio-group`)
  - `Switch` / `Toggle` (`@radix-ui/react-switch`)
  - `Tooltip` + `TooltipProvider` (`@radix-ui/react-tooltip`) with 700ms
    open delay and side-auto-flip
  - `Popover` (`@radix-ui/react-popover`) — Change B (`rebuild-dialog-and-popover-system`)
    consumes this to replace the hand-rolled `SopAddStepPopover` shell;
    this change ships the primitive, Change B integrates it
  - `Avatar` — generic (NOT DiceBear / brand) with size presets
    (`xs` / `sm` / `md` / `lg` / `xl`), letter fallback, and fallback
    icon. Internal-employee DiceBear and external-employee brand SVGs stay
    in `packages/ui-office/src/components/shared/{EmployeeAvatar,DicebearAvatar,BrandAvatar2D}.tsx`
    where the seed/brand-key resolution lives — `Avatar` is the
    cosmetic outer frame ui-office composes with
- **Complete state matrices on existing components**:
  - `Button` — add `isLoading?: boolean` prop; renders `<Loader2 className="animate-spin">`
    in front of children, sets `aria-busy="true"`, and forces `disabled`
    semantics while preserving width (no layout shift). Spinner color
    inherits per-variant text color so `destructive`/`outline`/`ghost`
    spinners look right
  - `Input`, `Textarea`, `SelectTrigger` — add `error?: boolean` +
    `helperText?: string` + auto-wired `aria-describedby` + `aria-invalid`.
    Error state swaps border to `border-red-400/60` and helperText color
    to `text-red-300`. Helper text renders in a `<p>` below the field with
    a generated id; if `error` is true the `aria-invalid` attribute is set
  - `SelectTrigger` `py-2` and `Input` `py-1` reconcile to a shared
    `py-1.5` token so a Select sits flush with an Input on the same form row
  - `Badge` — add `size?: 'xs' | 'sm' | 'md'` (default `sm` matches today's
    look) and `dismissible?: boolean` + `onDismiss?: () => void` rendering
    a right-side `<X>` icon that triggers the callback with `aria-label="Dismiss"`
  - `DropdownMenuItem` — add `variant?: 'default' | 'destructive'` (red text +
    icon) and replace `focus:bg-white/10 focus:text-slate-100` with
    `focus-visible:` equivalents
  - `Card` — add `CardFooter` (`p-4 pt-0 border-t border-white/10 flex
    items-center gap-2 justify-end`); export from index. Accept any number
    of action buttons via children rather than a typed prop slot
  - `Progress` — add `size?: 'sm' | 'md' | 'lg'` (heights `h-1` / `h-2` /
    `h-3`) and `tone?: 'default' | 'success' | 'warning' | 'error'` (cyan
    / emerald / amber / red fill colors)
- **a11y baseline fixes**:
  - `Select.tsx:17` Trigger `focus:` → `focus-visible:`
  - `Select.tsx:66` Item add `focus-visible:` ring alongside existing
    `focus:bg-white/10` (Radix sets `data-highlighted` on keyboard nav, so
    we keep the bg highlight but add the ring for the focused state)
  - `Dialog.tsx:41` Close button `focus:` → `focus-visible:`
  - `DropdownMenu.tsx:35` `focus:` → `focus-visible:`
  - All overlay surfaces (`Dialog`, `DialogShell`, `OverlayShell`,
    `Popover`) SHALL set `aria-modal="true"` + `role="dialog"` + carry
    `aria-labelledby` (or `aria-label` if no visual title)
  - `Input` / `Textarea` / `SelectTrigger` SHALL auto-wire
    `aria-describedby` to the helper-text id when `helperText` is set,
    and `aria-invalid="true"` when `error` is set
  - Icon-only buttons (Button with `size="icon"` and no text children)
    SHALL warn at dev time when no `aria-label` is provided. Implementation:
    a `useEffect` in dev (`import.meta.env.DEV`) walks `props.children` and
    `console.warn` if it finds none and `aria-label` is missing
  - All ui-core surfaces SHALL meet WCAG 2.1 AA contrast for text. The
    `text-slate-200` / `text-slate-300` palette on `bg-slate-900` /
    `bg-white/5` is documented and verified against AA in the spec
- **SSOT contract** — The `ui-core-component-library` capability formally
  declares: any application-level atomic component (Button, Input, Card,
  Dialog, Tooltip, etc.) consumed in `apps/*` or `packages/ui-office`
  SHALL come from `@offisim/ui-core` exports. Local `<button>` / `<input>`
  / `<textarea>` / `<select>` / hand-rolled tooltip / hand-rolled popover
  / hand-rolled radio cards are forbidden in component code. Exception:
  `apps/web/src/polyfills/` and `apps/desktop/src-tauri/` for non-component
  code; canvas-rendered content (scene, 3D, DAG nodes drawn into `<canvas>`)
  is out of scope
- **Cross-package migration** — audit found these self-rolled UI sites that
  this change SHALL migrate to ui-core primitives in the same delivery:
  - `packages/ui-office/src/components/sop/SopAddStepPopover.tsx` — full
    rewrite using `Popover` + `Input` + `Select` + `Textarea` (replaces
    the hand-rolled outside-click + Escape shell). Coordinated with
    Change B which consumes the new `Popover` primitive
  - `packages/ui-office/src/components/runtime/RuntimeBindingControl.tsx` —
    keep the card-style radio visual (it is a rich card layout, not a
    plain radio), but rebuild on the new `RadioGroup` primitive so the
    keyboard / a11y semantics come from Radix instead of the hand-rolled
    `button role="radio"` workaround
  - `packages/ui-office/src/components/employees/EmployeeQuickCard.tsx`
    raw `<input>` / `<textarea>` (lines 101 / 103) — replace with
    ui-core `Input` / `Textarea`
  - All native `title=` tooltips on critical affordances (Settings tabs,
    SOP sidebar overflow, Studio palette buttons, Header status icons) —
    replace with `Tooltip` so screen readers and keyboard users get the
    same hint a hover-with-mouse user gets
- **Component library docs**: extend `packages/ui-core/src/index.ts`
  exports for every new primitive and every new sub-export
  (`CardFooter`, `Checkbox`, `Radio`, `RadioGroup`, `Switch`, `Tooltip`,
  `TooltipProvider`, `TooltipTrigger`, `TooltipContent`, `Popover`,
  `PopoverTrigger`, `PopoverContent`, `PopoverAnchor`, `Avatar`,
  `AvatarFallback`)
- **Live verification**: keyboard Tab walk through every new + modified
  primitive in a story-style page (built temporarily in `apps/web/src/dev/`,
  removed at archive time), screen reader VoiceOver pass on
  Checkbox / Radio / Switch / Tooltip / Popover / Dialog, contrast checker
  on representative surfaces; recorded in tasks Section 13

## Capabilities

### New Capabilities

- `ui-core-component-library`: `@offisim/ui-core` is the single source of
  truth for application-level atomic UI components. SHALL list the full
  set of supported primitives, the state matrix each one supports
  (default / hover / active / focus / focus-visible / disabled / error /
  loading / indeterminate where relevant), and the contract that
  `apps/*` and `packages/ui-office` MUST compose application UI from
  these primitives rather than raw HTML form elements or hand-rolled
  popovers / tooltips / radio cards.

- `ui-core-a11y-baseline`: Keyboard, focus, ARIA, and contrast contracts
  every ui-core component SHALL satisfy. Includes the
  `focus:` → `focus-visible:` rule, the form-control
  `aria-describedby` / `aria-invalid` auto-wiring rule, the icon-only
  button `aria-label` dev-warn rule, the modal-surface
  `role="dialog"` / `aria-modal="true"` / labelling rule, the WCAG 2.1
  AA contrast floor, and the keyboard-only navigation contract for
  every interactive primitive.

### Modified Capabilities

- `design-system-consolidation`: extend the SSOT-primitives requirement
  list to include the new ui-core primitives (Checkbox, Radio,
  RadioGroup, Switch, Tooltip, Popover, Avatar) and the new sub-exports
  (CardFooter, dismissible Badge, destructive DropdownMenuItem,
  Button.isLoading, Input/Textarea/Select error+helperText). Touched
  surfaces SHALL prefer ui-core over duplicating these patterns.

## Impact

- **Code (ui-core)**: 6 new component files (`checkbox.tsx`, `radio.tsx`,
  `switch.tsx`, `tooltip.tsx`, `popover.tsx`, `avatar.tsx`); modifications
  to `button.tsx` (loading), `input.tsx` (error+helperText), `textarea.tsx`
  (same), `select.tsx` (same + focus-visible + py reconciliation),
  `badge.tsx` (size + dismissible), `dropdown-menu.tsx` (variant +
  focus-visible), `card.tsx` (CardFooter), `progress.tsx` (size + tone),
  `dialog.tsx` (focus-visible). Updates to `index.ts` re-exports.
- **Code (ui-office migration)**: rewrite `SopAddStepPopover.tsx`,
  `RuntimeBindingControl.tsx`, `EmployeeQuickCard.tsx`; add Tooltip
  wraps on Settings / SOP / Studio / Header icon affordances enumerated
  in tasks 11.x.
- **New deps**: `@radix-ui/react-checkbox`, `@radix-ui/react-radio-group`,
  `@radix-ui/react-switch`, `@radix-ui/react-tooltip`,
  `@radix-ui/react-popover`, `@radix-ui/react-avatar`. Added to
  `packages/ui-core/package.json` `dependencies`. Bundle delta is
  bounded — Radix primitives are small (each ~3-8 KB minzipped), and
  they share `@radix-ui/react-context` / `react-primitive` / `react-slot`
  which ui-core already depends on transitively.
- **TooltipProvider hoist**: `apps/web/src/App.tsx` and
  `apps/desktop` (which reuses web dist) need a single
  `<TooltipProvider delayDuration={700}>` at the root so all Tooltip
  usages share the same provider; Change documents the mount site.
- **No back-compat shims**: pre-launch. Old hand-rolled `SopAddStepPopover`
  is replaced wholesale; the `<button role="radio">` cards in
  `RuntimeBindingControl` are replaced with `RadioGroup` + custom child
  rendering; the cyan focus-ring style stays the same so visual diff is
  contained to `focus:` → `focus-visible:` (no change for keyboard, only
  removes sticky ring on mouse click).
- **Live verification**: physical keyboard Tab walkthrough of each new
  primitive on representative surfaces, screen reader pass on
  Checkbox / Radio / Switch / Tooltip / Popover / Dialog, contrast tool
  spot-check on cyan-on-slate-900 / red-on-slate-900 / amber-on-slate-900
  text. Verification recorded in Section 13.
- **Spec/docs sync**: `CLAUDE.md` does not need a Cross-Cutting Facts
  entry (this is a ui-core internal scope), but `packages/ui-office/CLAUDE.md`
  Settings/SOP/Studio sections SHALL stop documenting hand-rolled UI
  patterns once they are migrated. `openspec/protocols-ledger.md` Tauri
  / A2A / etc. rows are unaffected (no protocol surface changes).
