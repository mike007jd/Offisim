# design-token-foundation Specification

## Purpose

Defines the design-token foundation for shared UI, 3D scene colors, semantic colors, spacing, radius, motion, typography, z-index, Tailwind emission, and renderer compatibility exports.
## Requirements
### Requirement: `packages/ui-core/src/tokens/` SHALL be the single source of truth for all design tokens

Every design token consumed by Tailwind utility classes, CSS variables, JS / TSX inline `style={...}` props, or 3D scene materials in the Offisim codebase SHALL be authored in `packages/ui-core/src/tokens/` and consumed via either (a) the `@offisim/ui-core/tokens` subpath import or (b) the generated Tailwind theme CSS at `apps/web/src/generated/tailwind-theme.css` that is itself emitted from those tokens.

The directory SHALL contain exactly the following files, each with the named exports:

- `index.ts` — barrel re-export of every other file's public exports plus `emitTailwindThemeCss`
- `colors-semantic.ts` — `SemanticColors` interface, `LIGHT_SEMANTIC_COLORS`, `DARK_SEMANTIC_COLORS`, `getSemanticColors(theme)` helper
- `colors-3d.ts` — `Scene3DColors` interface, `LIGHT_SCENE_3D`, `DARK_SCENE_3D`, `STATE_COLORS_LIGHT`, `STATE_COLORS_DARK` (numeric hex `0x…` values for Three.js), `CATEGORY_COLORS_LIGHT`, `CATEGORY_COLORS_DARK`, `getStateColors(theme)`, `getSceneColors(theme)` helpers
- `spacing.ts` — `SPACING_SCALE` record (10 numeric steps), `SPACING_TAILWIND_CLASSES`, `getSpacingPx(step)` helper
- `typography.ts` — `TypographyRole` union, `TypographyToken` interface, `TYPOGRAPHY_SCALE` record (9 roles), `FONT_FAMILY` record
- `radius.ts` — `RADIUS_SCALE` record (6 named steps)
- `shadow.ts` — `ShadowName` union, `SHADOW_SCALE_LIGHT`, `SHADOW_SCALE_DARK` records (5 elevations + 4 glows = 9 entries each)
- `z-index.ts` — `Z_INDEX_SCALE` record (6 layers)
- `motion.ts` — `MOTION_DURATION` record (4 entries, ms), `MOTION_EASING` record (3 entries, CSS cubic-bezier strings)
- `border.ts` — `BORDER_WIDTH` record (3 widths in px), `BorderRole` union (`'subtle' | 'default' | 'strong'`)
- `tailwind-theme.ts` — `emitTailwindThemeCss(): string` pure function

The directory SHALL NOT contain any other files. Each file SHALL be self-contained and SHALL NOT import from `packages/ui-office`, `packages/renderer`, or `apps/web`. The `colors-3d.ts` numeric `0x…` exports MAY mirror `colors-semantic.ts` status colors — they are the only allowed cross-file dependency within `tokens/`.

#### Scenario: SSOT directory exists with the contracted files

- **WHEN** listing `packages/ui-core/src/tokens/`
- **THEN** the directory contains exactly these 11 files: `index.ts`, `colors-semantic.ts`, `colors-3d.ts`, `spacing.ts`, `typography.ts`, `radius.ts`, `shadow.ts`, `z-index.ts`, `motion.ts`, `border.ts`, `tailwind-theme.ts` — no others, no `legacy.ts`, no `compat.ts`, no per-feature subdirectories

#### Scenario: ui-core package exposes the tokens subpath

- **WHEN** importing from `@offisim/ui-core/tokens`
- **THEN** the named exports listed above are all available; `package.json` exports map contains a `"./tokens"` entry with `types` + `default` resolution into `dist/tokens/`

#### Scenario: Token files are leaf modules

- **WHEN** grepping `packages/ui-core/src/tokens/**/*.ts` for `import .* from '\.\./\.\./\.\./'` or `from '@offisim/(ui-office|renderer|core)'`
- **THEN** zero matches — token files import only from each other and from `@offisim/shared-types` (for `EmployeeState`)

### Requirement: `colors-semantic.ts` SHALL define complete light and dark variants for every semantic color

