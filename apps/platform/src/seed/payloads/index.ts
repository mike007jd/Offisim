import type { OfficialSeedPayload } from '../types.js';
import { companyTemplateSeed } from './company-template.js';
import { employeeSeed } from './employee.js';
import { officeLayoutSeed } from './office-layout.js';
import { prefabSeed } from './prefab.js';
import { skillSeed } from './skill.js';
import { sopSeed } from './sop.js';

/**
 * Canonical seed order — one payload per AssetKind. Order is load-bearing
 * because downstream assertions ("kind column has exactly 6 distinct
 * values") and manual verification count the output; don't shuffle.
 */
export const OFFICIAL_PAYLOADS: readonly OfficialSeedPayload[] = [
  employeeSeed,
  skillSeed,
  sopSeed,
  companyTemplateSeed,
  officeLayoutSeed,
  prefabSeed,
];
