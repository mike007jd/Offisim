## 1. Scaffold token SSOT directory

- [ ] 1.1 Create `packages/ui-core/src/tokens/` directory
- [ ] 1.2 Create empty stub files: `index.ts`, `colors-semantic.ts`, `colors-3d.ts`, `spacing.ts`, `typography.ts`, `radius.ts`, `shadow.ts`, `z-index.ts`, `motion.ts`, `border.ts`, `tailwind-theme.ts`
- [ ] 1.3 Add `"./tokens"` subpath export to `packages/ui-core/package.json` exports map (`{ types: "./dist/tokens/index.d.ts", default: "./dist/tokens/index.js" }`)
- [ ] 1.4 Verify `packages/ui-core/src/index.ts` does not need to re-export tokens (subpath import is the canonical path)

## 2. Author `colors-semantic.ts`

- [ ] 2.1 Define `SemanticColors` interface per `design.md` Decision 4 (44 fields: 5 surface, 5 text, 4 border, 4 accent, 8 state-feedback, 2 glass, 12 status, 4 inverse-misc)
- [ ] 2.2 Export `DARK_SEMANTIC_COLORS: SemanticColors` populated with the dark hex values from Decision 4 table
- [ ] 2.3 Export `LIGHT_SEMANTIC_COLORS: SemanticColors` populated with the light hex values from Decision 4 table
- [ ] 2.4 Export helper `getSemanticColors(theme: 'light' | 'dark'): SemanticColors`
- [ ] 2.5 Verify every field has both light and dark variants — no `undefined` / `''` / fallback to dark
- [ ] 2.6 Add JSDoc comments referring to source CSS variables / `STUDIO_COLORS` fields where applicable for traceability

## 3. Author `colors-3d.ts`

- [ ] 3.1 Define `Scene3DColors` interface per Decision 5 (20 fields)
- [ ] 3.2 Export `DARK_SCENE_3D` byte-equivalent to today's `DARK_SCENE` constant in `packages/ui-office/src/theme/use-scene-colors.ts`
- [ ] 3.3 Export `LIGHT_SCENE_3D` per Decision 5 light table
- [ ] 3.4 Export `STATE_COLORS_DARK: Record<EmployeeState, number>` numeric hex form of dark `statusXXX` semantics — byte-equivalent to today's `STATE_COLORS` in `packages/renderer/src/tokens/colors.ts`
- [ ] 3.5 Export `STATE_COLORS_LIGHT: Record<EmployeeState, number>` per light theme status colors
- [ ] 3.6 Export `getStateColors(theme: 'light' | 'dark')` helper
- [ ] 3.7 Export Studio category colors `CATEGORY_COLORS_DARK` (workspace/compute/knowledge/collaboration/infrastructure/decorative) byte-equivalent to today's `STUDIO_COLORS.cat*`; author `CATEGORY_COLORS_LIGHT` per same hue family

## 4. Author `spacing.ts`

- [ ] 4.1 Define `SPACING_SCALE` per Decision 6 + Decision 15 step `5`: ten steps `{ 0:0, 1:4, 2:8, 3:12, 4:16, 5:20, 6:24, 8:32, 12:48, 16:64 }` (units: px)
- [ ] 4.2 Export Tailwind class-name map `SPACING_TAILWIND_CLASSES` for code-mod / migration scripts
- [ ] 4.3 Export `getSpacingPx(step: keyof SPACING_SCALE): number` helper

## 5. Author `typography.ts`

- [ ] 5.1 Define `TypographyRole` union (`'display' | 'h1' | 'h2' | 'h3' | 'bodyLg' | 'body' | 'bodySm' | 'caption' | 'mono'`)
- [ ] 5.2 Define `TypographyToken` interface (`{ family, size, weight, lineHeight, letterSpacing }`)
- [ ] 5.3 Export `TYPOGRAPHY_SCALE: Record<TypographyRole, TypographyToken>` populated per Decision 7 table
- [ ] 5.4 Export `FONT_FAMILY = { sans: 'Inter, …', mono: 'JetBrains Mono, …' }` matching today's `--font-sans` / `--font-mono`
- [ ] 5.5 Document the Studio `FONT.{xs,sm,base,md,lg,xl,xxl}` → typography role mapping in JSDoc on the role enum