`SemanticColors` SHALL include exactly the following 38 fields, each with both a `LIGHT_SEMANTIC_COLORS[field]` and `DARK_SEMANTIC_COLORS[field]` value defined:

- Surface (5): `surface`, `surfaceElevated`, `surfaceMuted`, `surfaceHover`, `surfaceActive`
- Text (5): `textPrimary`, `textSecondary`, `textMuted`, `textDisabled`, `textInverse`
- Border (4): `borderSubtle`, `borderDefault`, `borderStrong`, `borderFocus`
- Accent (4): `accent`, `accentHover`, `accentMuted`, `accentText`
- State feedback (8): `success`, `successMuted`, `warning`, `warningMuted`, `error`, `errorMuted`, `info`, `infoMuted`
- Glass (2): `glassBg`, `glassBorder`
- Status — employee runtime (12): `statusIdle`, `statusAssigned`, `statusThinking`, `statusSearching`, `statusExecuting`, `statusMeeting`, `statusBlocked`, `statusWaiting`, `statusReporting`, `statusSuccess`, `statusFailed`, `statusPaused`

Both `LIGHT_SEMANTIC_COLORS` and `DARK_SEMANTIC_COLORS` SHALL be plain `Record<keyof SemanticColors, string>` objects with no `undefined` / `null` / empty string fields. Values SHALL be one of: 6-digit hex `#xxxxxx`, 8-digit hex `#xxxxxxxx`, or `rgba(r,g,b,a)` literal.

The `accent` field SHALL be `#3b82f6` in dark mode (production CSS variable wins) and `#2563eb` in light mode. The previous Studio `STUDIO_COLORS.accent = #6366f1` indigo SHALL NOT survive in any token export.

#### Scenario: Both themes are complete

- **WHEN** iterating over `Object.keys(LIGHT_SEMANTIC_COLORS)` and `Object.keys(DARK_SEMANTIC_COLORS)`
- **THEN** the two key sets are equal AND both equal the contracted 38-field set

#### Scenario: No empty values

- **WHEN** iterating over the values of `LIGHT_SEMANTIC_COLORS` and `DARK_SEMANTIC_COLORS`
- **THEN** every value is a non-empty string matching the regex `/^(#[0-9a-fA-F]{6}|#[0-9a-fA-F]{8}|rgba\([^)]+\))$/`

#### Scenario: Accent values match the unified production target

- **WHEN** reading `DARK_SEMANTIC_COLORS.accent`
- **THEN** the value is `#3b82f6` exactly
- **AND WHEN** reading `LIGHT_SEMANTIC_COLORS.accent`
- **THEN** the value is `#2563eb` exactly

### Requirement: `colors-3d.ts` SHALL define complete light and dark variants for every 3D scene color

`Scene3DColors` SHALL include the following fields:

**3D and shared scene fields**: `floor`, `desk`, `deskEdge`, `furniture`, `furnitureDark`, `furnitureLight`, `partition`, `screen`, `metal`, `serverBody`, `ledCyan`, `ledGreen`, `ledBlue`, `ledAmber`, `potBase`, `leafPrimary`, `leafSecondary`, `leafTertiary`, `text`, `textMuted`, `selectionRing`, `sceneBackground`, `wallShell`, `bookSpine`, `cableChannel`, `vendingScreen`, `tableReading`, `whiteboardSurface`, `whiteboardMarker`, `accentWarm`, `accentCool`, `floorTile`, `floorTileAlt`, `floorGrid`, `floorBorder`, `wallPanel`, `wallTrim`, `wallShadow`, `zoneRug`, `zoneLabelBg`, `zoneLabelText`, `labelGlow`, `workMat`, `cableAccent`, `characterShoe`, `characterHand`, and `brandNeutral`.

**2D canvas-only fields** (added by the `scene-2d-theme-tokens` capability): `canvasBackground`, `canvasGrid`, `deskSurface`, `deskScreen`, `deskBezel`, `pillBg`, `pillBgStroke`, `pillText`, `dotRing`, `nameLabelMuted`, `meetingBubbleBg`, `meetingBubbleStroke`, `meetingBubbleTitle`, `meetingBubbleParticipantText`, `meetingBubbleWaitingText`, `meetingBubbleExtraText`, `managerMarkerFill`, `managerMarkerStroke`, `managerMarkerLabel`, `selectionRing2D`, `dragGhostShadow`, `prefabSilhouetteDegraded`, `stateBadgeBg`, `stateBadgeStroke`, `stateBadgeText`, `stateBadgeBgBlocked`, `stateBadgeStrokeBlocked`, `stateBadgeTextBlocked`, `stateBadgeBgSuccess`, `stateBadgeStrokeSuccess`, `stateBadgeTextSuccess`.

