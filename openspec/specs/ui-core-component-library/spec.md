# ui-core-component-library Specification

## Purpose
TBD - created by archiving change expand-ui-core-foundation. Update Purpose after archive.
## Requirements
### Requirement: `@offisim/ui-core` is the SSOT for application-level atomic UI components

Application code in `apps/*` and `packages/ui-office` SHALL compose UI from primitives exported by `@offisim/ui-core`. Raw HTML form elements (`<button>`, `<input>`, `<textarea>`, `<select>`), hand-rolled popovers, hand-rolled tooltips, hand-rolled radio cards via `<button role="radio">`, and hand-rolled checkboxes via `<div onClick>` SHALL NOT appear in component code that has a ui-core equivalent.

`packages/ui-core` SHALL export the following set, covering common application UI:

**Buttons**: `Button` (variants `default` / `destructive` / `outline` / `secondary` / `ghost` / `link`; sizes `default` / `sm` / `lg` / `icon`).

**Form fields**: `Input`, `Textarea`, `Select` + `SelectGroup` + `SelectValue` + `SelectTrigger` + `SelectContent` + `SelectItem`.

**Toggles**: `Checkbox`, `RadioGroup` + `RadioGroupItem`, `Switch`.

**Floating surfaces**: `Dialog` + descendants, `DialogShell`, `OverlayShell`, `DropdownMenu` + descendants, `Tooltip` + `TooltipProvider` + `TooltipTrigger` + `TooltipContent`, `Popover` + `PopoverTrigger` + `PopoverContent` + `PopoverAnchor` + `PopoverClose`.

**Surface / display**: `Card` + `CardHeader` + `CardTitle` + `CardContent` + `CardFooter`, `SurfaceCard`, `Toolbar` + `ToolbarGroup` + `ToolbarSeparator` + `ToolbarSpacer`, `Tabs` + `TabsList` + `TabsTrigger` + `TabsContent`, `ScrollArea` + `ScrollBar`, `SegmentedControl`, `Badge`, `Alert` + `AlertTitle` + `AlertDescription`, `Progress`, `Avatar` + `AvatarImage` + `AvatarFallback`, `EmptyState`, `ErrorState`, `ToastBanner` + `useToasts`.

The exception is non-component code (polyfill modules, native-shell sidecars, build-tool config) and canvas-rendered content (3D scene, 2D office canvas, SOP DAG canvas drawn into `<canvas>`), which are out of scope for this contract.

#### Scenario: Application code does not import raw form controls
- **WHEN** grepping `packages/ui-office/src/components/**/*.tsx` and `apps/desktop/renderer/src/components/**/*.tsx` for `<button ` (with trailing space, excluding `<button` substrings inside class names or strings) and `<input ` and `<textarea ` and `<select `
- **THEN** every match has a 1-line justification comment OR is replaced with the ui-core equivalent

#### Scenario: ui-core surface covers required primitives
- **WHEN** importing from `@offisim/ui-core`
- **THEN** `Button`, `Input`, `Textarea`, `Select`, `SelectTrigger`, `SelectContent`, `SelectItem`, `Checkbox`, `RadioGroup`, `RadioGroupItem`, `Switch`, `Tooltip`, `TooltipProvider`, `Popover`, `PopoverTrigger`, `PopoverContent`, `Dialog`, `DialogShell`, `OverlayShell`, `DropdownMenu`, `DropdownMenuItem`, `Avatar`, `AvatarImage`, `AvatarFallback`, `Card`, `CardFooter`, `CardHeader`, `CardTitle`, `CardContent`, `Badge`, `Progress`, `Alert`, `Tabs`, `ScrollArea`, `SegmentedControl`, `Toolbar`, `EmptyState`, `ErrorState`, `ToastBanner`, `useToasts`, `SurfaceCard` all resolve

### Requirement: `Button` SHALL support a complete state matrix including `isLoading`

`Button` SHALL accept `isLoading?: boolean`. When `isLoading === true`, the button SHALL:

- Render a 16x16 `<Loader2>` lucide spinner with `animate-spin` and `aria-hidden="true"` as the first child, before any other children
- Set `aria-busy="true"` on the underlying `<button>`
- Behave as `disabled` (no click events fire, `disabled` attribute applied)
- Preserve text children visually so layout width does not shift between idle and loading

Spinner color SHALL be `currentColor` so it inherits each variant's text color (cyan-100 default, red-200 destructive, slate-300 ghost, etc.).

Variants and sizes already supported (default / destructive / outline / secondary / ghost / link; default / sm / lg / icon) SHALL remain unchanged.

#### Scenario: Loading button preserves layout
- **WHEN** rendering `<Button isLoading>Saving</Button>` and toggling `isLoading` from `false` to `true`
- **THEN** the button bounding-box width does not change; the spinner replaces the leading-icon slot or appears before the text without pushing the text out

