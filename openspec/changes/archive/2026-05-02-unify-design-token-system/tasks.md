## 1. Scaffold token SSOT directory

- [x] 1.1 Create `packages/ui-core/src/tokens/` directory
- [x] 1.2 Create empty stub files: `index.ts`, `colors-semantic.ts`, `colors-3d.ts`, `spacing.ts`, `typography.ts`, `radius.ts`, `shadow.ts`, `z-index.ts`, `motion.ts`, `border.ts`, `tailwind-theme.ts`
- [x] 1.3 Add `"./tokens"` subpath export to `packages/ui-core/package.json` exports map (`{ types: "./dist/tokens/index.d.ts", default: "./dist/tokens/index.js" }`)
- [x] 1.4 Verify `packages/ui-core/src/index.ts` does not need to re-export tokens (subpath import is the canonical path)

## 2. Author `colors-semantic.ts`

- [x] 2.1 Define `SemanticColors` interface per `design.md` Decision 4 (44 fields: 5 surface, 5 text, 4 border, 4 accent, 8 state-feedback, 2 glass, 12 status, 4 inverse-misc)
- [x] 2.2 Export `DARK_SEMANTIC_COLORS: SemanticColors` populated with the dark hex values from Decision 4 table
- [x] 2.3 Export `LIGHT_SEMANTIC_COLORS: SemanticColors` populated with the light hex values from Decision 4 table
- [x] 2.4 Export helper `getSemanticColors(theme: 'light' | 'dark'): SemanticColors`
- [x] 2.5 Verify every field has both light and dark variants — no `undefined` / `''` / fallback to dark
- [x] 2.6 Add JSDoc comments referring to source CSS variables / `STUDIO_COLORS` fields where applicable for traceability

## 3. Author `colors-3d.ts`

- [x] 3.1 Define `Scene3DColors` interface per Decision 5 (20 fields)
- [x] 3.2 Export `DARK_SCENE_3D` byte-equivalent to today's `DARK_SCENE` constant in `packages/ui-office/src/theme/use-scene-colors.ts`
- [x] 3.3 Export `LIGHT_SCENE_3D` per Decision 5 light table
- [x] 3.4 Export `STATE_COLORS_DARK: Record<EmployeeState, number>` numeric hex form of dark `statusXXX` semantics — byte-equivalent to today's `STATE_COLORS` in `packages/renderer/src/tokens/colors.ts`
- [x] 3.5 Export `STATE_COLORS_LIGHT: Record<EmployeeState, number>` per light theme status colors
- [x] 3.6 Export `getStateColors(theme: 'light' | 'dark')` helper
- [x] 3.7 Export Studio category colors `CATEGORY_COLORS_DARK` (workspace/compute/knowledge/collaboration/infrastructure/decorative) byte-equivalent to today's `STUDIO_COLORS.cat*`; author `CATEGORY_COLORS_LIGHT` per same hue family

## 4. Author `spacing.ts`

- [x] 4.1 Define `SPACING_SCALE` per Decision 6 + Decision 15 step `5`: ten steps `{ 0:0, 1:4, 2:8, 3:12, 4:16, 5:20, 6:24, 8:32, 12:48, 16:64 }` (units: px)
- [x] 4.2 Export Tailwind class-name map `SPACING_TAILWIND_CLASSES` for code-mod / migration scripts
- [x] 4.3 Export `getSpacingPx(step: keyof SPACING_SCALE): number` helper

## 5. Author `typography.ts`

- [x] 5.1 Define `TypographyRole` union (`'display' | 'h1' | 'h2' | 'h3' | 'bodyLg' | 'body' | 'bodySm' | 'caption' | 'mono'`)
- [x] 5.2 Define `TypographyToken` interface (`{ family, size, weight, lineHeight, letterSpacing }`)
- [x] 5.3 Export `TYPOGRAPHY_SCALE: Record<TypographyRole, TypographyToken>` populated per Decision 7 table
- [x] 5.4 Export `FONT_FAMILY = { sans: 'Inter, …', mono: 'JetBrains Mono, …' }` matching today's `--font-sans` / `--font-mono`
- [x] 5.5 Document the Studio `FONT.{xs,sm,base,md,lg,xl,xxl}` → typography role mapping in JSDoc on the role enum

