## ADDED Requirements

### Requirement: Every Tabs surface SHALL declare a `min-height` floor equal to the tallest steady-state tab content

Surfaces that host a Radix `Tabs.Root` with two or more visible tab triggers SHALL declare a `min-height` on the wrapper that contains the `TabsContent` children. The floor SHALL be at least the rendered height of the visually tallest steady-state tab body (i.e. the tallest tab in its rest state, before any expansion or async load growth). Tab bodies whose content grows beyond the floor SHALL scroll inside the body via `overflow-y: auto`, NOT expand the wrapper.

`min-height` floor values for the surfaces touched by this change:

- Personnel right inspector wrapper: `min-h-[560px]`.
- Personnel `TabsContent` per tab: `min-h-[520px]` (560 minus the trigger row).
- RightSidebar outer `Tabs.Root`: `min-h-[640px]`.
- DialogShell `DIALOG_TABS_CONTENT_CLASS`: `min-h-[320px]` (default for any future tabbed dialog).

Surfaces added in future changes SHALL document their floor value in the corresponding capability spec, derived empirically from the tallest steady-state tab content.

#### Scenario: Personnel inspector wrapper declares 560 px floor

- **WHEN** opening Personnel at viewport 1440x900 with an internal employee selected
- **THEN** `getComputedStyle(personnelInspectorWrapper).minHeight` SHALL be `'560px'`
- **AND** clicking through Profile → Appearance → Runtime → Skills → Memory → History SHALL NOT change `getComputedStyle(personnelInspectorWrapper).height`

#### Scenario: RightSidebar outer Tabs declares 640 px floor

- **WHEN** opening Office at viewport 1440x900 with the right rail expanded
- **THEN** `getComputedStyle(rightSidebarOuterTabs).minHeight` SHALL be `'640px'`
- **AND** swapping between Chat and Tasks tabs SHALL NOT change the rail's outer rendered height by more than 1 px

#### Scenario: DialogShell tab content body declares 320 px floor

- **WHEN** any dialog using `DIALOG_TABS_CONTENT_CLASS` renders an empty tab body (no content yet loaded, or a placeholder shell)
- **THEN** `getComputedStyle(activeTabsContent).minHeight` SHALL be `'320px'`
- **AND** the dialog outer container SHALL NOT visibly deflate during the empty-body window

### Requirement: Every Tabs caller SHALL declare unmount policy via SSOT class constants

Two named class constants exported from `@offisim/ui-core/dialog-shell` SHALL be the single source of truth for Tabs unmount policy:

- `TABS_RETAIN_STATE_CLASS = 'data-[state=inactive]:hidden'` — pairs with `forceMount` on `TabsContent` to keep all tabs mounted in the DOM and toggle visibility. Used when the Tabs surface needs (a) state preservation across tab swap, (b) layout stability across tab swap, OR (c) embedded heavy content (canvas, iframe) that should not re-mount.
- `DIALOG_TABS_CONTENT_CLASS` — pairs with Radix's default unmount semantics. Used when tab state and content are cheap to rebuild and there is no shift-stability concern.

Surfaces SHALL use one or the other, never inline `'data-[state=inactive]:hidden'` literals or hand-rolled `forceMount` patterns. Audit gate: zero matches for the literal string `data-[state=inactive]:hidden` outside of the SSOT module after migration.

#### Scenario: Personnel uses retain-state policy

- **WHEN** auditing `packages/ui-office/src/components/employees/PersonnelPage.tsx`
- **THEN** every `<TabsContent>` child of the inspector `<Tabs>` SHALL include `forceMount` AND apply `TABS_RETAIN_STATE_CLASS` via `cn(...)`
- **AND** no inline `'data-[state=inactive]:hidden'` literal SHALL appear in the file

#### Scenario: RightSidebar uses retain-state policy

- **WHEN** auditing `packages/ui-office/src/components/layout/RightSidebar.tsx`
- **THEN** every `<TabsContent>` (outer Chat/Tasks AND inner Activity/Plan/Outputs) SHALL include `forceMount` AND apply `TABS_RETAIN_STATE_CLASS`
- **AND** no inline `'data-[state=inactive]:hidden'` literal SHALL appear in the file

#### Scenario: SSOT constants exported from `@offisim/ui-core`

- **WHEN** importing from `@offisim/ui-core`
- **THEN** both `TABS_RETAIN_STATE_CLASS` and `DIALOG_TABS_CONTENT_CLASS` SHALL be available as `string` constants
- **AND** their values SHALL match the documented policy (`'data-[state=inactive]:hidden'` and `'flex-1 min-h-[320px] overflow-y-auto'` respectively)

### Requirement: Every async-loaded surface SHALL render a skeleton whose height matches the ready-state floor

`WorkspacePageShell.LoadingSkeleton` and any sibling skeleton helpers SHALL reserve a `min-height` equal to the workspace's known ready-state floor (the height the workspace will report once content loads). The reservation SHALL be expressed via the CSS custom property `--workspace-min-content-height`, set per workspace in `workspace-shell.css` keyed off the `data-workspace` attribute.

Per-workspace floors:

