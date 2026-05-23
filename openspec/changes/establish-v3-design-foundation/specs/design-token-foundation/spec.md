## MODIFIED Requirements

### Requirement: `packages/ui-core/src/tokens/` SHALL be the single source of truth for all design tokens

Every design token consumed by Tailwind utility classes, CSS variables, JS / TSX inline `style={...}` props, or 3D scene materials in the Offisim codebase SHALL be authored in `packages/ui-core/src/tokens/` and consumed via either (a) the `@offisim/ui-core/tokens` subpath import or (b) the generated Tailwind theme CSS at `apps/desktop/renderer/src/generated/tailwind-theme.css` that is itself emitted from those tokens.

The directory SHALL contain exactly the following 11 files, each with the named exports (the count is exactly 11: `index.ts`, `colors-semantic.ts`, `colors-3d.ts`, `spacing.ts`, `typography.ts`, `radius.ts`, `shadow.ts`, `z-index.ts`, `motion.ts`, `border.ts`, `tailwind-theme.ts`):

- `index.ts` — barrel re-export of every other file's public exports plus `emitTailwindThemeCss`
- `colors-semantic.ts` — `SemanticColors` interface (legacy field names retained), `LIGHT_SEMANTIC_COLORS` (revalued to V3-mapped values), `DARK_SEMANTIC_COLORS` (retained unchanged for intentional-dark consumers), `getSemanticColors(theme)` helper, plus `V3_COLORS` (the native V3 palette: `bg`, `surface0/1/2`, `surfaceSunken`, `ink1..4`, `line`/`lineSoft`/`lineStrong`, `accent`/`accentPress`/`accentFg`/`accentSurface`/`accentRing`, `ok`/`okSurface`, `warn`/`warnSurface`, `danger`/`dangerSurface`, `violet`/`violetSurface`, `wiz*` dark wizard tokens including `wizLine2`)
- `colors-3d.ts` — UNCHANGED (3D scene art-direction is out of scope; `LIGHT_SCENE_3D`/`DARK_SCENE_3D`/`STATE_COLORS_*`/`CATEGORY_COLORS_*`/`getSceneColors`/`getStateColors` retained)
- `spacing.ts` — `SPACING_SCALE` (Tailwind-compatible, retained), `SP_DENSITY` (V3 product density `1..8` + compact/spacious), `SPACING_TAILWIND_CLASSES`, `getSpacingPx(step)`
- `typography.ts` — `TypographyRole`, `TypographyToken`, `TYPOGRAPHY_SCALE`, `FONT_FAMILY` (sans → General Sans stack, mono → V3 mono stack), `FONT_SIZE_V3` (`micro`/`meta`/`sm`/`base`/`md`/`lg`/`xl`), `LETTER_SPACING` (`caps`)
- `radius.ts` — `RADIUS_SCALE` (V3 values; retains `none`/`sm`/`md`/`lg`/`xl`/`full` names, adds `xs`/`pill`)
- `shadow.ts` — `ShadowName`, `SHADOW_SCALE` (single light-only scale; the 5 elevations re-pointed to V3 `elev-1/2/3` semantics + 4 glows retained). `SHADOW_SCALE_DARK` removed.
- `z-index.ts` — UNCHANGED
- `motion.ts` — UNCHANGED
- `border.ts` — UNCHANGED
- `tailwind-theme.ts` — `emitTailwindThemeCss(commit): string` pure function plus `SHELL_HEIGHTS` (`title`/`toolbar`)

The directory SHALL NOT contain any other files. Each file SHALL be self-contained and SHALL NOT import from `packages/ui-office`, `packages/renderer`, or `apps/desktop/renderer`. `DARK_SEMANTIC_COLORS` SHALL be retained (it is consumed directly by intentional-dark surfaces).

#### Scenario: SSOT directory exists with the contracted files

