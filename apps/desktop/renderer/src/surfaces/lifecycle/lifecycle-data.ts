import { UI_DATA_COLORS } from '@/data/color-palette.js';
import type { Company } from '@/data/types.js';

/**
 * Lifecycle presentation data — derivations and label maps the lifecycle
 * surface (portal + creation wizard) needs but which are not carried on the
 * renderer view-models. Kept template-driven so each company template differs.
 */

/* --- Role labels + status dots ---------------------------------------------*/

/** Maps a template/runtime role string to its display label. Falls back to the
 *  raw role when no canonical mapping exists. */
export const ROLE_LABELS: Record<string, string> = {
  Developer: 'Lead Developer',
  Frontend: 'Frontend Engineer',
  Backend: 'Backend Engineer',
  Fullstack: 'Fullstack Engineer',
  'Project Manager': 'Project Manager',
  'Product Manager': 'Product Manager',
  QA: 'QA Engineer',
  'UX Designer': 'UX Designer',
  'UI Designer': 'UI Designer',
  'Graphic Designer': 'Graphic Designer',
  Researcher: 'Researcher',
  Writer: 'Writer',
  Manager: 'Editorial Manager',
  'SEO Specialist': 'SEO Specialist',
  'Account Manager': 'Account Manager',
  'Data Analyst': 'Data Analyst',
};

/** Resolve a human role label for a template/runtime role. */
export function roleLabel(role: string): string {
  return ROLE_LABELS[role] ?? role;
}

/** Status-dot color per role family — gives each employee card a colored
 *  presence dot that reads as a discipline cue (design spec: ROLE_DOT). */
export const ROLE_DOT: Record<string, string> = {
  Developer: UI_DATA_COLORS.blue2,
  Frontend: UI_DATA_COLORS.indigo,
  Backend: UI_DATA_COLORS.green3,
  Fullstack: UI_DATA_COLORS.sky,
  'Project Manager': UI_DATA_COLORS.purple,
  'Product Manager': UI_DATA_COLORS.violet3,
  QA: UI_DATA_COLORS.amber,
  'UX Designer': UI_DATA_COLORS.orange,
  'UI Designer': UI_DATA_COLORS.red,
  'Graphic Designer': UI_DATA_COLORS.pink,
  Researcher: UI_DATA_COLORS.teal,
  Writer: UI_DATA_COLORS.blue2,
  Manager: UI_DATA_COLORS.pink2,
  'SEO Specialist': UI_DATA_COLORS.teal2,
  'Account Manager': UI_DATA_COLORS.indigo,
  'Data Analyst': UI_DATA_COLORS.green3,
};

const DEFAULT_ROLE_DOT = UI_DATA_COLORS.ink6;

/** Resolve the status-dot color for a role. */
export function roleDot(role: string): string {
  return ROLE_DOT[role] ?? DEFAULT_ROLE_DOT;
}

/* --- Template zone summaries ------------------------------------------------*/

/** Per-template office zone list — each template builds out a different floor
 *  plan, so the wizard "Zones · N" summary is template-driven. */
export const TEMPLATE_ZONES: Record<string, string[]> = {
  'rd-company': ['Dev Bay', 'Server Room', 'Library', 'Meeting', 'Rest'],
  'content-studio': ['Writers Room', 'Edit Desk', 'Library', 'Review', 'Lounge'],
  'product-team': ['Design Studio', 'Build Bay', 'War Room', 'Lounge'],
  'agency-lite': ['Client Suite', 'Studio', 'Meeting', 'Lounge'],
  'ai-startup': ['Research Lab', 'GPU Cluster', 'Data Pit', 'War Room', 'Lounge'],
  'create-your-own': ['Custom plot'],
};

const DEFAULT_ZONES = ['Workspace', 'Meeting', 'Lounge'];

/** Resolve the zone summary list for a template. */
export function templateZones(templateId: string): string[] {
  return TEMPLATE_ZONES[templateId] ?? DEFAULT_ZONES;
}

/* --- Portal company brief derivations --------------------------------------*/

export interface CompanyBrief {
  templateLabel: string;
  employeeCount: number;
  projectCount: number;
  zoneCount: number;
  assetCount: number;
  updatedLabel: string;
  /** Zone names used to render the portal SVG office preview. */
  zoneNames: string[];
}

/** Stable small hash → used to derive deterministic-but-varied counts/dates so
 *  each portal company looks distinct without a backend feed. */
function hashSeed(seed: string): number {
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) {
    hash = (hash * 2654435761 + seed.charCodeAt(i)) >>> 0;
  }
  return hash;
}

const PORTAL_TEMPLATE_LABELS = [
  'Content Studio',
  'R&D Company',
  'Product Team',
  'Agency Lite',
  'AI Startup',
  'Custom Layout',
];

const PORTAL_ZONE_SETS: string[][] = [
  ['Dev Bay', 'Product', 'Library'],
  ['Writers Room', 'Edit Desk', 'Lounge'],
  ['Research Lab', 'Data Pit', 'War Room'],
  ['Studio', 'Client Suite', 'Meeting'],
];

/** Derive a portal Company Brief for a renderer Company view-model. Counts and
 *  the updated date are derived from the company id so they stay stable across
 *  renders; employee/project counts prefer real values when supplied. */
export function companyBrief(
  company: Company,
  opts: { employeeCount?: number; projectCount?: number } = {},
): CompanyBrief {
  const h = hashSeed(company.id);
  const templateLabel =
    PORTAL_TEMPLATE_LABELS[h % PORTAL_TEMPLATE_LABELS.length] ?? 'Custom Layout';
  const zoneNames = PORTAL_ZONE_SETS[h % PORTAL_ZONE_SETS.length] ?? DEFAULT_ZONES;
  const employeeCount = opts.employeeCount ?? 2 + (h % 9);
  const projectCount = opts.projectCount ?? h % 4;
  const assetCount = 8 + (h % 40);
  return {
    templateLabel,
    employeeCount,
    projectCount,
    zoneCount: zoneNames.length,
    assetCount,
    updatedLabel: portalUpdatedLabel(h),
    zoneNames,
  };
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function portalUpdatedLabel(h: number): string {
  const month = MONTHS[h % 12] ?? 'May';
  const day = 1 + (h % 27);
  const hour = 9 + (h % 8);
  const minute = h % 60;
  const ampm = hour >= 12 ? 'PM' : 'AM';
  const hr12 = hour > 12 ? hour - 12 : hour;
  return `Updated ${month} ${day}, ${hr12}:${String(minute).padStart(2, '0')} ${ampm}`;
}
