import type { CSSProperties } from 'react';

import {
  CATEGORY_COLORS_DARK,
  CATEGORY_COLORS_LIGHT,
  DARK_SEMANTIC_COLORS,
  FONT_FAMILY,
  LIGHT_SEMANTIC_COLORS,
  MOTION_DURATION,
  MOTION_EASING,
  RADIUS_SCALE,
  SPACING_SCALE,
  TYPOGRAPHY_SCALE,
  Z_INDEX_SCALE,
} from '@offisim/ui-core/tokens';

let cachedIsLight: boolean | null = null;

function isLightStudioTheme(): boolean {
  if (cachedIsLight !== null) return cachedIsLight;
  if (typeof document === 'undefined') return false;
  const root = document.documentElement;
  cachedIsLight = root.classList.contains('light') || root.dataset.theme === 'light';
  return cachedIsLight;
}

function semanticColors() {
  return isLightStudioTheme() ? LIGHT_SEMANTIC_COLORS : DARK_SEMANTIC_COLORS;
}

function categoryColors() {
  return isLightStudioTheme() ? CATEGORY_COLORS_LIGHT : CATEGORY_COLORS_DARK;
}

if (typeof window !== 'undefined') {
  const resetThemeCache = () => {
    cachedIsLight = null;
  };
  window.addEventListener('offisim.theme.change', resetThemeCache);
  window.addEventListener('offisim.density.change', resetThemeCache);
}

export const STUDIO_COLORS = {
  get bg() {
    return semanticColors().surface;
  },
  get surface0() {
    return semanticColors().surfaceElevated;
  },
  get surface1() {
    return semanticColors().surfaceMuted;
  },
  get surface2() {
    return semanticColors().surfaceHover;
  },

  get border() {
    return semanticColors().borderDefault;
  },
  get borderSubtle() {
    return semanticColors().borderSubtle;
  },
  get borderActive() {
    return semanticColors().borderFocus;
  },

  get textPrimary() {
    return semanticColors().textPrimary;
  },
  get textSecondary() {
    return semanticColors().textSecondary;
  },
  get textTertiary() {
    return semanticColors().textMuted;
  },
  get textDisabled() {
    return semanticColors().textDisabled;
  },
  get textInverse() {
    return semanticColors().textInverse;
  },

  get accent() {
    return semanticColors().accent;
  },
  get accentHover() {
    return semanticColors().accentHover;
  },
  get accentMuted() {
    return semanticColors().accentMuted;
  },
  get accentText() {
    return semanticColors().accentText;
  },

  get success() {
    return semanticColors().success;
  },
  get successMuted() {
    return semanticColors().successMuted;
  },
  get error() {
    return semanticColors().error;
  },
  get errorMuted() {
    return semanticColors().errorMuted;
  },
  get warning() {
    return semanticColors().warning;
  },
  get warningMuted() {
    return semanticColors().warningMuted;
  },
  get info() {
    return semanticColors().info;
  },

  get catWorkspace() {
    return categoryColors().workspace;
  },
  get catCompute() {
    return categoryColors().compute;
  },
  get catKnowledge() {
    return categoryColors().knowledge;
  },
  get catCollaboration() {
    return categoryColors().collaboration;
  },
  get catInfrastructure() {
    return categoryColors().infrastructure;
  },
  get catDecorative() {
    return categoryColors().decorative;
  },

  get canvasBg() {
    return semanticColors().surface;
  },
  get gridMajor() {
    return semanticColors().textMuted;
  },
  get gridMinor() {
    return semanticColors().surfaceHover;
  },
  get plotBorder() {
    return semanticColors().accent;
  },
  get ghostValid() {
    return semanticColors().success;
  },
  get ghostBlocked() {
    return semanticColors().error;
  },
} as const;

const SP_DEFAULTS = {
  xs: SPACING_SCALE[1],
  sm: SPACING_SCALE[2],
  md: SPACING_SCALE[3],
  lg: SPACING_SCALE[4],
  xl: SPACING_SCALE[5],
  xxl: SPACING_SCALE[6],
  xxxl: SPACING_SCALE[8],
} as const;

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

