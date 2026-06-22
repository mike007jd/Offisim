import {
  TEMPLATE_EMPLOYEE_CONFIG_JSON,
  aiStartupTemplate,
  serializeTemplatePersona,
} from '@offisim/core/templates';
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

const profile = sourceEmployee.persona.profile;

const summary =
  'AI product strategist for market-facing workflows: turns ML capabilities into user-facing product plans, researches users and competitors, calibrates trust/explainability, and shapes pricing and responsible AI launch decisions.';
const description = `${profile.expertise}\n\n**Working style.** ${profile.workingStyle}`;

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

const SCREENSHOT_PIPELINE_SVG = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 200" role="img" aria-label="Pipeline view">
  <rect width="320" height="200" fill="#0f172a"/>
  <text x="20" y="32" font-family="system-ui,sans-serif" font-size="11" fill="#94a3b8">Pipeline · Marketing strategist</text>
  <g font-family="system-ui,sans-serif" font-size="10" fill="#e2e8f0">
    <rect x="20" y="50" width="84" height="36" rx="6" fill="#1e293b" stroke="#a855f7" stroke-width="1"/>
    <text x="62" y="73" text-anchor="middle">Research</text>
    <rect x="118" y="50" width="84" height="36" rx="6" fill="#1e293b" stroke="#6366f1" stroke-width="1"/>
    <text x="160" y="73" text-anchor="middle">Plan</text>
    <rect x="216" y="50" width="84" height="36" rx="6" fill="#1e293b" stroke="#22d3ee" stroke-width="1"/>
    <text x="258" y="73" text-anchor="middle">Launch</text>
  </g>
  <path d="M104 68 L118 68 M202 68 L216 68" stroke="#475569" stroke-width="1.5" fill="none"/>
  <text x="20" y="120" font-family="system-ui,sans-serif" font-size="9" fill="#64748b">3 steps · drag to reorder · double-click to edit</text>
  <rect x="20" y="138" width="280" height="42" rx="6" fill="#1e293b"/>
  <text x="32" y="158" font-family="system-ui,sans-serif" font-size="10" fill="#e2e8f0">→ research user segments + competitor pricing</text>
  <text x="32" y="172" font-family="system-ui,sans-serif" font-size="9" fill="#94a3b8">followed by trust calibration step</text>
</svg>`;

const SCREENSHOT_BRIEF_SVG = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 200" role="img" aria-label="Brief view">
  <rect width="320" height="200" fill="#fffbeb"/>
  <rect x="20" y="20" width="280" height="160" rx="10" fill="#ffffff" stroke="#fde68a" stroke-width="1.5"/>
  <text x="32" y="44" font-family="system-ui,sans-serif" font-size="11" font-weight="600" fill="#92400e">Q3 LAUNCH BRIEF · Marketing</text>
  <line x1="32" y1="54" x2="288" y2="54" stroke="#fde68a"/>
  <g font-family="system-ui,sans-serif" font-size="10" fill="#1f2937">
    <text x="32" y="76">Audience: Mid-market PMs evaluating ML feature add-ons</text>
    <text x="32" y="94">Trust frame: Show explainability traces + opt-out for sensitive flows</text>
    <text x="32" y="112">Pricing: Tiered with usage-based overages</text>
    <text x="32" y="130">Channels: Product blog + dev newsletter + 2 dev podcasts</text>
    <text x="32" y="148">Risk: ML-confidence misread; mitigate with human-in-loop default</text>
  </g>
  <text x="32" y="172" font-family="system-ui,sans-serif" font-size="9" fill="#a16207">Drafted by Sample Marketing Strategist</text>
</svg>`;

const heroDataUri = `data:image/svg+xml;base64,${Buffer.from(HERO_SVG, 'utf8').toString('base64')}`;
const screenshotPipelineUri = `data:image/svg+xml;base64,${Buffer.from(SCREENSHOT_PIPELINE_SVG, 'utf8').toString('base64')}`;
const screenshotBriefUri = `data:image/svg+xml;base64,${Buffer.from(SCREENSHOT_BRIEF_SVG, 'utf8').toString('base64')}`;

const employeeAsset = {
  name: 'Sample Marketing Strategist',
  role_slug: ASSET_ID,
  persona_json: serializeTemplatePersona(sourceEmployee),
  config_json: TEMPLATE_EMPLOYEE_CONFIG_JSON,
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
  previews: [
    { kind: 'hero', url: heroDataUri, alt_text: 'Sample marketing strategist avatar' },
    { kind: 'screenshot', url: screenshotPipelineUri, alt_text: 'Pipeline view' },
    { kind: 'screenshot', url: screenshotBriefUri, alt_text: 'Q3 launch brief' },
  ],
  changelog:
    '1.0.0 — Initial release. Persona, pipeline template, and Q3 launch brief baseline shipped.',
  requirements: {
    required_capabilities: ['boss-route', 'pm-planner', 'memory-write'],
    recommended_models: [
      { profile: 'gpt-5.4-mini', reason: 'Cheap planning + research summaries' },
      { profile: 'claude-haiku-4-5', reason: 'Brief writing pass' },
    ],
  },
  lineage: {
    origin_package_id: 'offisim.template-ai-startup-product-manager',
    derivative_of: ['offisim.template-ai-startup'],
  },
  package_id: PACKAGE_ID,
  asset_id: ASSET_ID,
  assetFiles: {
    [`assets/employee.${ASSET_ID}.json`]: JSON.stringify(employeeAsset, null, 2),
  },
  customManifest: {
    employee_role_slug: ASSET_ID,
  },
};
