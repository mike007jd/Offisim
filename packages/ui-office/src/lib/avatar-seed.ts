import { avataaars } from '@dicebear/collection';
import { createAvatar } from '@dicebear/core';
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
  parseInt(hex.slice(1), 16),
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

/**
 * Build a DiceBear avataaars avatar with shirt color locked to `outfitColorFromSeed(seed)`,
 * so 2D cartoon heads stay byte-equivalent to 3D block-figure body color for the same seed.
 * Use this instead of calling `createAvatar(avataaars, ...)` directly.
 */
export function createOffisimAvatar(seed: string, size: number): string {
  return createAvatar(avataaars, {
    seed,
    size,
    clothesColor: [outfitColorFromSeed(seed).slice(1)],
  }).toDataUri();
}
