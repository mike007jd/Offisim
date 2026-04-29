## Context

Layout shift in Offisim is not a single bug — it is the absence of a
shared contract for "containers that swap content". Every surface that
ships a Tabs component, an async-loaded pane, a streaming text
bubble, an embedded canvas, or a custom font landed at a different
historical moment with different conventions. Some declared
`min-height`, some didn't; some used `forceMount + hidden`, some let
Radix unmount; some referenced `Inter` without ever loading it.

Three reads have already locked the root causes (proposal lists each
file:line). We did not find a single offender — we found a pattern
gap. The product closure bar ("UX must be elegant and simple") fails
under tab swap because every fix-it-once site is one symptom of the
same missing rule.

This change ships the rule as a new `layout-shift-stability`
capability, and migrates the four surfaces that today most visibly
break it: Personnel inspector tabs, RightSidebar chat/tasks, the
workspace shell skeleton, and DialogShell tab bodies. Web `index.html`
preloads variable fonts to eliminate FOUT-driven reflow at first
paint. Three motion-timing custom properties are introduced as an
interim before Change F (`unify-design-token-system`) subsumes motion
into the broader token system; without that interim, every fix here
ships at a different default duration and the user reads the same
shift differently per surface.

## Goals / Non-Goals

**Goals:**

- One product-wide contract (a new `layout-shift-stability`
  capability) every surface inherits: Tabs declare min-height,
  skeletons match real content, fonts preload, embedded canvases
  declare aspect-ratio.
- Concrete fixes at the four hot spots from the audit: Personnel
  inspector tabs, RightSidebar chat/tasks (outer + inner), Workspace
  shell skeleton, DialogShell tab content min-height — plus three
  cross-cutting fixes (font preload, StreamingBubble height bound,
  motion timing token interim).
- Two named SSOT class constants for Tabs unmount policy:
  `TABS_RETAIN_STATE_CLASS` (`'data-[state=inactive]:hidden'`) paired
  with `forceMount` for state-preserving Tabs; `DIALOG_TABS_CONTENT_CLASS`
  (existing) for default unmount Tabs. Caller imports one, no inline
  string.
- CLS ≤ 0.05 measurable from Chrome DevTools Performance trace at
  1440x900 and 1280x800 on Office, Personnel, SOPs, Market, Activity,
  Settings, Office RightSidebar tab swap, and cold-load on Slow-3G.
- No font-loading library, no JS-driven layout adjustment. The fix is
  pure layout discipline + asset preload.

**Non-Goals:**

- This change does NOT subsume the long-term motion token system —
  Change F (`unify-design-token-system`) owns that. We ship three
  custom properties as a stop-gap so the dialog/tabs duration is
  consistent across the migrated surfaces.
- This change does NOT redesign the Personnel 6-tab IA. The
  inspector is a 6-tab surface; we just stop it from bouncing.
- This change does NOT touch SOP DAG canvas pan/zoom (own
  capability), Studio editor (`studio-asset-edit-contract`), or
  Office 3D scene (`scene-orchestrator-boundaries`). Layout shift
  in the workspace center surfaces is bounded by the workspace
  shell — those interior surfaces have their own minimums.
- This change does NOT add new font variants. Inter and JetBrains
  Mono variable (woff2 only) — same families already declared.
- This change does NOT add automated visual regression / CLS
  monitoring. Per repo policy, no product-grade auto tests; live
  verification with DevTools is the gate.

## Decisions

### Decision 1: New `layout-shift-stability` capability owns the contract, not extension to `responsive-app-shell`

The shift contract is conceptually distinct from "shell layout adapts
to viewport". Responsive shell rules are about *what fits at width X*;
shift rules are about *what stays still during state change*. Mixing
them muddies both — a future change rewriting responsive break-points
should not have to also reason about CLS.

The capability is product-wide (every surface inherits) but lives as
a small spec with cross-references into `responsive-app-shell`,
`personnel-workspace-surface`, `panel-and-dialog-sizing`, and
`office-chat-default-presentation` — those four MODIFIED specs each
take the surface-specific requirements; the new capability takes the
abstract rules. Future surfaces (SOPs, Market, Activity, Studio,
Settings — when they migrate to the new pattern) consume the new
capability without re-stating the rules.

