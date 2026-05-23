export interface SemanticColors {
  surface: string;
  surfaceElevated: string;
  surfaceMuted: string;
  surfaceHover: string;
  surfaceActive: string;
  textPrimary: string;
  textSecondary: string;
  textMuted: string;
  textDisabled: string;
  textInverse: string;
  borderSubtle: string;
  borderDefault: string;
  borderStrong: string;
  borderFocus: string;
  accent: string;
  accentHover: string;
  accentMuted: string;
  accentText: string;
  success: string;
  successMuted: string;
  warning: string;
  warningMuted: string;
  error: string;
  errorMuted: string;
  info: string;
  infoMuted: string;
  glassBg: string;
  glassBorder: string;
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

/**
 * Semantic color source of truth.
 *
 * `DARK_SEMANTIC_COLORS` is RETAINED unchanged for the intentional-dark surfaces
 * (Studio, character-mesh, office3d-sections, zone editor, wizard role-dot
 * fallback) that read it directly via the tokens subpath — they do not depend on
 * the `.dark` CSS class.
 *
 * `LIGHT_SEMANTIC_COLORS` field VALUES are revalued to the V3 palette so the
 * ~1500 existing semantic Tailwind utility usages render V3 colors without any
 * call-site change (field names are intentionally preserved). See
 * `V3_COLORS` for the native V3 palette consumed by new V3-named utilities.
 */
export const DARK_SEMANTIC_COLORS: SemanticColors = {
  surface: '#0c1118',
  surfaceElevated: '#151d2e',
  surfaceMuted: '#1e293b',
  surfaceHover: '#334155',
  surfaceActive: '#3b4862',
  textPrimary: '#f1f5f9',
  textSecondary: '#94a3b8',
  textMuted: '#64748b',
  textDisabled: '#475569',
  textInverse: '#0c1118',
  borderSubtle: 'rgba(255,255,255,0.06)',
  borderDefault: 'rgba(255,255,255,0.10)',
  borderStrong: 'rgba(255,255,255,0.18)',
  borderFocus: 'rgba(59,130,246,0.55)',
  accent: '#3b82f6',
  accentHover: '#2563eb',
  accentMuted: 'rgba(59,130,246,0.18)',
  accentText: '#93c5fd',
  success: '#10b981',
  successMuted: 'rgba(16,185,129,0.15)',
  warning: '#f59e0b',
  warningMuted: 'rgba(245,158,11,0.15)',
  error: '#ef4444',
  errorMuted: 'rgba(239,68,68,0.15)',
  info: '#3b82f6',
  infoMuted: 'rgba(59,130,246,0.15)',
  glassBg: 'rgba(0,0,0,0.40)',
  glassBorder: 'rgba(255,255,255,0.10)',
  statusIdle: '#94a3b8',
  statusAssigned: '#60a5fa',
  statusThinking: '#818cf8',
  statusSearching: '#c084fc',
  statusExecuting: '#34d399',
  statusMeeting: '#a78bfa',
  statusBlocked: '#f87171',
  statusWaiting: '#fbbf24',
  statusReporting: '#2dd4bf',
  statusSuccess: '#4ade80',
  statusFailed: '#ef4444',
  statusPaused: '#9ca3af',
};

export const LIGHT_SEMANTIC_COLORS: SemanticColors = {
  surface: '#f7f9fc',
  surfaceElevated: '#ffffff',
  surfaceMuted: '#f1f4f9',
  surfaceHover: '#f1f4f9',
  surfaceActive: '#e9edf4',
  textPrimary: '#131a27',
  textSecondary: '#3c4a60',
  textMuted: '#647186',
  textDisabled: '#93a0b2',
  textInverse: '#ffffff',
  borderSubtle: '#e9edf4',
  borderDefault: '#dde3ec',
  borderStrong: '#c8d1de',
  borderFocus: 'rgba(47,107,255,0.36)',
  accent: '#2f6bff',
  accentHover: '#1f54d8',
  accentMuted: '#ecf2ff',
  accentText: '#1f54d8',
  success: '#1aa46a',
  successMuted: '#e4f5ec',
  warning: '#c98410',
  warningMuted: '#fdf2dd',
  error: '#d6453d',
  errorMuted: '#fdeae9',
  info: '#2f6bff',
  infoMuted: '#ecf2ff',
  glassBg: 'rgba(255,255,255,0.82)',
  glassBorder: '#dde3ec',
  statusIdle: '#647186',
  statusAssigned: '#2f6bff',
  statusThinking: '#7c4ddb',
  statusSearching: '#7c4ddb',
  statusExecuting: '#1aa46a',
  statusMeeting: '#7c4ddb',
  statusBlocked: '#d6453d',
  statusWaiting: '#c98410',
  statusReporting: '#2f6bff',
  statusSuccess: '#1aa46a',
  statusFailed: '#d6453d',
  statusPaused: '#647186',
};

/**
 * V3 native palette (verbatim from the V3 prototype `:root`). New V3-named
 * Tailwind keys and CSS variables resolve to these values; the legacy
 * `*_SEMANTIC_COLORS` names above are the back-compat layer that re-points the
 * existing utilities onto the same V3 values.
 *
 * The `wiz*` entries are the intentional-dark wizard tokens. Phase 0 only EMITS
 * them (as the `--wiz-*` contract); the lifecycle wizard component migration
 * onto them is owned by Phase 8 (`rebuild-lifecycle-dialogs-v3`).
 */
export const V3_COLORS = {
  bg: '#eef1f6',
  surface0: '#f7f9fc',
  surface1: '#ffffff',
  surface2: '#fbfcfe',
  surfaceSunken: '#f1f4f9',
  ink1: '#131a27',
  ink2: '#3c4a60',
  ink3: '#647186',
  ink4: '#93a0b2',
  line: '#dde3ec',
  lineSoft: '#e9edf4',
  lineStrong: '#c8d1de',
  accent: '#2f6bff',
  accentPress: '#1f54d8',
  accentFg: '#ffffff',
  accentSurface: '#ecf2ff',
  accentRing: 'rgba(47,107,255,0.36)',
  ok: '#1aa46a',
  okSurface: '#e4f5ec',
  warn: '#c98410',
  warnSurface: '#fdf2dd',
  danger: '#d6453d',
  dangerSurface: '#fdeae9',
  violet: '#7c4ddb',
  violetSurface: '#f1ebfd',
  wizBg: '#0c1019',
  wizSurface: 'rgba(255,255,255,0.02)',
  wizLine: 'rgba(255,255,255,0.06)',
  wizLine2: 'rgba(255,255,255,0.10)',
  wizInk1: '#ffffff',
  wizInk2: '#c4cdde',
  wizInk3: '#8b97ad',
  wizInk4: '#5a6577',
  wizBlue: '#3b82f6',
  wizEmerald: '#34d399',
} as const;

export type V3ColorName = keyof typeof V3_COLORS;

export function getSemanticColors(theme: 'light' | 'dark'): SemanticColors {
  return theme === 'light' ? LIGHT_SEMANTIC_COLORS : DARK_SEMANTIC_COLORS;
}
