## Why

Tab and pane switches across the product visibly jolt the layout. The user
already reports the Personnel right-inspector "shifts up and down" between
its 6 tabs, but the audit covers every other layout-shift / CLS source the
shell currently ships with — none of which can be carved off without
leaving the experience feeling cheap. We are pre-launch (no back-compat,
no flag-gated rollout) and product closure says functional ≠ optimal: a
workspace where tabs visibly bounce, fonts FOUT, the 3D preview pops in
after first paint, the streaming chat re-flows the rail, and dialogs
collapse mid-tab fails the "elegant and simple" UX bar regardless of
whether each individual surface is "working".

The concrete root causes, all in scope of this change:

- **Personnel right inspector**
  (`packages/ui-office/src/components/employees/PersonnelPage.tsx:236`):
  the `<div className="flex min-h-0 flex-1 flex-col">` that wraps all six
  `TabsContent` declares no `min-height`. `Profile` ≈ 200 px, `Appearance`
  embeds an R3F Canvas at ≥ 400 px, `Memory` / `History` grow from 80 px
  to 500 px+ as data loads. Switching tabs re-paints the wrapper at the
  new tab's intrinsic height and pushes the rest of the page.
- **RightSidebar Chat ↔ Tasks** (`RightSidebar.tsx:71-153`): both outer
  `TabsContent` use `forceMount + data-[state=inactive]:hidden`, but the
  `Tabs.Root` itself only declares `min-h-0 flex-1`. When the `chat`
  tab's `ChatPanel` is mid-stream (growing message list) and the user
  flips to `tasks`, the rail snaps to the `TaskDashboard` grid height —
  cosmetically identical to the inverse swap. Same on the inner
  `Activity / Plan / Outputs` sub-tabs.
- **WorkspacePageShell loading skeleton**
  (`packages/ui-office/src/components/workspace/WorkspacePageShell.tsx:19-34`):
  the `LoadingSkeleton` hard-codes 4 placeholder rows totaling ~180 px;
  every workspace's real first paint is materially different (Personnel
  ≥ 600 px, SOPs canvas ≥ 540 px, Settings ≈ 480 px, Activity ≥ 600 px),
  so the loading→ready transition jumps the page.
- **Web font FOUT** (`apps/web/index.html`, `apps/web/src/index.css:101-105`):
  `--font-sans: "Inter"` and `--font-mono: "JetBrains Mono"` are referenced
  but never `@font-face`-declared, never preloaded, and never given
  `font-display`. Browsers fall back to system metrics, then re-paint
  every glyph on font ready — every tab trigger label, every chat bubble,
  every Settings row reflows.
- **AppearanceTab 3D preview**
  (`packages/ui-office/src/components/employees/personnel-tabs/AppearanceTab.tsx:54-79`):
  `PreviewCard` declares `h-[200px]` for its content slot but
  `Preview3DCanvas` re-imposes `style={{ width: 256, height: 200 }}` at
  Three.js mount. R3F first paint typically lags 1-2 frames behind React
  layout — for that window the slot reports the 200 px-fixed shell while
  the canvas content is empty, then the controls fade in and bump
  scrolling.
- **StreamingBubble unbounded growth**
  (`packages/ui-office/src/components/chat/StreamingBubble.tsx:34-59`):
  `max-w-[94%]` sets horizontal width but the bubble has no
  `max-height` / `overflow-anchor` discipline. Long streamed answers
  grow the surrounding chat list past viewport in the middle of a token
  burst; ChatPanel's parent column already has `min-h-0 flex-col`, but
  the message scroll container needs `overflow-anchor: auto` (default)
  AND `overscroll-behavior: contain` to stop scroll-chaining to the rail.
- **DialogShell + Tabs collapse**
  (`packages/ui-core/src/components/dialog-shell.tsx:143-176`): `DIALOG_TABS_CONTENT_CLASS`
  is `flex-1 min-h-0 overflow-y-auto` — no `min-height` floor. When a
  dialog tab body briefly renders nothing (empty form, async load), the
  inner column collapses to 0 px and the dialog visually "deflates",
  then re-inflates on the next render. The clamp on the dialog outer
  shell hides this for now, but tab swap mid-load still flashes.
- **Radix Tabs unmount semantics**: across the codebase, some surfaces
  (RightSidebar) opt into `forceMount + data-[state=inactive]:hidden`
  to keep state, others (`PersonnelPage`, `DialogShell` callers) let
  Radix unmount inactive tabs and lose form state. The behavior is not
  documented, not consistent, and contributes to layout shift because
  unmount→mount runs the full layout pass on the new content height
  instead of swapping pre-laid-out hidden content.
