## Context

`@offisim/ui-core` is already the only sanctioned home for application-level
atomic components — `apps/web/src/components` has zero raw `<button>`,
zero raw `<input>`, zero `<select>`, and zero direct ui-core imports
(everything routes through `packages/ui-office`). `packages/ui-office`
imports ui-core in 93 files. The SSOT structure works, but ui-core itself
is incomplete:

1. **6 missing primitives** force feature code to roll its own — most
   visible offender is `SopAddStepPopover` (135 lines of raw `<input>` /
   `<select>` / `<textarea>` inside a manually-positioned floating div
   with hand-rolled outside-click + Escape handlers). `RuntimeBindingControl`
   fakes a radiogroup out of `<button role="radio">` cards because there
   is no shared `RadioGroup`. Native `title=` tooltips appear on critical
   affordances (Settings tabs, SOP sidebar, Header). `EmployeeQuickCard`
   renders raw `<input>` and `<textarea>` (lines 101 / 103) in inline
   editors.
2. **Existing primitives have unfinished surfaces** — `Button` has no
   `isLoading`, every async submit invents one. `Input` / `Textarea` /
   `SelectTrigger` have no `error` + `helperText` + ARIA wiring; consumers
   stack a separate `<Badge variant="error">` next to the field (see
   `BindingForm.tsx:58`). `Badge` has no size variant and no dismissible
   affordance. `DropdownMenuItem` has no `destructive` variant — destructive
   menu items render with default cyan focus highlight, no red-text
   semantics. `Card` has no `CardFooter` — every dialog reinvents the
   button row. `Progress` has no size variant or semantic tone.
3. **a11y inconsistencies** — four primitives still ship `focus:` instead
   of `focus-visible:` (Select trigger / Select item / DropdownMenuItem /
   Dialog Close). On mouse click these leave a sticky cyan ring; on
   keyboard nav they look identical. `Input.py-1` (h-9) vs
   `SelectTrigger.py-2` (also h-9) drift the form-row baseline by 4px.

This change closes all three gaps in one delivery and locks the SSOT in
as a spec requirement (`ui-core-component-library`) so future drift is
caught at proposal time.

## Goals / Non-Goals

**Goals:**

- Every commonly-needed atomic UI primitive (buttons, form fields,
  toggles, tooltips, popovers, avatars) lives in `@offisim/ui-core` with
  a complete state matrix.
- Application code (`apps/*`, `packages/ui-office`) composes UI from
  ui-core primitives. Raw HTML form controls and hand-rolled
  popovers / tooltips / radios in component code are forbidden.
- a11y baseline is a spec contract, not a per-component habit. Every
  ui-core component meets the same focus / ARIA / contrast bar.
- Existing self-rolled UI sites surfaced by audit are migrated to ui-core
  in this same change, so the SSOT contract starts the next change in a
  clean state.

**Non-Goals:**

- Theme tokens or color system unification — that is Change F
  (`unify-design-token-system`). This change SHALL adopt whatever
  Tailwind tokens are already in use; the only color-level decision is
  which existing utility class maps to `error` / `success` / `warning`
  states (already defined in `Alert` and `Badge`).
- Replacing `Dialog` with `DialogShell` everywhere or rewriting overlay
  semantics — those are Change B (`rebuild-dialog-and-popover-system`).
  This change SHIPS the `Popover` primitive; Change B INTEGRATES it
  (replaces the hand-rolled SopAddStepPopover popover shell logic).
- DiceBear / brand-avatar render logic. The new `Avatar` primitive is
  the cosmetic outer frame (size, shape, ring, fallback). Internal-employee
  DiceBear rendering and external-employee brand SVGs stay in
  `packages/ui-office/src/components/shared/{EmployeeAvatar,DicebearAvatar,BrandAvatar2D}.tsx`.
- Story-page / Storybook tooling. The dev-only verification page in
  `apps/web/src/dev/` is a temporary live-verify surface, not a
  permanent docs deliverable; it is removed before archive.
- Canvas-rendered content (3D scene, 2D office canvas, SOP DAG canvas
  primitives drawn into `<canvas>`). Those are not "UI components" in
  the React/DOM sense and have separate primitive layers.

## Decisions

### Decision 1: Build new primitives on Radix Primitives, not from scratch

