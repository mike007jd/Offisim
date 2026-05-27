import type { OfficialSeedPayload } from '../types.js';
import { companyTemplateSeed } from './company-template.js';
import { employeeSeed } from './employee.js';
import { officeLayoutSeed } from './office-layout.js';
import { prefabSeed } from './prefab.js';
import { skillSeed } from './skill.js';

/**
 * Canonical seed order for currently supported official Marketplace kinds.
 * Retired product surfaces are intentionally absent; startup retires any
 * stale official listing whose slug is no longer present here.
 */
export const OFFICIAL_PAYLOADS: readonly OfficialSeedPayload[] = [
  employeeSeed,
  skillSeed,
  companyTemplateSeed,
  officeLayoutSeed,
  prefabSeed,
];