**Rationale**: separation by axis. `responsive-app-shell` answers
"what fits at width X" — bounded vocabulary, viewport-driven.
`layout-shift-stability` answers "what stays still during state
change" — bounded vocabulary, state-driven. Mixed specs become
catch-all and hard to evolve.

**Alternative considered**: extend `responsive-app-shell` with a
"Layout stability" section. Rejected — the responsive spec is
already 7+ requirements and adding 5 more on a different axis would
make it the de-facto shell god-spec.

### Decision 2: Personnel inspector min-height = 560 px, derived from worst-case tab content

Personnel right inspector at 1440x900 reserves a 420 px max-width column.
The six tabs render the following content (measured in DevTools at
the time of the audit):

- `Profile`: form rows, ≈ 320 px when collapsed, ≈ 720 px scrolled.
- `Appearance`: `AvatarCustomizer` left + 2D 140x140 + 3D 200 px stacked
  preview right ≈ 540 px total.
- `Runtime`: provider/model selector + tool permissions form ≈ 380 px.
- `Skills`: skill binding list, dynamic 0–800 px depending on count.
- `Memory`: memory snapshot list, dynamic 80–700+ px.
- `History`: run-history table, dynamic 80–1000+ px.

The "min-height floor" is the height the wrapper SHALL paint at
when the *shortest* tab is active, so swapping to the *tallest* tab
does not push the surrounding page. We pick **560 px** — the
height of the Appearance tab at its baseline (rest state, no
expanded sections). Any taller content (Memory at 700 px, Skills at
800 px) scrolls inside the tab body via `overflow-y-auto`, never
expands the wrapper.

**Rationale**: 560 px is the steady-state height of the visually
tallest *fixed-height* tab. Tabs that grow with data scroll
internally; the wrapper does not bounce.

**Alternative considered**: per-tab dynamic `min-height` set by
JS measurement. Rejected — runtime measurement is fragile across
content async loads, and any per-tab hand-tuning gets stale fast.
A single 560 px floor is conservative and survives content
churn.

### Decision 3: All Personnel `TabsContent` use `forceMount + TABS_RETAIN_STATE_CLASS`

Three reasons to keep all six tabs mounted:

1. **State preservation**: Profile tab unsaved edits SHOULD survive
   tab swap (Settings sub-tabs already do this; Personnel should
   match). Currently the Radix default unmounts and the editor
   form re-initializes from `formData`, so flipping to Skills and
   back loses local-only edits.
2. **Layout stability**: with all six tabs in the DOM (visible:
   one; `data-[state=inactive]:hidden`: five), the wrapper's
   min-height does not need re-layout per swap — the rendered
   tabs are pre-laid-out and just toggle visibility.
3. **3D Canvas warm-up**: Appearance tab's R3F canvas takes 1-2
   frames to first paint; if the user swaps in/out of Appearance
   the canvas re-mounts and re-pays that cost. `forceMount`
   keeps the canvas warm.

The trade-off is memory cost (six tabs always in DOM) — bounded
because each tab's content is a few hundred KB at most and the
6-tab inspector is not a high-fan-out surface (one selected
employee at a time).

**Rationale**: Tabs unmount policy is part of the shift contract,
not a per-surface decision. Migrating Personnel to the same policy
RightSidebar already uses gives both surfaces the same UX.

**Alternative considered**: keep Radix's default unmount and rely
solely on `min-h-[560px]` to bound the wrapper. Rejected — it
solves layout shift but not state loss; user edits in Profile
silently disappear when they peek at History.

### Decision 4: AppearanceTab Canvas uses `aspect-[256/200]` slot; drop inline `style`

Currently `PreviewCard` declares `h-[200px]` and `Preview3DCanvas`
re-declares `style={{ width: 256, height: 200 }}` on the `<Canvas>`
itself. R3F's `<Canvas>` resizes to its parent on mount; the inline
style fights the parent slot and React Three Fiber re-runs
`useResize` once per mount, causing a 1-2 frame layout flash.

The fix:

- `PreviewCard` content slot: `aspect-[256/200] min-h-[200px]
  w-full max-w-[256px] flex items-center justify-center` (the
  preview is a 256:200 box capped to 256 px wide).
- `<Canvas>`: drop the inline `style` (`width: 256, height: 200`).
  R3F's default behavior is to fill its parent, which now has a
  pre-laid-out aspect-ratio.

