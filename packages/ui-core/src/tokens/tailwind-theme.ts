import { BORDER_WIDTH } from './border.js';
import { LIGHT_SEMANTIC_COLORS, V3_COLORS } from './colors-semantic.js';
import { MOTION_DURATION, MOTION_EASING } from './motion.js';
import { RADIUS_SCALE } from './radius.js';
import { ELEVATION, SHADOW_SCALE } from './shadow.js';
import { SP_DENSITY, SPACING_SCALE } from './spacing.js';
import type { DensityMode } from './spacing.js';
import { FONT_FAMILY, FONT_SIZE_V3, LETTER_SPACING, TYPOGRAPHY_SCALE } from './typography.js';
import { Z_INDEX_SCALE } from './z-index.js';

export const TAILWIND_THEME_CSS_HEADER =
  '/* AUTO-GENERATED — DO NOT EDIT — source: packages/ui-core/src/tokens — commit:';

/** V3 app-shell heights (`--title` / `--toolbar`). */
export const SHELL_HEIGHTS = {
  title: 40,
  toolbar: 54,
} as const;

const TOKEN_NAME_OVERRIDES: Record<string, string> = {
  surfaceElevated: 'surface-elevated',
  surfaceMuted: 'surface-muted',
  surfaceHover: 'surface-hover',
  surfaceActive: 'surface-active',
  textPrimary: 'text-primary',
  textSecondary: 'text-secondary',
  textMuted: 'text-muted',
  textDisabled: 'text-disabled',
  textInverse: 'text-inverse',
  borderSubtle: 'border-subtle',
  borderDefault: 'border-default',
  borderStrong: 'border-strong',
  borderFocus: 'border-focus',
  accentHover: 'accent-hover',
  accentMuted: 'accent-muted',
  accentText: 'accent-text',
  successMuted: 'success-muted',
  warningMuted: 'warning-muted',
  errorMuted: 'error-muted',
  infoMuted: 'info-muted',
  glassBg: 'glass-bg',
  glassBorder: 'glass-border',
  statusIdle: 'status-idle',
  statusAssigned: 'status-assigned',
  statusThinking: 'status-thinking',
  statusSearching: 'status-searching',
  statusExecuting: 'status-executing',
  statusMeeting: 'status-meeting',
  statusBlocked: 'status-blocked',
  statusWaiting: 'status-waiting',
  statusReporting: 'status-reporting',
  statusSuccess: 'status-success',
  statusFailed: 'status-failed',
  statusPaused: 'status-paused',
};

const SHADOW_NAME_OVERRIDES: Record<string, string> = {
  glowAccent: 'glow-accent',
  glowSuccess: 'glow-success',
  glowWarning: 'glow-warning',
  glowError: 'glow-error',
};

const TYPOGRAPHY_NAME_OVERRIDES: Record<string, string> = {
  bodyLg: 'body-lg',
  bodySm: 'body-sm',
};

function cssName(key: string): string {
  return TOKEN_NAME_OVERRIDES[key] ?? key.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
}

function typographyName(key: string): string {
  return TYPOGRAPHY_NAME_OVERRIDES[key] ?? key;
}

function shadowName(key: string): string {
  return SHADOW_NAME_OVERRIDES[key] ?? key;
}

function appendEntries(
  lines: string[],
  entries: Iterable<[string, string | number]>,
  prefix: string,
) {
  for (const [key, value] of entries) {
    lines.push(`  --${prefix}-${key}: ${value};`);
  }
}

function semanticThemeLines() {
  return Object.keys(LIGHT_SEMANTIC_COLORS).map((key) => {
    const name = cssName(key);
    return `  --color-${name}: var(--color-${name}-val);`;
  });
}

function semanticValueLines(colors: typeof LIGHT_SEMANTIC_COLORS) {
  return Object.entries(colors).map(([key, value]) => `  --color-${cssName(key)}-val: ${value};`);
}

function shadowThemeLines() {
  return Object.keys(SHADOW_SCALE).map((key) => {
    const name = shadowName(key);
    return `  --shadow-${name}: var(--shadow-${name}-val);`;
  });
}

function shadowValueLines() {
  return Object.entries(SHADOW_SCALE).map(
    ([key, value]) => `  --shadow-${shadowName(key)}-val: ${value};`,
  );
}

