// ---------------------------------------------------------------------------
// SVG Part Generators — illustration-grade character components
//
// Each function returns an SVG string with gradients and bezier curves.
// Colors are passed as hex strings (e.g., '#f5d0a9').
// All parts use a 64×64 viewport for consistent assembly.
// ---------------------------------------------------------------------------

// ── Heads ──────────────────────────────────────────────────────────────────

export type HeadShape = 'round' | 'oval' | 'soft-square';

export function generateHead(shape: HeadShape, skinColor: string): string {
  const darker = darken(skinColor, 15);
  const lighter = lighten(skinColor, 10);

  const paths: Record<HeadShape, string> = {
    round: 'M 18,35 C 18,18 28,10 32,10 C 36,10 46,18 46,35 C 46,48 40,52 32,52 C 24,52 18,48 18,35 Z',
    oval: 'M 19,36 C 19,19 27,9 32,9 C 37,9 45,19 45,36 C 45,50 39,54 32,54 C 25,54 19,50 19,36 Z',
    'soft-square': 'M 20,33 C 20,20 24,14 32,14 C 40,14 44,20 44,33 C 44,46 40,51 32,51 C 24,51 20,46 20,33 Z',
  };

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="64" height="64">
  <defs>
    <radialGradient id="hg" cx="40%" cy="35%" r="55%">
      <stop offset="0%" stop-color="${lighter}"/>
      <stop offset="80%" stop-color="${skinColor}"/>
      <stop offset="100%" stop-color="${darker}"/>
    </radialGradient>
  </defs>
  <path d="${paths[shape]}" fill="url(#hg)" stroke="${darker}" stroke-width="0.8"/>
  <!-- subtle cheek blush -->
  <ellipse cx="24" cy="38" rx="4" ry="2.5" fill="#e8a0a0" opacity="0.2"/>
  <ellipse cx="40" cy="38" rx="4" ry="2.5" fill="#e8a0a0" opacity="0.2"/>
</svg>`;
}

// ── Hair ───────────────────────────────────────────────────────────────────

export type HairStyle = 'short-messy' | 'short-neat' | 'long-straight' | 'curly' | 'ponytail' | 'bob' | 'bald';

export function generateHair(style: HairStyle, color: string): string {
  const darker = darken(color, 20);
  const highlight = lighten(color, 15);

  if (style === 'bald') return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="64" height="64"/>`;

  const styles: Record<Exclude<HairStyle, 'bald'>, string> = {
    'short-messy': `
      <path d="M 17,28 C 16,14 26,7 32,7 C 38,7 48,14 47,28 C 44,12 20,12 17,28 Z" fill="url(#hgrad)"/>
      <path d="M 20,15 C 22,9 30,7 35,8" fill="none" stroke="${highlight}" stroke-width="1.5" opacity="0.4"/>
      <path d="M 45,20 C 47,16 46,12 44,11" fill="none" stroke="${darker}" stroke-width="1" opacity="0.3"/>
      <!-- messy tufts -->
      <path d="M 19,14 C 17,10 20,7 23,8" fill="${color}" stroke="none"/>
      <path d="M 43,12 C 46,8 47,10 45,13" fill="${color}" stroke="none"/>`,

    'short-neat': `
      <path d="M 18,28 C 17,15 26,8 32,8 C 38,8 47,15 46,28 C 45,16 19,16 18,28 Z" fill="url(#hgrad)"/>
      <path d="M 22,13 C 25,9 32,8 38,10" fill="none" stroke="${highlight}" stroke-width="1.2" opacity="0.35"/>`,

    'long-straight': `
      <path d="M 16,30 C 15,14 25,6 32,6 C 39,6 49,14 48,30 L 48,50 C 46,52 42,54 40,54 L 40,30 C 40,18 24,18 24,30 L 24,54 C 22,54 18,52 16,50 Z" fill="url(#hgrad)"/>
      <path d="M 20,15 C 24,9 32,7 38,9" fill="none" stroke="${highlight}" stroke-width="1.5" opacity="0.3"/>
      <line x1="22" y1="20" x2="22" y2="48" stroke="${darker}" stroke-width="0.4" opacity="0.15"/>
      <line x1="26" y1="18" x2="26" y2="50" stroke="${darker}" stroke-width="0.3" opacity="0.1"/>`,

    curly: `
      <path d="M 16,30 C 14,12 26,5 32,5 C 38,5 50,12 48,30 C 50,34 48,38 46,36 C 48,32 46,14 32,10 C 18,14 16,32 18,36 C 16,38 14,34 16,30 Z" fill="url(#hgrad)"/>
      <!-- curl details -->
      <circle cx="17" cy="32" r="3" fill="${darker}" opacity="0.3"/>
      <circle cx="47" cy="32" r="3" fill="${darker}" opacity="0.3"/>
      <circle cx="15" cy="26" r="2.5" fill="${darker}" opacity="0.2"/>
      <circle cx="49" cy="26" r="2.5" fill="${darker}" opacity="0.2"/>
      <path d="M 24,8 C 28,4 36,4 40,8" fill="none" stroke="${highlight}" stroke-width="1.2" opacity="0.3"/>`,

    ponytail: `
      <path d="M 18,28 C 17,14 26,7 32,7 C 38,7 47,14 46,28 C 44,14 20,14 18,28 Z" fill="url(#hgrad)"/>
      <!-- ponytail -->
      <path d="M 44,20 C 50,18 54,24 52,34 C 50,42 46,46 44,44" fill="url(#hgrad)" stroke="${darker}" stroke-width="0.5"/>
      <path d="M 46,22 C 48,20 50,22 50,26" fill="none" stroke="${highlight}" stroke-width="0.8" opacity="0.3"/>`,

    bob: `
      <path d="M 16,30 C 15,14 25,6 32,6 C 39,6 49,14 48,30 L 48,42 C 46,46 42,48 38,46 L 38,30 C 38,18 26,18 26,30 L 26,46 C 22,48 18,46 16,42 Z" fill="url(#hgrad)"/>
      <path d="M 22,13 C 26,8 36,8 42,13" fill="none" stroke="${highlight}" stroke-width="1.5" opacity="0.3"/>`,
  };

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="64" height="64">
  <defs>
    <linearGradient id="hgrad" x1="30%" y1="0%" x2="70%" y2="100%">
      <stop offset="0%" stop-color="${highlight}"/>
      <stop offset="50%" stop-color="${color}"/>
      <stop offset="100%" stop-color="${darker}"/>
    </linearGradient>
  </defs>
  ${styles[style]}
</svg>`;
}

// ── Eyes ───────────────────────────────────────────────────────────────────

export type EyeExpression = 'neutral' | 'happy' | 'focused' | 'tired' | 'surprised';

export function generateEyes(expression: EyeExpression): string {
  const exprs: Record<EyeExpression, string> = {
    neutral: `
      <ellipse cx="26" cy="33" rx="2.8" ry="3.2" fill="#2d2d2d"/>
      <ellipse cx="38" cy="33" rx="2.8" ry="3.2" fill="#2d2d2d"/>
      <circle cx="27" cy="32" r="1" fill="white" opacity="0.7"/>
      <circle cx="39" cy="32" r="1" fill="white" opacity="0.7"/>`,
    happy: `
      <path d="M 23,34 C 24,31 28,31 29,34" fill="none" stroke="#2d2d2d" stroke-width="2" stroke-linecap="round"/>
      <path d="M 35,34 C 36,31 40,31 41,34" fill="none" stroke="#2d2d2d" stroke-width="2" stroke-linecap="round"/>`,
    focused: `
      <ellipse cx="26" cy="34" rx="2.8" ry="2" fill="#2d2d2d"/>
      <ellipse cx="38" cy="34" rx="2.8" ry="2" fill="#2d2d2d"/>
      <circle cx="27" cy="33.5" r="0.8" fill="white" opacity="0.6"/>
      <circle cx="39" cy="33.5" r="0.8" fill="white" opacity="0.6"/>
      <line x1="22" y1="30" x2="30" y2="31" stroke="#2d2d2d" stroke-width="1" opacity="0.4"/>
      <line x1="34" y1="31" x2="42" y2="30" stroke="#2d2d2d" stroke-width="1" opacity="0.4"/>`,
    tired: `
      <path d="M 23,35 C 24,33 28,33 29,35" fill="none" stroke="#2d2d2d" stroke-width="1.8" stroke-linecap="round"/>
      <path d="M 35,35 C 36,33 40,33 41,35" fill="none" stroke="#2d2d2d" stroke-width="1.8" stroke-linecap="round"/>
      <ellipse cx="26" cy="36" rx="3" ry="1.5" fill="#c4a0a0" opacity="0.15"/>
      <ellipse cx="38" cy="36" rx="3" ry="1.5" fill="#c4a0a0" opacity="0.15"/>`,
    surprised: `
      <ellipse cx="26" cy="33" rx="3.5" ry="4" fill="#2d2d2d"/>
      <ellipse cx="38" cy="33" rx="3.5" ry="4" fill="#2d2d2d"/>
      <circle cx="27.5" cy="32" r="1.5" fill="white" opacity="0.8"/>
      <circle cx="39.5" cy="32" r="1.5" fill="white" opacity="0.8"/>
      <path d="M 22,28 C 24,26 28,26 30,28" fill="none" stroke="#2d2d2d" stroke-width="0.8"/>
      <path d="M 34,28 C 36,26 40,26 42,28" fill="none" stroke="#2d2d2d" stroke-width="0.8"/>`,
  };

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="64" height="64">
  ${exprs[expression]}
</svg>`;
}

