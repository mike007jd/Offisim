import { getDefaultZoneLayout } from '@offisim/prefab';
import type { OfficialSeedPayload } from '../types.js';

const SLUG = 'offisim/starter-layout';
const PACKAGE_ID = 'offisim.office-layout.starter';
const ASSET_ID = 'starter_layout';

/**
 * Starter layout bundles the built-in default placements for the four zone
 * archetypes most teams touch first. Values come straight from
 * `@offisim/prefab`'s `getDefaultZoneLayout` so the seed never drifts from
 * the real runtime catalog.
 */
const layoutPack = {
  layout_id: 'starter-layout',
  name: 'Starter Layout',
  zones: [
    { slug: 'department', label: 'Department', prefabs: getDefaultZoneLayout('department', 4) },
    { slug: 'meeting', label: 'Meeting Room', prefabs: getDefaultZoneLayout('meeting_room', 4) },
    { slug: 'rest', label: 'Rest Area', prefabs: getDefaultZoneLayout('rest_area') },
    { slug: 'server', label: 'Server Room', prefabs: getDefaultZoneLayout('server_room', 3) },
  ],
};

const HERO_SVG = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 200" role="img" aria-label="Starter office layout">
  <rect width="320" height="200" fill="#0f172a"/>
  <g fill="#38bdf8" opacity="0.9">
    <rect x="24" y="32" width="132" height="68" rx="6"/>
    <rect x="172" y="32" width="124" height="68" rx="6"/>
    <rect x="24" y="112" width="124" height="60" rx="6"/>
    <rect x="164" y="112" width="132" height="60" rx="6"/>
  </g>
  <g fill="#0f172a" font-family="system-ui,sans-serif" font-size="11" font-weight="700">
    <text x="90" y="70" text-anchor="middle">DEPARTMENT</text>
    <text x="234" y="70" text-anchor="middle">MEETING</text>
    <text x="86" y="146" text-anchor="middle">REST</text>
    <text x="230" y="146" text-anchor="middle">SERVER</text>
  </g>
</svg>`;

const heroDataUri = `data:image/svg+xml;base64,${Buffer.from(HERO_SVG, 'utf8').toString('base64')}`;

export const officeLayoutSeed: OfficialSeedPayload = {
  slug: SLUG,
  kind: 'office_layout',
  title: 'Starter Office Layout',
  summary:
    'Default prefab placements for a department / meeting / rest / server zone combination — pulled from the runtime default-zone catalog.',
  description:
    "Four-zone layout pack derived from `@offisim/prefab`'s built-in default placements (4-desk department, 4-seat meeting, rest area, 3-rack server room). Preview-only in the Market today; layout packs do not yet have an install pipeline and are applied automatically by the zone creator.",
  version: '1.0.0',
  runtime_range: '>=0.1 <2.0',
  schema_version: '2026-03',
  risk_class: 'data_asset',
  supported_environments: ['desktop', 'web_limited'],
  filesystem_scope: 'none',
  network_scope: 'none',
  tags: ['office-layout', 'starter', 'official'],
  previews: [{ kind: 'hero', url: heroDataUri, alt_text: 'Starter layout zone grid' }],
  package_id: PACKAGE_ID,
  asset_id: ASSET_ID,
  assetFiles: {
    [`assets/office-layout/${ASSET_ID}.json`]: JSON.stringify(layoutPack, null, 2),
  },
  customManifest: {
    office_layout: layoutPack,
  },
};
