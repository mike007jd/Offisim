import { avataaars } from '@dicebear/collection';
import { createAvatar } from '@dicebear/core';
import type { EmployeeAppearance } from '@offisim/shared-types';
import { parseEmployeePersona } from '@offisim/shared-types';

// Tuple SSOT — add/reorder entries here; derived arrays stay index-aligned structurally.
const OUTFIT_PALETTE = [
  ['#3b82f6', 'Blue'], // raw-hex-allowed
  ['#a855f7', 'Purple'], // raw-hex-allowed
  ['#22c55e', 'Green'], // raw-hex-allowed
  ['#818cf8', 'Indigo'], // raw-hex-allowed
  ['#f97316', 'Orange'], // raw-hex-allowed
  ['#ef4444', 'Red'], // raw-hex-allowed
  ['#06b6d4', 'Cyan'], // raw-hex-allowed
  ['#f59e0b', 'Amber'], // raw-hex-allowed
  ['#0ea5e9', 'Sky'], // raw-hex-allowed
  ['#14b8a6', 'Teal'], // raw-hex-allowed
  ['#84cc16', 'Lime'], // raw-hex-allowed
  ['#eab308', 'Yellow'], // raw-hex-allowed
  ['#ec4899', 'Pink'], // raw-hex-allowed
  ['#f43f5e', 'Rose'], // raw-hex-allowed
  ['#8b5cf6', 'Violet'], // raw-hex-allowed
  ['#64748b', 'Slate'], // raw-hex-allowed
] as const satisfies ReadonlyArray<readonly [`#${string}`, string]>;

export const OUTFIT_COLORS: readonly string[] = OUTFIT_PALETTE.map(([hex]) => hex);

export const OUTFIT_COLORS_NUMERIC: readonly number[] = OUTFIT_PALETTE.map(([hex]) =>
  Number.parseInt(hex.slice(1), 16),
);

export const OUTFIT_LABELS: readonly string[] = OUTFIT_PALETTE.map(([, label]) => label);

export const SKIN_TONES = [
  '#fce7f3', // raw-hex-allowed
  '#fef3c7', // raw-hex-allowed
  '#92400e', // raw-hex-allowed
  '#fdf2f8', // raw-hex-allowed
  '#fff1f2', // raw-hex-allowed
  '#d4a574', // raw-hex-allowed
  '#f5deb3', // raw-hex-allowed
  '#fde68a', // raw-hex-allowed
  '#fed7aa', // raw-hex-allowed
  '#fdba74', // raw-hex-allowed
  '#fb923c', // raw-hex-allowed
  '#c2410c', // raw-hex-allowed
  '#9a3412', // raw-hex-allowed
  '#7c2d12', // raw-hex-allowed
  '#78350f', // raw-hex-allowed
  '#713f12', // raw-hex-allowed
  '#451a03', // raw-hex-allowed
  '#3b1d0b', // raw-hex-allowed
  '#24130a', // raw-hex-allowed
] as const;

export const HAIR_COLORS_SEED_PALETTE = [
  '#1a1a1a', // raw-hex-allowed
  '#6b3f1e', // raw-hex-allowed
  '#d4a843', // raw-hex-allowed
  '#b03020', // raw-hex-allowed
  '#9e9e9e', // raw-hex-allowed
  '#3d6bce', // raw-hex-allowed
  '#f8fafc', // raw-hex-allowed
  '#64748b', // raw-hex-allowed
] as const;

export const KNUTH_PRIME = 2654435761;

export function resolveAvatarSeed(agent: {
  name: string;
  persona_json?: string | null;
}): string {
  const persona = parseEmployeePersona(agent.persona_json ?? null);
  return persona.avatarSeed ?? agent.name;
}

