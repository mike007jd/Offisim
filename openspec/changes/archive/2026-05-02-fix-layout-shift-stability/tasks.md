## 1. SSOT class constants in `dialog-shell.tsx`

- [x] 1.1 In `packages/ui-core/src/components/dialog-shell.tsx`, modify
      `DIALOG_TABS_CONTENT_CLASS` (line 35) from
      `'flex-1 min-h-0 overflow-y-auto'` to
      `'flex-1 min-h-[320px] overflow-y-auto'`. Keep the JSDoc; update
      the comment to call out the 320 px floor and that it pairs with
      `forceMount + TABS_RETAIN_STATE_CLASS` for state-preserving Tabs.
- [x] 1.2 In the same file, add a new exported const after line 35:
      `export const TABS_RETAIN_STATE_CLASS = 'data-[state=inactive]:hidden';`
      with a JSDoc explaining it pairs with `forceMount` for
      state-preserving Tabs (vs Radix default unmount).
- [x] 1.3 In `packages/ui-core/src/index.ts` (the package barrel),
      add `TABS_RETAIN_STATE_CLASS` to the `dialog-shell` re-exports
      block. Confirm `DIALOG_TABS_CONTENT_CLASS` is already exported.
- [x] 1.4 Run `pnpm --filter @offisim/ui-core build`. Confirm
      `dist/components/dialog-shell.js` contains both constants and the
      type declaration `dist/components/dialog-shell.d.ts` exports
      both as `const` strings.

## 2. PersonnelPage inspector min-height + Tabs unmount migration

- [x] 2.1 In `packages/ui-office/src/components/employees/PersonnelPage.tsx`,
      modify line 129's grid from
      `'grid h-full w-full grid-cols-1 lg:grid-cols-[280px_minmax(0,1fr)_minmax(0,420px)]'`
      to
      `'flex h-full w-full flex-col lg:grid lg:grid-cols-[280px_minmax(0,1fr)_minmax(0,420px)]'`
      so the responsive break does not change the inspector's
      height budget.
- [x] 2.2 At line 236, replace
      `<div className="flex min-h-0 flex-1 flex-col">`
      with
      `<div className="flex min-h-[560px] flex-1 flex-col">`. The
      `min-h-0` is no longer needed because the children are positioned
      via `forceMount + hidden`, not flex shrink-to-content.
- [x] 2.3 At lines 237, 240, 243, 246, 249, 252, change every
      `<TabsContent value="..." className="m-0 flex min-h-0 flex-1 flex-col">`
      to
      `<TabsContent value="..." forceMount className={cn('m-0 flex min-h-[520px] flex-1 flex-col', TABS_RETAIN_STATE_CLASS)}>`.
      520 px is the inspector floor minus tab triggers (≈ 40 px).
      Import `TABS_RETAIN_STATE_CLASS` from `@offisim/ui-core` at the
      top of the file; import `cn` from `@offisim/ui-core/utils`.
- [x] 2.4 Verify the right `<section>` at line 223 keeps
      `flex min-h-0 flex-col bg-slate-950/40`; the `min-h-0` here is
      still required because the section is a flex child of the outer
      grid and must shrink at narrow tier.
- [x] 2.5 At line 218 (center detail+preview `<section>`), confirm
      `flex min-h-0 flex-col border-r border-white/5` survives
      unchanged — it is not part of the Tabs region.
- [x] 2.6 Run `pnpm --filter @offisim/ui-office build`. Confirm zero
      typecheck errors. Confirm `cn(..., TABS_RETAIN_STATE_CLASS)`
      compiles.

## 3. AppearanceTab Canvas slot aspect-ratio

- [x] 3.1 In `packages/ui-office/src/components/employees/personnel-tabs/AppearanceTab.tsx`,
      modify `PreviewCard` (lines 86-95). Replace the slot div at
      line 92 from
      `<div className="flex h-[200px] w-full items-center justify-center">{children}</div>`
      to
      `<div className="flex aspect-[256/200] min-h-[200px] w-full max-w-[256px] items-center justify-center">{children}</div>`.
- [x] 3.2 In `Preview3DCanvas` (lines 97-129), at line 115 modify the
      `<Canvas>` props: remove `style={{ width: 256, height: 200, background: 'transparent' }}`
      and replace with `style={{ background: 'transparent' }}`. R3F
      then fills its parent (the slot from 3.1).
- [x] 3.3 Confirm 2D `BrandAvatar2D` and `DicebearAvatar` rendered
      inside `PreviewCard` (lines 56-65) still center correctly inside
      the new 256:200 slot — both are `size={140}` square, placed
      with `flex items-center justify-center`, so they render
      vertically centered inside the 200 px slot height.