The `aspect-ratio` CSS property pre-allocates the height *before*
the canvas content paints; even on cold mount the slot is already
the right size and the canvas content fades in inside it without
disturbing siblings.

**Rationale**: `aspect-ratio` is the canonical CSS solution for
"reserve this much space before the embedded media loads"; it
applies equally to images, videos, iframes, and R3F canvases.

**Alternative considered**: keep the explicit `width: 256,
height: 200` inline style and add `min-height: 200px` to the
parent. Rejected — duplicate declarations, harder to evolve, and
the canvas mount still re-runs `useResize` because the inline
style is parsed at React render and the canvas reads parent
size after paint.

### Decision 5: RightSidebar outer Tabs min-height = 640 px

RightSidebar at 1440x900 has the right rail at 440 px wide
(per `office-chat-default-presentation`). The two outer tabs
host:

- `chat`: `ChatPanel` (input + scrollable message list +
  StreamingBubble + ChatInput stack) — minimum stable height
  with empty conversation ≈ 540 px.
- `tasks`: nested Tabs (Activity / Plan / Outputs) ≈ 580 px
  for the tallest sub-tab (`Plan` with 3-4 task cards).

The outer floor is 640 px (the empty `chat` rail's natural
height plus the Workspace eyebrow + tab triggers). Below the
floor, the rail bounces between 540 (empty chat) and 580+ (with
Tasks Plan content); above the floor, both states fit and the
rail does not move.

**Rationale**: same logic as Personnel inspector — the floor is
the height of the steady-state worst-case content, and overflow
scrolls internally. 640 px chosen over 580 to leave headroom
for chat input growth (multi-line draft) without re-introducing
shift.

**Alternative considered**: bind to viewport height
(`min-h-[calc(100vh-160px)]`). Rejected — at narrow tier the
rail collapses or transforms to ChatDrawer per the existing
responsive rules; coupling to viewport leaks responsive
concerns into shift contract.

### Decision 6: WorkspacePageShell skeleton heights match real content per workspace

The current 4-row skeleton is identical for every workspace; the
real content height varies dramatically. The fix is a CSS custom
property `--workspace-min-content-height` set in `workspace-shell.css`
keyed off the `data-workspace` attribute the shell already writes:

```css
.workspace-shell[data-workspace="office"]    { --workspace-min-content-height: 540px; }
.workspace-shell[data-workspace="personnel"] { --workspace-min-content-height: 600px; }
.workspace-shell[data-workspace="sops"]      { --workspace-min-content-height: 540px; }
.workspace-shell[data-workspace="market"]    { --workspace-min-content-height: 480px; }
.workspace-shell[data-workspace="activity-log"] { --workspace-min-content-height: 600px; }
.workspace-shell[data-workspace="settings"]  { --workspace-min-content-height: 480px; }
```

`LoadingSkeleton` then renders a single `<div>` with
`min-height: var(--workspace-min-content-height, 480px)` and the
existing animate-pulse strips inside it. The fallback (`480px`)
covers any future workspace before its custom property lands.

**Rationale**: the skeleton's purpose is to reserve space, not to
look like a wireframe. A single `min-height` block does the job
and the `data-workspace` attribute is already there for the right
key.

**Alternative considered**: per-workspace bespoke skeleton
shapes (Personnel: list rail + detail card silhouette; Office:
3D scene loading spinner). Rejected — bigger surface area, not
needed for shift stability, distracts from the actual scope.

### Decision 7: Self-host Inter + JetBrains Mono variable woff2 with `font-display: swap`

CSS already references both families. We add:

- `apps/web/public/fonts/inter-var.woff2` (Inter v4.0 variable,
  `wght 100-900`, Latin + Latin Extended subset, ≈ 105 KB).
- `apps/web/public/fonts/jetbrains-mono-var.woff2`
  (JetBrains Mono v2.304 variable, `wght 100-800`, Latin subset,
  ≈ 75 KB).

`apps/web/src/index.css` adds two `@font-face` blocks at the top
(line 1, before `@import "tailwindcss"`):

