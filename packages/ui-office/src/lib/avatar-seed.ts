import { parseEmployeePersona } from '@offisim/shared-types';

export const OUTFIT_COLORS = [
  '#3b82f6',
  '#a855f7',
  '#22c55e',
  '#818cf8',
  '#f97316',
  '#ef4444',
  '#06b6d4',
  '#f59e0b',
];

export const OUTFIT_COLORS_NUMERIC: readonly number[] = OUTFIT_COLORS.map((hex) =>
  parseInt(hex.slice(1), 16),
);

export const OUTFIT_LABELS: readonly string[] = [
  'Blue',
  'Purple',
  'Green',
  'Indigo',
  'Orange',
  'Red',
  'Cyan',
  'Amber',
];

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
