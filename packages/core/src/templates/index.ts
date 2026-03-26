import type { SopDefinition } from '@aics/shared-types';

import { agencyLiteTemplate } from './agency-lite.js';
import { aiStartupTemplate } from './ai-startup.js';
import { contentStudioTemplate } from './content-studio.js';
import { productTeamTemplate } from './product-team.js';
import { rdCompanyTemplate } from './rd-company.js';

export interface CompanyTemplateEmployee {
  name: string;
  role_slug: string;
  persona_json: string;
  config_json: string;
}

export interface CompanyTemplate {
  id: string;
  name: string;
  description: string;
  icon: string;
  employees: CompanyTemplateEmployee[];
  sops: SopDefinition[];
  layoutPreset: string;
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
