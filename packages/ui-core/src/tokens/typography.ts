export type TypographyRole =
  | 'display'
  | 'h1'
  | 'h2'
  | 'h3'
  | 'bodyLg'
  | 'body'
  | 'bodySm'
  | 'caption'
  | 'mono';

export interface TypographyToken {
  family: 'sans' | 'mono';
  size: number;
  weight: number;
  lineHeight: number;
  letterSpacing: string;
}

export const FONT_FAMILY = {
  sans: '"General Sans", ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  mono: 'ui-monospace, "SF Mono", "JetBrains Mono", Menlo, monospace',
} as const;

/** V3 product type scale (px). No `2xl` — that is reserved for dialog hero only. */
export const FONT_SIZE_V3: Record<'micro' | 'meta' | 'sm' | 'base' | 'md' | 'lg' | 'xl', number> = {
  micro: 10,
  meta: 11,
  sm: 12,
  base: 13,
  md: 14,
  lg: 15,
  xl: 19,
};

export const LETTER_SPACING = {
  caps: '0.14em',
} as const;

/**
 * Studio FONT mapping: xs/sm/base -> caption, md/lg -> bodySm,
 * xl -> body, xxl -> bodyLg.
 */
export const TYPOGRAPHY_SCALE: Record<TypographyRole, TypographyToken> = {
  display: { family: 'sans', size: 32, weight: 700, lineHeight: 1.15, letterSpacing: '0' },
  h1: { family: 'sans', size: 24, weight: 700, lineHeight: 1.2, letterSpacing: '0' },
  h2: { family: 'sans', size: 20, weight: 600, lineHeight: 1.3, letterSpacing: '0' },
  h3: { family: 'sans', size: 16, weight: 600, lineHeight: 1.4, letterSpacing: '0' },
  bodyLg: { family: 'sans', size: 16, weight: 400, lineHeight: 1.5, letterSpacing: '0' },
  body: { family: 'sans', size: 14, weight: 400, lineHeight: 1.5, letterSpacing: '0' },
  bodySm: { family: 'sans', size: 12, weight: 400, lineHeight: 1.45, letterSpacing: '0' },
  caption: { family: 'sans', size: 11, weight: 500, lineHeight: 1.4, letterSpacing: '0.02em' },
  mono: { family: 'mono', size: 12, weight: 400, lineHeight: 1.5, letterSpacing: '0' },
};