- **Responsive break at `lg` (1280 px)**: `PersonnelPage.tsx:129` switches
  from `grid-cols-1` to `grid-cols-[280px_minmax(0,1fr)_minmax(0,420px)]`.
  Just above and just below the break the active tab's intrinsic
  height differs, so a window resize across 1280 px steps the inspector
  tabs' `min-height` budget with no smoothing.
- **Animation timing drift** (`apps/web/src/index.css:266-318`,
  `dialog-shell.tsx:138`): `list-item-in 200ms ease-out`,
  `streaming-shimmer 1600ms ease-in-out`, dialog `duration-200` (Radix
  default 150 ms), and ad-hoc `transition-colors` calls (no duration)
  spread the motion vocabulary across five+ values. Inconsistent
  durations make the *same* layout shift feel different in different
  surfaces, which the user reads as "buggy".

Change F (`unify-design-token-system`) will own motion tokens long-term;
this change ships the dialog/tabs duration + easing pass interim so the
shift-stability guarantees do not regress when F lands. Pre-launch, no
back-compat — every surface gets the same fix at once.

## What Changes

- **Introduce `layout-shift-stability` capability** as a product-wide
  contract: every visible container that hosts swappable content (tabs,
  loading→ready transitions, async-loaded panes) SHALL declare a
  `min-height` floor or render an equally-tall skeleton; every custom
  font SHALL preload with `font-display: swap`; every Tabs surface SHALL
  declare its state-retention policy.
- **Personnel inspector min-height floor**: at
  `PersonnelPage.tsx:236`, replace the unsized `<div>` wrapper with one
  that declares `min-h-[560px]` (the worst-case content height of
  Memory/History/Skills tabs at 1440x900) and apply `forceMount +
  data-[state=inactive]:hidden` to all six `<TabsContent>` so the rail
  computes its row heights once on first mount, not per swap.
- **AppearanceTab Canvas slot `aspect-ratio`**: at
  `AppearanceTab.tsx:88-94`, replace `h-[200px]` with
  `aspect-[256/200] min-h-[200px] w-full max-w-[256px]` and remove the
  inline `style={{ width: 256, height: 200 }}` from `Preview3DCanvas`
  (`AppearanceTab.tsx:115`) so the canvas inherits the slot dimensions
  instead of fighting them. The Three.js R3F `<Canvas>` then mounts at
  pre-laid-out size and never bumps siblings.
- **RightSidebar fixed-rail height contract**: at
  `RightSidebar.tsx:71-75`, declare `min-h-[640px]` on the outer
  `Tabs.Root`. At line `100-152`, both `TabsContent` and the inner
  `activity / plan / outputs` panes already use
  `forceMount + data-[state=inactive]:hidden`; ensure the inactive
  panes keep `aria-hidden="true"` and do not render expensive trees
  unmounted (cosmetically already covered, but spec it so future
  edits do not regress).
- **WorkspacePageShell skeleton heights match real content**: at
  `WorkspacePageShell.tsx:19-34`, replace the four hard-coded
  placeholder rows with skeletons whose total height matches the
  `workspace`-prop's known minimum (Office ≥ 540, Personnel ≥ 600,
  SOPs ≥ 540, Market ≥ 480, Activity ≥ 600, Settings ≥ 480). New
  helper `WORKSPACE_MIN_CONTENT_HEIGHT_PX` table exported from
  `packages/ui-office/src/components/workspace/workspace-shell.css`
  via a CSS custom property `--workspace-min-content-height`.
- **Font preload + font-display**: in `apps/web/index.html` add
  ```html
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link
    rel="preload"
    href="/fonts/inter-var.woff2"
    as="font"
    type="font/woff2"
    crossorigin
  />
  <link
    rel="preload"
    href="/fonts/jetbrains-mono-var.woff2"
    as="font"
    type="font/woff2"
    crossorigin
  />
  ```
  Self-host the variable fonts under `apps/web/public/fonts/` (Inter
  variable + JetBrains Mono variable, both 400-900 weight, woff2 only).
  In `apps/web/src/index.css`, add `@font-face` blocks for both at the
  top with `font-display: swap`, `font-weight: 100 900`, and
  `unicode-range` covering Latin + Latin Extended for Inter (`U+0000-024F,
  U+1E00-1EFF, U+2000-206F, U+2074, U+20AC, U+2122, U+2191, U+2193,
  U+2212, U+2215, U+FEFF, U+FFFD`) and Latin only for JetBrains Mono
  (`U+0000-024F`).