## 6. Author `radius.ts`, `shadow.ts`, `z-index.ts`, `motion.ts`, `border.ts`

- [x] 6.1 `radius.ts` — export `RADIUS_SCALE: Record<'none'|'sm'|'md'|'lg'|'xl'|'full', number>` per Decision 8
- [x] 6.2 `shadow.ts` — export `SHADOW_SCALE_DARK: Record<ShadowName, string>` and `SHADOW_SCALE_LIGHT: Record<ShadowName, string>` per Decision 9; `ShadowName = 'resting'|'hover'|'popover'|'overlay'|'modal'|'glowAccent'|'glowSuccess'|'glowWarning'|'glowError'`
- [x] 6.3 `z-index.ts` — export `Z_INDEX_SCALE: Record<'base'|'elevated'|'sticky'|'dropdown'|'modal'|'top', number>` per Decision 10
- [x] 6.4 `motion.ts` — export `MOTION_DURATION: Record<'instant'|'fast'|'normal'|'slow', number>` (ms) and `MOTION_EASING: Record<'standard'|'decelerate'|'accelerate', string>` per Decision 11
- [x] 6.5 `border.ts` — export `BORDER_WIDTH: Record<'thin'|'normal'|'thick', number>` (px) per Decision 12; `BORDER_ROLE` is a string-literal type referencing `colors-semantic.ts` keys (no value table — borders pull color from semantic colors at consumption)

## 7. Author `tailwind-theme.ts` emitter

- [x] 7.1 Implement `emitTailwindThemeCss(): string` returning the three-block CSS structure from Decision 13
- [x] 7.2 Block 1 — `@theme inline { … }` with all category names mapped to `var(--<token>-val)` indirection layer
- [x] 7.3 Block 2 — `:root { --<token>-val: <light value>; … }` for every semantic color, shadow, plus density compact / spacious overrides
- [x] 7.4 Block 3 — `:root.dark { --<token>-val: <dark value>; … }` with dark color + dark shadow overrides
- [x] 7.5 Generated CSS includes a `/* AUTO-GENERATED — DO NOT EDIT — source: packages/ui-core/src/tokens — commit: <SHA> */` header
- [x] 7.6 The header `<SHA>` is taken from the `GIT_SHA` env var the emitter script provides; falls back to `'dev'` when absent
- [x] 7.7 Include all `@theme inline` keys Tailwind 4 understands: `--color-*`, `--spacing-*`, `--radius-*`, `--shadow-*`, `--z-*`, `--duration-*`, `--ease-*`, `--font-*`, `--text-*` (typography role utilities)
- [x] 7.8 Export `TAILWIND_THEME_CSS_HEADER` constant the check script can rely on for diff exclusion of the SHA line
- [x] 7.9 Add `tokens/index.ts` barrel re-exports for everything authored in steps 2–6 plus `emitTailwindThemeCss`

## 8. Build pipeline + theme generation script

- [x] 8.1 Build `@offisim/ui-core` to verify the new tokens compile and the subpath export resolves: `pnpm --filter @offisim/ui-core build`
- [x] 8.2 Create `scripts/emit-tailwind-theme.mjs` — imports `emitTailwindThemeCss` from the built `packages/ui-core/dist/tokens/index.js`, reads current git SHA, writes to `apps/web/src/generated/tailwind-theme.css`
- [x] 8.3 Create `scripts/check-tailwind-theme.mjs` — re-emits to a tmp file, diffs against committed `apps/web/src/generated/tailwind-theme.css` ignoring only the `commit:` SHA header line, exits non-zero on mismatch
- [x] 8.4 Add `tokens:emit` script to root `package.json`: `"tokens:emit": "node scripts/emit-tailwind-theme.mjs"`
- [x] 8.5 Add `tokens:check` script: `"tokens:check": "node scripts/check-tailwind-theme.mjs"`
- [x] 8.6 Run `pnpm tokens:emit` to generate the initial `apps/web/src/generated/tailwind-theme.css`
- [x] 8.7 Verify `pnpm tokens:check` passes on the generated file
- [x] 8.8 Add `apps/web/src/generated/` to `.gitignore` exception list (if `.gitignore` excludes any `generated/` patterns) — generated CSS is committed for build reproducibility
- [x] 8.9 Add JSDoc on `emit-tailwind-theme.mjs` and `check-tailwind-theme.mjs` documenting the contract

