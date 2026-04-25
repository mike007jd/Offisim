/**
 * Studio Design Tokens — centralized visual constants for all Studio components.
 *
 * Spacing reads from global density CSS variables when available, with static
 * fallbacks for SSR and tests that don't mount the full app shell.
 */

// ---------------------------------------------------------------------------
// Colors
// ---------------------------------------------------------------------------

export const STUDIO_COLORS = {
  // Surfaces (darkest → lightest)
  bg: '#0c1118',
  surface0: 'rgba(17, 24, 39, 0.97)', // panels, overlays
  surface1: 'rgba(30, 41, 59, 0.95)', // cards, inputs
  surface2: 'rgba(35, 35, 55, 0.9)', // hover, elevated

  // Borders
  border: '#2a2a3d',
  borderSubtle: 'rgba(42, 42, 61, 0.5)',
  borderActive: 'rgba(99, 102, 241, 0.5)',

  // Text hierarchy
  textPrimary: '#e2e8f0',
  textSecondary: '#94a3b8',
  textTertiary: '#64748b',
  textDisabled: '#475569',

  // Accent (indigo)
  accent: '#6366f1',
  accentHover: '#818cf8',
  accentMuted: 'rgba(99, 102, 241, 0.2)',
  accentText: '#a5b4fc',

  // Semantic
  success: '#22c55e',
  successMuted: 'rgba(34, 197, 94, 0.15)',
  error: '#ef4444',
  errorMuted: 'rgba(239, 68, 68, 0.15)',
  warning: '#f59e0b',
  warningMuted: 'rgba(245, 158, 11, 0.15)',
  info: '#3b82f6',

  // Category colors (for prefab palette icons)
  catWorkspace: '#60a5fa',
  catCompute: '#f97316',
  catKnowledge: '#a78bfa',
  catCollaboration: '#34d399',
  catInfrastructure: '#facc15',
  catDecorative: '#4ade80',

  // 3D scene
  canvasBg: '#111827',
  gridMajor: '#555',
  gridMinor: '#333',
  plotBorder: '#6366f1',
  ghostValid: '#22c55e',
  ghostBlocked: '#ef4444',
} as const;

// ---------------------------------------------------------------------------
// Spacing (4px grid)
// ---------------------------------------------------------------------------

const SP_DEFAULTS = { xs: 4, sm: 8, md: 12, lg: 16, xl: 20, xxl: 24, xxxl: 32 } as const;

let spCache: Record<string, number> | null = null;

function readSpCache(): Record<string, number> {
  if (spCache) return spCache;
  if (typeof document === 'undefined') return SP_DEFAULTS;
  const style = window.getComputedStyle(document.documentElement);
  const result: Record<string, number> = {};
  for (const [key, fallback] of Object.entries(SP_DEFAULTS)) {
    const raw = style.getPropertyValue(`--sp-${key}`).trim();
    const parsed = Number.parseInt(raw, 10);
    result[key] = Number.isFinite(parsed) ? parsed : fallback;
  }
  spCache = result;
  return result;
}

/** Call after density changes to pick up new CSS variable values. */
export function invalidateSpCache(): void {
  spCache = null;
}

export const SP = {
  get xs() {
    return readSpCache().xs ?? SP_DEFAULTS.xs;
  },
  get sm() {
    return readSpCache().sm ?? SP_DEFAULTS.sm;
  },
  get md() {
    return readSpCache().md ?? SP_DEFAULTS.md;
  },
  get lg() {
    return readSpCache().lg ?? SP_DEFAULTS.lg;
  },
  get xl() {
    return readSpCache().xl ?? SP_DEFAULTS.xl;
  },
  get xxl() {
    return readSpCache().xxl ?? SP_DEFAULTS.xxl;
  },
  get xxxl() {
    return readSpCache().xxxl ?? SP_DEFAULTS.xxxl;
  },
};

// ---------------------------------------------------------------------------
// Typography
// ---------------------------------------------------------------------------

export const FONT = {
  family: 'Inter, system-ui, -apple-system, sans-serif',
  mono: 'JetBrains Mono, Menlo, monospace',

  // Sizes
  xs: 9,
  sm: 10,
  base: 11,
  md: 12,
  lg: 13,
  xl: 14,
  xxl: 16,

  // Weights
  normal: 400,
  medium: 500,
  semibold: 600,
  bold: 700,
  black: 900,
} as const;

// ---------------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------------

