## Why

Design tokens in the repository are split across at least four parallel
sources that drift independently and contradict each other in production:

1. **`apps/web/src/index.css`** declares the live CSS variables and the
   Tailwind 4 `@theme inline` block consumed by every Tailwind utility class
   (`bg-surface`, `text-text-primary`, etc.).
2. **`packages/ui-office/src/components/studio/studio-tokens.ts`** declares
   `STUDIO_COLORS` / `SP` / `FONT` / `LAYOUT` as JS objects consumed by inline
   `style={...}` props in every Studio component. Values overlap the CSS
   variables but disagree (`STUDIO_COLORS.bg = #0c1118` agrees, but
   `STUDIO_COLORS.accent = #6366f1` indigo while `index.css --accent-val =
   #3b82f6` blue — the two surfaces visibly do not match).
3. **`packages/renderer/src/tokens/colors.ts`** declares `STATE_COLORS` (12
   employee-state hex numbers) consumed only by the 3D scene. There is no
   equivalent on the UI side, so a "thinking" employee badge rendered in
   chat picks an unrelated tailwind color.
4. **189 raw `#xxxxxx` hex literals + 110 sub-cases** scattered across the
   four Tailwind-aware packages (`grep -rE '#[0-9a-fA-F]{6}\b'` returns 299
   raw matches across `apps/web/src`, `packages/{ui-office,ui-core,renderer}/src`).
   Z-index uses raw `9999`, `9998`, `[60]`, `[70]`, `[75]`. Shadow uses
   arbitrary tuples (`shadow-[0_20px_60px_rgba(0,0,0,0.28)]` etc.).
   Motion uses arbitrary durations (`transition: 'background 0.1s, color 0.1s'`,
   `animation: list-item-in 200ms ease-out`).

On top of token fragmentation, **theme switching is intentionally broken**:

5. **`packages/ui-office/src/theme/theme-provider.tsx`** force-applies
   `root.classList.add('dark'); root.classList.remove('light')` on mount and
   the public `Theme` type is the literal `'dark'`. There is no `setTheme`,
   no system-fallback path, no light variant exported.
6. **`packages/ui-office/src/theme/use-scene-colors.ts`** returns a single
   `DARK_SCENE` constant — there is no `LIGHT_SCENE` definition. Every 3D
   color path is dark-only.

The result is that updating one surface's color/spacing/shadow does not
update the others, raw hex changes silently break parity, and "switch to
light mode" cannot be tested at all because there is no light variant of
half the values. Pre-launch, no back-compat — this is a single complete
delivery that consolidates all token sources to one SSOT, makes Tailwind
the consumer of TS tokens (not a parallel source), and restores light/dark
switching.

## What Changes

- **Establish a single token SSOT at `packages/ui-core/src/tokens/`**, the
  base UI package every other UI package already depends on. Nine token
  category files (`colors-semantic.ts`, `colors-3d.ts`, `spacing.ts`,
  `typography.ts`, `radius.ts`, `shadow.ts`, `z-index.ts`, `motion.ts`,
  `border.ts`) plus a `tokens/index.ts` barrel and a `tokens/tailwind-theme.ts`
  emitter that materializes the TS tokens as a Tailwind 4 `@theme` CSS block
  string. No Tailwind utility class, CSS variable, or component style is
  authored independently of these files.
- **Both light and dark variants are defined for every semantic color** —
  surface, text, border, accent, state-feedback, and status-employee. The
  3D color set (`colors-3d.ts`) keeps the existing `STATE_COLORS` numeric
  hex (Three.js consumes numbers), with light variants added in the same
  file.
- **Tailwind theme generation pipeline** — a build-time script
  (`scripts/emit-tailwind-theme.mjs`) reads the TS tokens and writes
  `apps/web/src/generated/tailwind-theme.css` containing the `@theme inline`
  block. `apps/web/src/index.css` `@import`s the generated file. The CI
  gate verifies the generated file matches a regenerated copy
  (`pnpm tokens:check`); commits with stale generated CSS fail the gate.