Both `LIGHT_SCENE_3D` and `DARK_SCENE_3D` SHALL be complete `Record<keyof Scene3DColors, string>` objects covering both groups.

`STATE_COLORS_LIGHT` and `STATE_COLORS_DARK` SHALL each be a `Record<EmployeeState, number>` (numeric hex form — `0xRRGGBB`) covering all 12 employee states defined in `@offisim/shared-types`.

Legacy `DARK_SCENE_3D` fields that existed before the 3D art-direction pass SHALL remain byte-equivalent to today's `DARK_SCENE` constant in `packages/ui-office/src/theme/use-scene-colors.ts`; added art-direction fields and the new 2D-canvas-only fields SHALL be explicit token values in both light and dark variants.

The new 2D-canvas-only `DARK_SCENE_3D` field values SHALL be byte-equivalent to today's hard-coded literals in `packages/ui-office/src/components/scene/Office2DCanvasView.tsx`, `packages/ui-office/src/components/scene/canvas-primitives.ts`, and `packages/ui-office/src/components/scene/canvas-layers/*.ts`, preserving dark-mode visual continuity (e.g., `canvasBackground = '#020617'`, `pillBg = '#1e293b'`, `managerMarkerStroke = '#a855f7'`).

`STATE_COLORS_DARK` SHALL be byte-equivalent to today's `STATE_COLORS` in `packages/renderer/src/tokens/colors.ts` — no field values change in dark mode.

`CATEGORY_COLORS_LIGHT` and `CATEGORY_COLORS_DARK` SHALL each be a `Record<'workspace'|'compute'|'knowledge'|'collaboration'|'infrastructure'|'decorative', string>`. `CATEGORY_COLORS_DARK` SHALL be byte-equivalent to today's `STUDIO_COLORS.cat*` fields.

#### Scenario: Dark scene legacy byte-equivalence

- **WHEN** comparing `DARK_SCENE_3D.floor` to today's `DARK_SCENE.floor` value `#253347`
- **THEN** the values are identical
- **AND** the same byte equivalence holds for every legacy `Scene3DColors` field

#### Scenario: Light scene completeness

- **WHEN** iterating over `LIGHT_SCENE_3D`
- **THEN** every contracted field (3D, shared, and 2D-canvas-only) is present with a non-empty color string

#### Scenario: 2D canvas-only dark byte-equivalence

- **WHEN** comparing `DARK_SCENE_3D.canvasBackground` to today's `BACKGROUND_COLOR` literal `#020617` in `canvas-layers/draw-background.ts`
- **THEN** the values are identical
- **AND** the same byte equivalence holds for every other 2D-canvas-only field's pre-tokenization literal

#### Scenario: STATE_COLORS_DARK preserves existing 3D ring colors

- **WHEN** comparing `STATE_COLORS_DARK.idle` to today's `STATE_COLORS.idle` value `0x94a3b8`
- **THEN** the values are identical
- **AND** the same byte equivalence holds for every other `EmployeeState`

### Requirement: `spacing.ts` SHALL define a 10-step canonical scale

`SPACING_SCALE` SHALL be a `Record<SpacingStep, number>` where `SpacingStep` is the union `0 | 1 | 2 | 3 | 4 | 5 | 6 | 8 | 12 | 16` and the values are pixels: `{ 0: 0, 1: 4, 2: 8, 3: 12, 4: 16, 5: 20, 6: 24, 8: 32, 12: 48, 16: 64 }`.

The scale SHALL match Tailwind 4's default spacing for the steps `0..6, 8` so that existing `p-3`, `gap-2`, `mt-4` Tailwind classes continue to work without translation.

The intermediate step `5` (20 px) SHALL be present so that the legacy `STUDIO_COLORS / studio-tokens.ts` `SP.xl: 20` consumer has a single named source.