## 6. Author `radius.ts`, `shadow.ts`, `z-index.ts`, `motion.ts`, `border.ts`

- [ ] 6.1 `radius.ts` — export `RADIUS_SCALE: Record<'none'|'sm'|'md'|'lg'|'xl'|'full', number>` per Decision 8
- [ ] 6.2 `shadow.ts` — export `SHADOW_SCALE_DARK: Record<ShadowName, string>` and `SHADOW_SCALE_LIGHT: Record<ShadowName, string>` per Decision 9; `ShadowName = 'resting'|'hover'|'popover'|'overlay'|'modal'|'glowAccent'|'glowSuccess'|'glowWarning'|'glowError'`
- [ ] 6.3 `z-index.ts` — export `Z_INDEX_SCALE: Record<'base'|'elevated'|'sticky'|'dropdown'|'modal'|'top', number>` per Decision 10
- [ ] 6.4 `motion.ts` — export `MOTION_DURATION: Record<'instant'|'fast'|'normal'|'slow', number>` (ms) and `MOTION_EASING: Record<'standard'|'decelerate'|'accelerate', string>` per Decision 11
- [ ] 6.5 `border.ts` — export `BORDER_WIDTH: Record<'thin'|'normal'|'thick', number>` (px) per Decision 12; `BORDER_ROLE` is a string-literal type referencing `colors-semantic.ts` keys (no value table — borders pull color from semantic colors at consumption)

## 7. Author `tailwind-theme.ts` emitter

- [ ] 7.1 Implement `emitTailwindThemeCss(): string` returning the three-block CSS structure from Decision 13
- [ ] 7.2 Block 1 — `@theme inline { … }` with all category names mapped to `var(--<token>-val)` indirection layer
- [ ] 7.3 Block 2 — `:root { --<token>-val: <light value>; … }` for every semantic color, shadow, plus density compact / spacious overrides
- [ ] 7.4 Block 3 — `:root.dark { --<token>-val: <dark value>; … }` with dark color + dark shadow overrides
- [ ] 7.5 Generated CSS includes a `/* AUTO-GENERATED — DO NOT EDIT — source: packages/ui-core/src/tokens — commit: <SHA> */` header
- [ ] 7.6 The header `<SHA>` is taken from the `GIT_SHA` env var the emitter script provides; falls back to `'dev'` when absent
- [ ] 7.7 Include all `@theme inline` keys Tailwind 4 understands: `--color-*`, `--spacing-*`, `--radius-*`, `--shadow-*`, `--z-*`, `--duration-*`, `--ease-*`, `--font-*`, `--text-*` (typography role utilities)
- [ ] 7.8 Export `TAILWIND_THEME_CSS_HEADER` constant the check script can rely on for diff exclusion of the SHA line
- [ ] 7.9 Add `tokens/index.ts` barrel re-exports for everything authored in steps 2–6 plus `emitTailwindThemeCss`

## 8. Build pipeline + theme generation script

- [ ] 8.1 Build `@offisim/ui-core` to verify the new tokens compile and the subpath export resolves: `pnpm --filter @offisim/ui-core build`
- [ ] 8.2 Create `scripts/emit-tailwind-theme.mjs` — imports `emitTailwindThemeCss` from the built `packages/ui-core/dist/tokens/index.js`, reads current git SHA, writes to `apps/web/src/generated/tailwind-theme.css`
- [ ] 8.3 Create `scripts/check-tailwind-theme.mjs` — re-emits to a tmp file, diffs against committed `apps/web/src/generated/tailwind-theme.css` ignoring only the `commit:` SHA header line, exits non-zero on mismatch
- [ ] 8.4 Add `tokens:emit` script to root `package.json`: `"tokens:emit": "node scripts/emit-tailwind-theme.mjs"`
- [ ] 8.5 Add `tokens:check` script: `"tokens:check": "node scripts/check-tailwind-theme.mjs"`
- [ ] 8.6 Run `pnpm tokens:emit` to generate the initial `apps/web/src/generated/tailwind-theme.css`
- [ ] 8.7 Verify `pnpm tokens:check` passes on the generated file
- [ ] 8.8 Add `apps/web/src/generated/` to `.gitignore` exception list (if `.gitignore` excludes any `generated/` patterns) — generated CSS is committed for build reproducibility
- [ ] 8.9 Add JSDoc on `emit-tailwind-theme.mjs` and `check-tailwind-theme.mjs` documenting the contract

