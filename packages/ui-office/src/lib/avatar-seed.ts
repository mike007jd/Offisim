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
  if (agent.persona_json) {
    try {
      const persona = JSON.parse(agent.persona_json) as { avatarSeed?: string };
      if (persona.avatarSeed) return persona.avatarSeed;
    } catch {
      // invalid JSON — fall through to name
    }
  }
  return agent.name;
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
