import type { CompanyTemplateDefinition } from './index.js';
import { productTeamTemplate } from './product-team.js';

/**
 * First-run office: a real stage and workstation layout with no pre-hired team.
 * The player owns the first hire and engine choice instead of inheriting either.
 */
export const starterCompanyTemplate: CompanyTemplateDefinition = {
  id: 'starter-company',
  name: 'Starter Company',
  description: 'An empty office ready for your first employee and first order.',
  presentation: {
    icon: 'Building2',
    accent: '#2f6bff',
    tagline: 'Open the doors, hire one person, and ship the first order',
    bestFor: ['First company', 'Guided setup', 'Learning Offisim'],
    capabilities: ['Empty team', 'Ready office', 'First-order walkthrough'],
  },
  layoutPreset: 'starter-office',
  zones: productTeamTemplate.zones,
  employees: [],
};
