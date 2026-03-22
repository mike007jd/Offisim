/**
 * Studio Design Tokens — centralized visual constants for all Studio components.
 *
 * Follows a 4px grid spacing system.
 * Dark theme with indigo accent, inspired by VS Code / Blender / Figma.
 * All Studio components MUST import from here instead of hardcoding values.
 */

// ---------------------------------------------------------------------------
// Colors
// ---------------------------------------------------------------------------

export const STUDIO_COLORS = {
  // Surfaces (darkest → lightest)
  bg: '#0a0a14',
  surface0: 'rgba(15, 15, 26, 0.97)',  // panels, overlays
  surface1: 'rgba(25, 25, 42, 0.95)',   // cards, inputs
  surface2: 'rgba(35, 35, 55, 0.9)',    // hover, elevated

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
  canvasBg: '#0f0f1a',
  gridMajor: '#555',
  gridMinor: '#333',
  plotBorder: '#6366f1',
  ghostValid: '#22c55e',
  ghostBlocked: '#ef4444',
} as const;

// ---------------------------------------------------------------------------
// Spacing (4px grid)
// ---------------------------------------------------------------------------

export const SP = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
  xxxl: 32,
} as const;

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
  paletteWidth: 220,
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
      return { ...base, left: 0, top: LAYOUT.toolbarHeight, bottom: LAYOUT.bottomBarHeight, width: LAYOUT.paletteWidth, borderRight: `1px solid ${STUDIO_COLORS.border}` };
    case 'right':
      return { ...base, right: 0, top: LAYOUT.toolbarHeight, bottom: LAYOUT.bottomBarHeight, width: LAYOUT.propertiesWidth, borderLeft: `1px solid ${STUDIO_COLORS.border}` };
    case 'top':
      return { ...base, left: 0, right: 0, top: 0, height: LAYOUT.toolbarHeight, flexDirection: 'row', alignItems: 'center', borderBottom: `1px solid ${STUDIO_COLORS.border}` };
    case 'bottom':
      return { ...base, left: 0, right: 0, bottom: 0, height: LAYOUT.bottomBarHeight, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', borderTop: `1px solid ${STUDIO_COLORS.border}` };
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
