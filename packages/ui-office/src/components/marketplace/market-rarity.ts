import type { AssetKind } from '@offisim/asset-schema';

export interface RarityColorScheme {
  border: string;
  glow: string;
  badge: string;
  accent: string;
}

export const RARITY_COLORS: Record<string, RarityColorScheme> = {
  employee: {
    border: 'border-blue-500/40',
    glow: 'shadow-blue-500/20',
    badge: 'bg-blue-500/20 text-blue-300',
    accent: 'bg-blue-500 hover:bg-blue-400',
  },
  skill: {
    border: 'border-purple-500/40',
    glow: 'shadow-purple-500/20',
    badge: 'bg-purple-500/20 text-purple-300',
    accent: 'bg-purple-500 hover:bg-purple-400',
  },
  sop: {
    border: 'border-amber-500/40',
    glow: 'shadow-amber-500/20',
    badge: 'bg-amber-500/20 text-amber-300',
    accent: 'bg-amber-500 hover:bg-amber-400',
  },
  company_template: {
    border: 'border-cyan-500/40',
    glow: 'shadow-cyan-500/20',
    badge: 'bg-cyan-500/20 text-cyan-300',
    accent: 'bg-cyan-500 hover:bg-cyan-400',
  },
  office_layout: {
    border: 'border-rose-500/40',
    glow: 'shadow-rose-500/20',
    badge: 'bg-rose-500/20 text-rose-300',
    accent: 'bg-rose-500 hover:bg-rose-400',
  },
  prefab: {
    border: 'border-orange-500/40',
    glow: 'shadow-orange-500/20',
    badge: 'bg-orange-500/20 text-orange-300',
    accent: 'bg-orange-500 hover:bg-orange-400',
  },
  bundle: {
    border: 'border-indigo-500/40',
    glow: 'shadow-indigo-500/20',
    badge: 'bg-indigo-500/20 text-indigo-300',
    accent: 'bg-indigo-500 hover:bg-indigo-400',
  },
};

export const DEFAULT_RARITY: RarityColorScheme = {
  border: 'border-slate-500/40',
  glow: 'shadow-slate-500/20',
  badge: 'bg-slate-500/20 text-slate-300',
  accent: 'bg-slate-500 hover:bg-slate-400',
};

export function getRarityColor(kind: AssetKind): RarityColorScheme {
  return RARITY_COLORS[kind] ?? DEFAULT_RARITY;
}