#### Scenario: Loading button is disabled and aria-busy
- **WHEN** rendering `<Button isLoading onClick={fn}>Saving</Button>` and clicking it
- **THEN** `fn` is not called; the button has `aria-busy="true"` and `disabled` attributes set

### Requirement: Form-control fields SHALL support `error` + `helperText` with auto-wired ARIA

`Input`, `Textarea`, and `SelectTrigger` SHALL each accept:

- `error?: boolean` — when true, swaps border to `border-red-400/60` and sets `aria-invalid="true"` on the underlying control
- `helperText?: string` — renders a `<p>` element below the field with id `${fieldId}-helper`, color `text-red-300` if `error`, otherwise `text-slate-400`

When `helperText` is set, the component SHALL set `aria-describedby` on the underlying control to the helper-text id. If the caller already passed `aria-describedby`, the helper id SHALL be appended (space-separated). If `helperText` is unset, no helper id is generated and `aria-describedby` is not modified.

`Input` SHALL use `py-1.5` to baseline-align with `SelectTrigger` (currently `py-1`); `SelectTrigger` SHALL use `py-1.5` (currently `py-2`); both share `h-9` outer height.

#### Scenario: Error state sets aria-invalid and red border
- **WHEN** rendering `<Input error helperText="Required" />`
- **THEN** the underlying `<input>` has `aria-invalid="true"` and the rendered border class includes `border-red-400/60`; the helper `<p>` has class containing `text-red-300`

#### Scenario: Helper text auto-wires aria-describedby
- **WHEN** rendering `<Input id="email" helperText="We will never share your email." />`
- **THEN** the underlying `<input>` has `aria-describedby="email-helper"` and the helper `<p>` has `id="email-helper"`

#### Scenario: Caller-provided aria-describedby is preserved
- **WHEN** rendering `<Input id="email" aria-describedby="extra-hint" helperText="Required" />`
- **THEN** the underlying `<input>` `aria-describedby` value is `"extra-hint email-helper"` (caller value first, then helper id)

#### Scenario: No helperText leaves aria untouched
- **WHEN** rendering `<Input id="email" />`
- **THEN** the underlying `<input>` has no `aria-describedby` and no `aria-invalid` from ui-core (caller-provided values pass through)

#### Scenario: Input and SelectTrigger share baseline
- **WHEN** rendering an `<Input>` and `<Select>` side by side in a flex row
- **THEN** their text baselines align within 1px (both use `h-9` outer + `py-1.5` inner padding)

### Requirement: `Badge` SHALL support size variants and dismissible affordance

`Badge` SHALL accept:

- `size?: 'xs' | 'sm' | 'md'` — `xs`: `px-1.5 py-0.5 text-[10px]`; `sm` (default): existing `px-2.5 py-0.5 text-xs`; `md`: `px-3 py-1 text-sm`
- `dismissible?: boolean` and `onDismiss?: () => void` — when `dismissible`, render a trailing `<X>` icon button (16x16, `aria-label="Dismiss"`) that calls `onDismiss` on click. Existing variants (`default` / `secondary` / `success` / `warning` / `error` / `info` / `outline`) remain unchanged

#### Scenario: Dismissible badge renders close button
- **WHEN** rendering `<Badge dismissible onDismiss={fn}>Tag</Badge>` and clicking the X icon
- **THEN** `fn` is called; the X icon has `aria-label="Dismiss"`

#### Scenario: Size variant changes padding and text size
- **WHEN** rendering `<Badge size="xs">x</Badge>` and `<Badge size="md">x</Badge>`
- **THEN** the rendered class strings include `px-1.5 py-0.5 text-[10px]` and `px-3 py-1 text-sm` respectively

### Requirement: `DropdownMenuItem` SHALL support a `destructive` variant

`DropdownMenuItem` SHALL accept `variant?: 'default' | 'destructive'`. The `destructive` variant SHALL apply text color `text-red-300`, hover/highlight color `text-red-200`, and focus background `bg-red-500/10` (replacing the default `bg-white/10`). The default variant remains as today.

#### Scenario: Destructive item shows red text
- **WHEN** rendering `<DropdownMenuItem variant="destructive">Delete</DropdownMenuItem>`
- **THEN** the rendered class string includes `text-red-300`

#### Scenario: Default variant unchanged
- **WHEN** rendering `<DropdownMenuItem>Edit</DropdownMenuItem>`
- **THEN** the rendered class string includes `text-slate-200` and the hover bg highlight via `data-highlighted` selector matches today's behavior

### Requirement: `Card` SHALL export `CardFooter`

`Card` exports SHALL include `CardFooter`, a forwardRef `<div>` with class `flex items-center gap-2 justify-end p-4 pt-0 border-t border-white/10`. CardHeader, CardTitle, CardContent retain their current class strings.

