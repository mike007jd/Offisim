import type { AssetKind } from '@offisim/asset-schema';

export interface RarityClassScheme {
  accent: string;
  accentBg: string;
  accentBorder: string;
  surface: string;
  cover: string;
}

const RARITY_CLASS: Record<string, RarityClassScheme> = {
  employee: {
    accent: 'text-accent',
    accentBg: 'bg-accent',
    accentBorder: 'border-accent',
    surface: 'bg-accent-surface',
    cover: 'bg-accent-surface',
  },
  skill: {
    accent: 'text-violet',
    accentBg: 'bg-violet',
    accentBorder: 'border-violet',
    surface: 'bg-violet-surface',
    cover: 'bg-violet-surface',
  },
  sop: {
    accent: 'text-warn',
    accentBg: 'bg-warn',
    accentBorder: 'border-warn',
    surface: 'bg-warn-surface',
    cover: 'bg-warn-surface',
  },
  company_template: {
    accent: 'text-violet',
    accentBg: 'bg-violet',
    accentBorder: 'border-violet',
    surface: 'bg-violet-surface',
    cover: 'bg-violet-surface',
  },
  office_layout: {
    accent: 'text-danger',
    accentBg: 'bg-danger',
    accentBorder: 'border-danger',
    surface: 'bg-danger-surface',
    cover: 'bg-danger-surface',
  },
  prefab: {
    accent: 'text-warn',
    accentBg: 'bg-warn',
    accentBorder: 'border-warn',
    surface: 'bg-warn-surface',
    cover: 'bg-warn-surface',
  },
  bundle: {
    accent: 'text-ink-3',
    accentBg: 'bg-ink-3',
    accentBorder: 'border-line-strong',
    surface: 'bg-surface-sunken',
    cover: 'bg-surface-sunken',
  },
};

export const DEFAULT_RARITY_CLASSES: RarityClassScheme = {
  accent: 'text-ink-3',
  accentBg: 'bg-ink-3',
  accentBorder: 'border-line-strong',
  surface: 'bg-surface-sunken',
  cover: 'bg-surface-sunken',
};

export function getRarityClasses(kind: AssetKind): RarityClassScheme {
  return RARITY_CLASS[kind] ?? DEFAULT_RARITY_CLASSES;
}
