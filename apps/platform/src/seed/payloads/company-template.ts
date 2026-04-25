import { agencyLiteTemplate } from '@offisim/core/dist/templates/agency-lite.js';
import type { OfficialSeedPayload } from '../types.js';

const SLUG = 'offisim/agency-lite';
const PACKAGE_ID = 'offisim.company-template.agency-lite';
const ASSET_ID = 'agency_lite';

const HERO_SVG = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 200" role="img" aria-label="Agency Lite company template">
  <rect width="320" height="200" fill="#1e293b"/>
  <g fill="#f8fafc" font-family="system-ui,sans-serif" font-size="12" font-weight="600">
    <circle cx="80" cy="96" r="18" fill="#6366f1"/><text x="80" y="136" text-anchor="middle">Account</text>
    <circle cx="130" cy="96" r="18" fill="#8b5cf6"/><text x="130" y="136" text-anchor="middle">Creative</text>
    <circle cx="180" cy="96" r="18" fill="#ec4899"/><text x="180" y="136" text-anchor="middle">Copy</text>
    <circle cx="230" cy="96" r="18" fill="#f97316"/><text x="230" y="136" text-anchor="middle">QA</text>
  </g>
  <text x="160" y="48" text-anchor="middle" fill="#fef3c7" font-family="system-ui,sans-serif" font-size="18" font-weight="700">Agency Lite</text>
</svg>`;

const heroDataUri = `data:image/svg+xml;base64,${Buffer.from(HERO_SVG, 'utf8').toString('base64')}`;

export const companyTemplateSeed: OfficialSeedPayload = {
  slug: SLUG,
  kind: 'company_template',
  title: 'Agency Lite Company Template',
  summary:
    'Five-seat freelancer / small studio layout with the account, creative, copy, QA, and producer roles pre-wired.',
  description:
    `Full ProcessTemplate adapted from the built-in 'agency-lite' company template: ${agencyLiteTemplate.employees.length} employees, ${agencyLiteTemplate.sops.length} SOPs, plus the agency zone layout. Preview-only in the Market — company templates are created through the first-run wizard today.`,
  version: '1.0.0',
  runtime_range: '>=0.1 <2.0',
  schema_version: '2026-03',
  risk_class: 'logic_asset',
  supported_environments: ['desktop', 'web_limited'],
  filesystem_scope: 'workspace',
  network_scope: 'none',
  tags: ['company-template', 'agency', 'official'],
  previews: [{ kind: 'hero', url: heroDataUri, alt_text: 'Agency Lite template layout' }],
  package_id: PACKAGE_ID,
  asset_id: ASSET_ID,
  assetFiles: {
    [`assets/company-template/${ASSET_ID}.json`]: JSON.stringify(agencyLiteTemplate, null, 2),
  },
  customManifest: {
    company_template_id: agencyLiteTemplate.id,
    company_template: agencyLiteTemplate,
  },
};