## 9. Wire generated CSS into `apps/web/src/index.css`

- [ ] 9.1 Add `@import "./generated/tailwind-theme.css";` immediately after `@import "tailwindcss";` and before `@source` directives
- [ ] 9.2 Delete the hand-authored `:root { --surface: …; … }` block (current lines 14–40) — values now come from generated CSS
- [ ] 9.3 Delete `:root[data-density="compact"]` and `:root[data-density="spacious"]` blocks (current lines 42–60) — generator emits these
- [ ] 9.4 Delete the hand-authored `@theme inline { … }` block (current lines 62–115) — generator emits this
- [ ] 9.5 Delete `.glow-accent` / `.glow-success` / `.glow-error` / `.glow-warning` CSS classes (current lines 252–263) — replaced by `shadow-glow-*` Tailwind utilities derived from `shadow.ts`
- [ ] 9.6 Keep `body { ... }`, `.glass-panel`, `.cyber-button`, `.noise`, `.scanline`, scrollbar utilities, `.font-pixel-*` aliases (legacy class names mapping to current variables), `.pixel-*` borders, `.focus-ring`, `@keyframes list-item-in`, `.animate-list-item`, `.streaming-shimmer`, `@media (prefers-reduced-motion: reduce)` blocks
- [ ] 9.7 Update `.cyber-button` `transition: all 0.3s` to `transition: all var(--duration-slow) var(--ease-standard)` to consume motion tokens
- [ ] 9.8 Update `.animate-list-item` keyframe duration `200ms ease-out` → `var(--duration-normal) var(--ease-decelerate)`
- [ ] 9.9 Update `.streaming-shimmer` animation `1.6s ease-in-out infinite` to consume motion tokens or document why it stays at literal value (long custom timing — author may keep but use named `--shimmer-duration` token)
- [ ] 9.10 Update `.noise` `z-index: 9999` and `.scanline` `z-index: 9998` to use `var(--z-top)` per Decision 10 (both fall in the `top` layer)
- [ ] 9.11 Update `.focus-ring` box-shadow rgba to consume `--color-border-focus` instead of literal `rgba(59,130,246,0.5)`

## 10. Audit + replace raw hex literals

- [ ] 10.1 Run `node scripts/lint-no-raw-hex.mjs` (after step 12) to enumerate every offending site — current audit baseline 299 raw 6-digit + ~110 sub-cases (3 / 4 / 8 digit) in `apps/web/src/` + `packages/{ui-office,ui-core,renderer}/src/`
- [ ] 10.2 Migrate `packages/ui-office/src/components/scene/**.{ts,tsx}` raw hex (top concentration: `office-2d-canvas-renderer.ts`, `office3d-scene-primitives.tsx`, `office3d-employees.tsx`, `office3d-brand-variants.tsx`) — replace with `useSceneColors()` returns or `STATE_COLORS_*` imports
- [ ] 10.3 Migrate `packages/ui-office/src/components/studio/**.{ts,tsx}` raw hex (top concentration: `StudioCanvas.tsx`, `StudioPlacedPrefabs.tsx`, `StudioZoneGhost.tsx`, `StudioToolbar.tsx`, `PrefabThumbnail.tsx`) — replace with `useSceneColors()` or category-color imports
- [ ] 10.4 Migrate `packages/ui-office/src/components/office/editor/**.{ts,tsx}` raw hex (`OfficeEditorOverlay.tsx`, `ZoneCanvas.tsx`, `ZoneInspector.tsx`, `PresetPalette.tsx`, `useZoneEditorState.ts`, `types.ts`) — same patterns
- [ ] 10.5 Migrate `packages/ui-office/src/components/sop/SopDagNode.tsx` raw hex
- [ ] 10.6 Migrate `packages/ui-office/src/components/agents/AgentCard.tsx` raw hex (state-feedback colors → `statusXXX` semantic tokens)
- [ ] 10.7 Migrate `apps/web/src/**` raw hex (any remaining after `index.css` cleanup)
- [ ] 10.8 Migrate `packages/ui-core/src/components/**` raw hex if any
- [ ] 10.9 Replace any `rgba(<r>,<g>,<b>,<a>)` literals where `<r>,<g>,<b>` correspond to a known semantic value with `color-mix(in srgb, var(--color-<name>) <alpha%>, transparent)` or with the matching `*Muted` token
- [ ] 10.10 After the migration, `grep -rE "#[0-9a-fA-F]{3,8}\b" apps/web/src packages/{ui-office,ui-core,renderer}/src --include="*.ts" --include="*.tsx" --include="*.css"` must report only matches inside `packages/ui-core/src/tokens/**`, `apps/web/src/generated/**`, or lines tagged `// raw-hex-allowed`

