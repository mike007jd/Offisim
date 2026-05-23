import type { AssetKind } from '@offisim/asset-schema';

const RARITY_CLASS: Record<string, string> = {
  employee: 'market-rarity-employee',
  skill: 'market-rarity-skill',
  sop: 'market-rarity-sop',
  company_template: 'market-rarity-template',
  office_layout: 'market-rarity-layout',
  prefab: 'market-rarity-prefab',
  bundle: 'market-rarity-bundle',
};

export function rarityClassName(kind: AssetKind): string {
  return RARITY_CLASS[kind] ?? 'market-rarity-default';
}
