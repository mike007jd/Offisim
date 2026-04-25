import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { OfficialSeedPayload } from '../types.js';

const SLUG = 'offisim/research-summary';
const PACKAGE_ID = 'offisim.skill.research-summary';
const ASSET_ID = 'research_summary';

// Read the authored SKILL.md at module init. Works in dev (tsx resolves
// import.meta.url to src/) and in prod (the platform build script copies
// payload `.md` files into dist/seed/payloads/).
const SKILL_MD_PATH = fileURLToPath(new URL('./skill-research-summary.md', import.meta.url));
const SKILL_MD_CONTENT = readFileSync(SKILL_MD_PATH, 'utf8');

const HERO_SVG = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 200" role="img" aria-label="Research Summary skill">
  <rect width="320" height="200" fill="#0f172a"/>
  <rect x="56" y="42" width="208" height="22" rx="4" fill="#facc15"/>
  <rect x="56" y="72" width="168" height="10" rx="3" fill="#334155"/>
  <rect x="56" y="90" width="192" height="10" rx="3" fill="#334155"/>
  <rect x="56" y="108" width="148" height="10" rx="3" fill="#334155"/>
  <text x="160" y="158" text-anchor="middle" font-family="system-ui,sans-serif" font-size="14" font-weight="600" fill="#facc15">Research Summary</text>
</svg>`;

const heroDataUri = `data:image/svg+xml;base64,${Buffer.from(HERO_SVG, 'utf8').toString('base64')}`;

export const skillSeed: OfficialSeedPayload = {
  slug: SLUG,
  kind: 'skill',
  title: 'Research Summary',
  summary:
    'Distill long research sources into a structured 3–5 paragraph executive summary with evidence anchors and follow-up questions.',
  description:
    'A drop-in skill for any employee who summarizes research. Walks the model through a five-step routine (skim, extract claims, cluster themes, draft, close with next steps) and enforces citation discipline. Activates on "summarize", "brief me on", "what does this paper say" prompts.',
  version: '1.0.0',
  runtime_range: '>=0.1 <2.0',
  schema_version: '2026-03',
  risk_class: 'logic_asset',
  supported_environments: ['desktop', 'web_limited'],
  filesystem_scope: 'workspace',
  network_scope: 'none',
  tags: ['skill', 'research', 'official'],
  previews: [{ kind: 'hero', url: heroDataUri, alt_text: 'Research summary skill cover' }],
  package_id: PACKAGE_ID,
  asset_id: ASSET_ID,
  assetFiles: {
    [`assets/skills/${ASSET_ID}/SKILL.md`]: SKILL_MD_CONTENT,
  },
  customManifest: {
    skill_slug: ASSET_ID,
    // Consumed by useInstallFlow → materializeSkillFromPlan to write SKILL.md
    // into the local vault without extracting the zip.
    skill_md_content: SKILL_MD_CONTENT,
  },
};