function hashSeed(seed: string): number {
  let hash = 5381;
  for (let i = 0; i < seed.length; i++) {
    hash = ((hash << 5) + hash + seed.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}

export function paletteIndex(seed: string, paletteLength: number): number {
  return Math.abs((hashSeed(seed) * KNUTH_PRIME) >>> 0) % paletteLength;
}

export function outfitColorFromSeed(seed: string): string {
  return OUTFIT_COLORS[paletteIndex(seed, OUTFIT_COLORS.length)] ?? '#3b82f6'; // raw-hex-allowed
}

export function skinToneFromSeed(seed: string): string {
  return SKIN_TONES[paletteIndex(`skin:${seed}`, SKIN_TONES.length)] ?? '#fce7f3'; // raw-hex-allowed
}

export function hairColorFromSeed(seed: string): string {
  return (
    HAIR_COLORS_SEED_PALETTE[paletteIndex(`hair:${seed}`, HAIR_COLORS_SEED_PALETTE.length)] ??
    '#111827' // raw-hex-allowed
  );
}

export function numericToHex(n: number): string {
  return `#${(n & 0xffffff).toString(16).padStart(6, '0')}`;
}

export function resolveOutfitColor(seed: string, appearance?: EmployeeAppearance | null): string {
  if (appearance && typeof appearance.clothingColor === 'number') {
    return numericToHex(appearance.clothingColor);
  }
  return outfitColorFromSeed(seed);
}

export function resolveSkinTone(seed: string, appearance?: EmployeeAppearance | null): string {
  if (appearance && typeof appearance.skinColor === 'number') {
    return numericToHex(appearance.skinColor);
  }
  return skinToneFromSeed(seed);
}

export function resolveHairColor(seed: string, appearance?: EmployeeAppearance | null): string {
  if (appearance && typeof appearance.hairColor === 'number') {
    return numericToHex(appearance.hairColor);
  }
  return hairColorFromSeed(seed);
}

export function resolveAccentColor(seed: string, appearance?: EmployeeAppearance | null): string {
  if (appearance && typeof appearance.clothingAccent === 'number') {
    return numericToHex(appearance.clothingAccent);
  }
  return outfitColorFromSeed(`accent:${seed}`);
}

/**
 * Maps Offisim `hairStyle` enum to a `@dicebear/avataaars` v9 `top` token.
 * `bald` is rendered via `topProbability: 0` at config-build time; the token
 * here is just a placeholder so the field is always populated.
 */
export const HAIR_STYLE_TO_AVATAARS_TOP = {
  short: 'shortFlat',
  long: 'straight01',
  ponytail: 'bun',
  curly: 'shortCurly',
  bald: 'shortFlat',
  bob: 'bob',
  spiky: 'frizzle',
  braids: 'fro',
} as const;

/**
 * Build a DiceBear avataaars avatar. When `appearance` is omitted, behavior is
 * byte-equivalent to the legacy seed-only path (shirt locked to
 * `outfitColorFromSeed(seed)` so 2D cartoon stays byte-equal to 3D body).
 * When provided, skin / hair / clothes / top are sourced from `appearance`,
 * falling back to seed only for axes the customizer doesn't cover (eyes,
 * mouth, accessories, …) so the same employee remains visually consistent.
 */
export function createOffisimAvatar(
  seed: string,
  size: number,
  appearance?: EmployeeAppearance | null,
): string {
  if (!appearance) {
    return createAvatar(avataaars, {
      seed,
      size,
      clothesColor: [outfitColorFromSeed(seed).slice(1)],
    }).toDataUri();
  }
  const topToken =
    HAIR_STYLE_TO_AVATAARS_TOP[appearance.hairStyle as keyof typeof HAIR_STYLE_TO_AVATAARS_TOP] ??
    'shortFlat';
  const isBald = appearance.hairStyle === 'bald';
  return createAvatar(avataaars, {
    seed,
    size,
    clothesColor: [numericToHex(appearance.clothingColor).slice(1)],
    skinColor: [numericToHex(appearance.skinColor).slice(1)],
    hairColor: [numericToHex(appearance.hairColor).slice(1)],
    top: [topToken],
    ...(isBald ? { topProbability: 0 } : {}),
  }).toDataUri();
}
