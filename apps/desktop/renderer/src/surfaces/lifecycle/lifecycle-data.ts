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
const ROLE_LABELS: Record<string, string> = {
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
const ROLE_DOT: Record<string, string> = {
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
const TEMPLATE_ZONES: Record<string, string[]> = {
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
  /** Real zone names (from the company's office layout) for the floor preview. */
  zoneNames: string[];
}

/** Build a portal Company Brief from real values only. Employee/project counts
 *  come from their queries; zone names come from the company's office layout.
 *  No fabricated counts, asset tallies, or "updated" timestamps. */
export function companyBrief(
  company: Company,
  opts: { employeeCount?: number; projectCount?: number; zoneNames?: string[] } = {},
): CompanyBrief {
  const zoneNames = opts.zoneNames ?? [];
  return {
    templateLabel: company.templateLabel,
    employeeCount: opts.employeeCount ?? 0,
    projectCount: opts.projectCount ?? 0,
    zoneCount: zoneNames.length,
    zoneNames,
  };
}