```css
@font-face {
  font-family: 'Inter';
  font-style: normal;
  font-weight: 100 900;
  font-display: swap;
  src: url('/fonts/inter-var.woff2') format('woff2-variations');
  unicode-range:
    U+0000-024F, U+1E00-1EFF, U+2000-206F, U+2074, U+20AC,
    U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD;
}
@font-face {
  font-family: 'JetBrains Mono';
  font-style: normal;
  font-weight: 100 800;
  font-display: swap;
  src: url('/fonts/jetbrains-mono-var.woff2') format('woff2-variations');
  unicode-range: U+0000-024F;
}
```

`apps/web/index.html` adds `<link rel="preconnect">` (no longer
needed since self-hosted; replaced by `<link rel="preload">` to
the asset URL):

```html
<link rel="preload" href="/fonts/inter-var.woff2" as="font" type="font/woff2" crossorigin />
<link rel="preload" href="/fonts/jetbrains-mono-var.woff2" as="font" type="font/woff2" crossorigin />
```

`font-display: swap` allows immediate paint with the system
fallback; the swap to Inter on font ready triggers a glyph repaint
*within* each text node — the layout shift is bounded by the
Inter and system metrics being close (Inter is metric-compatible
with Helvetica / Arial in browser fallback chains by design;
JetBrains Mono with SFMono-Regular / Consolas).

**Rationale**: `font-display: swap` is the standard recipe and
Inter ships with documented metrics for fallback compatibility.
Self-hosting beats Google Fonts because (a) Tauri release builds
do not have arbitrary network access from the file:// origin —
preload ensures the font is part of the app bundle; (b)
preconnect to `fonts.gstatic.com` adds two network round-trips
before paint; self-hosted is one fetch, parallel with the JS
bundle.

**Alternative considered**: Google Fonts CDN with
`<link rel="preconnect">`. Rejected for Tauri compat (CSP
allowlist would have to include `fonts.gstatic.com` and the
release `.app` runs from `tauri://localhost`).

### Decision 8: StreamingBubble bounds height at 60vh; `overscroll-contain` on bubble

A 50,000-token streamed answer can span thousands of pixels.
Without bound, the bubble grows past viewport and the chat list
auto-scroll keeps up — the user cannot read the start of the
response without manual scroll. The fix:

- Bubble outer: `max-h-[60vh] overflow-y-auto overscroll-contain`.
- The chat panel scrolls the *list*; the bubble scrolls within
  itself once content exceeds 60vh.
- `overscroll-contain` blocks rubber-band scroll-chain into the
  rail's outer scroll container — important on Tauri release
  where `apps/desktop` runs in a webview and scroll bubbling is
  the macOS default.

**Rationale**: 60vh is large enough that almost all assistant
turns fit without forcing inner scroll; large enough that, when
they do exceed, the user can still see surrounding chat context.

**Alternative considered**: `max-h-[400px]`. Rejected — 400 px
forces inner scroll on most prose answers.

### Decision 9: DialogShell `DIALOG_TABS_CONTENT_CLASS` gains `min-h-[320px]`

Currently the constant is `'flex-1 min-h-0 overflow-y-auto'`. The
`min-h-0` is correct for the flex chain (lets the scroll container
shrink below content), but combined with `flex-1`, an empty tab
collapses to 0 px and the dialog "deflates". The fix:
`'flex-1 min-h-[320px] overflow-y-auto'`.

320 px is empirically the floor across all current dialog tab
bodies:

- Project create dialog: ≈ 220 px.
- Settings legacy dialogs (pre-removal Employee Editor): ≈ 320 px.
- Studio Asset inspector tabs: ≈ 280 px.

Picking 320 px gives every existing caller headroom without forcing
content scroll on tabs that fit in 280–300.

**Rationale**: empirical, conservative, and survives the dialog's
clamp ceiling (`max-h-[min(720px,92vh)]`) — 320 + dialog header +
footer ≈ 460 px, well below ceiling.

**Alternative considered**: per-dialog opt-in via prop. Rejected
— same reasoning as Decision 2; one number, applies everywhere,
no per-caller tuning to drift.

### Decision 10: Tabs unmount policy SSOT lives in `dialog-shell.tsx`

Two named class constants exported from `packages/ui-core/src/components/dialog-shell.tsx`:

- `TABS_RETAIN_STATE_CLASS = 'data-[state=inactive]:hidden'` —
  use with `forceMount` on `TabsContent` to keep all tabs mounted
  and toggle visibility (state preservation + layout stability).