## 9. Wire generated CSS into `apps/web/src/index.css`

- [x] 9.1 Add `@import "./generated/tailwind-theme.css";` immediately after `@import "tailwindcss";` and before `@source` directives
- [x] 9.2 Delete the hand-authored `:root { --surface: …; … }` block (current lines 14–40) — values now come from generated CSS
- [x] 9.3 Delete `:root[data-density="compact"]` and `:root[data-density="spacious"]` blocks (current lines 42–60) — generator emits these
- [x] 9.4 Delete the hand-authored `@theme inline { … }` block (current lines 62–115) — generator emits this
- [x] 9.5 Delete `.glow-accent` / `.glow-success` / `.glow-error` / `.glow-warning` CSS classes (current lines 252–263) — replaced by `shadow-glow-*` Tailwind utilities derived from `shadow.ts`
- [x] 9.6 Keep `body { ... }`, `.glass-panel`, `.cyber-button`, `.noise`, `.scanline`, scrollbar utilities, `.font-pixel-*` aliases (legacy class names mapping to current variables), `.pixel-*` borders, `.focus-ring`, `@keyframes list-item-in`, `.animate-list-item`, `.streaming-shimmer`, `@media (prefers-reduced-motion: reduce)` blocks
- [x] 9.7 Update `.cyber-button` `transition: all 0.3s` to `transition: all var(--duration-slow) var(--ease-standard)` to consume motion tokens
- [x] 9.8 Update `.animate-list-item` keyframe duration `200ms ease-out` → `var(--duration-normal) var(--ease-decelerate)`
- [x] 9.9 Update `.streaming-shimmer` animation `1.6s ease-in-out infinite` to consume motion tokens or document why it stays at literal value (long custom timing — author may keep but use named `--shimmer-duration` token)
- [x] 9.10 Update `.noise` `z-index: 9999` and `.scanline` `z-index: 9998` to use `var(--z-top)` per Decision 10 (both fall in the `top` layer)
- [x] 9.11 Update `.focus-ring` box-shadow rgba to consume `--color-border-focus` instead of literal `rgba(59,130,246,0.5)`

## 10. Audit + replace raw hex literals

- [x] 10.1 Run `node scripts/lint-no-raw-hex.mjs` (after step 12) to enumerate every offending site — current audit baseline 299 raw 6-digit + ~110 sub-cases (3 / 4 / 8 digit) in `apps/web/src/` + `packages/{ui-office,ui-core,renderer}/src/`
- [x] 10.2 Migrate `packages/ui-office/src/components/scene/**.{ts,tsx}` raw hex (top concentration: `office-2d-canvas-renderer.ts`, `office3d-scene-primitives.tsx`, `office3d-employees.tsx`, `office3d-brand-variants.tsx`) — replace with `useSceneColors()` returns or `STATE_COLORS_*` imports
- [x] 10.3 Migrate `packages/ui-office/src/components/studio/**.{ts,tsx}` raw hex (top concentration: `StudioCanvas.tsx`, `StudioPlacedPrefabs.tsx`, `StudioZoneGhost.tsx`, `StudioToolbar.tsx`, `PrefabThumbnail.tsx`) — replace with `useSceneColors()` or category-color imports
- [x] 10.4 Migrate `packages/ui-office/src/components/office/editor/**.{ts,tsx}` raw hex (`OfficeEditorOverlay.tsx`, `ZoneCanvas.tsx`, `ZoneInspector.tsx`, `PresetPalette.tsx`, `useZoneEditorState.ts`, `types.ts`) — same patterns
- [x] 10.5 Migrate `packages/ui-office/src/components/sop/SopDagNode.tsx` raw hex
- [x] 10.6 Migrate `packages/ui-office/src/components/agents/AgentCard.tsx` raw hex (state-feedback colors → `statusXXX` semantic tokens)
- [x] 10.7 Migrate `apps/web/src/**` raw hex (any remaining after `index.css` cleanup)
- [x] 10.8 Migrate `packages/ui-core/src/components/**` raw hex if any
- [x] 10.9 Replace any `rgba(<r>,<g>,<b>,<a>)` literals where `<r>,<g>,<b>` correspond to a known semantic value with `color-mix(in srgb, var(--color-<name>) <alpha%>, transparent)` or with the matching `*Muted` token
- [x] 10.10 After the migration, `grep -rE "#[0-9a-fA-F]{3,8}\b" apps/web/src packages/{ui-office,ui-core,renderer}/src --include="*.ts" --include="*.tsx" --include="*.css"` must report only matches inside `packages/ui-core/src/tokens/**`, `apps/web/src/generated/**`, or lines tagged `// raw-hex-allowed`