#### Scenario: Scale matches contract

- **WHEN** reading `SPACING_SCALE[3]`
- **THEN** the value is `12`
- **AND** reading `SPACING_SCALE[16]` returns `64`
- **AND** every step in the union is a key of the record

### Requirement: `typography.ts` SHALL define 9 roles with complete tuples

`TYPOGRAPHY_SCALE` SHALL be a `Record<TypographyRole, TypographyToken>` covering exactly these 9 roles: `'display' | 'h1' | 'h2' | 'h3' | 'bodyLg' | 'body' | 'bodySm' | 'caption' | 'mono'`.

Each `TypographyToken` SHALL have all of `{ family: 'sans' | 'mono', size: number, weight: number, lineHeight: number, letterSpacing: string }` fields populated. No field SHALL be omitted or left as a Tailwind default fallback.

The exact values SHALL match the table in `design.md` Decision 7:

- display: sans, 32, 700, 1.15, -0.02em
- h1: sans, 24, 700, 1.2, -0.01em
- h2: sans, 20, 600, 1.3, -0.005em
- h3: sans, 16, 600, 1.4, 0
- bodyLg: sans, 16, 400, 1.5, 0
- body: sans, 14, 400, 1.5, 0
- bodySm: sans, 12, 400, 1.45, 0
- caption: sans, 11, 500, 1.4, 0.02em
- mono: mono, 12, 400, 1.5, 0

`FONT_FAMILY` SHALL be `{ sans: 'Inter, ui-sans-serif, system-ui, sans-serif', mono: 'JetBrains Mono, ui-monospace, SFMono-Regular, monospace' }` matching today's `--font-sans` / `--font-mono` exactly.

#### Scenario: Every role is fully populated

- **WHEN** iterating over `TYPOGRAPHY_SCALE`
- **THEN** every role has all 5 fields with non-undefined / non-zero values (size > 0, weight > 0, lineHeight > 0; letterSpacing may be `'0'` or `'0em'`)

### Requirement: `radius.ts` SHALL define 6 named steps

`RADIUS_SCALE` SHALL be a `Record<'none' | 'sm' | 'md' | 'lg' | 'xl' | 'full', number>` with values `{ none: 0, sm: 4, md: 8, lg: 12, xl: 16, full: 9999 }` (units: px).

#### Scenario: Scale matches contract

- **WHEN** reading `RADIUS_SCALE.full`
- **THEN** the value is `9999`
- **AND** `RADIUS_SCALE.md` is `8`

### Requirement: `shadow.ts` SHALL define 5 elevations + 4 glows for both themes

`SHADOW_SCALE_DARK` and `SHADOW_SCALE_LIGHT` SHALL each be a `Record<ShadowName, string>` where `ShadowName` is the union `'resting' | 'hover' | 'popover' | 'overlay' | 'modal' | 'glowAccent' | 'glowSuccess' | 'glowWarning' | 'glowError'` (9 entries each).

The dark values SHALL match `design.md` Decision 9 dark table. The light values SHALL match Decision 9 light overrides (alpha attenuated).

The dark `modal` shadow SHALL be `0 20px 60px rgba(2,6,23,0.28)` — the canonical replacement for the existing `shadow-[0_20px_60px_rgba(0,0,0,0.28)]` arbitrary value in `settings-primitives.tsx`.

The 4 glow shadows SHALL be the canonical replacements for the existing `.glow-accent`, `.glow-success`, `.glow-warning`, `.glow-error` CSS classes in `apps/web/src/index.css`. Those CSS classes SHALL be deleted as part of this change.

#### Scenario: Both themes are complete

- **WHEN** iterating over `Object.keys(SHADOW_SCALE_DARK)` and `Object.keys(SHADOW_SCALE_LIGHT)`
- **THEN** the two key sets are equal and contain exactly the 9 contracted names

#### Scenario: Modal shadow matches the legacy arbitrary value

- **WHEN** reading `SHADOW_SCALE_DARK.modal`
- **THEN** the value is `0 20px 60px rgba(2,6,23,0.28)` exactly

### Requirement: `z-index.ts` SHALL define 6 layers replacing all arbitrary z-index values