- **WHEN** listing `packages/ui-core/src/tokens/`
- **THEN** the directory contains exactly these 11 files and no others: (1) `index.ts`, (2) `colors-semantic.ts`, (3) `colors-3d.ts`, (4) `spacing.ts`, (5) `typography.ts`, (6) `radius.ts`, (7) `shadow.ts`, (8) `z-index.ts`, (9) `motion.ts`, (10) `border.ts`, (11) `tailwind-theme.ts`

#### Scenario: ui-core package exposes the tokens subpath

- **WHEN** importing from `@offisim/ui-core/tokens`
- **THEN** `V3_COLORS`, `LIGHT_SEMANTIC_COLORS`, `DARK_SEMANTIC_COLORS`, `getSemanticColors`, `SP_DENSITY`, `FONT_SIZE_V3`, `LETTER_SPACING`, `SHELL_HEIGHTS`, `emitTailwindThemeCss` are all available; `package.json` exports map contains a `"./tokens"` entry resolving into `dist/tokens/`

#### Scenario: Token files are leaf modules

- **WHEN** grepping `packages/ui-core/src/tokens/**/*.ts` for imports from `@offisim/(ui-office|renderer|core)`
- **THEN** zero matches — token files import only from each other and from `@offisim/shared-types`

### Requirement: `colors-semantic.ts` SHALL define complete light and dark variants for every semantic color

`SemanticColors` SHALL keep its existing 38-field interface (`surface`/`surfaceElevated`/`surfaceMuted`/`surfaceHover`/`surfaceActive`, `textPrimary`/`textSecondary`/`textMuted`/`textDisabled`/`textInverse`, `borderSubtle`/`borderDefault`/`borderStrong`/`borderFocus`, `accent`/`accentHover`/`accentMuted`/`accentText`, `success`/`successMuted`/`warning`/`warningMuted`/`error`/`errorMuted`/`info`/`infoMuted`, `glassBg`/`glassBorder`, the 12 `status*`). `LIGHT_SEMANTIC_COLORS` field VALUES SHALL be revalued to the V3 palette so that the existing ~1500 semantic Tailwind utility usages render V3 colors without any call-site change:

- `surface #f7f9fc`, `surfaceElevated #ffffff`, `surfaceMuted #f1f4f9`, `surfaceHover #f1f4f9`, `surfaceActive #e9edf4`
- `textPrimary #131a27`, `textSecondary #3c4a60`, `textMuted #647186`, `textDisabled #93a0b2`, `textInverse #ffffff`
- `borderSubtle #e9edf4`, `borderDefault #dde3ec`, `borderStrong #c8d1de`, `borderFocus rgba(47,107,255,0.36)`
- `accent #2f6bff`, `accentHover #1f54d8`, `accentMuted #ecf2ff`, `accentText #1f54d8`
- `success #1aa46a`, `successMuted #e4f5ec`, `warning #c98410`, `warningMuted #fdf2dd`, `error #d6453d`, `errorMuted #fdeae9`, `info #2f6bff`, `infoMuted #ecf2ff`
- `glassBg rgba(255,255,255,0.82)`, `glassBorder #dde3ec`
- status×12 mapped to V3 (idle/paused `#647186`, assigned/reporting `#2f6bff`, thinking/searching/meeting `#7c4ddb`, executing/success `#1aa46a`, blocked/failed `#d6453d`, waiting `#c98410`)

`DARK_SEMANTIC_COLORS` SHALL remain unchanged (consumed directly by Studio, CompanyCreationWizard, character-mesh-builder, office3d-sections, useZoneEditorState). `getSemanticColors(theme)` SHALL retain its signature. `V3_COLORS` SHALL expose the native V3 palette (including `--wiz-*` dark wizard values `wizBg #0c1019`, `wizSurface rgba(255,255,255,0.02)`, `wizLine rgba(255,255,255,0.06)`, `wizLine2 rgba(255,255,255,0.10)`, `wizInk1 #ffffff`, `wizInk2 #c4cdde`, `wizInk3 #8b97ad`, `wizInk4 #5a6577`, `wizBlue #3b82f6`, `wizEmerald #34d399`). `wizLine2` corresponds to the prototype's `--wiz-line-2` (used by the `.wiz-emp` employee cards in the lifecycle prototype).