Every new primitive that has a Radix counterpart uses it: `Checkbox` →
`@radix-ui/react-checkbox`, `Radio`/`RadioGroup` → `@radix-ui/react-radio-group`,
`Switch` → `@radix-ui/react-switch`, `Tooltip` → `@radix-ui/react-tooltip`,
`Popover` → `@radix-ui/react-popover`, `Avatar` → `@radix-ui/react-avatar`.

**Rationale**: Radix already owns keyboard semantics, ARIA attributes,
focus management, portal/positioning, and the controlled/uncontrolled
state pattern. Building from scratch wastes weeks and gets a11y wrong.
Existing ui-core components (`Dialog`, `DropdownMenu`, `Select`,
`Tabs`, `ScrollArea`) already follow this pattern; the new ones SHALL
match.

**Alternative considered**: Headless UI / Floating UI standalone
primitives. Rejected — ui-core already standardized on Radix; mixing
two primitive layers complicates portal/stack ordering and increases
bundle size. The 6 new Radix packages add ~30 KB minzipped total but
share `@radix-ui/react-context` / `react-primitive` / `react-slot`
which ui-core already pulls.

**Bundle impact**: each new primitive ~3-8 KB minzipped after dedupe.
Total est. +30 KB to ui-core dist. Acceptable per known debt
(main chunk ~1.7 MB).

### Decision 2: `Avatar` is brand-agnostic; DiceBear / brand SVGs stay in ui-office

`packages/ui-core/src/components/avatar.tsx` exports `Avatar`,
`AvatarImage`, `AvatarFallback` (Radix Avatar pattern):

```ts
interface AvatarProps {
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl';  // 16 / 24 / 32 / 40 / 56 px
  shape?: 'circle' | 'square';                // square = rounded-lg
  ring?: 'none' | 'subtle' | 'accent';        // subtle = border-white/15, accent = border-cyan-400/40
  className?: string;
  children: ReactNode;                         // <AvatarImage> + <AvatarFallback>
}
```

`AvatarImage` accepts `src` + `alt`. `AvatarFallback` accepts a `delayMs`
(default 600) and renders children — typically letter initials or a
default `<User>` lucide icon.

**Rationale**: keeping seed-resolution and brand-key resolution in
ui-office is the existing rule (per CLAUDE.md "DiceBear + 块人专供内部员工"
and "外包员工每 brand 独立资产"). ui-core stays brand-agnostic so
shared-types / app-shell does not need DiceBear or brand assets at
import time. ui-office composes:
`<Avatar><AvatarImage src={dicebearSvgUrl}/><AvatarFallback>{initial}</AvatarFallback></Avatar>`.

**Alternative considered**: Move DicebearAvatar into ui-core. Rejected —
DiceBear is bundled into ui-office (`@dicebear/avatars` etc.); moving
it would force ui-core to take that dep, and the current
`EmployeeAvatar` dispatcher already lives in ui-office. Cleaner to
keep ui-core cosmetic-only.

### Decision 3: `Button.isLoading` reserves layout, swaps content, sets aria-busy

```tsx
<Button isLoading>
  Saving
</Button>
```

renders the existing children + a 16px `<Loader2 className="animate-spin">`
prefix, with `aria-busy="true"` and `disabled` semantics. The button
width does not change between idle and loading because the spinner
takes the same horizontal slot as a leading icon. Spinner color is
`currentColor` so it inherits per-variant text color.

**Rationale**: avoiding layout shift in async submits is a real UX cost
(double-clicks, button drifts off cursor). Reserving the icon slot is
the standard fix; users can still pass a leading icon in children when
not loading and the spinner replaces it visually when loading.

**Alternative considered**: separate `loadingText` prop that swaps the
label entirely. Rejected — adds API surface, and screen readers handle
`aria-busy` better than an arbitrary text swap.

### Decision 4: Form-control error+helperText is a uniform contract

`Input` / `Textarea` / `SelectTrigger` all accept the same trio:

```ts
{
  error?: boolean;
  helperText?: string;
  id?: string;  // existing forwarded attribute; if not provided, we generate one for aria-describedby
}
```

When `helperText` is set, the component renders:

```tsx
<>
  <input ... aria-describedby={helperId} aria-invalid={error || undefined} />
  <p id={helperId} className={error ? 'text-red-300' : 'text-slate-400'}>
    {helperText}
  </p>
</>
```