## 11. Audit + replace arbitrary z-index / shadow / motion

- [x] 11.1 Replace `z-[60]` / `z-[70]` / `z-[75]` in `OfficeEditorOverlay.tsx`, `ValidationBanner.tsx`, `OnboardingController.tsx`, `AppOverlayHost.tsx` with `z-modal` (or `z-top` if above modal layer)
- [x] 11.2 Replace `studio-tokens.ts:161 zIndex: 20` consumer with `Z_INDEX_SCALE.sticky` import
- [x] 11.3 Replace `apps/web/src/index.css:169 z-index: 9999` and `:179 z-index: 9998` (handled in 9.10)
- [x] 11.4 Grep `z-\[\d+\]` and `zIndex: \d+` repo-wide — must be zero matches outside the SSOT
- [x] 11.5 Replace `shadow-[0_20px_60px_rgba(0,0,0,0.28)]` in `settings-primitives.tsx` with `shadow-modal`
- [x] 11.6 Replace `shadow-[0_0_8px_rgba(...)]` patterns in `PipelineProgress.tsx`, `DeliverableCard.tsx`, `AppLayout.tsx`, `ActivityRail.tsx`, `SystemMessageFeed.tsx`, `AgentCard.tsx` with appropriate `shadow-glow-*` or `shadow-overlay` / `shadow-popover`
- [x] 11.7 Replace `studio-tokens.ts:226 transition: 'background 0.1s, color 0.1s'` with `transition: 'background-color, color' duration-instant ease-standard` semantics (using `MOTION_DURATION.instant` + `MOTION_EASING.standard`)
- [x] 11.8 Audit any remaining `transition: '...[\d.]+s'` / `animation: '...[\d.]+(s|ms)'` literals on touched surfaces; replace with token references
- [x] 11.9 Grep `shadow-\[` repo-wide — must be zero matches outside the SSOT and outside the catalog

## 12. CI gate `lint-no-raw-hex` and friends

- [x] 12.1 Create `scripts/lint-no-raw-hex.mjs` — walks `apps/web/src/**/*.{ts,tsx,css}` and `packages/{ui-office,ui-core,renderer}/src/**/*.{ts,tsx,css}` (skipping `dist/`, `node_modules/`, `packages/ui-core/src/tokens/`, `apps/web/src/generated/`, `catalog/provider-source-registry/`)
- [x] 12.2 Match regexes: `/#[0-9a-fA-F]{3,8}\b/`, `/\bz-\[\d+\]/`, `/\bshadow-\[/`, `/\bzIndex\s*:\s*\d+/`, `/\btransition\s*:\s*['"][^'"]*\b\d+(\.\d+)?s\b/`
- [x] 12.3 Honor `// raw-hex-allowed` line-suffix escape hatch (entire matching line is skipped if the comment is anywhere on the line)
- [x] 12.4 Output: list every offending file:line:column with the matched literal; exit code 1 on any match
- [x] 12.5 Add `tokens:lint-hex` script to root `package.json`: `"tokens:lint-hex": "node scripts/lint-no-raw-hex.mjs"`
- [x] 12.6 Run `pnpm tokens:lint-hex` — must exit 0 after step 10 + 11 migration is complete
- [x] 12.7 Wire `tokens:lint-hex` and `tokens:check` into the root `pnpm validate` script (or whichever script is the canonical "before-commit gate"; currently no husky — these gates are run manually per `CLAUDE.md`)