- **StreamingBubble overflow contract**: at `StreamingBubble.tsx:45-57`,
  declare `max-h-[60vh] overflow-y-auto overscroll-contain` on the
  bubble and `overflow-anchor: auto` on the parent message list (already
  default but spec it). On Tauri release the `overscroll-contain` also
  blocks rubber-band scroll-chain into the rail.
- **DialogShell tab-content min-height floor**: at
  `dialog-shell.tsx:35`, change `DIALOG_TABS_CONTENT_CLASS` from
  `'flex-1 min-h-0 overflow-y-auto'` to
  `'flex-1 min-h-[320px] overflow-y-auto'`. 320 px is the
  empirical floor across all current dialog tab bodies (Studio Asset
  inspector tabs ≈ 280, Project create ≈ 220, Settings legacy dialogs
  ≈ 320). Document and add scenario.
- **Tabs unmount-policy SSOT**: define two named class constants in
  `packages/ui-core/src/components/dialog-shell.tsx`:
  `TABS_RETAIN_STATE_CLASS = 'data-[state=inactive]:hidden'` to be used
  with `forceMount` (state-preserving Tabs), and the existing
  `DIALOG_TABS_CONTENT_CLASS` (state-not-preserved). Audit and migrate
  every Tabs caller in `ui-office` to one of the two: PersonnelPage
  (forceMount), RightSidebar (forceMount, already there but pull in
  the constant), Settings sub-tabs (forceMount; carries unsaved
  changes). Document the policy in this change's spec.
- **Responsive break smoothing at 1280 px**: at
  `PersonnelPage.tsx:129`, replace
  `grid-cols-1 lg:grid-cols-[280px_minmax(0,1fr)_minmax(0,420px)]`
  with a layout that maintains the same tab-content min-height
  budget on either side of the break. Concretely: when `< lg`,
  switch the grid to a vertical stack with `min-h-[560px]` reserved
  for the tabs region so the inspector's intrinsic height does not
  push the page; when `≥ lg`, the existing 3-column layout already
  bounds height via the parent `h-full`.
- **Motion timing token interim** (handed to Change F long-term):
  introduce three CSS custom properties in `apps/web/src/index.css`:
  `--motion-duration-fast: 120ms`, `--motion-duration-base: 200ms`,
  `--motion-duration-slow: 320ms`, and `--motion-easing-standard:
  cubic-bezier(0.2, 0, 0, 1)`. Apply
  `transition-duration: var(--motion-duration-base)` to the
  DialogShell content `duration-200` (replace literal), the Tabs
  trigger transitions, and the `list-item-in` keyframe. Change F
  will subsume these into the unified token system.
- **Live verify gates**: live verification adds three CLS-specific
  steps — measure CLS via Chrome DevTools Performance trace at
  Personnel-tab swap, RightSidebar chat→tasks swap, and Office
  workspace cold load with throttled Slow-3G. Documented in
  `## Live verification` of `tasks.md`.

## Capabilities

### New Capabilities

- `layout-shift-stability`: product-wide contract for visible
  containers that swap content. Owns the rules: (a) every Tabs
  surface SHALL declare `min-height` ≥ tallest tab's intrinsic
  height; (b) every async-loaded surface SHALL paint a skeleton
  whose footprint matches the ready state; (c) every custom font
  SHALL preload with `font-display: swap`; (d) every Tabs caller
  SHALL declare unmount policy via the named SSOT class constants;
  (e) every embedded canvas / 3D / iframe slot SHALL declare
  `aspect-ratio` or fixed `min-height` BEFORE mount. Live-verify
  bar: CLS ≤ 0.05 at 1440x900 and 1280x800 across Office,
  Personnel, SOPs, Market, Activity, Settings.

### Modified Capabilities

- `personnel-workspace-surface`: 6-tab inspector wrapper SHALL
  declare `min-h-[560px]` floor; all six `TabsContent` SHALL use
  `forceMount + data-[state=inactive]:hidden` so tab switch is
  instant and does not re-mount the tab tree; the AppearanceTab
  3D Canvas slot SHALL declare `aspect-ratio` before mount.
- `office-chat-default-presentation`: RightSidebar outer `Tabs.Root`
  SHALL declare `min-h-[640px]`; both outer and inner
  `TabsContent` use `forceMount + data-[state=inactive]:hidden`;
  StreamingBubble SHALL bound message bubble height and use
  `overscroll-contain` so streaming token bursts do not push the
  rail layout.