with `helperId = useId()` if no caller-provided id exists. When
`error` is true the border swaps to `border-red-400/60` and the
helper-text color swaps to `text-red-300`.

**Rationale**: stacking a `<Badge variant="error">` next to a field
(today's pattern in `BindingForm.tsx:58`) is not assistive-tech-discoverable
and breaks layout when error text is long. Auto-wired
`aria-describedby` is the standard.

**Alternative considered**: A `FormField` wrapper component that owns
`Label` + `Input` + `HelperText`. Rejected — adds a layer that has to be
adopted everywhere; better to keep the props on the field itself so
existing Input usages opt in by adding two props.

### Decision 5: SelectTrigger and Input baseline reconciliation

Both reconcile to `py-1.5` (3px top + 3px bottom) at `h-9`. This is the
only visual diff baseline reconciliation requires; the rest of the
classes stay.

**Rationale**: form rows often mix Input + Select + Button on the same
row (Settings, BindingForm, PublishDialog). 4px baseline drift is a real
visible misalignment.

### Decision 6: Tooltip is global Provider + per-instance components

`Tooltip` exports `TooltipProvider`, `Tooltip`, `TooltipTrigger`,
`TooltipContent`, with default `delayDuration={700}` on the Provider.
Apps mount one Provider at the root. Tooltips on icon-only buttons,
truncated labels, and abbreviated states use:

```tsx
<Tooltip>
  <TooltipTrigger asChild>
    <Button size="icon" aria-label="Settings"><Cog/></Button>
  </TooltipTrigger>
  <TooltipContent side="bottom" sideOffset={4}>Settings</TooltipContent>
</Tooltip>
```

**Mount site**: `apps/web/src/App.tsx` wraps the existing root with
`<TooltipProvider delayDuration={700}>`. Desktop reuses the web dist so
it inherits.

**Rationale**: Radix Tooltip needs a single Provider per tree to share
"warm-up" delay state — multiple Providers cause inconsistent
delays. Hoisting to the root is the standard pattern.

**Default `delayDuration`**: 700ms is the WAI-ARIA Practices recommendation
(not so fast it interferes with mouse pass-through, not so slow users
think the tooltip is broken).

### Decision 7: Popover is the SSOT for floating non-modal panels

`Popover` exports `Popover`, `PopoverTrigger`, `PopoverContent`,
`PopoverAnchor` (Radix wrappers). Used for:

- Hand-rolled `SopAddStepPopover` (replaced in this change)
- Future inline editors, dropdown forms, color pickers, etc.

`PopoverContent` defaults to `align="start" sideOffset={4}` to match
existing dropdown/tooltip ergonomics; portal to `document.body` to
avoid clipping.

**Coordination with Change B** (`rebuild-dialog-and-popover-system`):
Change B uses this primitive to build a higher-level
`PopoverShell` (with title / footer / dirty-guard like `DialogShell`)
and migrate other floating UI surfaces. This change ships the bare
primitive and the SopAddStepPopover migration; the higher-level shell
is Change B's territory.

### Decision 8: focus-visible-only focus rings, no `focus:` on visible chrome

Every focus-ring class in ui-core SHALL use `focus-visible:` not `focus:`
when the ring is purely cosmetic (i.e. shouldn't show on mouse click).
The only place `focus:` should remain is when a state genuinely should
react to programmatic focus regardless of input modality (rare — none
in current ui-core).

The 4 sites flagged by audit:

- `select.tsx:17` Trigger ring → `focus-visible:`
- `select.tsx:66` Item — Radix sets `data-highlighted` for both keyboard
  and pointer hover; we keep `focus:bg-white/10` (the bg highlight) AND
  add `focus-visible:ring-2 focus-visible:ring-cyan-400/40` (the ring)
  so the ring only shows on keyboard focus while bg still highlights on
  hover
- `dialog.tsx:41` Close → `focus-visible:`
- `dropdown-menu.tsx:35` Item — same dual treatment as Select item

**Rationale**: `focus:` shows on mouse click and stays sticky until the
user clicks elsewhere — a known accessibility-hint anti-pattern that
clutters the UI. `focus-visible:` shows only when the browser determines
focus came from keyboard / programmatic / non-pointing-device interaction.

### Decision 9: Icon-only Button SHALL warn at dev time when no aria-label

```tsx
const Button = forwardRef<HTMLButtonElement, ButtonProps>(({ size, children, 'aria-label': ariaLabel, ...rest }, ref) => {
  if (import.meta.env.DEV && size === 'icon' && !ariaLabel && !hasTextChildren(children)) {
    console.warn('[ui-core] Button size="icon" requires an aria-label when children contain no text');
  }
  ...
});
```

**Rationale**: icon-only buttons without `aria-label` are unreadable to
screen readers — the most common a11y bug in this codebase. A dev-time
warn is non-blocking but discoverable; production bundles strip the
check via `import.meta.env.DEV` dead-code elimination.

**Alternative considered**: typescript discriminated union forcing
`aria-label` when `size="icon"`. Rejected — too noisy for legitimate
cases where `<TooltipTrigger asChild>` carries the label via Tooltip
(the trigger button has no own label because the Tooltip provides it).
Dev warn is friendlier.

### Decision 10: WCAG 2.1 AA contrast contract

All ui-core text on default backgrounds SHALL meet WCAG 2.1 AA — 4.5:1
normal, 3:1 large (≥18px or ≥14px bold).

Documented combinations on slate-900 / white/5 backgrounds:

- `text-slate-100` (#f1f5f9) on `bg-slate-900` (#0f172a) — 13.4:1 (AAA)
- `text-slate-200` (#e2e8f0) on `bg-slate-900` — 11.6:1 (AAA)
- `text-slate-300` (#cbd5e1) on `bg-slate-900` — 9.3:1 (AAA)
- `text-slate-400` (#94a3b8) on `bg-slate-900` — 5.6:1 (AA, used for
  helper text and descriptions)
- `text-slate-500` (#64748b) on `bg-slate-900` — 3.6:1 — **borderline,
  acceptable for placeholder text only (not actionable text)**; SHALL
  NOT be used for control labels or body text
- `text-cyan-200` (#a5f3fc) on `bg-slate-900` — 11.0:1 (AAA)
- `text-cyan-100` (#cffafe) on `bg-cyan-500/15` mixed with slate-900 —
  computed effective bg ≈ #1c4f5e, ratio ≈ 8.4:1 (AAA)
- `text-red-300` (#fca5a5) on `bg-slate-900` — 6.5:1 (AA)
- `text-emerald-300` (#6ee7b7) on `bg-slate-900` — 8.7:1 (AAA)
- `text-amber-300` (#fcd34d) on `bg-slate-900` — 11.0:1 (AAA)

The spec encodes the rule (AA min) and the verified palette. Future
color additions SHALL be re-verified against AA before being used in
ui-core text.

**Rationale**: a contrast contract gives reviewers a concrete bar to
hold new colors to. Without it, "looks fine" creep adds borderline
combinations.

### Decision 11: Self-rolled UI migration is in scope, not deferred

Three known sites migrate in this change (not in a follow-up):

1. `SopAddStepPopover.tsx` — full rewrite using `Popover` + `Input` +
   `Select` + `Textarea`. Coordinated with Change B which integrates
   the higher-level shell.
2. `RuntimeBindingControl.tsx` — keep the rich-card visual; rebuild on
   `RadioGroup` so `<button role="radio">` workaround goes away. The
   card content (title + description + unavailable hint) renders inside
   `RadioGroupItem` `asChild` button.
3. `EmployeeQuickCard.tsx` lines 101 / 103 — replace raw `<input>` /
   `<textarea>` with ui-core `Input` / `Textarea`.

Plus the Tooltip migration tasks (11.x) for `title=` -> `Tooltip` on
critical icon affordances.

**Rationale**: leaving these "for next change" lets the SSOT contract
start dirty. A clean handoff means archive proves the rule by surveying
a clean codebase.

### Decision 12: New primitives ship to `index.ts` with no namespace

Existing pattern is `export * from './components/foo.js';`. New files
follow suit. Component names already chosen to avoid collisions —
`Avatar` collides with no current symbol; `Tooltip`, `Popover`,
`Checkbox`, `Switch` do not collide with anything in ui-core or its
direct dependents. (`shared-types` exports no React components so
namespace is safe at the @offisim/ui-core consumer side.)

## Risks / Trade-offs

[Risk] Migrating `RuntimeBindingControl` from `<button role="radio">`
to `RadioGroup` could break the rich-card visual or the
`engineUnavailable` disabled-with-hint behavior.
→ Mitigation: `RadioGroupItem asChild` lets us keep the existing card
markup wholesale; only the outer `<div role="radiogroup">` becomes
`<RadioGroupRoot>` and the buttons become `<RadioGroupItem asChild>`.
Visual identical, semantics from Radix. Live verify with VoiceOver:
arrow keys cycle radios, Space selects, disabled engines skipped.

[Risk] `SopAddStepPopover` full rewrite changes positioning behavior
(Radix Popover uses `@floating-ui` internally; the hand-rolled
`Math.min(position.x, window.innerWidth - 300)` clamp is replaced).
→ Mitigation: the new `Popover` ships with Radix's collision-aware
positioning out of the box. Anchor at the click coordinate via
`PopoverAnchor` virtual element pattern. Live verify: open
SopAddStepPopover near each viewport edge, confirm it flips to stay
on-screen.

[Risk] `Button.isLoading` text change might confuse some existing
async-submit screens that already render their own spinner.
→ Mitigation: `isLoading` defaults to `undefined` — no behavior change
unless explicitly set. Migration is opt-in. Existing custom spinners
keep working until they're rewritten.

[Risk] `aria-describedby` auto-wiring on Input/Textarea/Select could
conflict with caller-provided `aria-describedby` (some screens may
already point Input at a separate help element).
→ Mitigation: if caller provides `aria-describedby`, append the
generated helper id with a space separator; if no `helperText` is set,
do not generate an id. Spec scenario covers this.

[Risk] Adding 6 Radix dependencies grows the install graph. pnpm install
time on cold cache may grow ~5-10s.
→ Acceptable. Hot install is still fast (deduped).

[Risk] Dev-warn for icon-only button missing aria-label may produce
console noise in legitimate `TooltipTrigger asChild` cases.
→ Mitigation: `TooltipTrigger asChild` causes the trigger button to
inherit the Tooltip's `aria-describedby`; we adjust the dev check to
also tolerate a present `aria-describedby` or an explicit
`data-tooltip-trigger` data attribute. See task 6.6 for the exact rule.

[Risk] Contrast contract pins palette to slate/cyan/red/emerald/amber
at specific shades; Change F (`unify-design-token-system`) may want to
swap palettes.
→ Mitigation: spec encodes the AA contract abstractly ("any text on
default surface SHALL meet 4.5:1 AA") with the current palette as a
verified-baseline table. Future palette swaps SHALL re-verify and
update the table; the AA rule survives.

[Trade-off] Bundle grows ~30 KB minzipped from new Radix deps; ui-core
dist size grows accordingly (estimated +20 KB after dedupe and tree-shake
since some Radix shared internals are already pulled).
→ Acceptable. Main chunk debt is ~1.7 MB; +20 KB is below noise.

## Migration Plan

Pre-launch — no data or schema migration. Code migration:

1. Land new primitives + state-matrix completion + a11y fixes in ui-core
   first (tasks 1-9). ui-core builds clean before any consumer migrates.
2. Migrate `SopAddStepPopover`, `RuntimeBindingControl`, `EmployeeQuickCard`
   (tasks 10.x). These are the biggest self-rolled UI sites; replacing
   them validates the new primitives in real consumer code.
3. Migrate Tooltip wraps on enumerated `title=` sites (tasks 11.x).
   Lower-risk; can be parallelized across files.
4. Build the temporary dev-only verification page in
   `apps/web/src/dev/ui-core-gallery.tsx` for keyboard/screen-reader
   walkthrough (tasks 12.x). Removed before archive.
5. Build + verify gates (tasks 13.x): serial
   `shared-types → ui-core → ui-office → web` per CLAUDE.md.
6. Live verification (tasks 14.x): physical Tab walk, VoiceOver pass,
   contrast checker spot-check, browser console-error sweep on dev page.
7. Archive: drop `apps/web/src/dev/ui-core-gallery.tsx`, run final
   typecheck, archive change.

Tauri release rebuild required only because the ui-office migration touches
chat / SOP / Settings surfaces shipped in the desktop bundle. Standard
desktop release verification (release `.app` build + open, smoke each
migrated surface).