// ThemeProvider dispatches `offisim.density.change` whenever the data-density
// attribute is rewritten; we drop the SP cache so the next read re-samples the
// updated CSS variables. (Module-level listener is fine — single attach for the
// entire app session.)
if (typeof window !== 'undefined') {
  window.addEventListener('offisim.density.change', invalidateSpCache);
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

export const FONT = {
  family: FONT_FAMILY.sans,
  mono: FONT_FAMILY.mono,

  xs: TYPOGRAPHY_SCALE.caption.size - 2,
  sm: TYPOGRAPHY_SCALE.caption.size - 1,
  base: TYPOGRAPHY_SCALE.caption.size,
  md: TYPOGRAPHY_SCALE.bodySm.size,
  lg: TYPOGRAPHY_SCALE.bodySm.size + 1,
  xl: TYPOGRAPHY_SCALE.body.size,
  xxl: TYPOGRAPHY_SCALE.bodyLg.size,

  normal: TYPOGRAPHY_SCALE.body.weight,
  medium: TYPOGRAPHY_SCALE.caption.weight,
  semibold: TYPOGRAPHY_SCALE.h3.weight,
  bold: TYPOGRAPHY_SCALE.h2.weight + 100,
  black: 900,
} as const;

export const STUDIO_LAYOUT = {
  toolbarHeight: 44,
  bottomBarHeight: 40,
  paletteWidth: 240,
  propertiesWidth: 240,
  panelRadius: RADIUS_SCALE.none,
  cardRadius: RADIUS_SCALE.sm + 2,
  buttonRadius: RADIUS_SCALE.sm,
} as const;

export const LAYOUT = STUDIO_LAYOUT;

export const STUDIO_Z_INDEX = {
  elevated: Z_INDEX_SCALE.elevated,
  sticky: Z_INDEX_SCALE.sticky,
  dropdown: Z_INDEX_SCALE.dropdown,
  modal: Z_INDEX_SCALE.modal,
} as const;

const fastTransition = `background ${MOTION_DURATION.instant}ms ${MOTION_EASING.standard}, color ${MOTION_DURATION.instant}ms ${MOTION_EASING.standard}`;
const inputTransition = `background ${MOTION_DURATION.instant}ms ${MOTION_EASING.standard}, border-color ${MOTION_DURATION.instant}ms ${MOTION_EASING.standard}`;

export const STUDIO_TRANSITION = {
  allFast: `all ${MOTION_DURATION.fast}ms ${MOTION_EASING.standard}`,
  backgroundInstant: `background ${MOTION_DURATION.instant}ms ${MOTION_EASING.standard}`,
  colorBorderFast: `color ${MOTION_DURATION.fast}ms ${MOTION_EASING.standard}, border-color ${MOTION_DURATION.fast}ms ${MOTION_EASING.standard}`,
  transformFast: `transform ${MOTION_DURATION.fast}ms ${MOTION_EASING.standard}`,
} as const;

export function panelStyle(side: 'left' | 'right' | 'top' | 'bottom'): CSSProperties {
  const base: CSSProperties = {
    position: 'absolute',
    background: STUDIO_COLORS.surface0,
    fontFamily: FONT.family,
    zIndex: Z_INDEX_SCALE.sticky,
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

export function toolButtonStyle(active: boolean): CSSProperties {
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
    transition: fastTransition,
  };
}

export function kbdStyle(): CSSProperties {
  return {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 18,
    height: 18,
    padding: `0 ${SP.xs}px`,
    borderRadius: RADIUS_SCALE.sm - 1,
    background: STUDIO_COLORS.surface1,
    border: `1px solid ${STUDIO_COLORS.borderSubtle}`,
    color: STUDIO_COLORS.textTertiary,
    fontSize: FONT.xs,
    fontFamily: FONT.mono,
    lineHeight: 1,
  };
}

export function sectionHeaderStyle(): CSSProperties {
  return {
    padding: `${SP.sm}px ${SP.md}px`,
    fontSize: FONT.sm,
    fontWeight: FONT.black,
    letterSpacing: 0,
    textTransform: 'uppercase' as const,
    color: STUDIO_COLORS.textTertiary,
    borderBottom: `1px solid ${STUDIO_COLORS.border}`,
    flexShrink: 0,
  };
}

export function labelStyle(): CSSProperties {
  return {
    fontSize: FONT.xs,
    fontWeight: FONT.semibold,
    letterSpacing: 0,
    textTransform: 'uppercase' as const,
    color: STUDIO_COLORS.textTertiary,
    marginBottom: SP.xs,
  };
}

export function valueStyle(): CSSProperties {
  return {
    fontSize: FONT.md,
    fontFamily: FONT.mono,
    color: STUDIO_COLORS.textPrimary,
  };
}

export function inputStyle(focused: boolean): CSSProperties {
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
    transition: inputTransition,
  };
}