- `office`: `540px`
- `personnel`: `600px`
- `sops`: `540px`
- `market`: `480px`
- `activity-log`: `600px`
- `settings`: `480px`
- Default fallback (any future workspace before its custom property is set): `480px`

The skeleton's outer reservation block SHALL apply the class `workspace-shell-loading-region` which resolves to `min-height: var(--workspace-min-content-height)`.

#### Scenario: Personnel loading skeleton reserves 600 px

- **WHEN** opening Personnel at viewport 1440x900 with `loading=true`
- **THEN** the loading skeleton's outer block SHALL render with computed `min-height: 600px`
- **AND** the loading→ready transition SHALL NOT shift the surrounding page

#### Scenario: Default fallback applies to unknown workspace

- **WHEN** any future workspace renders with `data-workspace` set to a value not yet listed in `workspace-shell.css`
- **THEN** the loading skeleton SHALL apply the fallback `min-height: 480px`
- **AND** the workspace SHALL NOT collapse to zero or unreserve space during load

### Requirement: Custom fonts SHALL be preloaded with `font-display: swap`

The web shell's `index.html` SHALL preload every custom font referenced by `apps/web/src/index.css` via `<link rel="preload" as="font" type="font/woff2" crossorigin>` tags placed in `<head>`. Each preloaded font SHALL be served from a same-origin path (no third-party CDN) so the Tauri release `.app` (running from `tauri://localhost`) can load it without CSP allowlist changes.

Each `@font-face` block SHALL declare `font-display: swap` so the browser paints text immediately with the system fallback and re-paints once the custom font is ready, instead of blocking text render.

Preloaded fonts after this change:

- `Inter` variable woff2, weight `100 900`, Latin + Latin Extended subset, ≤ 110 KB.
- `JetBrains Mono` variable woff2, weight `100 800`, Latin subset, ≤ 80 KB.

Combined preload payload SHALL be ≤ 200 KB. Future font additions SHALL re-evaluate this budget.

#### Scenario: Web shell preloads Inter and JetBrains Mono

- **WHEN** loading `apps/web/index.html`
- **THEN** the document `<head>` SHALL contain `<link rel="preload" href="/fonts/inter-var.woff2" as="font" type="font/woff2" crossorigin>` AND `<link rel="preload" href="/fonts/jetbrains-mono-var.woff2" as="font" type="font/woff2" crossorigin>`

#### Scenario: Both fonts use font-display: swap

- **WHEN** auditing `apps/web/src/index.css` `@font-face` blocks
- **THEN** both Inter and JetBrains Mono blocks SHALL declare `font-display: swap`
- **AND** the `src` URL of each SHALL resolve to a same-origin path under `/fonts/`

#### Scenario: First-paint FOUT is measurable but bounded

- **WHEN** loading the web shell at 1440x900 with cache disabled and Slow 3G throttle
- **THEN** the cumulative layout shift attributable to font swap SHALL be ≤ 0.10 measured by Chrome DevTools Performance trace
- **AND** the first contentful paint SHALL NOT block on font load (text SHALL render in system fallback within the first 100 ms after navigation start)

### Requirement: Embedded canvas / 3D / iframe slots SHALL declare `aspect-ratio` or `min-height` before mount

Slots that host a `react-three-fiber` `<Canvas>`, an `<iframe>`, an `<img>`, a `<video>`, or any other element whose intrinsic size is computed asynchronously SHALL pre-allocate the slot's height via either (a) a CSS `aspect-ratio` property paired with a parent `width`, or (b) an explicit `min-height` value. The pre-allocation SHALL be applied to the slot's parent element so the layout pass completes before the embedded content mounts.

Inline `style={{ width, height }}` props on `<Canvas>` SHALL NOT be used to declare the slot size — R3F mount runs `useResize` on parent, fighting any inline self-declared size.

#### Scenario: AppearanceTab Canvas slot uses aspect-ratio

- **WHEN** auditing `packages/ui-office/src/components/employees/personnel-tabs/AppearanceTab.tsx`
- **THEN** the `PreviewCard` content slot for the 3D preview SHALL declare `aspect-[256/200]`, `min-h-[200px]`, and `max-w-[256px]`
- **AND** the `<Canvas>` element inside SHALL NOT declare `style={{ width, height }}` — the canvas SHALL fill its parent slot

#### Scenario: 3D Canvas mount does not shift siblings

- **WHEN** opening Personnel Appearance tab from a cold state
- **THEN** the 2D preview's pixel position SHALL NOT change between T=0 (tab activated, slot reserved) and T=+200ms (canvas painted)

### Requirement: Streaming text bubbles SHALL bound height and use `overscroll-contain`

`StreamingBubble` and other surfaces that display incrementally-streamed text content SHALL declare a `max-height` no greater than `60vh`, an `overflow-y: auto` for inner scroll, and `overscroll-contain` to block scroll-chain into ancestor containers.

Reasoning region (`StreamingBubble.ReasoningRegion`) SHALL declare a tighter bound (`max-h-[40vh]`) since it is auxiliary content shown above the answer.

#### Scenario: Long streamed answer scrolls inside bubble