## 13. Migrate `studio-tokens.ts` consumers + delete file

- [x] 13.1 Grep `import.*studio-tokens` repo-wide to enumerate consumers
- [x] 13.2 For each consumer: rewrite imports to `@offisim/ui-core/tokens` per Decision 15 rename map
- [x] 13.3 Convert `STUDIO_COLORS.cat*` consumers (Studio palette + canvas) to import from `colors-3d.ts` `CATEGORY_COLORS_*` records via `useSceneColors()` or theme-aware helper
- [x] 13.4 Convert `SP.{xs,sm,md,lg,xl,xxl,xxxl}` consumers — replace numeric reads (`SP.md`) with `SPACING_SCALE[3]` (or equivalent via Decision 15 step map)
- [x] 13.5 Convert `FONT.*` consumers — replace `FONT.md` with `TYPOGRAPHY_SCALE.bodySm.size` (or whichever role per Decision 7 mapping)
- [x] 13.6 Convert `LAYOUT.*` consumers — `panelRadius/cardRadius/buttonRadius` → `RADIUS_SCALE.{none,sm,md}`; `toolbarHeight/bottomBarHeight/paletteWidth/propertiesWidth` keep as Studio-local constants (`STUDIO_LAYOUT` const inside `StudioPage.tsx` or extracted to `studio-layout.ts` next to `StudioPage`)
- [x] 13.7 Update `panelStyle()` / `toolButtonStyle()` / `kbdStyle()` / `sectionHeaderStyle()` / `labelStyle()` / `valueStyle()` / `inputStyle()` in `studio-tokens.ts` — they emit inline CSS objects; rewrite as utility-class strings consumed from `@offisim/ui-core/tokens` semantic Tailwind classes (preferred) OR migrate them to a new `studio-style-helpers.ts` that imports from the SSOT
- [x] 13.8 Delete `packages/ui-office/src/components/studio/studio-tokens.ts`
- [x] 13.9 Delete `invalidateSpCache` consumer in `theme-provider.tsx` if `SP` is no longer cached (pure-record reads do not need invalidation)
- [x] 13.10 `pnpm --filter @offisim/ui-office typecheck` — must pass with zero new errors

## 14. Move `STATE_COLORS` to ui-core, keep renderer re-export

- [x] 14.1 In `packages/renderer/src/tokens/colors.ts`: replace inline `STATE_COLORS` with `export { STATE_COLORS_DARK as STATE_COLORS } from '@offisim/ui-core/tokens'` (back-compat for renderer-only consumers — pre-launch, this is the only re-export, no aliasing on UI consumers)
- [x] 14.2 Audit renderer consumers — if any want theme-aware state colors, they must use `STATE_COLORS_LIGHT` / `STATE_COLORS_DARK` directly via the ui-core import path
- [x] 14.3 `pnpm --filter @offisim/renderer build` — must compile clean
- [x] 14.4 Verify the existing renderer `tokens/index.ts` re-exports `STATE_COLORS` — semantic preserved for old consumers

## 15. Theme provider rewrite

