import { aiStartupTemplate } from '@offisim/core/dist/templates/ai-startup.js';
import type { OfficialSeedPayload } from '../types.js';

const SLUG = 'offisim/sample-marketing-strategist';
const PACKAGE_ID = 'offisim.sample-marketing-strategist';
const ASSET_ID = 'sample_marketing_strategist';

// Base persona comes from the AI Startup template's product manager — it is
// already written, proofread, and representative of an Offisim employee.
// We remap role_slug to a generic marketing strategist slug so the install
// target is obviously a "sample" rather than a specific role in any template.
const sourceEmployee = aiStartupTemplate.employees[3] ?? aiStartupTemplate.employees[0];
if (!sourceEmployee) {
  throw new Error('ai-startup template is empty — cannot seed sample employee');
}

const persona = JSON.parse(sourceEmployee.persona_json) as {
  expertise: string;
  style: string;
  characterConfig?: Record<string, unknown>;
};

const summary =
  'AI product strategist for market-facing workflows: turns ML capabilities into user-facing product plans, researches users and competitors, calibrates trust/explainability, and shapes pricing and responsible AI launch decisions.';
const description = `${persona.expertise}\n\n**Working style.** ${persona.style}`;

const HERO_SVG = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 200" role="img" aria-label="Sample Marketing Strategist">
  <defs>
    <linearGradient id="bg" x1="0" x2="1" y1="0" y2="1">
      <stop offset="0" stop-color="#a855f7"/>
      <stop offset="1" stop-color="#6366f1"/>
    </linearGradient>
  </defs>
  <rect width="320" height="200" fill="url(#bg)"/>
  <circle cx="160" cy="78" r="34" fill="#fde68a"/>
  <rect x="106" y="118" width="108" height="54" rx="12" fill="#4f46e5"/>
  <text x="160" y="156" text-anchor="middle" font-family="system-ui,sans-serif" font-size="14" font-weight="600" fill="#ffffff">Marketing Strategist</text>
</svg>`;

const heroDataUri = `data:image/svg+xml;base64,${Buffer.from(HERO_SVG, 'utf8').toString('base64')}`;

const employeeAsset = {
  name: 'Sample Marketing Strategist',
  role_slug: ASSET_ID,
  persona_json: sourceEmployee.persona_json,
  config_json: sourceEmployee.config_json,
};

export const employeeSeed: OfficialSeedPayload = {
  slug: SLUG,
  kind: 'employee',
  title: 'Sample Marketing Strategist',
  summary,
  description,
  version: '1.0.0',
  runtime_range: '>=0.1 <2.0',
  schema_version: '2026-03',
  risk_class: 'logic_asset',
  supported_environments: ['desktop', 'web_limited'],
  filesystem_scope: 'workspace',
  network_scope: 'none',
  tags: ['employee', 'marketing', 'official'],
  previews: [{ kind: 'hero', url: heroDataUri, alt_text: 'Sample marketing strategist avatar' }],
  package_id: PACKAGE_ID,
  asset_id: ASSET_ID,
  assetFiles: {
    [`assets/employee.${ASSET_ID}.json`]: JSON.stringify(employeeAsset, null, 2),
  },
  customManifest: {
    employee_role_slug: ASSET_ID,
  },
};
