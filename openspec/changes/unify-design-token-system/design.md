## Context

The repo runs Tailwind 4 (`tailwindcss ^4.2.1`, `@tailwindcss/vite ^4.2.1`,
no `tailwind.config.*` file present — confirmed via `find … -name
'tailwind.config*'`). Tailwind 4 uses a CSS-first configuration model:
the active theme lives in an `@theme` (or `@theme inline`) block in CSS,
not in a JS config. `apps/web/src/index.css` already declares one such
block but populates it from hand-authored CSS variables and from a curated
"legacy alias" section that re-routes old token names to new ones — the
file is the de-facto theme config but it is not derived from any
machine-readable source.

A parallel JS object set lives at `packages/ui-office/src/components/studio/studio-tokens.ts`
(`STUDIO_COLORS`, `SP`, `FONT`, `LAYOUT`) and is consumed by inline
`style={...}` props in every Studio component. The Studio file pre-dates
the unified `index.css` token block and was never migrated.

The 3D layer's color and motion tokens live separately in
`packages/renderer/src/tokens/{colors,motion,state-feedback-matrix,
departments}.ts`. The renderer has no peer-level dependency on
`packages/ui-office`, so its tokens cannot import from Studio's file
even if anyone wanted to.

The result is three independent token surfaces:

| Surface | Where | Consumed by |
|---|---|---|
| Tailwind / CSS | `apps/web/src/index.css` `@theme inline` | Tailwind utility classes |
| Studio inline | `packages/ui-office/src/components/studio/studio-tokens.ts` | Studio inline `style={}` |
| 3D scene | `packages/renderer/src/tokens/*.ts` | Three.js color/motion buckets |

Plus 299 raw `#xxxxxx` literals (grep audit on
`packages/{ui-office,ui-core,renderer}/src + apps/web/src`),
arbitrary z-index values (`9999`, `9998`, `[60]`, `[70]`, `[75]`, `20`),
arbitrary `shadow-[...]` tuples (8+ unique tuples in `ui-office/src`),
and arbitrary motion timings.

On top of this, the theme provider deliberately locks the root to
dark-only (`theme-provider.tsx:28-31`) and `use-scene-colors.ts` only
defines `DARK_SCENE`. A "switch to light mode" UX is impossible to
implement on the current state because most colors do not have a light
variant defined anywhere.

The user's directive: production-grade single change, no minimum
viable carving — every audit finding gets addressed in the same commit.

## Goals / Non-Goals

**Goals:**
- One token SSOT in `packages/ui-core/src/tokens/` consumed by every
  CSS / TS surface, including Tailwind theme generation.
- All semantic colors (surface / text / border / accent / state-feedback
  / status-employee) defined for both light and dark themes; no missing
  variants.
- Tailwind theme is generated from TS tokens — `apps/web/src/index.css`
  contains zero hand-authored color values.
- No raw hex literal outside the SSOT (CI gate enforces).
- No arbitrary z-index / shadow / motion timing on touched surfaces
  (CI gate enforces).
- Theme switching works end-to-end: user toggle in Settings → CSS class
  on `<html>` → Tailwind utilities re-evaluate → 3D scene refreshes →
  state persisted across reload.
- Studio's accent matches the main app's accent (no indigo-vs-blue split).

**Non-Goals:**
- Replacing Tailwind 4 with vanilla CSS modules. Tailwind utilities
  remain the primary class-authoring surface; this change makes them
  consume a single token source rather than diverging from one.
- Unifying the 3D motion buckets (`MOTION_TIER_A/B/C` in
  `packages/renderer/src/tokens/motion.ts`) with the new UI motion token.
  3D motion uses GSAP-style easing strings (`power2.out`, `back.out(1.2)`)
  that have no CSS analog. Both motion sets live in the same token
  directory but are addressed separately in their respective consumers.