## 11. Audit + replace arbitrary z-index / shadow / motion

- [ ] 11.1 Replace `z-[60]` / `z-[70]` / `z-[75]` in `OfficeEditorOverlay.tsx`, `ValidationBanner.tsx`, `OnboardingController.tsx`, `AppOverlayHost.tsx` with `z-modal` (or `z-top` if above modal layer)
- [ ] 11.2 Replace `studio-tokens.ts:161 zIndex: 20` consumer with `Z_INDEX_SCALE.sticky` import
- [ ] 11.3 Replace `apps/web/src/index.css:169 z-index: 9999` and `:179 z-index: 9998` (handled in 9.10)
- [ ] 11.4 Grep `z-\[\d+\]` and `zIndex: \d+` repo-wide — must be zero matches outside the SSOT
- [ ] 11.5 Replace `shadow-[0_20px_60px_rgba(0,0,0,0.28)]` in `settings-primitives.tsx` with `shadow-modal`
- [ ] 11.6 Replace `shadow-[0_0_8px_rgba(...)]` patterns in `PipelineProgress.tsx`, `DeliverableCard.tsx`, `AppLayout.tsx`, `ActivityRail.tsx`, `SystemMessageFeed.tsx`, `AgentCard.tsx` with appropriate `shadow-glow-*` or `shadow-overlay` / `shadow-popover`
- [ ] 11.7 Replace `studio-tokens.ts:226 transition: 'background 0.1s, color 0.1s'` with `transition: 'background-color, color' duration-instant ease-standard` semantics (using `MOTION_DURATION.instant` + `MOTION_EASING.standard`)
- [ ] 11.8 Audit any remaining `transition: '...[\d.]+s'` / `animation: '...[\d.]+(s|ms)'` literals on touched surfaces; replace with token references
- [ ] 11.9 Grep `shadow-\[` repo-wide — must be zero matches outside the SSOT and outside the catalog

## 12. CI gate `lint-no-raw-hex` and friends

- [ ] 12.1 Create `scripts/lint-no-raw-hex.mjs` — walks `apps/web/src/**/*.{ts,tsx,css}` and `packages/{ui-office,ui-core,renderer}/src/**/*.{ts,tsx,css}` (skipping `dist/`, `node_modules/`, `packages/ui-core/src/tokens/`, `apps/web/src/generated/`, `catalog/provider-source-registry/`)
- [ ] 12.2 Match regexes: `/#[0-9a-fA-F]{3,8}\b/`, `/\bz-\[\d+\]/`, `/\bshadow-\[/`, `/\bzIndex\s*:\s*\d+/`, `/\btransition\s*:\s*['"][^'"]*\b\d+(\.\d+)?s\b/`
- [ ] 12.3 Honor `// raw-hex-allowed` line-suffix escape hatch (entire matching line is skipped if the comment is anywhere on the line)
- [ ] 12.4 Output: list every offending file:line:column with the matched literal; exit code 1 on any match
- [ ] 12.5 Add `tokens:lint-hex` script to root `package.json`: `"tokens:lint-hex": "node scripts/lint-no-raw-hex.mjs"`
- [ ] 12.6 Run `pnpm tokens:lint-hex` — must exit 0 after step 10 + 11 migration is complete
- [ ] 12.7 Wire `tokens:lint-hex` and `tokens:check` into the root `pnpm validate` script (or whichever script is the canonical "before-commit gate"; currently no husky — these gates are run manually per `CLAUDE.md`)

