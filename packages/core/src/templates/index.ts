import type {
  RoleSlug,
  SopDefinition,
  SystemZoneTemplate,
  ZonePresetPrefab,
} from '@offisim/shared-types';

import { agencyLiteTemplate } from './agency-lite.js';
import { aiStartupTemplate } from './ai-startup.js';
import { contentStudioTemplate } from './content-studio.js';
import { productTeamTemplate } from './product-team.js';
import { rdCompanyTemplate } from './rd-company.js';

export { agencyLiteTemplate } from './agency-lite.js';
export { aiStartupTemplate } from './ai-startup.js';
export { contentStudioTemplate } from './content-studio.js';
export { productTeamTemplate } from './product-team.js';
export { rdCompanyTemplate } from './rd-company.js';

export interface CompanyTemplateEmployee {
  name: string;
  role_slug: RoleSlug;
  persona_json: string;
  config_json: string;
}

export interface TemplateZoneBlueprint extends SystemZoneTemplate {
  defaultPrefabs?: readonly ZonePresetPrefab[];
}

export interface CompanyTemplate {
  id: string;
  name: string;
  description: string;
  icon: string;
  employees: CompanyTemplateEmployee[];
  sops: SopDefinition[];
  layoutPreset: string;
  zones?: readonly TemplateZoneBlueprint[];
}

const TEMPLATES: CompanyTemplate[] = [
  rdCompanyTemplate,
  contentStudioTemplate,
  productTeamTemplate,
  agencyLiteTemplate,
  aiStartupTemplate,
];

export function listTemplates(): CompanyTemplate[] {
  return TEMPLATES;
}

export function getTemplate(id: string): CompanyTemplate | undefined {
  return TEMPLATES.find((t) => t.id === id);
}