#### Scenario: Light palette renders V3 values under legacy names

- **WHEN** reading `LIGHT_SEMANTIC_COLORS.textPrimary` and `LIGHT_SEMANTIC_COLORS.error`
- **THEN** the values are `#131a27` and `#d6453d` (V3 ink-1 and danger)
- **AND** `LIGHT_SEMANTIC_COLORS.accent` is `#2f6bff`

#### Scenario: Dark palette retained for intentional-dark consumers

- **WHEN** importing `DARK_SEMANTIC_COLORS`
- **THEN** the export exists and its values are unchanged from before this change

#### Scenario: V3 native palette available

- **WHEN** reading `V3_COLORS.ink1`, `V3_COLORS.accent`, `V3_COLORS.wizBg`
- **THEN** the values are `#131a27`, `#2f6bff`, `#0c1019`

### Requirement: `spacing.ts` SHALL define a 10-step canonical scale

`SPACING_SCALE` SHALL remain Tailwind-default-compatible (`0:0, 1:4, 2:8, 3:12, 4:16, 5:20, 6:24, 8:32, 12:48, 16:64`) so existing `p-3`, `gap-2` classes keep working. `SP_DENSITY` SHALL define the V3 product spacing `1..8` with px `{ 1:4, 2:6, 3:8, 4:10, 5:12, 6:14, 7:16, 8:20 }` for `normal`, with `compact` and `spacious` variants, emitted as `--sp-1`..`--sp-8`.

#### Scenario: Tailwind scale unchanged; V3 density present

- **WHEN** reading `SPACING_SCALE[3]` and `SP_DENSITY.normal[3]`
- **THEN** the values are `12` and `8` respectively
- **AND** `SP_DENSITY.normal[8]` is `20`

### Requirement: `typography.ts` SHALL define 9 roles with complete tuples

`FONT_SIZE_V3` SHALL be `Record<'micro'|'meta'|'sm'|'base'|'md'|'lg'|'xl', number>` = `{ micro:10, meta:11, sm:12, base:13, md:14, lg:15, xl:19 }` (no `2xl`). `LETTER_SPACING` SHALL include `caps: '0.14em'`. `FONT_FAMILY` SHALL be `{ sans: '"General Sans", ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif', mono: 'ui-monospace, "SF Mono", "JetBrains Mono", Menlo, monospace' }`. `TYPOGRAPHY_SCALE` SHALL be retained with `family` referencing the new `FONT_FAMILY`.

#### Scenario: V3 font sizes and General Sans

- **WHEN** reading `FONT_SIZE_V3.sm` and `FONT_FAMILY.sans` and `LETTER_SPACING.caps`
- **THEN** the values are `12`, a string beginning with `"General Sans"`, and `'0.14em'`
- **AND** `FONT_SIZE_V3` has no `2xl` key

### Requirement: `tailwind-theme.ts` SHALL emit a Tailwind 4 `@theme inline` block from the TS tokens

`emitTailwindThemeCss(commit): string` SHALL return CSS with these sections in order:

1. A `/* AUTO-GENERATED — DO NOT EDIT — source: packages/ui-core/src/tokens — commit: <SHA> */` header.
2. An `@theme inline { ... }` block that (a) RETAINS every legacy Tailwind theme key currently consumed by utilities (`--color-surface`, `--color-text-primary`, `--color-error`, `--color-success`, the full semantic set, `--text-caption` and the typography roles, `--radius-none/sm/md/lg/xl/full`, `--shadow-resting/hover/popover/overlay/modal` + 4 glows) — these resolve to the revalued V3 values via the `-val` indirection; AND (b) ADDS V3-named keys referencing the V3 native variables (`--color-ink-1: var(--ink-1)`, `--color-accent: var(--accent)`, `--color-ok/warn/danger/violet`, `--radius-r-xs..r-pill: var(--r-*)`, `--text-fs-micro..fs-xl: var(--fs-*)`, `--shadow-elev-1/2/3: var(--elev-*)`, `--spacing-sp-1..8: var(--sp-*)`).
3. A single `:root { ... }` block declaring: (a) the legacy `--color-*-val` values (now V3-mapped) + root aliases (`--surface`, `--text-primary-val`, etc.); (b) the V3 native variables with literal values (`--bg`, `--surface-0/1/2`, `--surface-sunken`, `--ink-1..4`, `--line`/`--line-soft`/`--line-strong`, `--accent`/`--accent-press`/`--accent-fg`/`--accent-surface`/`--accent-ring`, `--ok`/`--ok-surface`/`--warn`/`--warn-surface`/`--danger`/`--danger-surface`/`--violet`/`--violet-surface`, `--r-xs..--r-pill`, `--elev-1/2/3`, `--fs-micro..--fs-xl`, `--ls-caps`, `--sp-1..8`, `--title`, `--toolbar`); (c) the `--wiz-*` dark wizard tokens.
4. Density overrides `:root[data-density="compact"|"spacious"]` re-declaring `--sp-1..8` (+ legacy `--sp-xs..xxxl` aliases).

The function SHALL NOT emit a `:root.dark { ... }` block (the app is light-only). It SHALL be deterministic and side-effect free and SHALL NOT read env / files / git directly.

#### Scenario: Emitter is deterministic and light-only

- **WHEN** calling `emitTailwindThemeCss('abc123')` twice
- **THEN** the two return values are byte-equal
- **AND** the result contains exactly one `@theme inline {` and one `:root {` and zero `:root.dark {`

#### Scenario: Legacy utility keys retained and re-pointed to V3

- **WHEN** calling `emitTailwindThemeCss('abc123')`
- **THEN** the `@theme inline` block still contains `--color-text-primary`, `--color-error`, `--text-caption`, `--shadow-modal`, `--radius-md`
- **AND** `--color-text-primary` resolves (transitively) to `#131a27`, `--color-error` to `#d6453d`, `--radius-md` to `9px`
- **AND** a renderer build still generates the `text-text-primary`, `bg-error`, `text-caption`, `rounded-md`, `shadow-modal` utility classes

#### Scenario: V3 native layer and wizard tokens present

- **WHEN** calling `emitTailwindThemeCss('abc123')`
- **THEN** the `:root` block contains `--ink-1: #131a27;`, `--accent: #2f6bff;`, `--r-md: 9px;`, `--elev-1: ...`, `--sp-3: 8px;`, `--title: 40px;`, `--wiz-bg: #0c1019;`
- **AND** the `@theme inline` block contains `--color-ink-1: var(--ink-1);` and `--radius-r-md: var(--r-md);`

## REMOVED Requirements

### Requirement: `radius.ts` SHALL define 6 named steps

**Reason**: V3 expands the radius scale beyond 6 steps. `RADIUS_SCALE` retains the legacy `none`/`sm`/`md`/`lg`/`xl`/`full` names (revalued to V3) and ADDS `xs`/`pill`, so the scale is no longer "6 named steps". Replaced by the V3 radius requirement in the ADDED block.

### Requirement: `shadow.ts` SHALL define 5 elevations + 4 glows for both themes

**Reason**: V3 is light-only. `shadow.ts` collapses to a single light-only `SHADOW_SCALE` re-pointed to the V3 `elev-1/2/3` semantics, and `SHADOW_SCALE_DARK` is removed — so the "for both themes" dual-scale contract no longer holds. Replaced by the light-only V3 shadow requirement in the ADDED block.

## ADDED Requirements

### Requirement: `radius.ts` SHALL carry the V3 radius values