- [x] 15.1 Update `Theme` type in `packages/ui-office/src/theme/theme-provider.tsx` to `'light' | 'dark' | 'system'`
- [x] 15.2 Add `ResolvedTheme = 'light' | 'dark'` type
- [x] 15.3 Update `ThemeContextValue` to expose `theme: Theme`, `resolvedTheme: ResolvedTheme`, `setTheme: (theme: Theme) => void`, plus existing `density` + `setDensity`
- [x] 15.4 Add `localStorage` key constant `THEME_STORAGE_KEY = 'offisim.theme'`
- [x] 15.5 Add `readStoredTheme(): Theme` helper analogous to existing `readStoredDensity`
- [x] 15.6 Add `resolveTheme(theme: Theme): ResolvedTheme` — returns `'light' | 'dark'` resolving `'system'` via `window.matchMedia('(prefers-color-scheme: dark)')`
- [x] 15.7 Add a `useEffect` that listens for `matchMedia('(prefers-color-scheme: dark)').addEventListener('change', …)` when `theme === 'system'` and updates `resolvedTheme` accordingly; cleanup the listener on unmount or when theme transitions away from `'system'`
- [x] 15.8 Add a `useEffect` that toggles `<html>` `dark` / `light` classes based on `resolvedTheme` (replaces the current force-dark logic)
- [x] 15.9 Add `setTheme` callback that updates state, persists to localStorage (or removes the key when value is `'system'`), and toggles the class
- [x] 15.10 Update `theme-provider.tsx` JSDoc + remove the "dark-only" comment from `apps/web/src/index.css:9-12`
- [x] 15.11 Verify the pre-hydration inline script in `apps/web/index.html` matches the persistence contract (see step 17)
- [x] 15.12 `pnpm --filter @offisim/ui-office typecheck` — must pass with zero new errors

## 16. Scene-colors light variant

- [x] 16.1 Update `packages/ui-office/src/theme/use-scene-colors.ts` — import `LIGHT_SCENE_3D` and `DARK_SCENE_3D` from `@offisim/ui-core/tokens`
- [x] 16.2 Replace the `DARK_SCENE` constant + `useSceneColors` body with: `const { resolvedTheme } = useTheme(); return resolvedTheme === 'light' ? LIGHT_SCENE_3D : DARK_SCENE_3D;`
- [x] 16.3 Verify the returned `SceneColors` shape matches the existing interface byte-for-byte (Decision 5)
- [x] 16.4 Audit consumers of `useSceneColors()` in `packages/ui-office/src/components/scene/**` — they should not need any change; the hook still returns the same shape

## 17. Pre-hydration theme script

- [x] 17.1 Edit `apps/web/index.html` — add the inline `<script>` block from `design.md` Decision 16 inside `<head>`, before any other script tag
- [x] 17.2 Verify the script reads `localStorage.getItem('offisim.theme')`, falls back to `'system'`, resolves system via `matchMedia`, toggles `dark` class on `<html>`, defaults to dark on error
- [x] 17.3 Build the web app and inspect `apps/web/dist/index.html` — script must be present in the production bundle
- [x] 17.4 Verify Tauri release picks up the same `index.html` (`apps/desktop/src-tauri/tauri.conf.json` `frontendDist` points at `../../web/dist`)

## 18. Settings UI: theme control

- [x] 18.1 Locate the existing Appearance / Theme section in `packages/ui-office/src/components/settings/**`
- [x] 18.2 Add a Theme tile or `SegmentedControl` with three options: `System` / `Light` / `Dark` — bound to `useTheme().theme` and `setTheme`
- [x] 18.3 Live preview: changing the segment immediately toggles the app theme (no save button required for theme)
- [x] 18.4 Settings persistence: theme is persisted independently of `runtimePolicy` (separate localStorage key, no need to round-trip through Settings save bar)
- [x] 18.5 Visual: when `system` is active, show a small subtitle "Following OS preference: <Light|Dark>" reflecting `resolvedTheme`

## 19. Live verification (release Tauri app + browser)