## 13. Migrate `studio-tokens.ts` consumers + delete file

- [ ] 13.1 Grep `import.*studio-tokens` repo-wide to enumerate consumers
- [ ] 13.2 For each consumer: rewrite imports to `@offisim/ui-core/tokens` per Decision 15 rename map
- [ ] 13.3 Convert `STUDIO_COLORS.cat*` consumers (Studio palette + canvas) to import from `colors-3d.ts` `CATEGORY_COLORS_*` records via `useSceneColors()` or theme-aware helper
- [ ] 13.4 Convert `SP.{xs,sm,md,lg,xl,xxl,xxxl}` consumers — replace numeric reads (`SP.md`) with `SPACING_SCALE[3]` (or equivalent via Decision 15 step map)
- [ ] 13.5 Convert `FONT.*` consumers — replace `FONT.md` with `TYPOGRAPHY_SCALE.bodySm.size` (or whichever role per Decision 7 mapping)
- [ ] 13.6 Convert `LAYOUT.*` consumers — `panelRadius/cardRadius/buttonRadius` → `RADIUS_SCALE.{none,sm,md}`; `toolbarHeight/bottomBarHeight/paletteWidth/propertiesWidth` keep as Studio-local constants (`STUDIO_LAYOUT` const inside `StudioPage.tsx` or extracted to `studio-layout.ts` next to `StudioPage`)
- [ ] 13.7 Update `panelStyle()` / `toolButtonStyle()` / `kbdStyle()` / `sectionHeaderStyle()` / `labelStyle()` / `valueStyle()` / `inputStyle()` in `studio-tokens.ts` — they emit inline CSS objects; rewrite as utility-class strings consumed from `@offisim/ui-core/tokens` semantic Tailwind classes (preferred) OR migrate them to a new `studio-style-helpers.ts` that imports from the SSOT
- [ ] 13.8 Delete `packages/ui-office/src/components/studio/studio-tokens.ts`
- [ ] 13.9 Delete `invalidateSpCache` consumer in `theme-provider.tsx` if `SP` is no longer cached (pure-record reads do not need invalidation)
- [ ] 13.10 `pnpm --filter @offisim/ui-office typecheck` — must pass with zero new errors

## 14. Move `STATE_COLORS` to ui-core, keep renderer re-export

- [ ] 14.1 In `packages/renderer/src/tokens/colors.ts`: replace inline `STATE_COLORS` with `export { STATE_COLORS_DARK as STATE_COLORS } from '@offisim/ui-core/tokens'` (back-compat for renderer-only consumers — pre-launch, this is the only re-export, no aliasing on UI consumers)
- [ ] 14.2 Audit renderer consumers — if any want theme-aware state colors, they must use `STATE_COLORS_LIGHT` / `STATE_COLORS_DARK` directly via the ui-core import path
- [ ] 14.3 `pnpm --filter @offisim/renderer build` — must compile clean
- [ ] 14.4 Verify the existing renderer `tokens/index.ts` re-exports `STATE_COLORS` — semantic preserved for old consumers

## 15. Theme provider rewrite