`Z_INDEX_SCALE` SHALL be a `Record<'base' | 'elevated' | 'sticky' | 'dropdown' | 'modal' | 'top', number>` with values `{ base: 0, elevated: 10, sticky: 20, dropdown: 50, modal: 100, top: 200 }`.

After this change, no source file under `apps/web/src/`, `packages/{ui-office,ui-core,renderer}/src/` SHALL contain a literal arbitrary z-index — neither `z-[<digits>]` Tailwind class nor inline `zIndex: <digits>` style prop nor CSS `z-index: <digits>` rule (with `<digits> >= 1000` definitely forbidden, `<digits>` matching one of the named layer values is the only acceptable form and is preferred via the named token import).

#### Scenario: Scale covers all today's arbitrary values

- **WHEN** auditing the codebase
- **THEN** every previously-used z-index value (`9999`, `9998`, `60`, `70`, `75`, `20`) maps onto one of the 6 named layers

### Requirement: `motion.ts` SHALL define 4 durations and 3 easings

`MOTION_DURATION` SHALL be a `Record<'instant' | 'fast' | 'normal' | 'slow', number>` (units: ms) with values `{ instant: 50, fast: 150, normal: 250, slow: 400 }`.

`MOTION_EASING` SHALL be a `Record<'standard' | 'decelerate' | 'accelerate', string>` with CSS cubic-bezier values `{ standard: 'cubic-bezier(0.4, 0, 0.2, 1)', decelerate: 'cubic-bezier(0, 0, 0.2, 1)', accelerate: 'cubic-bezier(0.4, 0, 1, 1)' }`.

The UI motion vocabulary defined here is independent of the 3D motion vocabulary in `packages/renderer/src/tokens/motion.ts` (`M0`/`M1`/`M2`/`M3` GSAP buckets). Both vocabularies coexist; this spec governs the CSS / Tailwind / DOM transition surface only.

#### Scenario: Scales match contract

- **WHEN** reading `MOTION_DURATION.fast`
- **THEN** the value is `150`
- **AND** `MOTION_EASING.standard` is `'cubic-bezier(0.4, 0, 0.2, 1)'`

### Requirement: `border.ts` SHALL define 3 widths and a role union

`BORDER_WIDTH` SHALL be a `Record<'thin' | 'normal' | 'thick', number>` (units: px) with values `{ thin: 1, normal: 2, thick: 3 }`.

`BorderRole` SHALL be the union `'subtle' | 'default' | 'strong'` mapping to the corresponding `borderSubtle` / `borderDefault` / `borderStrong` keys in `colors-semantic.ts`.

#### Scenario: Widths match contract

- **WHEN** reading `BORDER_WIDTH.thick`
- **THEN** the value is `3`

### Requirement: `tailwind-theme.ts` SHALL emit a Tailwind 4 `@theme inline` block from the TS tokens

`emitTailwindThemeCss(): string` SHALL return a CSS string with three logical sections in order:

1. A `/* AUTO-GENERATED — DO NOT EDIT — source: packages/ui-core/src/tokens — commit: <SHA> */` header comment.
2. An `@theme inline { ... }` block declaring every Tailwind 4 theme key derived from the tokens, using the indirection `--color-X: var(--color-X-val);`, `--shadow-Y: var(--shadow-Y-val);`, etc., so the `@theme` keys reference runtime-switchable variables.
3. A `:root { ... }` block declaring the light values (`--color-X-val: <light hex>`) followed by a `:root.dark { ... }` block declaring the dark values (`--color-X-val: <dark hex>`). Density `:root[data-density="compact"|"spacious"]` overrides are also emitted in this section.

The function SHALL be deterministic and side-effect free: calling it twice with the same token input SHALL return identical strings (modulo the SHA in the header, which is provided externally).

The function SHALL NOT read environment variables, files, or git state directly. The git SHA is passed in via parameter (default `'dev'`).

#### Scenario: Emitter is deterministic

- **WHEN** calling `emitTailwindThemeCss('abc123')` twice in the same process
- **THEN** the two return values are byte-equal

#### Scenario: Generated CSS contains the `@theme inline` block