`RADIUS_SCALE` SHALL retain the legacy names so existing `rounded-*` utilities generate, with V3 values, and add `xs`/`pill`: `{ none:0, xs:5, sm:7, md:9, lg:13, xl:18, full:9999, pill:999 }`.

#### Scenario: Radius values match V3

- **WHEN** reading `RADIUS_SCALE.md`, `RADIUS_SCALE.lg`, `RADIUS_SCALE.xs`, `RADIUS_SCALE.pill`
- **THEN** the values are `9`, `13`, `5`, `999`

### Requirement: `shadow.ts` SHALL define a single light-only shadow scale re-pointed to V3 elevations

`SHADOW_SCALE` SHALL be a single `Record<ShadowName, string>` (light-only) where `ShadowName` retains `'resting' | 'hover' | 'popover' | 'overlay' | 'modal' | 'glowAccent' | 'glowSuccess' | 'glowWarning' | 'glowError'`. `resting`/`hover` SHALL use the V3 `elev-1`/`elev-2` values, `popover` → `elev-2`, `overlay`/`modal` → `elev-3`; the 4 glows are retained. `SHADOW_SCALE_DARK` SHALL be removed.

- `elev-1`: `0 1px 2px rgba(20,32,56,0.06), 0 1px 1px rgba(20,32,56,0.04)`
- `elev-2`: `0 4px 14px rgba(20,32,56,0.10), 0 1px 3px rgba(20,32,56,0.06)`
- `elev-3`: `0 18px 44px rgba(18,28,50,0.20), 0 4px 12px rgba(18,28,50,0.10)`

#### Scenario: Single light-only scale mapped to V3 elevations

- **WHEN** reading `SHADOW_SCALE.modal` and `SHADOW_SCALE.resting`
- **THEN** `modal` equals the `elev-3` value and `resting` equals the `elev-1` value
- **AND** no `SHADOW_SCALE_DARK` export exists

### Requirement: The generated theme and app shell SHALL be light-only with intentional-dark token availability

The renderer SHALL force a single light theme: `theme-provider` SHALL resolve to `light` and SHALL NOT apply a `.dark` class on the document root at runtime. The `.dark` class machinery (the `Theme`/`ResolvedTheme` types and the class-toggle code path) is RETAINED in code but pinned to light — it is NOT hard-deleted — and the generated CSS SHALL contain no `:root.dark` block, so the machinery is inert.

Phase 0 SHALL EMIT the `--wiz-*` dark wizard tokens and SHALL designate the intentional-dark exception set — Studio plus the lifecycle wizard surfaces (CompanyCreationWizard, EmployeeCreatorOverlay) — as the surfaces that are exempt from the light-only resolution. Phase 0 SHALL NOT rewrite any wizard component file: Studio already stays dark by reading `DARK_SEMANTIC_COLORS` regardless of app theme (decoupled via `studio-style-helpers.ts`), and the actual migration of the lifecycle wizard component files onto `--wiz-*` tokens is OWNED BY Phase 8 (`rebuild-lifecycle-dialogs-v3`), not Phase 0. The `--wiz-*` tokens emitted here are the contract Phase 8 will consume.

#### Scenario: App is light-only with retained-but-inert dark machinery

- **WHEN** the renderer mounts and `theme-provider` resolves the theme
- **THEN** the document root carries `light` (never `dark`) at runtime, the generated CSS exposes no `:root.dark` rule, and the `.dark` class machinery remains present in code but is never applied

#### Scenario: Phase 0 emits the wizard token contract without rewriting wizard files

- **WHEN** inspecting the generated theme CSS and the Phase 0 source diff
- **THEN** the `--wiz-*` dark wizard tokens are present in the generated `:root` block, AND Studio resolves its palette to `DARK_SEMANTIC_COLORS`, AND no CompanyCreationWizard / EmployeeCreatorOverlay component file is converted to `--wiz-*` by Phase 0 (that migration is owned by Phase 8)
