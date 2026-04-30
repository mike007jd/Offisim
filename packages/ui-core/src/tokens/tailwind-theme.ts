import { BORDER_WIDTH } from './border.js';
import { DARK_SEMANTIC_COLORS, LIGHT_SEMANTIC_COLORS } from './colors-semantic.js';
import { MOTION_DURATION, MOTION_EASING } from './motion.js';
import { RADIUS_SCALE } from './radius.js';
import { SHADOW_SCALE_DARK, SHADOW_SCALE_LIGHT } from './shadow.js';
import { SPACING_SCALE } from './spacing.js';
import { FONT_FAMILY, TYPOGRAPHY_SCALE } from './typography.js';
import { Z_INDEX_SCALE } from './z-index.js';

export const TAILWIND_THEME_CSS_HEADER =
  '/* AUTO-GENERATED — DO NOT EDIT — source: packages/ui-core/src/tokens — commit:';

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
  return Object.keys(SHADOW_SCALE_LIGHT).map((key) => {
    const name = shadowName(key);
    return `  --shadow-${name}: var(--shadow-${name}-val);`;
  });
}

function shadowValueLines(shadows: typeof SHADOW_SCALE_LIGHT) {
  return Object.entries(shadows).map(
    ([key, value]) => `  --shadow-${shadowName(key)}-val: ${value};`,
  );
}

function legacyThemeAliases() {
  return [
    ['hud-black', 'surface'],
    ['hud-dark', 'surface-elevated'],
    ['hud-mid', 'surface-muted'],
    ['hud-light', 'surface-hover'],
    ['hud-lighter', 'text-disabled'],
    ['hud-border', 'border-default'],
    ['ocean-deep', 'surface-elevated'],
    ['ocean-mid', 'surface-muted'],
    ['ocean-light', 'surface-hover'],
    ['sand', 'text-primary'],
    ['shell', 'text-secondary'],
    ['lobster-red', 'error'],
    ['coral-orange', 'warning'],
    ['kelp-green', 'success'],
    ['sea-blue', 'accent'],
    ['abyss', 'surface'],
    ['pearl', 'text-inverse'],
    ['foam', 'surface-active'],
    ['coral', 'warning'],
  ].map(([alias, target]) => `  --color-${alias}: var(--color-${target}-val);`);
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

function densityLines(mode: 'normal' | 'compact' | 'spacious') {
  const values =
    mode === 'compact'
      ? { xs: 2, sm: 4, md: 8, lg: 12, xl: 16, xxl: 20, xxxl: 24 }
      : mode === 'spacious'
        ? { xs: 6, sm: 12, md: 16, lg: 20, xl: 28, xxl: 32, xxxl: 40 }
        : { xs: 4, sm: 8, md: 12, lg: 16, xl: 20, xxl: 24, xxxl: 32 };
  return Object.entries(values).map(([key, value]) => `  --sp-${key}: ${value}px;`);
}

export function emitTailwindThemeCss(commit = 'dev'): string {
  const themeLines = [
    ...semanticThemeLines(),
    ...legacyThemeAliases(),
    ...shadowThemeLines(),
    ...Object.entries(SPACING_SCALE).map(([key, value]) => `  --spacing-${key}: ${value}px;`),
    '  --spacing-sp-xs: var(--sp-xs);',
    '  --spacing-sp-sm: var(--sp-sm);',
    '  --spacing-sp-md: var(--sp-md);',
    '  --spacing-sp-lg: var(--sp-lg);',
    '  --spacing-sp-xl: var(--sp-xl);',
    '  --spacing-sp-xxl: var(--sp-xxl);',
    '  --spacing-sp-xxxl: var(--sp-xxxl);',
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
    ...shadowValueLines(SHADOW_SCALE_LIGHT),
    ...rootAliases(),
    ...densityLines('normal'),
  ];
  const rootDark = [
    ...semanticValueLines(DARK_SEMANTIC_COLORS),
    ...shadowValueLines(SHADOW_SCALE_DARK),
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
    ':root.dark {',
    ...rootDark,
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