- `responsive-app-shell`: WorkspacePageShell loading skeleton SHALL
  match the real content's min-height per workspace via
  `--workspace-min-content-height` custom property; web index.html
  SHALL preload Inter + JetBrains Mono with `font-display: swap`
  to eliminate FOUT-driven reflow at first paint; the `lg` (1280 px)
  responsive break SHALL preserve the same tab-content height
  budget on both sides.
- `panel-and-dialog-sizing`: `DIALOG_TABS_CONTENT_CLASS` SHALL gain
  a `min-h-[320px]` floor; new sibling constant
  `TABS_RETAIN_STATE_CLASS = 'data-[state=inactive]:hidden'` SHALL
  be exported alongside, and the file SHALL document the policy
  pairing (`forceMount + TABS_RETAIN_STATE_CLASS` for state-
  preserving Tabs vs default unmount). Three motion-timing custom
  properties SHALL be applied to dialog enter/exit transitions
  pending Change F's full token unification.

## Impact

- **Code (component layout)**:
  - `packages/ui-office/src/components/employees/PersonnelPage.tsx`
    (lines 129, 236-258): grid floor + Tabs unmount policy.
  - `packages/ui-office/src/components/employees/personnel-tabs/AppearanceTab.tsx`
    (lines 86-95, 111-115): preview slot aspect-ratio + drop inline
    canvas style.
  - `packages/ui-office/src/components/layout/RightSidebar.tsx`
    (lines 71-75, 100-152): outer Tabs min-height + retain-state
    constant import.
  - `packages/ui-office/src/components/chat/StreamingBubble.tsx`
    (lines 45-57): bubble height bound + `overscroll-contain`.
  - `packages/ui-office/src/components/workspace/WorkspacePageShell.tsx`
    (lines 19-34): skeleton height matches workspace-prop floor.
  - `packages/ui-office/src/components/workspace/workspace-shell.css`:
    new `--workspace-min-content-height` custom property family.
  - `packages/ui-core/src/components/dialog-shell.tsx`
    (lines 35, 138): `DIALOG_TABS_CONTENT_CLASS` floor + new
    `TABS_RETAIN_STATE_CLASS` export + motion duration token.

- **Code (assets / shell)**:
  - `apps/web/index.html`: `<link rel="preconnect">` + 2x
    `<link rel="preload">` for Inter / JetBrains Mono variable
    woff2.
  - `apps/web/src/index.css` (lines 1, 100-105, 266-278): 2x
    `@font-face` blocks at top, motion-timing custom properties,
    `--motion-duration-base` applied to `list-item-in` keyframe.
  - `apps/web/public/fonts/inter-var.woff2`,
    `apps/web/public/fonts/jetbrains-mono-var.woff2`: new
    self-hosted variable font binaries (woff2, ≤ 200 KB combined).

- **Spec / docs**:
  - New `openspec/specs/layout-shift-stability/spec.md` after
    archive (this change provides it).
  - `personnel-workspace-surface`, `office-chat-default-presentation`,
    `responsive-app-shell`, `panel-and-dialog-sizing` each gain
    new requirements.
  - `CLAUDE.md` "Cross-Cutting Facts" section gains a one-line
    pointer: "Layout-shift contract lives in
    `layout-shift-stability` capability — Tabs unmount policy SSOT
    is `TABS_RETAIN_STATE_CLASS` from `@offisim/ui-core/dialog-shell`."
  - `packages/ui-office/CLAUDE.md` gains a "Layout shift" section
    summarizing the four contract bullets.

- **No back-compat**: pre-launch. Existing surfaces are migrated to
  the new SSOT class constants in the same change; old inline
  `data-[state=inactive]:hidden` literals SHALL be replaced.

- **No new dependencies**: variable woff2 fonts are bundled as
  static assets; no font-loading library, no async font import.

- **Live verification**: release Tauri `.app` + Chrome DevTools
  performance trace at 1440x900 / 1280x800 covering Office,
  Personnel (all 6 tabs), RightSidebar Chat ↔ Tasks ↔ subtabs,
  workspace cold-load on Slow-3G throttle, FOUT measurement on
  hard reload. CLS budget ≤ 0.05 per surface; tab-swap visual
  stability verified by overlay screenshot diff (before/after
  same tab swap, content region pixel-equal in the off-tab area).
