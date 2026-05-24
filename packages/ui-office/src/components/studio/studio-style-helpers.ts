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

// Studio is an intentional-dark surface (DNA §11): it stays dark regardless of
// the app theme. Pinned to `false` so it reads `DARK_SEMANTIC_COLORS` even now
// that the app root always carries the `.light` class (V3 is light-only). Do not
// re-couple this to the document `.light`/`data-theme` class.
function isLightStudioTheme(): boolean {
  return false;
}

function semanticColors() {
  return isLightStudioTheme() ? LIGHT_SEMANTIC_COLORS : DARK_SEMANTIC_COLORS;
}

function categoryColors() {
  return isLightStudioTheme() ? CATEGORY_COLORS_LIGHT : CATEGORY_COLORS_DARK;
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

export const STUDIO_TRANSITION = {
  allFast: `all ${MOTION_DURATION.fast}ms ${MOTION_EASING.standard}`,
  backgroundInstant: `background ${MOTION_DURATION.instant}ms ${MOTION_EASING.standard}`,
  colorBorderFast: `color ${MOTION_DURATION.fast}ms ${MOTION_EASING.standard}, border-color ${MOTION_DURATION.fast}ms ${MOTION_EASING.standard}`,
  transformFast: `transform ${MOTION_DURATION.fast}ms ${MOTION_EASING.standard}`,
} as const;

export const STUDIO_PANEL_CLASS = {
  left: 'absolute bottom-10 left-0 top-11 z-sticky flex w-60 flex-col overflow-hidden border-r border-line bg-surface-1',
  right:
    'absolute bottom-10 right-0 top-11 z-sticky flex w-60 flex-col overflow-hidden border-l border-line bg-surface-1',
  top: 'absolute inset-x-0 top-0 z-sticky flex h-11 flex-row items-center overflow-hidden border-b border-line bg-surface-1',
  bottom:
    'absolute inset-x-0 bottom-0 z-sticky flex h-10 flex-row items-center justify-center overflow-hidden border-t border-line bg-surface-1',
} as const;

export const STUDIO_LABEL_CLASS =
  'mb-1 shrink-0 text-fs-micro font-semibold uppercase tracking-ls-caps text-ink-3';
export const STUDIO_VALUE_CLASS = 'font-mono text-fs-sm text-ink-1';
export const STUDIO_SECTION_HEADER_CLASS =
  'shrink-0 border-b border-line px-sp-3 py-sp-2 text-fs-micro font-black uppercase tracking-ls-caps text-ink-3';
export const STUDIO_KBD_CLASS =
  'inline-flex h-4 min-w-4 items-center justify-center rounded-r-xs border border-line-soft bg-surface-2 px-1 font-mono text-fs-micro leading-none text-ink-3';

export function studioToolButtonClass(active: boolean): string {
  return active
    ? 'gap-sp-1 border-0 bg-accent-surface text-accent hover:bg-accent-surface'
    : 'gap-sp-1 border-0 bg-transparent text-ink-2 hover:bg-surface-sunken hover:text-ink-1';
}

export function studioInputClass(focused: boolean): string {
  return focused
    ? 'h-8 rounded-r-sm border-line-strong bg-surface-2 px-sp-2 text-fs-sm text-ink-1 outline-none transition-colors'
    : 'h-8 rounded-r-sm border-line-soft bg-transparent px-sp-2 text-fs-sm text-ink-1 outline-none transition-colors';
}