- `DIALOG_TABS_CONTENT_CLASS = 'flex-1 min-h-[320px] overflow-y-auto'`
  (existing, modified) — default unmount via Radix.

JSX pattern:

```tsx
<TabsContent
  value="profile"
  forceMount
  className={cn(DIALOG_TABS_CONTENT_CLASS, TABS_RETAIN_STATE_CLASS)}
>
  ...
</TabsContent>
```

Or for default unmount:

```tsx
<TabsContent value="profile" className={DIALOG_TABS_CONTENT_CLASS}>
  ...
</TabsContent>
```

Audit pass: every `TabsContent` in `ui-office` SHALL use one of the
two patterns. Inline literals (`data-[state=inactive]:hidden` as a
string) SHALL be replaced.

**Rationale**: putting both constants in `dialog-shell.tsx`
co-locates the Tabs SSOT next to the dialog SSOT they pair with.
Importers already pull from `@offisim/ui-core`; one more named
export costs nothing.

**Alternative considered**: new file `tabs-policy.ts` in
`ui-core`. Rejected — overhead for two strings; the dialog-shell
file is already the recognized SSOT for tab-related class
constants.

### Decision 11: Motion timing custom properties as Change F interim

Three CSS custom properties in `apps/web/src/index.css`:

```css
:root {
  --motion-duration-fast: 120ms;
  --motion-duration-base: 200ms;
  --motion-duration-slow: 320ms;
  --motion-easing-standard: cubic-bezier(0.2, 0, 0, 1);
}
```

Applied this change:

- `dialog-shell.tsx:138` `duration-200` → keep Tailwind class
  (Tailwind `duration-200` already maps to 200 ms; no functional
  change, but document mapping in spec). Spec adds: when the
  Tailwind preset is replaced by token-based config in Change F,
  the binding becomes `transition-duration: var(--motion-duration-base)`.
- `apps/web/src/index.css:267-278` `list-item-in 200ms ease-out` →
  `list-item-in var(--motion-duration-base) var(--motion-easing-standard)`.
- `apps/web/src/index.css:296-310` `streaming-shimmer 1.6s
  ease-in-out infinite` → leave as-is. Streaming shimmer is a
  loop, not an enter/exit; Change F handles it.

Change F (`unify-design-token-system`) consumes these tokens and
adds duration aliases to the Tailwind theme; this change does
not redefine the Tailwind side, only the CSS variables.

**Rationale**: this change cannot ship without aligning the
visible motion durations of dialog enter, list-item enter, tab
swap fade — otherwise the UX feels patchworky. Change F is the
permanent home; we surface three tokens here so the binding is
already named when F lands.

**Alternative considered**: hold all motion changes for Change F.
Rejected — the dialog/tabs duration drift is part of the
"buggy feel" the user reports under tab swap; ignoring it means
the layout-shift fix lands but the feel stays uneven.

### Decision 12: Responsive break smoothing — single column at < lg keeps the same min-height budget

`PersonnelPage.tsx:129` switches from `grid-cols-1` to a 3-column
grid at `lg` (1280 px). Below `lg`, the inspector tabs become a
stacked block in the single column; the `min-h-[560px]` floor
applies regardless of tier. The rule SHALL be: `min-height` of
the inspector tabs region is the same in narrow / tablet / desktop
modes.

Concretely the JSX changes from:

```tsx
<div className="grid h-full w-full grid-cols-1 lg:grid-cols-[280px_minmax(0,1fr)_minmax(0,420px)]">
```

to:

```tsx
<div className="flex h-full w-full flex-col lg:grid lg:grid-cols-[280px_minmax(0,1fr)_minmax(0,420px)]">
```

The right inspector `<section>` keeps `min-h-[560px]` (same in
both modes). The list rail and detail `<section>` keep their
intrinsic heights but stack vertically below `lg`. This avoids
the case where resizing across 1280 px restructures the grid and
the inspector's height budget changes — at narrow / tablet the
inspector is below the list+detail with the same 560 px floor.

**Rationale**: one min-height floor, two layout modes — the
budget is invariant under resize.

**Alternative considered**: container-query the inspector and
respond to its own width. Rejected — container queries are still
a Tier-3 risk for older webviews and Tauri release ships
WebKit at OS-vendor-pinned versions; hard breakpoint is more
predictable.

## Risks / Trade-offs

