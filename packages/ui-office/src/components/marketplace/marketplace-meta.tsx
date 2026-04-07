import type { AssetKind, RiskClass } from '@offisim/asset-schema';
import type { LucideIcon } from 'lucide-react';
import { BookTemplate, Box, Building2, LayoutGrid, Package, UserPlus, Zap } from 'lucide-react';

export const KIND_ICON: Record<AssetKind, LucideIcon> = {
  employee: UserPlus,
  skill: Zap,
  sop: BookTemplate,
  company_template: Building2,
  office_layout: LayoutGrid,
  prefab: Box,
  bundle: Package,
};

export const INSTALLABLE_KINDS = new Set<AssetKind>(['employee', 'skill']);

export const KIND_FILTERS: Array<{ value: AssetKind | 'all'; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'employee', label: 'Employees' },
  { value: 'skill', label: 'Skills' },
  { value: 'sop', label: 'SOPs' },
  { value: 'company_template', label: 'Companies' },
];

export const SORT_OPTIONS = ['relevance', 'newest', 'rating', 'installs'] as const;
export type MarketSortOption = (typeof SORT_OPTIONS)[number];

export function formatInstallCount(value: number): string {
  if (value >= 1000) {
    return `${(value / 1000).toFixed(value >= 10_000 ? 0 : 1)}k`;
  }
  return String(value);
}

export function formatRiskLabel(riskClass?: RiskClass): string {
  switch (riskClass) {
    case 'privileged_asset':
      return 'Privileged';
    case 'logic_asset':
      return 'Logic';
    case 'data_asset':
      return 'Data';
    default:
      return 'Unknown';
  }
}
