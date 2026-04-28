import { avataaars } from '@dicebear/collection';
import { createAvatar } from '@dicebear/core';
import type { EmployeeAppearance } from '@offisim/shared-types';
import { parseEmployeePersona } from '@offisim/shared-types';

// Tuple SSOT — add/reorder entries here; derived arrays stay index-aligned structurally.
const OUTFIT_PALETTE = [
  ['#3b82f6', 'Blue'],
  ['#a855f7', 'Purple'],
  ['#22c55e', 'Green'],
  ['#818cf8', 'Indigo'],
  ['#f97316', 'Orange'],
  ['#ef4444', 'Red'],
  ['#06b6d4', 'Cyan'],
  ['#f59e0b', 'Amber'],
] as const satisfies ReadonlyArray<readonly [`#${string}`, string]>;

export const OUTFIT_COLORS: readonly string[] = OUTFIT_PALETTE.map(([hex]) => hex);

export const OUTFIT_COLORS_NUMERIC: readonly number[] = OUTFIT_PALETTE.map(([hex]) =>
  Number.parseInt(hex.slice(1), 16),
);

export const OUTFIT_LABELS: readonly string[] = OUTFIT_PALETTE.map(([, label]) => label);

export const SKIN_TONES = [
  '#fce7f3',
  '#fef3c7',
  '#92400e',
  '#fdf2f8',
  '#fff1f2',
  '#d4a574',
  '#f5deb3',
];

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

export function outfitColorFromSeed(seed: string): string {
  return OUTFIT_COLORS[hashSeed(seed) % OUTFIT_COLORS.length] ?? '#3b82f6';
}

export function skinToneFromSeed(seed: string): string {
  return SKIN_TONES[hashSeed(`skin:${seed}`) % SKIN_TONES.length] ?? '#fce7f3';
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
