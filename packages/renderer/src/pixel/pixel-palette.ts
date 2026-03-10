/** Pixel scale: each logical pixel = PX * PX screen pixels */
export const PX = 3;

/**
 * Pixel palette -- indexed colors for all pixel art.
 * Index 0 = transparent (sentinel, not drawn).
 * Indices 1-16 are fixed palette slots.
 */
export const PIXEL_PALETTE: readonly number[] = [
  0x000000, // 0: transparent (sentinel, not drawn)
  0x1a1c2c, // 1: ocean-deep (darkest)
  0x333c57, // 2: ocean-mid
  0x566c86, // 3: ocean-light
  0x8b9bb4, // 4: shell (light gray-blue)
  0xc0cbdc, // 5: foam (lightest gray)
  0xf4f4f4, // 6: sand (near-white)
  0xffffff, // 7: pearl (white)
  0xe43b44, // 8: lobster-red
  0xf77622, // 9: coral-orange
  0x3e8948, // 10: kelp-green
  0x3978a8, // 11: sea-blue
  0x0e071b, // 12: abyss (darkest shadow)
  0xfbbf24, // 13: gold/warning
  0xa78bfa, // 14: violet
  0xef4444, // 15: error-red
  0x4ade80, // 16: success-green
];
