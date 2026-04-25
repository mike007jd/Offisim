import type { OfficialSeedPayload } from '../types.js';

const SLUG = 'offisim/research-pipeline';
const PACKAGE_ID = 'offisim.sop.research-pipeline';
const ASSET_ID = 'research_pipeline';

/**
 * SopDefinition shape — mirrors `@offisim/shared-types`'s SopDefinition.
 * Kept as an inline literal to avoid pulling shared-types into platform's
 * seed graph; consumers (future SOP install pipeline) will re-validate.
 */
const sopDefinition = {
  sop_id: 'sop-research-pipeline',
  name: 'Research Pipeline',
  description:
    'A lightweight three-step pipeline to turn a research prompt into a finished write-up: scout sources, outline, then publish.',
  created_at: '2026-04-01T00:00:00.000Z',
  steps: [
    {
      step_id: 'scout-sources',
      label: 'Scout Sources',
      role_slug: 'researcher',
      instruction:
        'Gather five to eight high-signal sources for the topic. Prefer primary literature and vendor docs over summary blogs. For each source record: title, author, year, URL, and a one-sentence statement of why it is relevant. Reject sources without an author or publication date.',
      output_key: 'sources',
      dependencies: [],
    },
    {
      step_id: 'outline',
      label: 'Outline',
      role_slug: 'product_manager',
      instruction:
        'Turn `sources` into a structured outline: hypothesis, 3–5 theme buckets, and a "conflicting evidence" section. Every bullet must cite at least one of the collected sources. Flag any theme with fewer than two supporting sources.',
      output_key: 'outline',
      dependencies: ['scout-sources'],
    },
    {
      step_id: 'publish',
      label: 'Publish',
      role_slug: 'frontend',
      instruction:
        'Write the final article from `outline`. One paragraph per theme, 180 words max each. Open with the hypothesis. Close with a numbered list of open questions that emerged from the conflicting-evidence section.',
      output_key: 'publish',
      dependencies: ['outline'],
    },
  ],
};

const HERO_SVG = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 200" role="img" aria-label="Research Pipeline SOP">
  <rect width="320" height="200" fill="#065f46"/>
  <g fill="#ffffff" font-family="system-ui,sans-serif" font-size="12" font-weight="600">
    <rect x="32" y="84" width="64" height="40" rx="8" fill="#10b981"/><text x="64" y="108" text-anchor="middle">Scout</text>
    <rect x="128" y="84" width="64" height="40" rx="8" fill="#14b8a6"/><text x="160" y="108" text-anchor="middle">Outline</text>
    <rect x="224" y="84" width="64" height="40" rx="8" fill="#0ea5e9"/><text x="256" y="108" text-anchor="middle">Publish</text>
  </g>
  <g stroke="#ffffff" stroke-width="2" fill="none">
    <line x1="96" y1="104" x2="128" y2="104"/>
    <line x1="192" y1="104" x2="224" y2="104"/>
  </g>
</svg>`;

const heroDataUri = `data:image/svg+xml;base64,${Buffer.from(HERO_SVG, 'utf8').toString('base64')}`;

export const sopSeed: OfficialSeedPayload = {
  slug: SLUG,
  kind: 'sop',
  title: 'Research Pipeline',
  summary:
    'Three-step SOP (scout → outline → publish) to turn a research prompt into a sourced write-up.',
  description:
    'A lightweight authored SOP intended as a starting template for research-heavy teams. Three steps, three role handoffs (researcher → PM → frontend), strict citation rule. Preview-only in the Market today; no install pipeline is wired for SOPs yet.',
  version: '1.0.0',
  runtime_range: '>=0.1 <2.0',
  schema_version: '2026-03',
  risk_class: 'logic_asset',
  supported_environments: ['desktop', 'web_limited'],
  filesystem_scope: 'workspace',
  network_scope: 'none',
  tags: ['sop', 'research', 'official'],
  previews: [{ kind: 'hero', url: heroDataUri, alt_text: 'Research pipeline SOP overview' }],
  package_id: PACKAGE_ID,
  asset_id: ASSET_ID,
  assetFiles: {
    [`assets/sop/${ASSET_ID}.json`]: JSON.stringify(sopDefinition, null, 2),
  },
  customManifest: {
    sop_definition: sopDefinition,
  },
};
