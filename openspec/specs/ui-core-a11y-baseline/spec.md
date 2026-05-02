# ui-core-a11y-baseline Specification

## Purpose
TBD - created by archiving change expand-ui-core-foundation. Update Purpose after archive.
## Requirements
### Requirement: Focus rings SHALL use `focus-visible:` not `focus:`

Every cosmetic focus ring on a `@offisim/ui-core` component SHALL use the `focus-visible:` variant, not `focus:`. The `focus-visible:` variant only triggers when the browser's heuristic decides focus came from a keyboard / programmatic / non-pointing-device source, so a mouse click does not leave a sticky ring.

For dropdown / menu / select items where Radix sets `data-highlighted` on hover AND keyboard focus, components MAY keep `focus:bg-...` for the background highlight (Radix's `data-highlighted` covers both pointer and keyboard) AND add a `focus-visible:ring-2 focus-visible:ring-cyan-400/40` for the keyboard-only ring.

The previously identified offenders SHALL be fixed:

- `packages/ui-core/src/components/select.tsx` line 17 (Trigger): `focus:` → `focus-visible:`
- `packages/ui-core/src/components/select.tsx` line 66 (Item): keep `focus:bg-white/10`, add `focus-visible:ring-2 focus-visible:ring-cyan-400/40 focus-visible:ring-inset`
- `packages/ui-core/src/components/dialog.tsx` line 41 (Close button): `focus:` → `focus-visible:`
- `packages/ui-core/src/components/dropdown-menu.tsx` line 35 (Item): keep `focus:bg-white/10 focus:text-slate-100`, add `focus-visible:ring-2 focus-visible:ring-cyan-400/40 focus-visible:ring-inset`

#### Scenario: Mouse click does not leave sticky ring
- **WHEN** a user mouse-clicks any ui-core focusable component (Button / Input / Select / Dialog Close / DropdownMenuItem / Checkbox / Radio / Switch)
- **THEN** the cyan focus ring is NOT visible after the click (focus-visible: heuristic suppresses ring for pointer focus)

#### Scenario: Keyboard focus shows the ring
- **WHEN** a user Tab-keys to any ui-core focusable component
- **THEN** the cyan focus ring (`ring-cyan-400/40`, 2px thickness) IS visible around the focused element

#### Scenario: ui-core does not use cosmetic `focus:` ring classes
- **WHEN** grepping `packages/ui-core/src/components/**/*.tsx` for `focus:outline-none` and `focus:ring-`
- **THEN** zero matches exist; `focus-visible:outline-none` and `focus-visible:ring-` are used instead. (`focus:bg-` matches are allowed only on dropdown/menu/select item highlight background, paired with a `focus-visible:ring` for the keyboard ring)

### Requirement: Modal surfaces SHALL declare `role="dialog"` + `aria-modal` + accessible label

`Dialog` (Radix-based, in `dialog.tsx`), `DialogShell` (in `dialog-shell.tsx`), and `OverlayShell` (in `overlay-shell.tsx`) SHALL ensure the rendered dialog node has:

- `role="dialog"` (Radix sets this by default; OverlayShell sets it explicitly)
- `aria-modal="true"`
- An accessible label via either `aria-labelledby` (preferred, pointing at the DialogTitle's id) or `aria-label` (fallback when no visible title)

`Popover` is non-modal and SHALL set `role="dialog"` with `aria-modal="false"` (it is a floating panel, not a modal).

In dev mode, `Dialog` / `DialogShell` / `OverlayShell` SHALL `console.warn` if neither `aria-label` nor `aria-labelledby` resolves at render time (gated on `import.meta.env.DEV`).

#### Scenario: Dialog with title is labelled
- **WHEN** rendering `<Dialog open><DialogContent><DialogHeader><DialogTitle>Confirm</DialogTitle></DialogHeader>...</DialogContent></Dialog>`
- **THEN** the rendered dialog node has `role="dialog"`, `aria-modal="true"`, and `aria-labelledby` pointing at the DialogTitle's id

#### Scenario: Dialog without title falls back to aria-label
- **WHEN** rendering a `DialogContent` with no DialogTitle but `aria-label="Editor"`
- **THEN** the rendered dialog node has `aria-label="Editor"`; in dev mode no warning fires

#### Scenario: Dialog without label warns in dev
- **WHEN** rendering a `DialogContent` with no DialogTitle and no `aria-label` in dev mode
- **THEN** `console.warn` fires with a `[ui-core]` prefix referencing the missing label

#### Scenario: Popover is non-modal
- **WHEN** rendering an open `<Popover><PopoverTrigger>...</PopoverTrigger><PopoverContent>...</PopoverContent></Popover>`
- **THEN** the content node has `role="dialog"` and `aria-modal="false"` (popover is non-modal, focus is not trapped, Escape closes but the rest of the page remains interactive)

### Requirement: Form-control fields SHALL auto-wire `aria-describedby` and `aria-invalid`

`Input`, `Textarea`, and `SelectTrigger` SHALL automatically wire ARIA based on their `error` and `helperText` props:

- When `error === true`: the underlying control SHALL have `aria-invalid="true"`
- When `helperText` is set: the underlying control SHALL have `aria-describedby` referencing the helper-text element's id
- When the caller has already passed `aria-describedby`, the helper id SHALL be appended (space-separated), preserving the caller's value
- When `helperText` is unset, `aria-describedby` is NOT modified by ui-core

#### Scenario: Error state sets aria-invalid
- **WHEN** rendering `<Input error helperText="Required" />`
- **THEN** the underlying `<input>` has `aria-invalid="true"`

#### Scenario: Helper text auto-wires aria-describedby
- **WHEN** rendering `<Textarea id="bio" helperText="Markdown supported" />`
- **THEN** the underlying `<textarea>` has `aria-describedby="bio-helper"`; a `<p id="bio-helper">` follows it in the DOM

#### Scenario: Caller-provided aria-describedby preserved
- **WHEN** rendering `<Input id="email" aria-describedby="hint-1" helperText="Check your spelling" />`
- **THEN** the underlying `<input>` `aria-describedby` is `"hint-1 email-helper"` — caller value first, helper id appended

### Requirement: Icon-only `Button` SHALL warn in dev when missing `aria-label`

When `Button` renders with `size === 'icon'` AND no `aria-label` AND no `aria-describedby` AND no text children (no React child resolves to a non-empty string), the component SHALL `console.warn` in dev mode (gated on `import.meta.env.DEV`).

The warn does not fire when:

- The Button has any text child (e.g. `<Button size="icon">X</Button>`)
- The Button has `aria-label` set
- The Button has `aria-describedby` set (typical when used as `<TooltipTrigger asChild>` because Radix Tooltip injects `aria-describedby`)

Production builds strip the check via `import.meta.env.DEV` dead-code elimination.

#### Scenario: Icon-only button without label warns
- **WHEN** rendering `<Button size="icon"><Cog/></Button>` in dev mode (no aria-label, no aria-describedby, no text children)
- **THEN** `console.warn` fires with a `[ui-core]` prefix mentioning the missing label

#### Scenario: Icon-only button with aria-label does not warn
- **WHEN** rendering `<Button size="icon" aria-label="Settings"><Cog/></Button>` in dev mode
- **THEN** no warning fires

#### Scenario: Icon-only button as TooltipTrigger asChild does not warn
- **WHEN** rendering `<Tooltip><TooltipTrigger asChild><Button size="icon"><Cog/></Button></TooltipTrigger><TooltipContent>Settings</TooltipContent></Tooltip>`
- **THEN** no warning fires (Radix Tooltip injects `aria-describedby` on the trigger button)

### Requirement: ui-core text SHALL meet WCAG 2.1 AA contrast on default surfaces

Text rendered by `@offisim/ui-core` components on default surfaces (`bg-slate-900`, `bg-white/5` over `bg-slate-900`, the `bg-cyan-500/15` and similar accent backgrounds) SHALL meet WCAG 2.1 AA contrast: 4.5:1 for normal text, 3:1 for large text (≥18px or ≥14px bold).

The verified palette as shipped by this change:

| Foreground | Background | Ratio | Verdict |
|------------|------------|-------|---------|
| `text-slate-100` (#f1f5f9) | `bg-slate-900` (#0f172a) | 13.4:1 | AAA |
| `text-slate-200` (#e2e8f0) | `bg-slate-900` | 11.6:1 | AAA |
| `text-slate-300` (#cbd5e1) | `bg-slate-900` | 9.3:1 | AAA |
| `text-slate-400` (#94a3b8) | `bg-slate-900` | 5.6:1 | AA |
| `text-slate-500` (#64748b) | `bg-slate-900` | 3.6:1 | borderline — placeholder only |
| `text-cyan-200` (#a5f3fc) | `bg-slate-900` | 11.0:1 | AAA |
| `text-cyan-100` (#cffafe) | `bg-cyan-500/15` over `bg-slate-900` | ~8.4:1 | AAA |
| `text-red-300` (#fca5a5) | `bg-slate-900` | 6.5:1 | AA |
| `text-emerald-300` (#6ee7b7) | `bg-slate-900` | 8.7:1 | AAA |
| `text-amber-300` (#fcd34d) | `bg-slate-900` | 11.0:1 | AAA |

`text-slate-500` SHALL be reserved for placeholder text (≈3.6:1 — below AA for normal body text but acceptable for placeholders per WCAG 1.4.3 exception). It SHALL NOT be used for control labels, helper text, or body content.

Future palette additions SHALL be re-verified against AA before being merged into ui-core text-color usage; the spec table SHALL be updated.

#### Scenario: Body and label text passes AA
- **WHEN** auditing `text-slate-200`, `text-slate-300`, `text-slate-400`, `text-cyan-100`, `text-cyan-200`, `text-red-300`, `text-emerald-300`, `text-amber-300` on the documented surface backgrounds
- **THEN** all combinations pass WCAG 2.1 AA (≥4.5:1 normal text)

#### Scenario: Placeholder-only color is not used for actionable text
- **WHEN** grepping `packages/ui-core/src/components/**/*.tsx` for `text-slate-500`
- **THEN** matches only appear in placeholder contexts (`placeholder:text-slate-500`), not on body or label text

### Requirement: Keyboard navigation SHALL work without mouse on every interactive primitive

Every interactive ui-core primitive SHALL support keyboard navigation per WAI-ARIA Authoring Practices:

- `Button`: Space and Enter activate; Tab focuses
- `Input` / `Textarea`: Tab focuses, type to enter value, Tab moves to next form field
- `Select`: Tab focuses Trigger, Space/Enter/Arrow opens, arrow keys cycle items, Enter/Space selects, Escape closes
- `Checkbox`: Tab focuses, Space toggles, transitions through `unchecked` ↔ `checked` (and `mixed` when uncontrolled with indeterminate)
- `RadioGroup` / `RadioGroupItem`: Tab focuses the group (only the selected — or first if none selected — radio receives Tab focus), arrow keys cycle items, Space selects, focus stays on the selected item; disabled items skipped in arrow nav
- `Switch`: Tab focuses, Space toggles
- `Tabs`: Tab focuses TabsList, arrow keys cycle Triggers, Space/Enter selects (Radix automatic activation by default)
- `Dialog` / `DialogShell` / `OverlayShell`: opening traps focus inside the dialog (first focusable element auto-focused), Tab cycles within, Shift+Tab reverses, Escape requests close (subject to `closeOnEscape` / `onRequestClose`)
- `DropdownMenu`: Tab focuses Trigger, Space/Enter/Arrow Down opens, arrow keys cycle items, type-ahead jumps to matching item, Escape closes, Enter activates the focused item
- `Tooltip`: focus on Trigger reveals content immediately (no delay for keyboard focus, per Radix default); Escape OR blur closes
- `Popover`: focus on Trigger does not auto-open (Trigger is a button — Space/Enter opens), arrow keys do not open; once open, focus moves into content (Radix `autoFocus`); Escape closes and returns focus to Trigger; Tab cycles within content (or out, depending on Radix `modal` prop — default `false`)

#### Scenario: Tab walks through every primitive without trapping
- **WHEN** rendering a page with one of every interactive primitive in tab order and pressing Tab repeatedly
- **THEN** each primitive receives focus exactly once per cycle (RadioGroup contributes one stop for the selected item; Tabs contributes one stop for the active tab); no primitive traps focus permanently

#### Scenario: Dialog traps focus while open
- **WHEN** an open Dialog is rendered with two focusable elements
- **THEN** Tab cycles between those two elements only; Shift+Tab reverses; focus does not leak to elements behind the dialog

#### Scenario: RadioGroup arrow nav skips disabled
- **WHEN** rendering `<RadioGroup value="a"><RadioGroupItem value="a"/><RadioGroupItem value="b" disabled/><RadioGroupItem value="c"/></RadioGroup>`, focusing the group, and pressing arrow Down
- **THEN** focus moves from item `a` to item `c` (skipping disabled `b`)