export const LAYOUT = {
  toolbarHeight: 44,
  bottomBarHeight: 40,
  paletteWidth: 240,
  propertiesWidth: 240,
  panelRadius: 0,
  cardRadius: 6,
  buttonRadius: 4,
} as const;

// ---------------------------------------------------------------------------
// Shared style factories
// ---------------------------------------------------------------------------

export function panelStyle(side: 'left' | 'right' | 'top' | 'bottom'): React.CSSProperties {
  const base: React.CSSProperties = {
    position: 'absolute',
    background: STUDIO_COLORS.surface0,
    fontFamily: FONT.family,
    zIndex: 20,
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
  };

  switch (side) {
    case 'left':
      return {
        ...base,
        left: 0,
        top: LAYOUT.toolbarHeight,
        bottom: LAYOUT.bottomBarHeight,
        width: LAYOUT.paletteWidth,
        borderRight: `1px solid ${STUDIO_COLORS.border}`,
      };
    case 'right':
      return {
        ...base,
        right: 0,
        top: LAYOUT.toolbarHeight,
        bottom: LAYOUT.bottomBarHeight,
        width: LAYOUT.propertiesWidth,
        borderLeft: `1px solid ${STUDIO_COLORS.border}`,
      };
    case 'top':
      return {
        ...base,
        left: 0,
        right: 0,
        top: 0,
        height: LAYOUT.toolbarHeight,
        flexDirection: 'row',
        alignItems: 'center',
        borderBottom: `1px solid ${STUDIO_COLORS.border}`,
      };
    case 'bottom':
      return {
        ...base,
        left: 0,
        right: 0,
        bottom: 0,
        height: LAYOUT.bottomBarHeight,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        borderTop: `1px solid ${STUDIO_COLORS.border}`,
      };
  }
}

export function toolButtonStyle(active: boolean): React.CSSProperties {
  return {
    display: 'flex',
    alignItems: 'center',
    gap: SP.xs,
    padding: `${SP.xs}px ${SP.sm}px`,
    borderRadius: LAYOUT.buttonRadius,
    border: 'none',
    cursor: 'pointer',
    background: active ? STUDIO_COLORS.accentMuted : 'transparent',
    color: active ? STUDIO_COLORS.accentText : STUDIO_COLORS.textSecondary,
    fontSize: FONT.base,
    fontWeight: FONT.medium,
    fontFamily: FONT.family,
    transition: 'background 0.1s, color 0.1s',
  };
}

export function kbdStyle(): React.CSSProperties {
  return {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 18,
    height: 18,
    padding: `0 ${SP.xs}px`,
    borderRadius: 3,
    background: 'rgba(255,255,255,0.06)',
    border: `1px solid ${STUDIO_COLORS.borderSubtle}`,
    color: STUDIO_COLORS.textTertiary,
    fontSize: FONT.xs,
    fontFamily: FONT.mono,
    lineHeight: 1,
  };
}

export function sectionHeaderStyle(): React.CSSProperties {
  return {
    padding: `${SP.sm}px ${SP.md}px`,
    fontSize: FONT.sm,
    fontWeight: FONT.black,
    letterSpacing: 1.5,
    textTransform: 'uppercase' as const,
    color: STUDIO_COLORS.textTertiary,
    borderBottom: `1px solid ${STUDIO_COLORS.border}`,
    flexShrink: 0,
  };
}

export function labelStyle(): React.CSSProperties {
  return {
    fontSize: FONT.xs,
    fontWeight: FONT.semibold,
    letterSpacing: 0.5,
    textTransform: 'uppercase' as const,
    color: STUDIO_COLORS.textTertiary,
    marginBottom: SP.xs,
  };
}

export function valueStyle(): React.CSSProperties {
  return {
    fontSize: FONT.md,
    fontFamily: FONT.mono,
    color: STUDIO_COLORS.textPrimary,
  };
}

export function inputStyle(focused: boolean): React.CSSProperties {
  return {
    height: 32,
    padding: `0 ${SP.sm}px`,
    background: focused ? STUDIO_COLORS.surface1 : 'transparent',
    border: `1px solid ${focused ? STUDIO_COLORS.borderActive : STUDIO_COLORS.borderSubtle}`,
    borderRadius: LAYOUT.buttonRadius,
    color: STUDIO_COLORS.textPrimary,
    fontSize: FONT.md,
    fontFamily: FONT.family,
    outline: 'none',
    transition: 'background 0.1s, border-color 0.1s',
  };
}