/** V3-named Tailwind `@theme` keys referencing the V3 native `:root` variables. */
function v3ThemeKeys() {
  // `--color-<name>` resolves to the identically named `:root` variable.
  const colorNames = [
    'bg',
    'surface-0',
    'surface-1',
    'surface-2',
    'surface-sunken',
    'ink-1',
    'ink-2',
    'ink-3',
    'ink-4',
    'line',
    'line-soft',
    'line-strong',
    'accent',
    'accent-press',
    'accent-fg',
    'accent-surface',
    'accent-ring',
    'ok',
    'ok-surface',
    'warn',
    'warn-surface',
    'danger',
    'danger-surface',
    'violet',
    'violet-surface',
    'wiz-bg',
    'wiz-surface',
    'wiz-line',
    'wiz-line-2',
    'wiz-ink-1',
    'wiz-ink-2',
    'wiz-ink-3',
    'wiz-ink-4',
    'wiz-blue',
    'wiz-emerald',
  ];
  const radiusKeys = ['xs', 'sm', 'md', 'lg', 'xl', 'pill'];
  const fontSizeKeys = Object.keys(FONT_SIZE_V3);
  const densitySteps = Object.keys(SP_DENSITY.normal);
  return [
    ...colorNames.map((name) => `  --color-${name}: var(--${name});`),
    ...radiusKeys.map((k) => `  --radius-r-${k}: var(--r-${k});`),
    ...fontSizeKeys.map((k) => `  --text-fs-${k}: var(--fs-${k});`),
    '  --shadow-elev-1: var(--elev-1);',
    '  --shadow-elev-2: var(--elev-2);',
    '  --shadow-elev-3: var(--elev-3);',
    ...densitySteps.map((k) => `  --spacing-sp-${k}: var(--sp-${k});`),
  ];
}

/** V3 native CSS variables with literal values, declared in `:root`. */
function v3NativeVars() {
  const radiusKeys: Array<keyof typeof RADIUS_SCALE> = ['xs', 'sm', 'md', 'lg', 'xl', 'pill'];
  return [
    `  --bg: ${V3_COLORS.bg};`,
    `  --surface-0: ${V3_COLORS.surface0};`,
    `  --surface-1: ${V3_COLORS.surface1};`,
    `  --surface-2: ${V3_COLORS.surface2};`,
    `  --surface-sunken: ${V3_COLORS.surfaceSunken};`,
    `  --ink-1: ${V3_COLORS.ink1};`,
    `  --ink-2: ${V3_COLORS.ink2};`,
    `  --ink-3: ${V3_COLORS.ink3};`,
    `  --ink-4: ${V3_COLORS.ink4};`,
    `  --line: ${V3_COLORS.line};`,
    `  --line-soft: ${V3_COLORS.lineSoft};`,
    `  --line-strong: ${V3_COLORS.lineStrong};`,
    `  --accent: ${V3_COLORS.accent};`,
    `  --accent-press: ${V3_COLORS.accentPress};`,
    `  --accent-fg: ${V3_COLORS.accentFg};`,
    `  --accent-surface: ${V3_COLORS.accentSurface};`,
    `  --accent-ring: ${V3_COLORS.accentRing};`,
    `  --ok: ${V3_COLORS.ok};`,
    `  --ok-surface: ${V3_COLORS.okSurface};`,
    `  --warn: ${V3_COLORS.warn};`,
    `  --warn-surface: ${V3_COLORS.warnSurface};`,
    `  --danger: ${V3_COLORS.danger};`,
    `  --danger-surface: ${V3_COLORS.dangerSurface};`,
    `  --violet: ${V3_COLORS.violet};`,
    `  --violet-surface: ${V3_COLORS.violetSurface};`,
    ...radiusKeys.map((key) => `  --r-${key}: ${RADIUS_SCALE[key]}px;`),
    `  --elev-1: ${ELEVATION.elev1};`,
    `  --elev-2: ${ELEVATION.elev2};`,
    `  --elev-3: ${ELEVATION.elev3};`,
    ...Object.entries(FONT_SIZE_V3).map(([key, value]) => `  --fs-${key}: ${value}px;`),
    `  --ls-caps: ${LETTER_SPACING.caps};`,
    `  --title: ${SHELL_HEIGHTS.title}px;`,
    `  --toolbar: ${SHELL_HEIGHTS.toolbar}px;`,
  ];
}

/** Intentional-dark wizard tokens (emitted contract; consumed by Phase 8). */
function wizVars() {
  return [
    `  --wiz-bg: ${V3_COLORS.wizBg};`,
    `  --wiz-surface: ${V3_COLORS.wizSurface};`,
    `  --wiz-line: ${V3_COLORS.wizLine};`,
    `  --wiz-line-2: ${V3_COLORS.wizLine2};`,
    `  --wiz-ink-1: ${V3_COLORS.wizInk1};`,
    `  --wiz-ink-2: ${V3_COLORS.wizInk2};`,
    `  --wiz-ink-3: ${V3_COLORS.wizInk3};`,
    `  --wiz-ink-4: ${V3_COLORS.wizInk4};`,
    `  --wiz-blue: ${V3_COLORS.wizBlue};`,
    `  --wiz-emerald: ${V3_COLORS.wizEmerald};`,
  ];
}