- **`packages/ui-office/src/components/studio/studio-tokens.ts` is deleted**.
  Its consumers re-import the same names from `@offisim/ui-core/tokens`.
  Studio's `STUDIO_COLORS.accent` aligns to the unified accent token (no
  more indigo-vs-blue disagreement).
- **`packages/renderer/src/tokens/colors.ts` STATE_COLORS** moves to
  `@offisim/ui-core/tokens/colors-3d.ts` and is re-exported from the
  renderer's existing `tokens/index.ts` for back-compat inside this change
  (re-export only — pre-launch, no aliasing on consumers).
- **Raw hex literals removed across `apps/web/src/`,
  `packages/ui-office/src/`, `packages/ui-core/src/`, `packages/renderer/src/`**.
  Tooling: a Biome custom rule plus a CI grep gate (`pnpm tokens:lint-hex`)
  that fails on any `#[0-9a-fA-F]{3,8}` literal outside of the
  `packages/ui-core/src/tokens/` SSOT and the curated marketplace catalog
  (`catalog/provider-source-registry/` is exempt — third-party brand colors).
- **Z-index scale** — six named layers (`base / elevated / sticky /
  dropdown / modal / top`) replace `z-[60]`, `z-[70]`, `z-[75]`,
  `z-index: 9999`, `z-index: 9998`, and the inline `zIndex: 20` in
  `studio-tokens.ts`.
- **Shadow scale** — five named elevations (`resting / hover / popover /
  overlay / modal`) replace every `shadow-[...]` arbitrary-value class and
  the four `.glow-*` CSS classes (which become `shadow.glow-{accent,success,
  warning,error}`).
- **Spacing token** — eight steps (`px-0 / px-1 / px-2 / px-3 / px-4 /
  px-6 / px-8 / px-12 / px-16` mapping to `0 / 4 / 8 / 12 / 16 / 24 / 32 /
  48 / 64 px`) — one canonical scale, no more `SP_DEFAULTS` Studio fork +
  Tailwind default fork. The existing density modes (compact / normal /
  spacious) continue to multiply this scale via CSS variables.
- **Typography token** — nine roles (`display / h1 / h2 / h3 / body-lg /
  body / body-sm / caption / mono`), each with a fixed `{ family, size,
  weight, lineHeight, letterSpacing }` tuple. Tailwind `text-display`
  / `text-h1` / `text-body` utilities map to these.
- **Radius token** — five steps (`none / sm / md / lg / xl / full`) at
  `0 / 4 / 8 / 12 / 16 / 9999 px`.
- **Border token** — three widths (`thin / normal / thick`) at `1 / 2 / 3 px`,
  plus three border-color roles (`subtle / default / strong`) routed
  through semantic colors.
- **Motion token** — four durations (`instant / fast / normal / slow` at
  `50 / 150 / 250 / 400 ms`) and three easings (`standard / decelerate /
  accelerate`). The 3D motion buckets in `packages/renderer/src/tokens/motion.ts`
  remain the canonical 3D source; the new UI motion token is parallel — they
  are not unified, but they live next to each other in the SSOT and reference
  the same easing names.
- **Light/dark theme switching restored** — `theme-provider.tsx` becomes
  `'light' | 'dark' | 'system'` with persistence in `localStorage` key
  `offisim.theme` and `prefers-color-scheme` fallback. `tailwind-theme.css`
  emits both light and dark CSS variable scopes (Tailwind 4 supports
  `:root { ... }` + `:root.dark { ... }` natively). `use-scene-colors.ts`
  returns `useTheme().resolvedTheme === 'light' ? LIGHT_SCENE : DARK_SCENE`.
- **No `cyan-400/20` / `slate-700` Tailwind-palette literals on touched
  surfaces** — replaced by semantic token names. Tailwind 4 still ships
  the default palette; this change does not strip the default palette but
  forbids new authoring with palette literals on touched surfaces.

## Capabilities

### New Capabilities