// ── Mouths ─────────────────────────────────────────────────────────────────

export type MouthExpression = 'neutral' | 'smile' | 'frown' | 'open' | 'talking';

export function generateMouth(expression: MouthExpression): string {
  const exprs: Record<MouthExpression, string> = {
    neutral: `<line x1="29" y1="42" x2="35" y2="42" stroke="#8b6b5b" stroke-width="1.2" stroke-linecap="round"/>`,
    smile: `<path d="M 28,41 C 30,45 34,45 36,41" fill="none" stroke="#8b6b5b" stroke-width="1.2" stroke-linecap="round"/>`,
    frown: `<path d="M 28,44 C 30,41 34,41 36,44" fill="none" stroke="#8b6b5b" stroke-width="1.2" stroke-linecap="round"/>`,
    open: `<ellipse cx="32" cy="43" rx="3" ry="2.5" fill="#6b4b3b" stroke="#8b6b5b" stroke-width="0.6"/>`,
    talking: `<ellipse cx="32" cy="43" rx="2.5" ry="1.8" fill="#6b4b3b" stroke="#8b6b5b" stroke-width="0.6"/>`,
  };

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="64" height="64">
  ${exprs[expression]}
</svg>`;
}

// ── Bodies ─────────────────────────────────────────────────────────────────

export type ClothingStyle = 'hoodie' | 'turtleneck' | 'shirt' | 'casual';

export function generateBody(style: ClothingStyle, clothingColor: string): string {
  const darker = darken(clothingColor, 18);
  const lighter = lighten(clothingColor, 12);

  const styles: Record<ClothingStyle, string> = {
    hoodie: `
      <!-- body -->
      <path d="M 20,10 C 18,10 12,16 10,28 L 10,50 C 10,52 14,54 20,54 L 44,54 C 50,54 54,52 54,50 L 54,28 C 52,16 46,10 44,10 Z" fill="url(#bgrad)"/>
      <!-- hood line -->
      <path d="M 24,10 C 28,6 36,6 40,10" fill="none" stroke="${darker}" stroke-width="1.2"/>
      <!-- center zip -->
      <line x1="32" y1="14" x2="32" y2="50" stroke="${darker}" stroke-width="0.6" opacity="0.3"/>
      <!-- kangaroo pocket -->
      <path d="M 22,36 L 42,36 L 42,46 C 42,48 38,48 32,48 C 26,48 22,48 22,46 Z" fill="none" stroke="${darker}" stroke-width="0.6" opacity="0.25"/>
      <!-- sleeve folds -->
      <path d="M 14,24 C 16,26 14,30 12,28" fill="none" stroke="${darker}" stroke-width="0.5" opacity="0.2"/>
      <path d="M 50,24 C 48,26 50,30 52,28" fill="none" stroke="${darker}" stroke-width="0.5" opacity="0.2"/>`,

    turtleneck: `
      <path d="M 20,10 C 18,10 12,16 10,28 L 10,50 C 10,52 14,54 20,54 L 44,54 C 50,54 54,52 54,50 L 54,28 C 52,16 46,10 44,10 Z" fill="url(#bgrad)"/>
      <!-- high collar -->
      <path d="M 24,10 C 24,6 40,6 40,10" fill="${darker}"/>
      <path d="M 24,8 L 24,12" fill="none" stroke="${lighter}" stroke-width="0.4" opacity="0.3"/>
      <path d="M 28,7 L 28,11" fill="none" stroke="${lighter}" stroke-width="0.4" opacity="0.3"/>
      <path d="M 32,7 L 32,11" fill="none" stroke="${lighter}" stroke-width="0.4" opacity="0.3"/>
      <path d="M 36,7 L 36,11" fill="none" stroke="${lighter}" stroke-width="0.4" opacity="0.3"/>
      <path d="M 40,8 L 40,12" fill="none" stroke="${lighter}" stroke-width="0.4" opacity="0.3"/>`,

    shirt: `
      <path d="M 20,10 C 18,10 12,16 10,28 L 10,50 C 10,52 14,54 20,54 L 44,54 C 50,54 54,52 54,50 L 54,28 C 52,16 46,10 44,10 Z" fill="url(#bgrad)"/>
      <!-- collar V -->
      <path d="M 26,10 L 32,20 L 38,10" fill="none" stroke="${darker}" stroke-width="1"/>
      <!-- collar flaps -->
      <path d="M 26,10 L 24,16 L 30,18" fill="${lighter}" stroke="${darker}" stroke-width="0.5" opacity="0.7"/>
      <path d="M 38,10 L 40,16 L 34,18" fill="${lighter}" stroke="${darker}" stroke-width="0.5" opacity="0.7"/>
      <!-- buttons -->
      <circle cx="32" cy="26" r="1" fill="${darker}" opacity="0.4"/>
      <circle cx="32" cy="34" r="1" fill="${darker}" opacity="0.4"/>
      <circle cx="32" cy="42" r="1" fill="${darker}" opacity="0.4"/>`,

    casual: `
      <path d="M 22,10 C 18,10 12,16 10,28 L 10,50 C 10,52 14,54 20,54 L 44,54 C 50,54 54,52 54,50 L 54,28 C 52,16 46,10 42,10 Z" fill="url(#bgrad)"/>
      <!-- round neck -->
      <path d="M 25,10 C 28,14 36,14 39,10" fill="none" stroke="${darker}" stroke-width="1"/>
      <!-- subtle wrinkles -->
      <path d="M 26,24 C 28,26 30,24" fill="none" stroke="${darker}" stroke-width="0.4" opacity="0.2"/>
      <path d="M 36,30 C 38,32 40,30" fill="none" stroke="${darker}" stroke-width="0.4" opacity="0.2"/>`,
  };

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="64" height="64">
  <defs>
    <linearGradient id="bgrad" x1="20%" y1="0%" x2="80%" y2="100%">
      <stop offset="0%" stop-color="${lighter}"/>
      <stop offset="60%" stop-color="${clothingColor}"/>
      <stop offset="100%" stop-color="${darker}"/>
    </linearGradient>
  </defs>
  ${styles[style]}
</svg>`;
}