function rootAliases() {
  return [
    '  --surface: var(--color-surface-val);',
    '  --surface-light: var(--color-surface-elevated-val);',
    '  --surface-lighter: var(--color-surface-muted-val);',
    '  --surface-mid: var(--color-surface-hover-val);',
    '  --border-val: var(--color-border-default-val);',
    '  --text-primary-val: var(--color-text-primary-val);',
    '  --text-secondary-val: var(--color-text-secondary-val);',
    '  --text-muted-val: var(--color-text-muted-val);',
    '  --accent-val: var(--color-accent-val);',
    '  --accent-hover-val: var(--color-accent-hover-val);',
    '  --success-val: var(--color-success-val);',
    '  --warning-val: var(--color-warning-val);',
    '  --error-val: var(--color-error-val);',
    '  --info-val: var(--color-info-val);',
    '  --glass-bg: var(--color-glass-bg-val);',
    '  --glass-border: var(--color-glass-border-val);',
    '  --scrollbar-thumb: color-mix(in srgb, var(--color-text-secondary-val) 22%, transparent);',
    '  --scrollbar-thumb-hover: color-mix(in srgb, var(--color-text-secondary-val) 42%, transparent);',
    '  --shimmer-duration: 1600ms;',
  ];
}

const LEGACY_DENSITY: Record<DensityMode, Record<string, number>> = {
  compact: { xs: 2, sm: 4, md: 8, lg: 12, xl: 16, xxl: 20, xxxl: 24 },
  spacious: { xs: 6, sm: 12, md: 16, lg: 20, xl: 28, xxl: 32, xxxl: 40 },
  normal: { xs: 4, sm: 8, md: 12, lg: 16, xl: 20, xxl: 24, xxxl: 32 },
};

function densityLines(mode: DensityMode) {
  return [
    ...Object.entries(SP_DENSITY[mode]).map(([key, value]) => `  --sp-${key}: ${value}px;`),
    ...Object.entries(LEGACY_DENSITY[mode]).map(([key, value]) => `  --sp-${key}: ${value}px;`),
  ];
}

export function emitTailwindThemeCss(commit = 'dev'): string {
  const themeLines = [
    ...semanticThemeLines(),
    ...shadowThemeLines(),
    ...Object.entries(SPACING_SCALE).map(([key, value]) => `  --spacing-${key}: ${value}px;`),
    ...Object.keys(LEGACY_DENSITY.normal).map((key) => `  --spacing-sp-${key}: var(--sp-${key});`),
    ...v3ThemeKeys(),
  ];

  appendEntries(
    themeLines,
    Object.entries(RADIUS_SCALE).map(([k, v]) => [k, `${v}px`]),
    'radius',
  );
  appendEntries(themeLines, Object.entries(Z_INDEX_SCALE), 'z');
  appendEntries(
    themeLines,
    Object.entries(MOTION_DURATION).map(([key, value]) => [key, `${value}ms`]),
    'duration',
  );
  appendEntries(themeLines, Object.entries(MOTION_EASING), 'ease');
  appendEntries(
    themeLines,
    Object.entries(BORDER_WIDTH).map(([key, value]) => [key, `${value}px`]),
    'border-width',
  );
  appendEntries(themeLines, Object.entries(FONT_FAMILY), 'font');

  for (const [role, token] of Object.entries(TYPOGRAPHY_SCALE)) {
    const name = typographyName(role);
    themeLines.push(`  --text-${name}: ${token.size}px;`);
    themeLines.push(`  --text-${name}--line-height: ${token.lineHeight};`);
    themeLines.push(`  --text-${name}--font-weight: ${token.weight};`);
    themeLines.push(`  --text-${name}--letter-spacing: ${token.letterSpacing};`);
  }

  const rootLight = [
    ...semanticValueLines(LIGHT_SEMANTIC_COLORS),
    ...shadowValueLines(),
    ...rootAliases(),
    ...v3NativeVars(),
    ...wizVars(),
    ...densityLines('normal'),
  ];

  return [
    `${TAILWIND_THEME_CSS_HEADER} ${commit} */`,
    '',
    '@theme inline {',
    ...themeLines,
    '}',
    '',
    ':root {',
    ...rootLight,
    '}',
    '',
    ':root[data-density="compact"] {',
    ...densityLines('compact'),
    '}',
    '',
    ':root[data-density="spacious"] {',
    ...densityLines('spacious'),
    '}',
    '',
  ].join('\n');
}