- **`design-token-foundation`** — defines the SSOT location, the 9 token
  category file contracts, the Tailwind theme emission pipeline, the
  no-raw-hex / no-arbitrary-z-index / no-arbitrary-shadow CI gates, and
  the rule that all Tailwind utility classes consumed by application code
  flow from this single source.
- **`theme-light-dark-switching`** — defines the `Theme` type contract,
  persistence key, system-fallback resolution, all light variants of
  semantic / shadow / scene tokens, and the wiring through to Tailwind
  `darkMode: 'class'` and `useSceneColors()`.

### Modified Capabilities

- **`design-system-consolidation`** — the existing capability covers
  shared primitives (`SurfaceCard`, `Toolbar`, etc.) and constraint that
  touched surfaces use design system tokens. It is updated to require
  that those tokens come from `@offisim/ui-core/tokens` (not local
  duplicates), that no raw hex / arbitrary z-index / arbitrary shadow
  appears on touched surfaces, and that touched components must support
  both light and dark themes.

## Impact

- **New code**: `packages/ui-core/src/tokens/{index.ts,colors-semantic.ts,
  colors-3d.ts,spacing.ts,typography.ts,radius.ts,shadow.ts,z-index.ts,
  motion.ts,border.ts,tailwind-theme.ts}` (11 files);
  `scripts/emit-tailwind-theme.mjs`, `scripts/check-tailwind-theme.mjs`,
  `scripts/lint-no-raw-hex.mjs`; `apps/web/src/generated/tailwind-theme.css`
  (generated, committed for reproducibility).
- **Deleted code**: `packages/ui-office/src/components/studio/studio-tokens.ts`
  (after consumers migrate to `@offisim/ui-core/tokens`). `apps/web/src/index.css`
  loses its hand-authored `@theme inline` block (replaced by the generated
  import). `.glow-accent` / `.glow-success` / `.glow-warning` / `.glow-error`
  CSS classes deleted (replaced by Tailwind utilities derived from shadow
  token).
- **Modified code**: every file under `packages/{ui-office,ui-core,renderer}/src/`
  and `apps/web/src/` that currently uses raw hex / arbitrary z-index /
  arbitrary shadow / arbitrary motion timing — replaced by semantic class
  or token import. Approximate scope from audit: ~30 files for hex,
  ~6 files for shadow, ~5 files for z-index, ~10 files for motion.
- **Modified config**: `packages/ui-core/package.json` adds a `tokens` export
  subpath; `apps/web/vite.config.ts` may need a path alias if the tokens
  subpath is not auto-resolved.
- **Theme-switching wiring**: `packages/ui-office/src/theme/theme-provider.tsx`
  rewritten — `Theme` becomes union, `setTheme` exposed, persistence
  + system-fallback added; `packages/ui-office/src/theme/use-scene-colors.ts`
  rewritten with light + dark variants and `useTheme()` consumption;
  Settings tab gets a "Theme" control surfaced through the existing
  appearance section.
- **CI gates added**: `pnpm tokens:check` (generated CSS up-to-date),
  `pnpm tokens:lint-hex` (no raw hex outside SSOT). Both wired to the
  existing CI walk via `pnpm` scripts in the root package.
- **No back-compat**: pre-launch — `STUDIO_COLORS` and `requiresLocalOffisimTools`-style
  legacy aliases are not retained. Studio components import from the new
  SSOT directly. The renderer keeps its `tokens/index.ts` re-export path
  so existing 3D imports do not change source path.
- **Live verification**: dev server light/dark toggle visibly inverts every
  surface (chat, scene, Studio, Settings, Personnel, Activity Log, Market,
  SOPs); Studio accent matches main-app accent (no indigo/blue mismatch);
  contrast spot-check via DevTools (≥4.5:1 for body text, ≥3:1 for large
  text + interactive borders); all touched surfaces render correctly in
  both themes; Tauri release `.app` builds and ships the same generated
  CSS as the web build (`pnpm tokens:check` is part of the desktop
  bundle gate).
