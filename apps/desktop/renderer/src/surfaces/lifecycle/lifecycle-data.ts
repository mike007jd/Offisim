import type { Company } from '@/data/types.js';

/**
 * Lifecycle presentation data — derivations the portal surface needs but which
 * are not carried on the renderer view-models. (Template roster / role / zone
 * presentation now lives in `template-view.ts`, derived from the canonical core
 * templates.)
 */

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