[Risk] 560 px Personnel min-height could leave whitespace below
the Profile tab (≈ 320 px content) at desktop. Mitigation: at
1440x900 the right inspector column is 420 px wide and 560 px tall;
that is a comfortable form-factor (1.33:1 portrait). Empty space
below shorter tabs is acceptable — better than bouncing.

[Risk] `forceMount` on all six Personnel tabs increases initial
mount cost. The Appearance tab boots an R3F canvas; mounting it
even when inactive consumes GPU. Mitigation: R3F canvases run
their render loop only when in viewport (R3F's `frameloop="demand"`
default is event-driven). With Appearance tab `data-[state=inactive]:hidden`,
the canvas is `display: none` and R3F suspends rendering.
Verified by: check `r3f stats` panel during live verify, confirm
`fps` of the Appearance canvas is 0 when tab is inactive.

[Risk] Self-hosted variable woff2 fonts add 180 KB to the initial
bundle. Mitigation: `<link rel="preload">` with `font-display: swap`
means the bytes are fetched in parallel with the JS bundle (not
serial), and first paint uses system fallback so the bytes don't
block render. Net first-paint impact: 0; net layout shift impact:
near-0 (Inter and JetBrains Mono are metric-compatible with their
fallbacks, swap visible only at glyph-shape level).

[Risk] Three motion timing custom properties bound here may
diverge from Change F's final tokens. Mitigation: this change
specifies the tokens as variable names that Change F will own;
F's migration adjusts the values, not the names. If F decides
on different names, a one-line rename in F's task list.

[Risk] Removing `<Canvas style={{ width: 256, height: 200 }}>`
inline style could cause R3F to fill *more* than 256 px wide if
the parent slot ever exceeds 256. Mitigation: parent slot caps
at `max-w-[256px]`. Live verify covers this on Personnel
Appearance tab at narrow tier (where the column may shrink).

[Risk] `<TabsContent value="x" forceMount className="hidden">`
Radix pattern keeps DOM trees mounted; some inactive tabs may
do work (e.g. Memory tab subscribes to `memory.*` events even
when hidden). Mitigation: this is also the *intent* — keep
state warm. Live verify includes a memory-pressure check (open
Personnel for 10 minutes, swap tabs frequently; confirm event
log subscriber count is bounded by the tab count, not growing).

[Trade-off] DialogShell `min-h-[320px]` means a tiny dialog
(e.g. a confirm dialog) inherits 320 px of tab content height.
The dialog *clamp* (`min-h-[clamp(360px,60vh,720px)]` already
puts the floor at 360 px — adding 320 to a tab content
inside a 360 px dialog leaves only 40 px for header/footer/
nothing. Mitigation: tiny dialogs do not have Tabs; the
constant only applies inside dialogs that USE Tabs. Confirm
dialogs without Tabs are unaffected.

[Trade-off] Replacing the existing `data-[state=inactive]:hidden`
literals with `TABS_RETAIN_STATE_CLASS` constant edits ~6 files
in ui-office. Pre-launch policy says "no back-compat shims" — we
delete the literals and migrate. The change to the source-tree
is mechanical (search/replace) but git diff shows in many places.

## Migration Plan

Pre-launch — no migration. The change ships in one commit chain
following the build order `shared-types → ui-core → ui-office →
web`. All four migrated surfaces (`PersonnelPage`, `RightSidebar`,
`WorkspacePageShell`, `DialogShell`) are touched in the same
change. Self-hosted woff2 binaries are added under
`apps/web/public/fonts/` and committed to the repo (≤ 200 KB
combined; below the typical asset size threshold). No DB
migration. No state migration. No release flag.

Tauri release rebuild required (CSS / asset / class changes).
Web build picks up the CSS; desktop release SHALL re-bundle
the `apps/web/dist` output via `pnpm --filter @offisim/desktop
build`. Per CLAUDE.md gotcha: any change that touches
`packages/ui-office` requires `pnpm --filter @offisim/ui-office
build` first; Tauri `.app` SHALL be rebuilt against the new
`dist`.

Live verification on release `.app` covers six workspaces +
RightSidebar tab swap + Personnel inspector tab swap +
DialogShell tab body floor + cold-load FOUT measurement. CLS
budget ≤ 0.05 per surface, measured by Chrome DevTools
Performance trace at 1440x900 and 1280x800.