- **WHEN** calling `emitTailwindThemeCss('abc123')`
- **THEN** the result contains exactly one `@theme inline {` substring AND exactly one `:root {` substring AND exactly one `:root.dark {` substring

#### Scenario: Indirection layer is present

- **WHEN** calling `emitTailwindThemeCss('abc123')`
- **THEN** the `@theme inline` block contains `--color-surface: var(--color-surface-val);` (and the same pattern for every other semantic color) — Tailwind reads from the named variable, the named variable reads from the runtime-switchable `-val` variable

### Requirement: Tailwind theme generation pipeline SHALL produce committed reproducible CSS

The repository SHALL ship `apps/web/src/generated/tailwind-theme.css` as a committed file. It SHALL be the only `.css` file under `apps/web/src/generated/`.

`apps/web/src/index.css` SHALL `@import` the generated file immediately after `@import "tailwindcss";` and before any `@source` directive.

The script `scripts/emit-tailwind-theme.mjs` SHALL regenerate `apps/web/src/generated/tailwind-theme.css` from the built `@offisim/ui-core/tokens`. The script `scripts/check-tailwind-theme.mjs` SHALL verify the committed file matches the regenerated output (ignoring the `commit:` SHA line) and exit non-zero on mismatch.

The root `package.json` SHALL define `tokens:emit` and `tokens:check` scripts wired to these `.mjs` files.

#### Scenario: Generated CSS is committed

- **WHEN** listing `apps/web/src/generated/`
- **THEN** the directory contains `tailwind-theme.css` and is tracked by git

#### Scenario: index.css imports the generated file

- **WHEN** reading the first 5 non-blank lines of `apps/web/src/index.css`
- **THEN** the lines include `@import "tailwindcss";` followed by `@import "./generated/tailwind-theme.css";`

#### Scenario: tokens:check fails on stale generated file

- **WHEN** the committed `apps/web/src/generated/tailwind-theme.css` does not match `emitTailwindThemeCss(currentGitSha)`
- **THEN** `pnpm tokens:check` exits non-zero with a diff in stdout

### Requirement: No raw color / shadow / z-index / motion literals SHALL exist outside the SSOT

Source files under `apps/web/src/`, `packages/ui-office/src/`, `packages/ui-core/src/components/`, `packages/ui-core/src/lib/`, `packages/ui-core/src/hooks/`, and `packages/renderer/src/` SHALL NOT contain:

- A 3-, 4-, 6-, or 8-digit hex literal (`#[0-9a-fA-F]{3,8}\b`) except inside `// raw-hex-allowed`-tagged lines
- A Tailwind arbitrary z-index (`z-\[\d+\]`)
- A Tailwind arbitrary shadow (`shadow-\[`)
- An inline `zIndex: <digits>` style prop with a value not corresponding to a `Z_INDEX_SCALE` named layer
- A `transition: '...[\d.]+s'` or `animation: '...[\d.]+(s|ms)'` literal whose duration is not derived from `MOTION_DURATION`

Exempt locations: `packages/ui-core/src/tokens/**`, `apps/web/src/generated/**`, `catalog/provider-source-registry/**`, and any line tagged with the trailing comment `// raw-hex-allowed`.

The file-level escape hatch `// raw-hex-allowed-file: ...` SHALL be limited to files outside the 2D office canvas pipeline (per `scene-2d-theme-tokens` capability) AND outside the scene shell. Specifically, the 11 files listed in the `scene-2d-theme-tokens` capability AND `packages/ui-office/src/components/scene/SceneCanvas.tsx` SHALL NOT carry that header. The error-panel and fallback-badge surfaces of the scene shell are governed by the `scene-3d-performance-fallback` capability and consume `useSceneColors()` plus `@theme inline`-resolved Tailwind utilities.

Other files that today carry `// raw-hex-allowed-file:` (Studio canvas, ZoneCanvas, PrefabThumbnail, company-creation-wizard-preview, 3D mesh prefabs, `office3d-*.ts(x)`, `office3d-shared.ts`) keep the exemption pending separate scoped work.

The CI gate `pnpm tokens:lint-hex` SHALL enforce this rule. The gate SHALL print every offending file path, line, and matched literal, and SHALL exit non-zero on any match.

#### Scenario: Lint gate exits clean on a compliant tree