- [x] 19.1 Browser dev (`pnpm --filter @offisim/web dev`): default theme matches OS preference (system mode); manual toggle to Light flips every surface; manual toggle to Dark flips back
- [x] 19.2 Open every workspace (Office / SOPs / Market / Personnel / Activity Log / Settings / Studio overlay) in Light theme — visually inspect that no surface stays dark, no text is unreadable, no border vanishes
- [x] 19.3 Same workspaces in Dark theme — visual diff must be the inverse: no surface stays light, no text loses contrast
- [x] 19.4 Studio accent color matches main-app accent (no indigo-vs-blue mismatch when comparing Studio toolbar active state vs. main-app primary button)
- [x] 19.5 3D scene (Office workspace 3D mode) — toggle theme, materials repaint to LIGHT_SCENE_3D / DARK_SCENE_3D variant; confirm no shader compile errors / no NaN colors / no all-black or all-white meshes
- [x] 19.6 DevTools accessibility audit on a representative page (Office chat panel + employee list): body text ≥ 4.5:1 contrast, large text ≥ 3:1, interactive borders ≥ 3:1 — both themes
- [x] 19.7 Refresh page — theme persists; no flash of wrong theme during pre-hydration script execution (visually no flicker)
- [x] 19.8 OS-level dark mode toggle (System Preferences → Appearance) when theme is `system` — app theme follows
- [x] 19.9 `pnpm --filter @offisim/desktop build` — release `.app` bundles successfully with the generated CSS
- [x] 19.10 Tauri release `.app` launch: same theme behavior as web; theme persists across app restarts; pre-hydration script works in WebView

## 20. Build + verify gates (serial per CLAUDE.md)

- [x] 20.1 `pnpm --filter @offisim/shared-types build`
- [x] 20.2 `pnpm --filter @offisim/ui-core build`
- [x] 20.3 `pnpm --filter @offisim/core build`
- [x] 20.4 `pnpm tokens:emit` — generated CSS up-to-date
- [x] 20.5 `pnpm tokens:check` — exit 0
- [x] 20.6 `pnpm tokens:lint-hex` — exit 0
- [x] 20.7 `pnpm --filter @offisim/renderer build`
- [x] 20.8 `pnpm --filter @offisim/ui-office build`
- [x] 20.9 `pnpm --filter @offisim/web typecheck`
- [x] 20.10 `pnpm --filter @offisim/web build`
- [x] 20.11 `npx biome check .` — zero new errors
- [x] 20.12 `pnpm harness:contract` — green (no harness changes expected; safety check)
- [x] 20.13 `pnpm --filter @offisim/desktop build` — release `.app` bundles

## 21. Spec / docs / memory sync

- [x] 21.1 Update root `CLAUDE.md` "Cross-Cutting Facts" — add an entry on the token SSOT location and the `pnpm tokens:check` / `tokens:lint-hex` gates
- [x] 21.2 Update `packages/ui-office/CLAUDE.md` — replace any reference to `studio-tokens.ts` with `@offisim/ui-core/tokens`; add note on theme-provider's new tri-state contract; add note on `useSceneColors()` returning theme-aware values
- [x] 21.3 Update `packages/ui-core/CLAUDE.md` if it exists, or add one — document the tokens directory contract, the SSOT rule, and the rename map for migrators
- [x] 21.4 Update `packages/renderer/CLAUDE.md` if it exists — note that `STATE_COLORS` is now re-exported from `@offisim/ui-core/tokens` and that 3D consumers should import the theme-aware variants directly when theme switching matters
- [x] 21.5 If `openspec/protocols-ledger.md` lists Tailwind / design system protocols, update the row to reflect the SSOT location and emission contract; otherwise no protocol-ledger entry is required
- [x] 21.6 MEMORY.md: add an entry under "Repository Hygiene" or equivalent stating "Design tokens SSOT lives in `packages/ui-core/src/tokens/`; never re-author hex / z-index / shadow inline" to discourage future regression

## 22. Archive gate (per CLAUDE.md OpenSpec Archive Gate)

- [x] 22.1 Spec consistency: verify `specs/design-token-foundation/spec.md` and `specs/theme-light-dark-switching/spec.md` reflect the values + behavior actually shipped — update any drift before archive
- [x] 22.2 Tasks consistency: every checked box has a matching artifact (file, command, live verification observation); any "partially done" item is not silently checked
- [x] 22.3 Documentation consistency: CLAUDE.md, package CLAUDE.mds, and any JSDoc comments referring to the token SSOT all match the shipped state
- [x] 22.4 Protocol ledger: the Tauri row gets a brief note on the new generated CSS surface if relevant (likely no change since this is web/UI-only)