- [ ] 15.1 Update `Theme` type in `packages/ui-office/src/theme/theme-provider.tsx` to `'light' | 'dark' | 'system'`
- [ ] 15.2 Add `ResolvedTheme = 'light' | 'dark'` type
- [ ] 15.3 Update `ThemeContextValue` to expose `theme: Theme`, `resolvedTheme: ResolvedTheme`, `setTheme: (theme: Theme) => void`, plus existing `density` + `setDensity`
- [ ] 15.4 Add `localStorage` key constant `THEME_STORAGE_KEY = 'offisim.theme'`
- [ ] 15.5 Add `readStoredTheme(): Theme` helper analogous to existing `readStoredDensity`
- [ ] 15.6 Add `resolveTheme(theme: Theme): ResolvedTheme` — returns `'light' | 'dark'` resolving `'system'` via `window.matchMedia('(prefers-color-scheme: dark)')`
- [ ] 15.7 Add a `useEffect` that listens for `matchMedia('(prefers-color-scheme: dark)').addEventListener('change', …)` when `theme === 'system'` and updates `resolvedTheme` accordingly; cleanup the listener on unmount or when theme transitions away from `'system'`
- [ ] 15.8 Add a `useEffect` that toggles `<html>` `dark` / `light` classes based on `resolvedTheme` (replaces the current force-dark logic)
- [ ] 15.9 Add `setTheme` callback that updates state, persists to localStorage (or removes the key when value is `'system'`), and toggles the class
- [ ] 15.10 Update `theme-provider.tsx` JSDoc + remove the "dark-only" comment from `apps/web/src/index.css:9-12`
- [ ] 15.11 Verify the pre-hydration inline script in `apps/web/index.html` matches the persistence contract (see step 17)
- [ ] 15.12 `pnpm --filter @offisim/ui-office typecheck` — must pass with zero new errors

## 16. Scene-colors light variant

- [ ] 16.1 Update `packages/ui-office/src/theme/use-scene-colors.ts` — import `LIGHT_SCENE_3D` and `DARK_SCENE_3D` from `@offisim/ui-core/tokens`
- [ ] 16.2 Replace the `DARK_SCENE` constant + `useSceneColors` body with: `const { resolvedTheme } = useTheme(); return resolvedTheme === 'light' ? LIGHT_SCENE_3D : DARK_SCENE_3D;`
- [ ] 16.3 Verify the returned `SceneColors` shape matches the existing interface byte-for-byte (Decision 5)
- [ ] 16.4 Audit consumers of `useSceneColors()` in `packages/ui-office/src/components/scene/**` — they should not need any change; the hook still returns the same shape

## 17. Pre-hydration theme script

- [ ] 17.1 Edit `apps/web/index.html` — add the inline `<script>` block from `design.md` Decision 16 inside `<head>`, before any other script tag
- [ ] 17.2 Verify the script reads `localStorage.getItem('offisim.theme')`, falls back to `'system'`, resolves system via `matchMedia`, toggles `dark` class on `<html>`, defaults to dark on error
- [ ] 17.3 Build the web app and inspect `apps/web/dist/index.html` — script must be present in the production bundle
- [ ] 17.4 Verify Tauri release picks up the same `index.html` (`apps/desktop/src-tauri/tauri.conf.json` `frontendDist` points at `../../web/dist`)

## 18. Settings UI: theme control

- [ ] 18.1 Locate the existing Appearance / Theme section in `packages/ui-office/src/components/settings/**`
- [ ] 18.2 Add a Theme tile or `SegmentedControl` with three options: `System` / `Light` / `Dark` — bound to `useTheme().theme` and `setTheme`
- [ ] 18.3 Live preview: changing the segment immediately toggles the app theme (no save button required for theme)
- [ ] 18.4 Settings persistence: theme is persisted independently of `runtimePolicy` (separate localStorage key, no need to round-trip through Settings save bar)
- [ ] 18.5 Visual: when `system` is active, show a small subtitle "Following OS preference: <Light|Dark>" reflecting `resolvedTheme`

## 19. Live verification (release Tauri app + browser)

