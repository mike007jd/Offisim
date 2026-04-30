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
  sans: '"Inter", ui-sans-serif, system-ui, sans-serif',
  mono: '"JetBrains Mono", ui-monospace, SFMono-Regular, monospace',
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