#### Scenario: CardFooter is exported and renders bordered footer row
- **WHEN** rendering `<Card><CardContent>Body</CardContent><CardFooter><Button>OK</Button></CardFooter></Card>`
- **THEN** `CardFooter` resolves from `@offisim/ui-core` and the rendered footer has classes including `border-t border-white/10`, `flex`, and `justify-end`

### Requirement: `Progress` SHALL support size variants and semantic tones

`Progress` SHALL accept:

- `size?: 'sm' | 'md' | 'lg'` — heights `h-1` / `h-2` (default) / `h-3`
- `tone?: 'default' | 'success' | 'warning' | 'error'` — fill colors `bg-cyan-400` (default) / `bg-emerald-400` / `bg-amber-400` / `bg-red-400`

ARIA `role="progressbar"` + `aria-valuenow` + `aria-valuemin` + `aria-valuemax` remain set as today.

#### Scenario: Tone changes fill color
- **WHEN** rendering `<Progress value={40} tone="success" />`
- **THEN** the inner fill `<div>` has class containing `bg-emerald-400`

#### Scenario: Size changes outer height
- **WHEN** rendering `<Progress value={40} size="lg" />`
- **THEN** the outer `<div>` has class containing `h-3`

### Requirement: ui-core SHALL provide a generic `Avatar` primitive

`Avatar`, `AvatarImage`, `AvatarFallback` SHALL be available from `@offisim/ui-core`, built on `@radix-ui/react-avatar`. `Avatar` SHALL accept:

- `size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl'` — 16 / 24 / 32 / 40 / 56 px (default `md`)
- `shape?: 'circle' | 'square'` — circle (`rounded-full`, default) or square (`rounded-lg`)
- `ring?: 'none' | 'subtle' | 'accent'` — none / `border border-white/15` (default) / `border border-cyan-400/40`

`AvatarImage` SHALL accept `src` and `alt`. `AvatarFallback` SHALL accept `delayMs?: number` (default 600) and children (initials text or `<User>` icon).

This primitive is brand-agnostic. Internal-employee DiceBear rendering and external-employee brand SVGs SHALL stay in `packages/ui-office/src/components/shared/{EmployeeAvatar,DicebearAvatar,BrandAvatar2D}.tsx`. Those higher-level components compose `Avatar` for the cosmetic frame.

#### Scenario: Avatar renders Radix avatar with size
- **WHEN** rendering `<Avatar size="lg"><AvatarImage src="..." alt="X"/><AvatarFallback>X</AvatarFallback></Avatar>`
- **THEN** the outer element has class implying 40px height/width (`h-10 w-10`) and uses Radix avatar's image/fallback fallback timing

#### Scenario: Fallback shows when image fails to load
- **WHEN** the image `src` 404s or is unset and `delayMs` elapses
- **THEN** the AvatarFallback children render

### Requirement: New floating-surface primitives SHALL be available

`Tooltip` (with `TooltipProvider`, `TooltipTrigger`, `TooltipContent`) and `Popover` (with `PopoverTrigger`, `PopoverContent`, `PopoverAnchor`, `PopoverClose`) SHALL be exported from `@offisim/ui-core`, built on `@radix-ui/react-tooltip` and `@radix-ui/react-popover`.

`TooltipProvider` defaults: `delayDuration={700}`, `skipDelayDuration={300}`. `TooltipContent` defaults: `side="bottom"`, `sideOffset={4}`, `collisionPadding={8}`, with built-in arrow.

`PopoverContent` defaults: `align="start"`, `sideOffset={4}`, `collisionPadding={8}`, portals to `document.body`. Popover content SHALL set `role="dialog"` + `aria-modal="false"` (non-modal floating panel).

Apps SHALL mount one `<TooltipProvider>` at the root tree (`apps/desktop/renderer/src/App.tsx`). Multiple Providers in the same tree are forbidden because they break shared open/skip-delay state.

#### Scenario: Tooltip Provider mounts once at root
- **WHEN** rendering the Web app shell
- **THEN** exactly one `<TooltipProvider>` exists in the React tree, near the root, with `delayDuration={700}`

#### Scenario: Popover content portals to document.body
- **WHEN** rendering an open `<Popover><PopoverTrigger>...</PopoverTrigger><PopoverContent>...</PopoverContent></Popover>`
- **THEN** the rendered `PopoverContent` DOM node is appended directly under `document.body` (or under a configured `container` prop), not nested inside the trigger's parent

#### Scenario: Popover content has dialog role and non-modal aria
- **WHEN** rendering an open Popover
- **THEN** the content node has `role="dialog"` and `aria-modal="false"`