// ── Accessories ────────────────────────────────────────────────────────────

export type Accessory = 'glasses-round' | 'glasses-rect' | 'headphones' | 'badge';

export function generateAccessory(type: Accessory): string {
  const accs: Record<Accessory, string> = {
    'glasses-round': `
      <circle cx="26" cy="33" r="5" fill="none" stroke="#555" stroke-width="1.2"/>
      <circle cx="38" cy="33" r="5" fill="none" stroke="#555" stroke-width="1.2"/>
      <line x1="31" y1="33" x2="33" y2="33" stroke="#555" stroke-width="1"/>
      <line x1="21" y1="33" x2="18" y2="31" stroke="#555" stroke-width="0.8"/>
      <line x1="43" y1="33" x2="46" y2="31" stroke="#555" stroke-width="0.8"/>
      <!-- lens reflection -->
      <path d="M 23,31 C 24,29 25,30" fill="none" stroke="white" stroke-width="0.6" opacity="0.3"/>
      <path d="M 35,31 C 36,29 37,30" fill="none" stroke="white" stroke-width="0.6" opacity="0.3"/>`,

    'glasses-rect': `
      <rect x="21" y="30" width="10" height="7" rx="1.5" fill="none" stroke="#444" stroke-width="1.2"/>
      <rect x="33" y="30" width="10" height="7" rx="1.5" fill="none" stroke="#444" stroke-width="1.2"/>
      <line x1="31" y1="33" x2="33" y2="33" stroke="#444" stroke-width="1"/>
      <line x1="21" y1="33" x2="18" y2="31" stroke="#444" stroke-width="0.8"/>
      <line x1="43" y1="33" x2="46" y2="31" stroke="#444" stroke-width="0.8"/>`,

    headphones: `
      <path d="M 16,30 C 16,20 22,14 32,14 C 42,14 48,20 48,30" fill="none" stroke="#3a3a3a" stroke-width="2.5"/>
      <!-- ear cups -->
      <rect x="12" y="28" width="6" height="10" rx="3" fill="#3a3a3a"/>
      <rect x="46" y="28" width="6" height="10" rx="3" fill="#3a3a3a"/>
      <rect x="13" y="30" width="4" height="6" rx="2" fill="#555"/>`,

    badge: `
      <line x1="32" y1="10" x2="32" y2="18" stroke="#888" stroke-width="0.6"/>
      <rect x="27" y="18" width="10" height="14" rx="1.5" fill="white" stroke="#ccc" stroke-width="0.5"/>
      <rect x="29" y="20" width="6" height="4" rx="1" fill="#ddd"/>
      <line x1="29" y1="27" x2="35" y2="27" stroke="#ccc" stroke-width="0.5"/>
      <line x1="30" y1="29" x2="34" y2="29" stroke="#ddd" stroke-width="0.4"/>`,
  };

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="64" height="64">
  ${accs[type]}
</svg>`;
}

// ── Color Utilities ────────────────────────────────────────────────────────

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  return [
    parseInt(h.substring(0, 2), 16),
    parseInt(h.substring(2, 4), 16),
    parseInt(h.substring(4, 6), 16),
  ];
}

function rgbToHex(r: number, g: number, b: number): string {
  const clamp = (v: number) => Math.max(0, Math.min(255, Math.round(v)));
  return `#${clamp(r).toString(16).padStart(2, '0')}${clamp(g).toString(16).padStart(2, '0')}${clamp(b).toString(16).padStart(2, '0')}`;
}

function darken(hex: string, percent: number): string {
  const [r, g, b] = hexToRgb(hex);
  const f = 1 - percent / 100;
  return rgbToHex(r * f, g * f, b * f);
}

function lighten(hex: string, percent: number): string {
  const [r, g, b] = hexToRgb(hex);
  const f = percent / 100;
  return rgbToHex(r + (255 - r) * f, g + (255 - g) * f, b + (255 - b) * f);
}
