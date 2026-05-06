import type { AssetKind } from '@offisim/asset-schema';

export interface RarityColorScheme {
  border: string;
  glow: string;
  badge: string;
  accent: string;
}

export const RARITY_COLORS: Record<string, RarityColorScheme> = {
  employee: {
    border: 'border-info',
    glow: 'shadow-sm',
    badge: 'bg-info-muted text-info',
    accent: 'border border-info bg-info-muted text-info hover:bg-surface-hover',
  },
  skill: {
    border: 'border-accent',
    glow: 'shadow-sm',
    badge: 'bg-accent-muted text-accent-text',
    accent: 'border border-accent bg-accent-muted text-accent-text hover:bg-surface-hover',
  },
  sop: {
    border: 'border-warning',
    glow: 'shadow-sm',
    badge: 'bg-warning-muted text-warning',
    accent: 'border border-warning bg-warning-muted text-warning hover:bg-surface-hover',
  },
  company_template: {
    border: 'border-accent',
    glow: 'shadow-sm',
    badge: 'bg-accent-muted text-accent-text',
    accent: 'border border-accent bg-accent-muted text-accent-text hover:bg-surface-hover',
  },
  office_layout: {
    border: 'border-error',
    glow: 'shadow-sm',
    badge: 'bg-error-muted text-error',
    accent: 'border border-error bg-error-muted text-error hover:bg-surface-hover',
  },
  prefab: {
    border: 'border-warning',
    glow: 'shadow-sm',
    badge: 'bg-warning-muted text-warning',
    accent: 'border border-warning bg-warning-muted text-warning hover:bg-surface-hover',
  },
  bundle: {
    border: 'border-info',
    glow: 'shadow-sm',
    badge: 'bg-info-muted text-info',
    accent: 'border border-info bg-info-muted text-info hover:bg-surface-hover',
  },
};

export const DEFAULT_RARITY: RarityColorScheme = {
  border: 'border-border-default',
  glow: 'shadow-sm',
  badge: 'bg-surface-muted text-text-secondary',
  accent:
    'border border-border-default bg-surface-muted text-text-secondary hover:bg-surface-hover',
};

export function getRarityColor(kind: AssetKind): RarityColorScheme {
  return RARITY_COLORS[kind] ?? DEFAULT_RARITY;
}