- **WHEN** the model streams a response exceeding 60vh of vertical text
- **THEN** the bubble SHALL render at `max-height: 60vh` with `overflow-y: auto`
- **AND** scrolling at the bubble's bottom edge SHALL NOT bubble up to the chat list scroll container (`overscroll-behavior: contain`)

#### Scenario: Reasoning region uses tighter bound

- **WHEN** the model emits reasoning content alongside an answer
- **THEN** the reasoning region SHALL render at `max-height: 40vh`
- **AND** it SHALL NOT consume more screen than the answer that follows

### Requirement: Motion timing SHALL be expressed via custom properties pending Change F unification

Three CSS custom properties SHALL be declared in `apps/web/src/index.css` `:root` block:

- `--motion-duration-fast: 120ms` — short-lived enter/exit (toasts, tooltips).
- `--motion-duration-base: 200ms` — default enter/exit (dialogs, list items).
- `--motion-duration-slow: 320ms` — longer enter/exit (workspace switches).
- `--motion-easing-standard: cubic-bezier(0.2, 0, 0, 1)` — Material-style standard easing.

Animations and transitions touched by this change SHALL bind to these properties:

- `list-item-in` keyframe SHALL use `var(--motion-duration-base)` and `var(--motion-easing-standard)`.
- DialogShell content `duration-200` SHALL be documented as the literal binding for `var(--motion-duration-base)` (rebinding to the variable is owned by Change F's Tailwind theme rewrite).

Looped non-enter/exit animations (`streaming-shimmer`) are owned by Change F.

#### Scenario: Motion tokens declared in :root

- **WHEN** auditing `apps/web/src/index.css` `:root` block
- **THEN** the four motion custom properties (`--motion-duration-fast`, `--motion-duration-base`, `--motion-duration-slow`, `--motion-easing-standard`) SHALL be declared
- **AND** the `list-item-in` animation rule SHALL bind to `var(--motion-duration-base)` and `var(--motion-easing-standard)`

#### Scenario: DialogShell duration documented

- **WHEN** auditing `packages/ui-core/src/components/dialog-shell.tsx` near the `duration-200` Tailwind class
- **THEN** a JSDoc comment SHALL note that the literal 200 ms maps to `var(--motion-duration-base)` and that Change F will rebind via Tailwind theme

### Requirement: Live verification SHALL measure Cumulative Layout Shift via Chrome DevTools Performance trace

Verification of any change in this capability SHALL include a Chrome DevTools Performance trace capturing the relevant interaction (tab swap, workspace switch, cold load) and SHALL report the Cumulative Layout Shift score from the "Layout Shift" section of the trace. CLS budgets:

- Tab swap (within an open surface): **CLS ≤ 0.05** total across the swap loop.
- Cold workspace load: **CLS ≤ 0.05** between navigation start and first idle.
- First-paint FOUT (font swap): **CLS ≤ 0.10** between navigation start and font ready (slightly looser; one-time event per session).

Failure to meet the budget on any verified surface SHALL block the change archive — the offending surface SHALL be re-fixed and re-verified.

#### Scenario: Personnel tab swap meets CLS budget

- **WHEN** running Chrome DevTools Performance trace at 1440x900 in the Tauri release `.app` while clicking through all six Personnel tabs
- **THEN** the "Cumulative Layout Shift" metric in the trace SHALL be ≤ 0.05 total

#### Scenario: RightSidebar tab swap meets CLS budget

- **WHEN** running Chrome DevTools Performance trace at 1440x900 while swapping Chat ↔ Tasks ↔ inner sub-tabs
- **THEN** the "Cumulative Layout Shift" metric in the trace SHALL be ≤ 0.05 total

#### Scenario: Cold workspace load meets CLS budget

- **WHEN** running Chrome DevTools Performance trace from navigation start through first idle on Office at 1440x900 with cache disabled
- **THEN** the "Cumulative Layout Shift" metric SHALL be ≤ 0.05 across the entire load
- **AND** the trace SHALL show font preload requests initiating ≤ 50 ms after navigation start

### Requirement: Tabs unmount policy SHALL be documented in `packages/ui-core/src/components/dialog-shell.tsx`

The `dialog-shell.tsx` source file SHALL contain JSDoc on both `TABS_RETAIN_STATE_CLASS` and `DIALOG_TABS_CONTENT_CLASS` describing when to use which:

- `TABS_RETAIN_STATE_CLASS` (use with `forceMount`): state-preserving Tabs, layout-stable Tabs, Tabs with embedded heavy content (canvas / 3D / iframe).
- `DIALOG_TABS_CONTENT_CLASS` (Radix default unmount): cheap Tabs, no state to preserve, no layout-shift concern.

The JSDoc SHALL also reference the layout-shift-stability spec for the rationale.

#### Scenario: SSOT file contains policy JSDoc

- **WHEN** auditing `packages/ui-core/src/components/dialog-shell.tsx`
- **THEN** the file SHALL contain JSDoc above both `TABS_RETAIN_STATE_CLASS` and `DIALOG_TABS_CONTENT_CLASS` documenting the policy
- **AND** the JSDoc SHALL reference the `layout-shift-stability` capability by name