### Requirement: `Checkbox`, `RadioGroup` + `RadioGroupItem`, `Switch` SHALL be available

These primitives SHALL be built on `@radix-ui/react-checkbox`, `@radix-ui/react-radio-group`, `@radix-ui/react-switch`. Each SHALL support default / hover / focus-visible / checked / disabled states.

`Checkbox` SHALL support `checked?: boolean | 'indeterminate'` and render a `<Check>` or `<Minus>` lucide icon in the indicator depending on state. `RadioGroupItem` SHALL support `asChild` so consumers can render rich card layouts (used by `RuntimeBindingControl`). `Switch` SHALL support `size?: 'sm' | 'md'` (default `md`) and animate the thumb on toggle.

#### Scenario: Checkbox indeterminate state shows minus icon
- **WHEN** rendering `<Checkbox checked="indeterminate" />`
- **THEN** the indicator shows the `<Minus>` lucide icon (not `<Check>`); the underlying control reports `data-state="indeterminate"`

#### Scenario: RadioGroupItem asChild renders consumer markup
- **WHEN** rendering `<RadioGroup value="a"><RadioGroupItem value="a" asChild><button>card markup</button></RadioGroupItem></RadioGroup>`
- **THEN** the rendered element is a `<button>` (consumer markup) with Radix-injected `role="radio"` and `aria-checked="true"` attributes; arrow keys cycle focus per Radix RadioGroup contract

#### Scenario: Switch keyboard toggle
- **WHEN** rendering an unchecked `<Switch />`, focusing it, and pressing Space
- **THEN** the switch transitions to checked state and `onCheckedChange` fires with `true`

### Requirement: Self-rolled UI in audited sites SHALL migrate to ui-core

The following sites SHALL be migrated as part of this change (not deferred):

- `packages/ui-office/src/components/sop/SopAddStepPopover.tsx` — full rewrite using `Popover` + `Input` + `Select` + `Textarea`. The existing hand-rolled outside-click handler, Escape handler, and viewport-clamp positioning SHALL be replaced by Radix Popover semantics. Anchor at the click coordinate via virtual element or PopoverAnchor pattern.
- `packages/ui-office/src/components/runtime/RuntimeBindingControl.tsx` — `<button role="radio">` cards SHALL be replaced with `RadioGroup` + `RadioGroupItem asChild`. Keep the rich card visual; delete the `// biome-ignore lint/a11y/useSemanticElements` comment.
- `packages/ui-office/src/components/employees/EmployeeQuickCard.tsx` — raw `<input>` and `<textarea>` (lines 101 / 103) SHALL be replaced with ui-core `Input` and `Textarea`.
- `packages/ui-office/src/components/install/BindingForm.tsx` — separate `<Badge variant="error">` next to a field SHALL be replaced with `Input ... error helperText="required"`.
- All native `title=` tooltips on critical icon-only affordances (Settings tab nav, SOP sidebar overflow, Studio palette buttons, Header status icons, RuntimeBindingControl unavailable hint, EmptyState disabledReason) SHALL be replaced with ui-core `Tooltip`. Existing `title=` SHALL be removed (it shows redundantly with no keyboard a11y).

#### Scenario: SopAddStepPopover uses ui-core Popover
- **WHEN** grepping `packages/ui-office/src/components/sop/SopAddStepPopover.tsx` for `<input ` / `<select ` / `<textarea ` / `addEventListener('pointerdown'` / `addEventListener('keydown'`
- **THEN** zero matches; the file imports `Popover`, `PopoverContent`, `PopoverAnchor`, `Input`, `Select`, `SelectTrigger`, `Textarea` from `@offisim/ui-core`

#### Scenario: RuntimeBindingControl uses RadioGroup
- **WHEN** grepping `packages/ui-office/src/components/runtime/RuntimeBindingControl.tsx` for `role="radio"` literal string
- **THEN** zero hand-rolled matches; the file imports `RadioGroup` and `RadioGroupItem` from `@offisim/ui-core` and uses `RadioGroupItem asChild` to wrap the rich-card buttons

#### Scenario: EmployeeQuickCard uses ui-core Input/Textarea
- **WHEN** grepping `packages/ui-office/src/components/employees/EmployeeQuickCard.tsx` for `<input ` / `<textarea `
- **THEN** zero hand-rolled matches; ui-core `Input` and `Textarea` imports are present

#### Scenario: title= replaced with Tooltip on critical affordances
- **WHEN** auditing the Settings tab nav, SOP sidebar overflow, Studio palette buttons, Header status icons, RuntimeBindingControl unavailable hint, EmptyState disabledReason
- **THEN** none of these surfaces use the `title=` attribute for the hint; each uses `<Tooltip><TooltipTrigger asChild>...</TooltipTrigger><TooltipContent>{hint}</TooltipContent></Tooltip>`