- [ ] 19.1 Browser dev (`pnpm --filter @offisim/web dev`): default theme matches OS preference (system mode); manual toggle to Light flips every surface; manual toggle to Dark flips back
- [ ] 19.2 Open every workspace (Office / SOPs / Market / Personnel / Activity Log / Settings / Studio overlay) in Light theme — visually inspect that no surface stays dark, no text is unreadable, no border vanishes
- [ ] 19.3 Same workspaces in Dark theme — visual diff must be the inverse: no surface stays light, no text loses contrast
- [ ] 19.4 Studio accent color matches main-app accent (no indigo-vs-blue mismatch when comparing Studio toolbar active state vs. main-app primary button)
- [ ] 19.5 3D scene (Office workspace 3D mode) — toggle theme, materials repaint to LIGHT_SCENE_3D / DARK_SCENE_3D variant; confirm no shader compile errors / no NaN colors / no all-black or all-white meshes
- [ ] 19.6 DevTools accessibility audit on a representative page (Office chat panel + employee list): body text ≥ 4.5:1 contrast, large text ≥ 3:1, interactive borders ≥ 3:1 — both themes
- [ ] 19.7 Refresh page — theme persists; no flash of wrong theme during pre-hydration script execution (visually no flicker)
- [ ] 19.8 OS-level dark mode toggle (System Preferences → Appearance) when theme is `system` — app theme follows
- [ ] 19.9 `pnpm --filter @offisim/desktop build` — release `.app` bundles successfully with the generated CSS
- [ ] 19.10 Tauri release `.app` launch: same theme behavior as web; theme persists across app restarts; pre-hydration script works in WebView

## 20. Build + verify gates (serial per CLAUDE.md)

- [ ] 20.1 `pnpm --filter @offisim/shared-types build`
- [ ] 20.2 `pnpm --filter @offisim/ui-core build`
- [ ] 20.3 `pnpm --filter @offisim/core build`
- [ ] 20.4 `pnpm tokens:emit` — generated CSS up-to-date
- [ ] 20.5 `pnpm tokens:check` — exit 0
- [ ] 20.6 `pnpm tokens:lint-hex` — exit 0
- [ ] 20.7 `pnpm --filter @offisim/renderer build`
- [ ] 20.8 `pnpm --filter @offisim/ui-office build`
- [ ] 20.9 `pnpm --filter @offisim/web typecheck`
- [ ] 20.10 `pnpm --filter @offisim/web build`
- [ ] 20.11 `npx biome check .` — zero new errors
- [ ] 20.12 `pnpm harness:contract` — green (no harness changes expected; safety check)
- [ ] 20.13 `pnpm --filter @offisim/desktop build` — release `.app` bundles

## 21. Spec / docs / memory sync

- [ ] 21.1 Update root `CLAUDE.md` "Cross-Cutting Facts" — add an entry on the token SSOT location and the `pnpm tokens:check` / `tokens:lint-hex` gates
- [ ] 21.2 Update `packages/ui-office/CLAUDE.md` — replace any reference to `studio-tokens.ts` with `@offisim/ui-core/tokens`; add note on theme-provider's new tri-state contract; add note on `useSceneColors()` returning theme-aware values
- [ ] 21.3 Update `packages/ui-core/CLAUDE.md` if it exists, or add one — document the tokens directory contract, the SSOT rule, and the rename map for migrators
- [ ] 21.4 Update `packages/renderer/CLAUDE.md` if it exists — note that `STATE_COLORS` is now re-exported from `@offisim/ui-core/tokens` and that 3D consumers should import the theme-aware variants directly when theme switching matters
- [ ] 21.5 If `openspec/protocols-ledger.md` lists Tailwind / design system protocols, update the row to reflect the SSOT location and emission contract; otherwise no protocol-ledger entry is required
- [ ] 21.6 MEMORY.md: add an entry under "Repository Hygiene" or equivalent stating "Design tokens SSOT lives in `packages/ui-core/src/tokens/`; never re-author hex / z-index / shadow inline" to discourage future regression

## 22. Archive gate (per CLAUDE.md OpenSpec Archive Gate)

- [ ] 22.1 Spec consistency: verify `specs/design-token-foundation/spec.md` and `specs/theme-light-dark-switching/spec.md` reflect the values + behavior actually shipped — update any drift before archive
- [ ] 22.2 Tasks consistency: every checked box has a matching artifact (file, command, live verification observation); any "partially done" item is not silently checked
- [ ] 22.3 Documentation consistency: CLAUDE.md, package CLAUDE.mds, and any JSDoc comments referring to the token SSOT all match the shipped state
- [ ] 22.4 Protocol ledger: the Tauri row gets a brief note on the new generated CSS surface if relevant (likely no change since this is web/UI-only)