## 4. RightSidebar outer Tabs min-height + retain-state migration

- [x] 4.1 In `packages/ui-office/src/components/layout/RightSidebar.tsx`,
      at line 71 modify the outer `<Tabs>`:
      `className="flex min-h-[640px] min-h-0 flex-1 flex-col overflow-hidden"`.
      The `min-h-[640px]` sets the floor; `min-h-0` keeps the flex
      shrink behavior for the inner scroll containers.
- [x] 4.2 At lines 100, 108 modify the outer `<TabsContent>` from
      `className="mt-0 flex min-h-0 flex-1 flex-col overflow-hidden data-[state=inactive]:hidden"`
      to
      `className={cn('mt-0 flex min-h-0 flex-1 flex-col overflow-hidden', TABS_RETAIN_STATE_CLASS)}`.
      Both retain `forceMount`.
- [x] 4.3 At lines 131, 138, 145 modify the inner
      `<TabsContent>` (Activity / Plan / Outputs) from
      `className="mt-0 min-h-0 flex-1 ... data-[state=inactive]:hidden"`
      to
      `className={cn('mt-0 min-h-0 flex-1 overflow-y-auto custom-scrollbar ...', TABS_RETAIN_STATE_CLASS)}`.
      Each inner content keeps its specific padding classes (the
      `Activity` one has `px-3 pb-3 pt-3`, the others don't); only the
      `data-[state=inactive]:hidden` literal is replaced by the
      constant.
- [x] 4.4 Import `TABS_RETAIN_STATE_CLASS` from `@offisim/ui-core` and
      `cn` from `@offisim/ui-core/utils` at the top of the file.

## 5. StreamingBubble height bound + overscroll-contain

- [x] 5.1 In `packages/ui-office/src/components/chat/StreamingBubble.tsx`,
      at line 45 modify the bubble div from
      `className="max-w-[94%] border-l-2 border-blue-400/30 bg-white/5 px-3 py-1.5 text-sm leading-snug text-slate-200 whitespace-pre-wrap rounded-xl"`
      to
      `className="max-w-[94%] max-h-[60vh] overflow-y-auto overscroll-contain border-l-2 border-blue-400/30 bg-white/5 px-3 py-1.5 text-sm leading-snug text-slate-200 whitespace-pre-wrap rounded-xl"`.
- [x] 5.2 At line 72 (the `ReasoningRegion` outer div), apply the same
      bound:
      `className="mb-1 max-w-[94%] max-h-[40vh] overflow-y-auto overscroll-contain rounded-xl border border-indigo-400/20 bg-indigo-500/8 px-3 py-1.5 text-xs leading-snug text-indigo-100/90"`.
      Reasoning bubbles are smaller (40vh) — they precede the answer
      and should not consume more screen than the answer.
- [x] 5.3 Confirm ChatPanel parent message-list scroll container
      already uses `min-h-0 overflow-y-auto` (line 540 / 560 of
      `ChatPanel.tsx`); no change needed there. The `overscroll-contain`
      on the bubble blocks rubber-band into the rail.

## 6. WorkspacePageShell skeleton heights match real workspace floors

- [x] 6.1 In `packages/ui-office/src/components/workspace/workspace-shell.css`,
      add a block after `.workspace-shell` (after line 8):
      ```css
      .workspace-shell { --workspace-min-content-height: 480px; }
      .workspace-shell[data-workspace="office"]    { --workspace-min-content-height: 540px; }
      .workspace-shell[data-workspace="personnel"] { --workspace-min-content-height: 600px; }
      .workspace-shell[data-workspace="sops"]      { --workspace-min-content-height: 540px; }
      .workspace-shell[data-workspace="market"]    { --workspace-min-content-height: 480px; }
      .workspace-shell[data-workspace="activity-log"] { --workspace-min-content-height: 600px; }
      .workspace-shell[data-workspace="settings"]  { --workspace-min-content-height: 480px; }
      .workspace-shell-loading-region { min-height: var(--workspace-min-content-height); }
      ```
- [x] 6.2 In `packages/ui-office/src/components/workspace/WorkspacePageShell.tsx`,
      modify `LoadingSkeleton` (lines 19-34) — the `<div className="px-6 py-6 space-y-4">`
      becomes `<div className="workspace-shell-loading-region px-6 py-6 space-y-4">`.
      The skeleton bars inside stay (4 animate-pulse rows) but the
      outer reservation now matches the workspace's real content
      floor.
- [x] 6.3 Verify each workspace's real content meets or exceeds its
      declared floor. Office (3D scene container is `flex-1 min-h-0`
      with parent `h-full`, fills viewport): trivially passes 540 px
      at 1440x900. Personnel: 560 px from §2.2 + 40 px tabs trigger =
      600 px, matches floor. SOPs: canvas is `flex-1`, fills viewport.
      Market: list grid auto-fills; floor is conservative. Activity:
      timeline is `min-h-0 flex-1`, fills viewport. Settings: tab body
      via `DIALOG_TABS_CONTENT_CLASS` is now 320 px floor + tabs
      trigger (~40 px) + sticky save bar (~80 px) = 440 px close to
      480 floor; sticky save bar absorbs the remainder.

## 7. Web font preload + self-host woff2

- [x] 7.1 Create directory `apps/web/public/fonts/` if not present.
- [x] 7.2 Download Inter v4.0 variable woff2
      (`https://github.com/rsms/inter/releases/download/v4.0/Inter-4.0.zip`,
      extract `Inter-Variable.woff2`, rename to `inter-var.woff2`)
      and place at `apps/web/public/fonts/inter-var.woff2`. Subset
      to Latin + Latin Extended only via `pyftsubset` or equivalent
      to keep size ≤ 110 KB.
- [x] 7.3 Download JetBrains Mono v2.304 variable woff2
      (`https://github.com/JetBrains/JetBrainsMono/releases/download/v2.304/JetBrainsMono-2.304.zip`,
      extract `webfonts/JetBrainsMono[wght].woff2`, rename to
      `jetbrains-mono-var.woff2`) and place at
      `apps/web/public/fonts/jetbrains-mono-var.woff2`. Subset to
      Latin only; target size ≤ 80 KB.
- [x] 7.4 In `apps/web/src/index.css`, immediately after the required
      CSS `@import` lines, add the two `@font-face` blocks per design.md
      Decision 7. `@import` must stay first so browser CSS parsing keeps
      Tailwind active. Use `font-display: swap`,
      `format('woff2-variations')`, `font-weight: 100 900` (Inter)
      and `100 800` (JetBrains Mono).
- [x] 7.5 In `apps/web/index.html`, after the `<title>` tag (line 7),
      add the two `<link rel="preload" href="/fonts/..." as="font"
      type="font/woff2" crossorigin />` lines per design.md Decision 7.
- [x] 7.6 Confirm Tauri release CSP allows local font loads from
      `tauri://localhost/fonts/*`. Inspect
      `apps/desktop/src-tauri/tauri.conf.json` `security.csp.font-src`;
      add `'self'` if missing (most likely already present via
      default `'self'`).
- [x] 7.7 Verify subset size: combined preload ≤ 200 KB. If over,
      narrow `unicode-range` further (drop Latin Extended from
      Inter — most product text is ASCII).

## 8. Motion timing custom properties (interim, Change F long-term)

- [x] 8.1 In `apps/web/src/index.css` `:root` block (lines 14-40),
      after line 39 add:
      ```css
      --motion-duration-fast: 120ms;
      --motion-duration-base: 200ms;
      --motion-duration-slow: 320ms;
      --motion-easing-standard: cubic-bezier(0.2, 0, 0, 1);
      ```
- [x] 8.2 In the same file, at line 277 modify the `list-item-in`
      animation rule from
      `animation: list-item-in 200ms ease-out both;`
      to
      `animation: list-item-in var(--motion-duration-base) var(--motion-easing-standard) both;`.
- [x] 8.3 Leave `streaming-shimmer` (lines 295-311) at `1.6s ease-in-out
      infinite` — looped non-enter/exit animation, owned by Change F.
- [x] 8.4 In `packages/ui-core/src/components/dialog-shell.tsx` line
      138, the `duration-200` Tailwind class remains literal but the
      file gets a JSDoc note above the block: `// Motion: 200ms is
      var(--motion-duration-base) — Change F unifies via Tailwind theme.`
      No code change to the class string.

## 9. CLAUDE.md + ui-office CLAUDE.md docs sync

- [x] 9.1 In `/Users/haoshengli/Seafile/WebWorkSpace/Offisim/CLAUDE.md`
      "Cross-Cutting Facts" section, add a one-line entry: `Layout-shift
      contract lives in capability layout-shift-stability — Tabs unmount
      policy SSOT is TABS_RETAIN_STATE_CLASS in @offisim/ui-core.
      Self-hosted Inter + JetBrains Mono variable woff2 with
      font-display: swap.`
- [x] 9.2 In `/Users/haoshengli/Seafile/WebWorkSpace/Offisim/packages/ui-office/CLAUDE.md`,
      add a new section `## Layout Shift` after the existing UI / Scene
      / 3D section, summarizing the four bullets: (a) every Tabs
      surface declares min-height + uses `forceMount +
      TABS_RETAIN_STATE_CLASS`; (b) WorkspacePageShell skeleton matches
      `--workspace-min-content-height` per workspace; (c) every
      Canvas / 3D / iframe slot declares `aspect-ratio` before mount;
      (d) StreamingBubble bounds at `max-h-[60vh]` with
      `overscroll-contain`.

## 10. Build + verify gates (serial per CLAUDE.md)

- [x] 10.1 `pnpm --filter @offisim/shared-types build` — green
      (no shared-types changes but mandatory in build order).
- [x] 10.2 `pnpm --filter @offisim/ui-core build` — green; output
      contains `TABS_RETAIN_STATE_CLASS` export.
- [x] 10.3 `pnpm --filter @offisim/core build` — green (no core
      changes; mandatory in build order).
- [x] 10.4 `pnpm --filter @offisim/ui-office build` — green; zero
      typecheck errors. Confirm `cn` and `TABS_RETAIN_STATE_CLASS`
      imports resolve in `PersonnelPage.tsx` and `RightSidebar.tsx`.
- [x] 10.5 `pnpm --filter @offisim/web typecheck` — green.
- [x] 10.6 `pnpm --filter @offisim/web build` — green; bundle output
      includes `assets/fonts/*.woff2` (or whatever Vite final path is)
      and `index.html` has the `<link rel="preload">` lines emitted.
      Inspect `apps/web/dist/index.html` to confirm.
- [x] 10.7 `npx biome check .` — zero new errors (existing warnings
      allowed).
- [x] 10.8 `pnpm harness:contract` — green. No new harness scenarios
      required (layout shift is not a graph invariant); existing
      scenarios MUST continue to pass.
- [x] 10.9 `pnpm --filter @offisim/desktop build` — release `.app`
      builds. The new fonts are bundled in `apps/web/dist` which
      `apps/desktop`'s `tauri.conf.json` `frontendDist: ../../web/dist`
      pulls in. Confirm `Offisim.app/Contents/Resources/_up_/_up_/web/dist/fonts/`
      contains both woff2.

## 11. Live verification (release Tauri app + browser, CLS measurement)

- [x] 11.1 **Personnel inspector tab swap CLS** (release `.app`,
      desktop 1440x900). Open Personnel, select an employee with full
      data (provider config + ≥ 5 skill bindings + ≥ 10 history
      entries). Open Chrome DevTools (Cmd+Option+I in Tauri
      release inspector mode) → Performance panel → Record. Click
      Profile → Appearance → Runtime → Skills → Memory → History →
      Profile in succession at ≈ 1 click/second. Stop record. In
      "Layout Shift" section, **CLS SHALL be ≤ 0.05** total across
      the entire 6-tab swap loop. Capture the trace.
- [x] 11.2 **RightSidebar Chat ↔ Tasks tab swap CLS** (release `.app`,
      desktop 1440x900). Open Office workspace, send a multi-line chat
      message and let it stream a long answer (≥ 200 tokens). While
      streaming, click Tasks → Chat → Tasks → Chat at ≈ 1 click/second.
      Performance trace: **CLS SHALL be ≤ 0.05**. Confirm by
      visual inspection that the rail does not visibly bounce on tab
      swap. Capture the trace.
- [x] 11.3 **Workspace cold load FOUT measurement** (web, Chrome
      DevTools, hard reload with cache disabled, throttle to Slow 3G).
      Open Office at 1440x900. Capture Performance trace from page
      navigation through first idle. Look for: "Recalculate Style"
      events triggered by font load, and any Layout Shift entries
      whose source is body / chat trigger / status bar text. **CLS
      from font swap SHALL be ≤ 0.10** (slightly looser bound for
      first-paint-only swap). Capture the trace + screenshot.
- [x] 11.4 **Personnel inspector visual stability overlay**
      (release `.app`, desktop 1440x900). Take screenshots of the
      inspector at each of the six tabs (Profile / Appearance / Runtime
      / Skills / Memory / History) with the same employee selected.
      Open all six in an image diff tool (`compare` from ImageMagick or
      Pixelmator). The list rail (`<aside>`) and detail header
      (`DetailHeader`) regions SHALL be **pixel-equal across all six
      screenshots** — those regions are not in the Tabs DOM and SHALL
      NOT shift.
- [x] 11.5 **AppearanceTab 3D Canvas mount stability** (release
      `.app`, desktop 1440x900). Open Personnel, select an internal
      employee, click Appearance tab. Within 1 frame the
      `aspect-[256/200]` slot SHALL show a 256x200 box; the R3F canvas
      SHALL mount inside it without bumping the 2D preview above
      (PreviewCard "2D"). Confirm by screenshot at T=0 (Appearance tab
      activated) and T=+200ms (canvas painted). Both screenshots: 2D
      preview's pixel position SHALL be unchanged.
- [x] 11.6 **StreamingBubble overflow-contain check** (release `.app`,
      desktop 1440x900). In Office, send a prompt that produces a long
      reply (`Output the full README.md verbatim`). When the bubble
      exceeds 60vh, attempt to scroll past the bubble boundaries with
      trackpad. The chat list outside the bubble SHALL NOT
      rubber-band-scroll past its own bounds. Confirm visually.
- [x] 11.7 **DialogShell tab body floor** (release `.app`, desktop
      1440x900). Open the most-tab-heavy dialog still in the codebase
      (Settings sub-tabs render inside the main shell, not a dialog;
      Project create dialog has no Tabs; Studio Asset inspector has
      Tabs — open Studio, select an asset, observe inspector tabs).
      Click between Properties / Notes / History tabs. **The dialog
      outer height SHALL NOT change**; the tab body SHALL maintain ≥
      320 px content floor. Confirm via DevTools Computed style:
      `min-height` on the active `TabsContent` SHALL read `320px`.
- [x] 11.8 **Font preload network trace** (web, Chrome DevTools
      Network, hard reload with cache disabled, no throttle). Reload
      Office at 1440x900. In Network tab filter `font`. **Both
      `inter-var.woff2` and `jetbrains-mono-var.woff2` SHALL appear
      with Initiator = `(preload)`** and SHALL load in parallel with
      the JS bundle (Initiator timeline starts ≤ 50 ms after navigation
      start). Combined transferred size SHALL be ≤ 200 KB.
- [x] 11.9 **Tablet 1280x800 break smoothing** (release `.app`,
      manually resize window to 1280x800). Open Personnel. Resize
      window between 1270 px width and 1290 px width several times.
      The inspector tabs region SHALL maintain `min-h-[560px]` on
      both sides of the break; the 3-column → stacked layout swap
      SHALL NOT cause the tabs region's height to change.
- [x] 11.10 **Memory pressure with all-tabs-mounted** (release `.app`,
      desktop 1440x900). Open Personnel, select an employee. Open
      DevTools → Memory → Heap snapshot. Click through all six tabs
      twice. Take another heap snapshot. **Heap delta SHALL be ≤ 5
      MB** (six tabs mounted vs unmounted overhead). If delta exceeds
      5 MB, investigate which tab is leaking subscriptions.
- [x] 11.11 **Reduced-motion regression check** (release `.app`,
      desktop 1440x900, with macOS System Settings → Accessibility →
      Display → Reduce Motion enabled). Confirm `list-item-in`
      animation does not run (CSS `@media (prefers-reduced-motion:
      reduce)` block at line 286-292 already handles this; this step
      verifies it survived the motion token edits).

## 12. Spec / docs / memory sync

- [x] 12.1 Update `CLAUDE.md` Cross-Cutting Facts (per task 9.1).
- [x] 12.2 Update `packages/ui-office/CLAUDE.md` (per task 9.2).
- [x] 12.3 Update `MEMORY.md` Active Backlog: add a new "completed
      Phase F0/F1 ad-hoc layout-shift remediation — see archived
      change `fix-layout-shift-stability`" line under the relevant
      section.
- [x] 12.4 If `openspec/protocols-ledger.md` has a row that touches
      web-fonts / WCAG / Tauri CSP / motion — verify and refresh.
      (Likely unchanged; verify nonetheless per Archive Gate.)

## 13. Live verification report

- [x] 13.1 Compile a verification report under
      `Docs/handoffs/fix-layout-shift-stability-verify.md` capturing:
      (a) screenshots from §11.1 / §11.4 / §11.5 / §11.7;
      (b) Performance trace exports from §11.1-§11.3 (CLS values);
      (c) Network trace from §11.8 (font load timing);
      (d) Memory delta from §11.10;
      (e) any deviation between observed and target CLS.
- [x] 13.2 If any §11 step exceeds the CLS budget, do NOT archive
      the change; iterate the fix on the offending surface and
      re-verify before archive gate.