- **WHEN** running `pnpm tokens:lint-hex` on the post-migration codebase
- **THEN** the script exits with code 0 and prints a brief "no violations found" summary

#### Scenario: Lint gate catches a regression

- **WHEN** a developer adds `style={{ color: '#ff0000' }}` to any file under `packages/ui-office/src/` without the `// raw-hex-allowed` comment
- **THEN** `pnpm tokens:lint-hex` exits non-zero and the offending location appears in stdout

#### Scenario: Lint gate respects the line-level escape hatch

- **WHEN** a line reads `const PLACEHOLDER = '#abcdef'; // raw-hex-allowed`
- **THEN** the gate skips that line and does not report a violation

#### Scenario: SceneCanvas.tsx is no longer file-level exempt

- **WHEN** grepping `packages/ui-office/src/components/scene/SceneCanvas.tsx` for `^// raw-hex-allowed-file:`
- **THEN** zero matches exist
- **AND** `pnpm tokens:lint-hex` runs the full per-line gate over that file

#### Scenario: 2D office canvas files are no longer file-level exempt

- **WHEN** grepping the 11 files listed in the `scene-2d-theme-tokens` capability for `^// raw-hex-allowed-file:`
- **THEN** zero matches exist, and `pnpm tokens:lint-hex` runs the full per-line gate over those files

### Requirement: Studio inline-style consumers SHALL migrate from `studio-tokens.ts` to `@offisim/ui-core/tokens`

`packages/ui-office/src/components/studio/studio-tokens.ts` SHALL be deleted after consumers are migrated. Every Studio component that previously imported `STUDIO_COLORS`, `SP`, `FONT`, `LAYOUT`, `panelStyle`, `toolButtonStyle`, `kbdStyle`, `sectionHeaderStyle`, `labelStyle`, `valueStyle`, or `inputStyle` SHALL import its replacement from `@offisim/ui-core/tokens` (color / spacing / typography / radius / shadow tokens) plus a new `studio-style-helpers.ts` (or equivalent local module) for the Studio-specific style factories that compose multiple tokens.

The four Studio layout constants (`toolbarHeight`, `bottomBarHeight`, `paletteWidth`, `propertiesWidth`) are NOT design tokens — they SHALL move to a `STUDIO_LAYOUT` constant in a Studio-local file. They are excluded from the SSOT.

#### Scenario: Studio tokens file is gone

- **WHEN** listing `packages/ui-office/src/components/studio/`
- **THEN** the file `studio-tokens.ts` does not exist

#### Scenario: No Studio component imports the legacy file

- **WHEN** grepping `packages/ui-office/src/components/studio/**/*.{ts,tsx}` for `from '\.\/studio-tokens'`
- **THEN** zero matches exist

#### Scenario: Studio uses the unified accent

- **WHEN** rendering an active Studio toolbar tool
- **THEN** the active state background uses the unified `accentMuted` (derived from `--color-accent` blue `#3b82f6` in dark theme), not the legacy indigo `#6366f1`

### Requirement: Renderer 3D color exports SHALL re-export from the SSOT

`packages/renderer/src/tokens/colors.ts` SHALL re-export `STATE_COLORS` from `@offisim/ui-core/tokens` (specifically `STATE_COLORS_DARK` aliased as `STATE_COLORS` for back-compat with renderer-only consumers within this change). The renderer's `tokens/index.ts` continues to export `STATE_COLORS` so existing 3D consumer imports work without source-path edits.

Renderer consumers that need theme-aware 3D state colors SHALL import `STATE_COLORS_LIGHT` and `STATE_COLORS_DARK` directly from `@offisim/ui-core/tokens` and resolve the active variant at runtime.

#### Scenario: Renderer file re-exports

- **WHEN** reading `packages/renderer/src/tokens/colors.ts`
- **THEN** it contains a single re-export statement of the form `export { STATE_COLORS_DARK as STATE_COLORS } from '@offisim/ui-core/tokens';` (or the equivalent named alias) — no inline definition of `STATE_COLORS`

#### Scenario: Renderer index continues to export STATE_COLORS

- **WHEN** importing `import { STATE_COLORS } from '@offisim/renderer/tokens'`
- **THEN** the import succeeds and the value matches the dark numeric hex map