- Repainting the visual identity (no new accent color, no new typeface
  choice, no shift in surface lightness). The values defined in this
  change reflect the *current* visual state with the conflicts resolved
  in favor of the production CSS variables (`--accent-val = #3b82f6`
  blue, not Studio's `#6366f1` indigo) — Studio realigns to main app.
- Stripping the Tailwind default palette (`bg-cyan-400`, `text-slate-700`,
  etc. continue to compile). The change forbids *new authoring* with
  those literals on touched surfaces but does not delete the palette.
- Restoring the SVG 2D scene grammar — out of scope; this change does
  not touch scene rendering primitives, only their color/motion sources.
- Migrating the catalog (`catalog/provider-source-registry/`) brand
  colors. Third-party brand hex values are exempt from the no-raw-hex
  CI rule.
- Building a token visualizer / Storybook page. Live verification uses
  the dev server toggle.

## Decisions

### Decision 1: SSOT lives at `packages/ui-core/src/tokens/`

`packages/ui-core` is the leaf UI package — `ui-office` depends on it,
the renderer depends on shared-types only and now also re-exports tokens
from ui-core (renderer is browser-friendly enough to import a leaf TS
module that exports plain objects). The location ensures every UI surface
has a clean import path to the tokens with no risk of circular dependency.

**Alternative considered**: `packages/shared-types/src/tokens/`. Rejected
because shared-types is meant to be zero-dependency type-only contracts;
adding token *values* introduces runtime exports that would force every
backend service to ship the design tokens.

**Alternative considered**: a new `@offisim/tokens` package. Rejected as
package overhead — `ui-core` already exists, every UI consumer already
depends on it, and the tokens are tightly bound to UI consumption.

The 11 files under `packages/ui-core/src/tokens/`:

| File | Exports |
|---|---|
| `index.ts` | Barrel re-exports for the 9 category files + the Tailwind theme emitter |
| `colors-semantic.ts` | `SemanticColors` type, `LIGHT_SEMANTIC_COLORS`, `DARK_SEMANTIC_COLORS` records |
| `colors-3d.ts` | `Scene3DColors` type, `LIGHT_SCENE_3D`, `DARK_SCENE_3D`, `STATE_COLORS_LIGHT`, `STATE_COLORS_DARK` (numeric hex for Three.js) |
| `spacing.ts` | `SPACING_SCALE` record (8 steps) |
| `typography.ts` | `TYPOGRAPHY_SCALE` record (9 roles) |
| `radius.ts` | `RADIUS_SCALE` record (6 steps) |
| `shadow.ts` | `SHADOW_SCALE` record (5 elevations + 4 glow variants) |
| `z-index.ts` | `Z_INDEX_SCALE` record (6 layers) |
| `motion.ts` | `MOTION_DURATION` (4 steps) + `MOTION_EASING` (3 curves) |
| `border.ts` | `BORDER_WIDTH` (3 widths) + `BORDER_ROLE` (3 color roles) |
| `tailwind-theme.ts` | `emitTailwindThemeCss(): string` — pure function returning the `@theme inline` CSS block plus `:root.dark` overrides |

### Decision 2: Tailwind 4 CSS-first config consumes generated CSS

Tailwind 4 ships a CSS-first config: `@theme inline { … }` blocks are
the canonical place to declare custom colors / spacing / fonts. We do
NOT migrate to a JS `tailwind.config.ts` — that would re-introduce a
parallel theme source.

The flow:
1. TS tokens define values.
2. `scripts/emit-tailwind-theme.mjs` imports `emitTailwindThemeCss()`
   and writes `apps/web/src/generated/tailwind-theme.css`.
3. `apps/web/src/index.css` does `@import "./generated/tailwind-theme.css";`
   at the top.
4. Tailwind 4 picks up the `@theme inline` block at build time.
5. CI gate `pnpm tokens:check` regenerates and `diff`s — fails if
   committed file is stale.

`apps/web/src/index.css` retains:
- `@import "tailwindcss"` directive
- `@source "..."` paths (Tailwind 4 content scan)
- The base body / scrollbar / glass-panel utility CSS (component-level,
  not theme-level)
- The `@import "./generated/tailwind-theme.css"` line

It loses:
- The hand-authored `:root { --surface: ... }` CSS variable wall (lines
  14–60 today)
- The `@theme inline { ... }` block (lines 62–115 today)
- The `:root[data-density="compact"|"spacious"]` override blocks
  (lines 42–60 today) — these move into the generated file

The density modifier remains a runtime concept (compact / normal /
spacious) and is emitted by the same generator. Density CSS lives next
to theme CSS so a single import gets both.

**Tailwind 4 dark mode**: Tailwind 4 supports `@variant dark` and reads
`darkMode` semantics from CSS. We use the class-based mode by emitting
both `:root { --color-surface: <light>; }` and `:root.dark {
--color-surface: <dark>; }` so any utility like `bg-surface` (consuming
`--color-surface`) automatically inverts when the `dark` class is on
`<html>`.

### Decision 3: Theme provider becomes `'light' | 'dark' | 'system'` with persistence

`theme-provider.tsx` rewritten:

```ts
type Theme = 'light' | 'dark' | 'system';
type ResolvedTheme = 'light' | 'dark';

interface ThemeContextValue {
  theme: Theme;
  resolvedTheme: ResolvedTheme;
  density: Density;
  setTheme: (theme: Theme) => void;
  setDensity: (density: Density) => void;
}
```

- `localStorage` key `offisim.theme` persists user choice
- `system` resolves via `window.matchMedia('(prefers-color-scheme: dark)')`
  and listens for OS-level changes
- `setTheme` updates state, persists, and toggles `<html>`'s `dark` /
  `light` classes
- `useTheme()` callable from UI components
- `useSceneColors()` reads `useTheme().resolvedTheme` and returns
  `LIGHT_SCENE_3D` or `DARK_SCENE_3D`

Settings exposes a Theme tile in the existing Appearance section
(or a new dedicated section if appearance is currently runtime-only —
spec calls for a Theme control regardless of the section name).

**Default**: first-run users get `system`. SSR / pre-hydration HTML
defaults to `dark` (matches today's behavior; avoids a flash to light).

### Decision 4: Color scale — semantic light + dark variants

The `SemanticColors` type:

```ts
interface SemanticColors {
  // Surface (background tiers)
  surface: string;
  surfaceElevated: string;
  surfaceMuted: string;
  surfaceHover: string;
  surfaceActive: string;
  // Text
  textPrimary: string;
  textSecondary: string;
  textMuted: string;
  textDisabled: string;
  textInverse: string;
  // Border
  borderSubtle: string;
  borderDefault: string;
  borderStrong: string;
  borderFocus: string;
  // Accent
  accent: string;
  accentHover: string;
  accentMuted: string;
  accentText: string;
  // State feedback
  success: string;
  successMuted: string;
  warning: string;
  warningMuted: string;
  error: string;
  errorMuted: string;
  info: string;
  infoMuted: string;
  // Glass
  glassBg: string;
  glassBorder: string;
  // Status (employee)
  statusIdle: string;
  statusAssigned: string;
  statusThinking: string;
  statusSearching: string;
  statusExecuting: string;
  statusMeeting: string;
  statusBlocked: string;
  statusWaiting: string;
  statusReporting: string;
  statusSuccess: string;
  statusFailed: string;
  statusPaused: string;
}
```

**Dark theme values** (current production, anchored on `index.css` and
`STUDIO_COLORS` reconciled):

| Token | Hex |
|---|---|
| surface | `#0c1118` |
| surfaceElevated | `#151d2e` |
| surfaceMuted | `#1e293b` |
| surfaceHover | `#334155` |
| surfaceActive | `#3b4862` |
| textPrimary | `#f1f5f9` |
| textSecondary | `#94a3b8` |
| textMuted | `#64748b` |
| textDisabled | `#475569` |
| textInverse | `#0c1118` |
| borderSubtle | `rgba(255,255,255,0.06)` |
| borderDefault | `rgba(255,255,255,0.10)` |
| borderStrong | `rgba(255,255,255,0.18)` |
| borderFocus | `rgba(59,130,246,0.55)` |
| accent | `#3b82f6` |
| accentHover | `#2563eb` |
| accentMuted | `rgba(59,130,246,0.18)` |
| accentText | `#93c5fd` |
| success | `#10b981` |
| successMuted | `rgba(16,185,129,0.15)` |
| warning | `#f59e0b` |
| warningMuted | `rgba(245,158,11,0.15)` |
| error | `#ef4444` |
| errorMuted | `rgba(239,68,68,0.15)` |
| info | `#3b82f6` |
| infoMuted | `rgba(59,130,246,0.15)` |
| glassBg | `rgba(0,0,0,0.40)` |
| glassBorder | `rgba(255,255,255,0.10)` |
| statusIdle | `#94a3b8` |
| statusAssigned | `#60a5fa` |
| statusThinking | `#818cf8` |
| statusSearching | `#c084fc` |
| statusExecuting | `#34d399` |
| statusMeeting | `#a78bfa` |
| statusBlocked | `#f87171` |
| statusWaiting | `#fbbf24` |
| statusReporting | `#2dd4bf` |
| statusSuccess | `#4ade80` |
| statusFailed | `#ef4444` |
| statusPaused | `#9ca3af` |

**Light theme values** (newly authored — chosen to maintain the same hue
families as dark and meet WCAG AA contrast for body/border text):

| Token | Hex |
|---|---|
| surface | `#fafbfc` |
| surfaceElevated | `#ffffff` |
| surfaceMuted | `#f1f5f9` |
| surfaceHover | `#e2e8f0` |
| surfaceActive | `#cbd5e1` |
| textPrimary | `#0f172a` |
| textSecondary | `#475569` |
| textMuted | `#64748b` |
| textDisabled | `#94a3b8` |
| textInverse | `#ffffff` |
| borderSubtle | `rgba(15,23,42,0.06)` |
| borderDefault | `rgba(15,23,42,0.12)` |
| borderStrong | `rgba(15,23,42,0.20)` |
| borderFocus | `rgba(37,99,235,0.55)` |
| accent | `#2563eb` |
| accentHover | `#1d4ed8` |
| accentMuted | `rgba(37,99,235,0.12)` |
| accentText | `#1e40af` |
| success | `#059669` |
| successMuted | `rgba(5,150,105,0.12)` |
| warning | `#d97706` |
| warningMuted | `rgba(217,119,6,0.12)` |
| error | `#dc2626` |
| errorMuted | `rgba(220,38,38,0.12)` |
| info | `#2563eb` |
| infoMuted | `rgba(37,99,235,0.12)` |
| glassBg | `rgba(255,255,255,0.65)` |
| glassBorder | `rgba(15,23,42,0.10)` |
| statusIdle | `#64748b` |
| statusAssigned | `#2563eb` |
| statusThinking | `#4f46e5` |
| statusSearching | `#9333ea` |
| statusExecuting | `#059669` |
| statusMeeting | `#7c3aed` |
| statusBlocked | `#dc2626` |
| statusWaiting | `#d97706` |
| statusReporting | `#0d9488` |
| statusSuccess | `#16a34a` |
| statusFailed | `#dc2626` |
| statusPaused | `#64748b` |

The `accent` value resolves the Studio-vs-main-app conflict: dark accent
is `#3b82f6` (production CSS variable wins; Studio's `#6366f1` indigo
is replaced).

### Decision 5: 3D color scale

`Scene3DColors` keeps the same string-hex shape `use-scene-colors.ts`
returns today, plus a numeric variant for the Three.js employee state
ring color (the existing `STATE_COLORS` numeric hex).

```ts
interface Scene3DColors {
  floor: string;
  desk: string;
  deskEdge: string;
  furniture: string;
  furnitureDark: string;
  furnitureLight: string;
  partition: string;
  screen: string;
  metal: string;
  serverBody: string;
  ledCyan: string;
  ledGreen: string;
  ledBlue: string;
  ledAmber: string;
  potBase: string;
  leafPrimary: string;
  leafSecondary: string;
  leafTertiary: string;
  text: string;
  textMuted: string;
  selectionRing: string;
}
```

`DARK_SCENE_3D` matches today's `DARK_SCENE` constant byte-for-byte.

`LIGHT_SCENE_3D` (newly authored):

| Field | Light Hex | Dark Hex (existing) |
|---|---|---|
| floor | `#dbe2ed` | `#253347` |
| desk | `#1f2937` | `#e2e8f0` |
| deskEdge | `#334155` | `#cbd5e1` |
| furniture | `#cbd5e1` | `#2d3b4f` |
| furnitureDark | `#94a3b8` | `#0f172a` |
| furnitureLight | `#e2e8f0` | `#334155` |
| partition | `#475569` | `#94a3b8` |
| screen | `#0284c7` | `#0ea5e9` |
| metal | `#94a3b8` | `#334155` |
| serverBody | `#475569` | `#0f172a` |
| ledCyan | `#0891b2` | `#06b6d4` |
| ledGreen | `#16a34a` | `#22c55e` |
| ledBlue | `#2563eb` | `#3b82f6` |
| ledAmber | `#d97706` | `#fbbf24` |
| potBase | `#94a3b8` | `#334155` |
| leafPrimary | `#059669` | `#10b981` |
| leafSecondary | `#047857` | `#059669` |
| leafTertiary | `#10b981` | `#34d399` |
| text | `#0f172a` | `#e2e8f0` |
| textMuted | `#475569` | `#94a3b8` |
| selectionRing | `#2563eb` | `#3b82f6` |

`STATE_COLORS_LIGHT` and `STATE_COLORS_DARK` are numeric versions (e.g.
`0x94a3b8`) of the semantic `statusIdle / statusAssigned / …` values, so
the renderer's existing consumers can keep their numeric API.

### Decision 6: Spacing scale

`SPACING_SCALE` — eight steps mapping to a 4-px grid:

| Name | px | Tailwind class |
|---|---|---|
| `0` | 0 | `p-0` |
| `1` | 4 | `p-1` |
| `2` | 8 | `p-2` |
| `3` | 12 | `p-3` |
| `4` | 16 | `p-4` |
| `6` | 24 | `p-6` |
| `8` | 32 | `p-8` |
| `12` | 48 | `p-12` |
| `16` | 64 | `p-16` |

These are also the Tailwind 4 default spacing scale, so existing
`p-3` / `gap-2` etc. continue to work. The win is that `studio-tokens.ts`
SP no longer redefines the same numbers in JS.

Density modes (compact / normal / spacious) continue to apply via CSS
variables. The density CSS lives in the generated theme file (Decision 2).

### Decision 7: Typography scale

`TYPOGRAPHY_SCALE` — nine roles:

| Role | Family | Size | Weight | LineHeight | LetterSpacing | Tailwind class |
|---|---|---|---|---|---|---|
| `display` | sans | 32 | 700 | 1.15 | -0.02em | `text-display` |
| `h1` | sans | 24 | 700 | 1.2 | -0.01em | `text-h1` |
| `h2` | sans | 20 | 600 | 1.3 | -0.005em | `text-h2` |
| `h3` | sans | 16 | 600 | 1.4 | 0 | `text-h3` |
| `bodyLg` | sans | 16 | 400 | 1.5 | 0 | `text-body-lg` |
| `body` | sans | 14 | 400 | 1.5 | 0 | `text-body` |
| `bodySm` | sans | 12 | 400 | 1.45 | 0 | `text-body-sm` |
| `caption` | sans | 11 | 500 | 1.4 | 0.02em | `text-caption` |
| `mono` | mono | 12 | 400 | 1.5 | 0 | `text-mono` |

`family.sans = "Inter, ui-sans-serif, system-ui, sans-serif"` and
`family.mono = "JetBrains Mono, ui-monospace, SFMono-Regular, monospace"`,
matching today's `--font-sans` / `--font-mono` declarations in
`index.css`. The `font-pixel-display` / `font-pixel-body` legacy classes
in `index.css:225-233` are removed (zero current consumers found in
audit grep — they exist as defensive CSS but no `.font-pixel-*` class
appears in `tsx` source).

`FONT.xs/sm/base/md/lg/xl/xxl` from `studio-tokens.ts:117-136` map onto
this scale: `xs(9) → caption`, `sm(10) → caption`, `base(11) → caption`,
`md(12) → bodySm`, `lg(13) → bodySm`, `xl(14) → body`, `xxl(16) → bodyLg`.
The `9 / 10 / 11` Studio sizes are below the WCAG-recommended 12 px
minimum and are folded up to `caption (11)`.

### Decision 8: Radius scale

`RADIUS_SCALE`:

| Name | px | Tailwind class |
|---|---|---|
| `none` | 0 | `rounded-none` |
| `sm` | 4 | `rounded-sm` |
| `md` | 8 | `rounded-md` |
| `lg` | 12 | `rounded-lg` |
| `xl` | 16 | `rounded-xl` |
| `full` | 9999 | `rounded-full` |

This intentionally shifts Tailwind's default `rounded-2xl` (16px) to
`rounded-xl` semantic role. Touched surfaces use the named token, not
the legacy alias. `LAYOUT.cardRadius = 6` in `studio-tokens.ts` is
realigned to `sm (4)` or `md (8)` — Studio components decide; the audit
shows `cardRadius: 6` was a Studio-only number with no equivalent in the
main app, so the alignment to `md` is a visual normalization, not a
regression. `panelRadius: 0` becomes `none`.

### Decision 9: Shadow scale

`SHADOW_SCALE` — five elevations + four glows:

| Name | CSS |
|---|---|
| `resting` | `0 1px 2px rgba(0,0,0,0.05)` |
| `hover` | `0 2px 8px rgba(0,0,0,0.10)` |
| `popover` | `0 8px 24px rgba(2,6,23,0.14)` |
| `overlay` | `0 12px 32px rgba(2,6,23,0.18)` |
| `modal` | `0 20px 60px rgba(2,6,23,0.28)` |
| `glowAccent` | `0 0 12px rgba(59,130,246,0.20), inset 0 0 12px rgba(59,130,246,0.04)` |
| `glowSuccess` | `0 0 12px rgba(16,185,129,0.20), inset 0 0 12px rgba(16,185,129,0.04)` |
| `glowWarning` | `0 0 12px rgba(245,158,11,0.20), inset 0 0 12px rgba(245,158,11,0.04)` |
| `glowError` | `0 0 12px rgba(239,68,68,0.20), inset 0 0 12px rgba(239,68,68,0.04)` |

Tailwind utilities: `shadow-resting` / `shadow-hover` / `shadow-popover`
/ `shadow-overlay` / `shadow-modal` / `shadow-glow-accent` / etc.

The existing `shadow-[0_20px_60px_rgba(0,0,0,0.28)]` arbitrary value in
settings-primitives.tsx becomes `shadow-modal`. `PANEL_SHADOW` /
`PANEL_SHADOW_GLOW` constants in `AppLayout.tsx` map to the modal /
modal+glowAccent composition.

**Light theme shadow override**: light shadows have lower opacity (alpha
0.04 / 0.08 / 0.12 / 0.16 / 0.22 instead of 0.05–0.28) — emitted in the
generated CSS as `:root.dark` overrides on top of `:root` defaults.

### Decision 10: Z-index scale

`Z_INDEX_SCALE`:

| Layer | Value | Use |
|---|---|---|
| `base` | 0 | Default content |
| `elevated` | 10 | Cards, raised surfaces |
| `sticky` | 20 | Sticky headers, Studio panels (replaces `studio-tokens.ts:161 zIndex: 20`) |
| `dropdown` | 50 | Dropdowns, popovers, tooltips |
| `modal` | 100 | Dialogs, modals (replaces `z-[60]`, `z-[70]`, `z-[75]`) |
| `top` | 200 | Toasts, debug overlays, noise (replaces `z-index: 9999` / `9998`) |

Tailwind utilities: `z-base` / `z-elevated` / `z-sticky` / `z-dropdown`
/ `z-modal` / `z-top`.

### Decision 11: Motion scale

`MOTION_DURATION`:

| Name | ms |
|---|---|
| `instant` | 50 |
| `fast` | 150 |
| `normal` | 250 |
| `slow` | 400 |

`MOTION_EASING`:

| Name | CSS |
|---|---|
| `standard` | `cubic-bezier(0.4, 0, 0.2, 1)` |
| `decelerate` | `cubic-bezier(0, 0, 0.2, 1)` |
| `accelerate` | `cubic-bezier(0.4, 0, 1, 1)` |

Tailwind utilities: `duration-instant` / `duration-fast` / `duration-normal`
/ `duration-slow`; `ease-standard` / `ease-decelerate` / `ease-accelerate`.

The `studio-tokens.ts:226 transition: 'background 0.1s, color 0.1s'`
becomes `transition: 'background-color, color' duration-instant
ease-standard` (or the equivalent inline CSS using
`MOTION_DURATION.instant + MOTION_EASING.standard`). The
`apps/web/src/index.css:277 list-item-in 200ms ease-out` becomes
`MOTION_DURATION.normal` (250 — close enough, no perceptual difference)
and `MOTION_EASING.decelerate`.

The 3D motion buckets in `packages/renderer/src/tokens/motion.ts`
(`M0`/`M1`/`M2`/`M3` with GSAP easing strings like `power2.out`) are
left untouched. They are a separate motion vocabulary for Three.js
animation and have no CSS analog; the SSOT principle is that *each
consumer* has one source, not that all consumers share the same
vocabulary.

### Decision 12: Border scale

`BORDER_WIDTH`:

| Name | px |
|---|---|
| `thin` | 1 |
| `normal` | 2 |
| `thick` | 3 |

`BORDER_ROLE` (mapped through semantic colors):

| Name | Light | Dark |
|---|---|---|
| `subtle` | `borderSubtle` | `borderSubtle` |
| `default` | `borderDefault` | `borderDefault` |
| `strong` | `borderStrong` | `borderStrong` |

Tailwind utilities: `border-thin` (1px) / `border-normal` (2px) /
`border-thick` (3px); `border-subtle` / `border-default` / `border-strong`
(color). Tailwind's `border` (1px) and `border-2` (2px) defaults still
work, but touched surfaces author with the named tokens.

### Decision 13: Tailwind theme emitter

`tailwind-theme.ts` exports:

```ts
export function emitTailwindThemeCss(): string
```

Returns a string with three blocks:

```css
/* AUTO-GENERATED FROM packages/ui-core/src/tokens — DO NOT EDIT */

@theme inline {
  /* spacing, radius, typography, shadow, z-index, motion — single
     definitions referenced by both themes via CSS variables */
  --color-surface: var(--color-surface-val);
  --color-text-primary: var(--color-text-primary-val);
  …
  --radius-sm: 4px;
  --radius-md: 8px;
  …
  --duration-fast: 150ms;
  …
  --shadow-modal: var(--shadow-modal-val);
  --z-modal: 100;
  …
}

:root {
  --color-surface-val: #fafbfc;
  --color-text-primary-val: #0f172a;
  …
  --shadow-modal-val: 0 20px 60px rgba(2, 6, 23, 0.16);
  …
}

:root.dark {
  --color-surface-val: #0c1118;
  --color-text-primary-val: #f1f5f9;
  …
  --shadow-modal-val: 0 20px 60px rgba(2, 6, 23, 0.28);
  …
}
```

Two-tier indirection (`--color-X` consumes `--color-X-val`) because
Tailwind 4's `@theme inline` resolves variables at build time; the
runtime-switchable layer must be a separate variable scope. This is the
documented Tailwind 4 pattern for theme switching.

The script `scripts/emit-tailwind-theme.mjs`:
1. Imports `emitTailwindThemeCss` from the built `packages/ui-core/dist`
2. Writes `apps/web/src/generated/tailwind-theme.css`
3. Writes a header comment with the source commit SHA for traceability

`scripts/check-tailwind-theme.mjs` re-runs the emitter to a temp file
and `diff`s — non-zero exit on mismatch. Wired as
`pnpm --filter @offisim/ui-core build && node scripts/check-tailwind-theme.mjs`
in the root `tokens:check` script.

### Decision 14: No-raw-hex CI gate

`scripts/lint-no-raw-hex.mjs`:

```bash
node scripts/lint-no-raw-hex.mjs
```

Walks:
- `apps/web/src/**/*.{ts,tsx,css}`
- `packages/{ui-office,ui-core,renderer}/src/**/*.{ts,tsx,css}`

Excludes:
- `packages/ui-core/src/tokens/**` (the SSOT itself)
- `apps/web/src/generated/**` (generated CSS)
- `catalog/provider-source-registry/**` (third-party brand colors)
- Lines containing `// raw-hex-allowed` (escape hatch for cases like
  sample data, harness fixtures)

Greps `#[0-9a-fA-F]{3,8}\b` and exits non-zero if any match exists. Wired
to `pnpm tokens:lint-hex`.

The same script extends to forbid `z-\[\d+\]`, `shadow-\[`, and inline
`zIndex: \d+` / `transition: '... [\d.]+s` outside the SSOT — one CI
script, multiple regex rules.

### Decision 15: Consumer migration plan

The migration is mechanical:

1. **Tailwind utility classes**: existing classes that consume CSS
   variables (`bg-surface`, `text-text-primary`, etc.) work unchanged
   — they read the same CSS variable names, just from a generated source.
2. **`studio-tokens.ts` consumers**: replace
   `import { STUDIO_COLORS, SP, FONT, LAYOUT } from './studio-tokens'`
   with imports from `@offisim/ui-core/tokens`. Field rename map:
   - `STUDIO_COLORS.bg` → `colors.surface`
   - `STUDIO_COLORS.surface0` → `colors.surfaceElevated`
   - `STUDIO_COLORS.surface1` → `colors.surfaceMuted`
   - `STUDIO_COLORS.surface2` → `colors.surfaceHover`
   - `STUDIO_COLORS.border` → `colors.borderDefault`
   - `STUDIO_COLORS.borderSubtle` → `colors.borderSubtle`
   - `STUDIO_COLORS.borderActive` → `colors.borderFocus`
   - `STUDIO_COLORS.textPrimary/Secondary/Tertiary/Disabled` → same names in `colors`
   - `STUDIO_COLORS.accent/accentHover/accentMuted/accentText` → same names in `colors`
   - `STUDIO_COLORS.success/error/warning/info + Muted` → same names in `colors`
   - `STUDIO_COLORS.cat*` (category palette) → preserved in
     `colors-3d.ts` as `CATEGORY_COLORS_LIGHT/DARK` (Studio palette icons
     are 3D-adjacent — they live in the 3D color file)
   - `STUDIO_COLORS.canvasBg/gridMajor/gridMinor/plotBorder/ghostValid/ghostBlocked`
     → `colors-3d.ts` (Studio canvas is a 3D surface)
   - `SP.{xs,sm,md,lg,xl,xxl,xxxl}` → `SPACING_SCALE.{1,2,3,4,5,6,8}`
     using the px-equivalent step (xs=4→1, sm=8→2, md=12→3, lg=16→4,
     xl=20→5 *new step needed in spacing*, xxl=24→6, xxxl=32→8)
   - `FONT.*` → `TYPOGRAPHY_SCALE.*` per the typography map in
     Decision 7
   - `LAYOUT.toolbarHeight/bottomBarHeight/paletteWidth/propertiesWidth`
     → keep in Studio (these are layout *constants*, not tokens —
     `studio-tokens.ts` becomes `studio-layout.ts` containing only these
     four numbers, or they move into a `STUDIO_LAYOUT` const inside
     `StudioPage.tsx`)
   - `LAYOUT.panelRadius/cardRadius/buttonRadius` → `RADIUS_SCALE.{none,
     sm,md}`
3. **3D `useSceneColors()` consumers**: file path stable, the value
   returned now varies by theme.
4. **Inline raw hex in `*.tsx` style props**: replace with the matching
   token. The audit shows the top 20 hex literals all map to existing
   semantic tokens (e.g. `#3b82f6 → accent`, `#ef4444 → error`,
   `#10b981 → success`, `#f59e0b → warning`, `#0c1118 → surface`).
5. **Tailwind palette literals (`border-cyan-400/20`, `bg-slate-950` etc.)
   on touched surfaces**: replace with semantic Tailwind class
   (`border-accent/20`, `bg-surface`). Touched surfaces tracked via the
   `design-system-consolidation` capability — surfaces not touched by this
   change keep their literals; the no-raw-hex gate applies repo-wide but
   the no-palette-literal rule is scoped to the design-system spec.

The new `xl: 5 (20)` spacing step replaces `SP.xl: 20` from
`studio-tokens.ts`. The final spacing scale is therefore:
`{ 0, 1, 2, 3, 4, 5, 6, 8, 12, 16 }` mapping to `{ 0, 4, 8, 12, 16, 20,
24, 32, 48, 64 }` px — ten steps. The proposal lists nine because step
`5` is implicit in Tailwind 4 default spacing; making it an explicit
named step in the SSOT keeps the audit trail of "where did 20 come from".

### Decision 16: Theme persistence and SSR safety

`localStorage` key `offisim.theme` stores `'light' | 'dark' | 'system'`.

Pre-hydration HTML in `apps/web/index.html` includes a small inline
script that reads localStorage and applies the `dark` class before React
hydrates — avoids a flash of wrong theme. The script is < 200 chars and
has no dependency on the bundle.

```html
<script>
  (function() {
    try {
      var t = localStorage.getItem('offisim.theme') || 'system';
      var dark = t === 'dark' || (t === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
      document.documentElement.classList.toggle('dark', dark);
    } catch (e) { document.documentElement.classList.add('dark'); }
  })();
</script>
```

Tauri release picks up the same `index.html` so the desktop boot is
flash-free as well.

## Risks / Trade-offs

[Risk] Tailwind 4 `@theme inline` two-tier indirection (`--color-X`
consuming `--color-X-val`) is a recent feature; older Tailwind 4 minor
versions may resolve the indirection at build time and lose runtime
switchability.
→ Mitigation: pin `tailwindcss ^4.2.1` exactly (current installed), test
the generated CSS in Tailwind's dev server, and document the version
constraint in the spec. If a future Tailwind upgrade breaks this, the
generator emits a flat `:root.dark` style instead — equivalent runtime
behavior, requires a generator change only.

[Risk] Replacing `STUDIO_COLORS.accent` from `#6366f1` (indigo) to
`#3b82f6` (blue) is a visible color change to anyone using Studio today.
→ Mitigation: Studio is currently published (commits show recent work
on `2026-04-26-studio-plot-zone-hierarchy`, etc.) — accent realignment
is one of the goals (Studio matches main app). No back-compat shim.

[Risk] The light theme values are newly authored — never visually
verified against the actual UI surfaces. Some semantic-color choices may
look wrong in context (e.g. `accent` blue on a light bg may need to be
darker for contrast).
→ Mitigation: live verification mandates a full traversal of every
workspace surface in light mode (Office, SOPs, Market, Personnel,
Activity Log, Settings, Studio overlay). DevTools contrast-ratio
measurement is part of the verification protocol. Color values may
need a follow-up tune-pass after the first live verify; that is
acceptable iteration on the spec but the theme switching infrastructure
must be in place to enable any tuning.

[Risk] Removing `studio-tokens.ts` is a wide blast radius — every Studio
component re-imports. A single typo in the rename map breaks dozens of
files at once.
→ Mitigation: the rename map (Decision 15) enumerates each field
explicitly; the migration is a single PR with the tokens, the rename,
and a typecheck + build gate. No "leave the old file aliased" path —
typecheck catches every reference.

[Risk] CI gate `pnpm tokens:lint-hex` fails the first time on every
existing raw hex, blocking the commit until they are migrated.
→ Mitigation: the migration tasks (Section 7 of `tasks.md`) explicitly
list the file groups to clean up, and the gate is added as the LAST
task before live verification — every prior task lands the migration,
then the gate goes in to prevent regression.

[Risk] The two-tier CSS variable approach doubles the variable count in
the generated file (~80 entries instead of ~40). This is irrelevant for
parse time but slightly increases the compiled CSS size.
→ Acceptable. Tailwind's preflight is already ~2 KB; adding ~2 KB of
theme variables is below the noise floor compared to the 1.7 MB main
chunk.

[Risk] System theme listening (`matchMedia`) needs a cleanup on
`ThemeProvider` unmount. Forgetting the cleanup leaks event listeners
across hot-reload cycles in dev.
→ Mitigation: the rewritten `theme-provider.tsx` uses `useEffect` with
explicit cleanup. Tested via React 19 Strict Mode double-mount in dev.

[Risk] `useSceneColors()` returning a different object reference on every
theme change re-triggers all 3D scene material allocations. With Three.js
material instances pooled, this may cause a one-time GPU upload when
toggling theme.
→ Acceptable. Theme toggle is a user-initiated low-frequency event;
GPU upload of ~20 colored materials is < 10 ms on any modern device.

[Trade-off] The 3D motion vocabulary (`M0`/`M1`/`M2`/`M3` GSAP buckets)
is not unified with the UI motion vocabulary (`instant`/`fast`/`normal`/
`slow` CSS durations). They live in the same `tokens/` directory but
are not cross-referenced.
→ Acceptable. They have different consumers (Three.js animation lib vs.
CSS transitions) and different easing systems (GSAP power-eases vs.
cubic-bezier). Forcing them into one vocabulary would lose information.

## Migration Plan

Pre-launch — no data migration. Code migration sequence:

1. Land the tokens directory in `packages/ui-core/src/tokens/`.
2. Build `@offisim/ui-core`.
3. Land the Tailwind theme emitter + generated CSS.
4. Build `@offisim/web` to verify Tailwind picks up the generated theme.
5. Migrate `studio-tokens.ts` consumers to the new SSOT.
6. Delete `studio-tokens.ts`.
7. Migrate raw-hex / arbitrary-z-index / arbitrary-shadow / arbitrary-motion
   sites file-by-file (audit-driven file list).
8. Land the no-raw-hex CI gate.
9. Land the theme-provider rewrite + Settings tile + scene-colors light
   variant.
10. Live verify both themes across all workspaces + Tauri release.

All ten steps land in this single change. No partial-delivery state is
acceptable per the user directive.
