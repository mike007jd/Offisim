import { getBuiltinPrefab } from '@offisim/prefab';
import type { OfficialSeedPayload } from '../types.js';

const SLUG = 'offisim/desk-essentials';
const PACKAGE_ID = 'offisim.prefab.desk-essentials';
const ASSET_ID = 'desk_essentials';

const workstation = getBuiltinPrefab('workstation-standard');
if (!workstation) {
  throw new Error("Built-in prefab 'workstation-standard' not found — cannot seed prefab pack");
}

/**
 * A single-prefab "pack" wrapping the canonical standard workstation. Acts
 * as a preview-only entry in the Market to exercise the `prefab` kind
 * filter; cloning the pack into a company's private prefab library is not
 * implemented yet.
 */
const prefabPack = {
  pack_id: 'desk-essentials',
  name: 'Desk Essentials',
  entries: [workstation],
};

const HERO_SVG = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 200" role="img" aria-label="Desk Essentials prefab pack">
  <rect width="320" height="200" fill="#111827"/>
  <rect x="64" y="112" width="192" height="22" rx="4" fill="#a78bfa"/>
  <rect x="132" y="62" width="56" height="46" rx="4" fill="#38bdf8"/>
  <rect x="148" y="108" width="24" height="12" rx="2" fill="#cbd5e1"/>
  <rect x="96" y="136" width="16" height="38" rx="3" fill="#c084fc"/>
  <rect x="210" y="136" width="16" height="38" rx="3" fill="#c084fc"/>
  <text x="160" y="42" text-anchor="middle" fill="#f9fafb" font-family="system-ui,sans-serif" font-size="16" font-weight="700">Desk Essentials</text>
</svg>`;

const heroDataUri = `data:image/svg+xml;base64,${Buffer.from(HERO_SVG, 'utf8').toString('base64')}`;

export const prefabSeed: OfficialSeedPayload = {
  slug: SLUG,
  kind: 'prefab',
  title: 'Desk Essentials Prefab Pack',
  summary:
    'Single-entry prefab pack wrapping the built-in Standard Workstation (desk + monitor + chair) for preview in Market.',
  description: `Wraps '${workstation.prefabId}' — the canonical ${workstation.name.toLowerCase()} — into a Market-visible prefab pack. Preview-only today: prefab install / copy-into-library is not yet implemented.`,
  version: '1.0.0',
  runtime_range: '>=0.1 <2.0',
  schema_version: '2026-03',
  risk_class: 'data_asset',
  supported_environments: ['desktop', 'web_limited'],
  filesystem_scope: 'none',
  network_scope: 'none',
  tags: ['prefab', 'workspace', 'official'],
  previews: [{ kind: 'hero', url: heroDataUri, alt_text: 'Desk Essentials prefab preview' }],
  package_id: PACKAGE_ID,
  asset_id: ASSET_ID,
  assetFiles: {
    [`assets/prefab/${ASSET_ID}.json`]: JSON.stringify(prefabPack, null, 2),
  },
  customManifest: {
    prefab_pack: prefabPack,
  },
};
