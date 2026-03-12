import type { SopDefinition } from '@aics/shared-types';

import type { CompanyTemplate } from './index.js';

export const agencyLiteTemplate: CompanyTemplate = {
  id: 'agency-lite',
  name: 'Agency Lite',
  description: 'A lean agency setup for client communication, content delivery, and project management.',
  icon: '🏢',
  layoutPreset: '2x2',
  employees: [
    {
      name: 'Pat Account Manager',
      role_slug: 'account-manager',
      persona_json: JSON.stringify({
        personality: 'Professional, empathetic, deadline-conscious client liaison',
        expertise: 'Client communication, project scoping, timeline management, stakeholder alignment',
        style: 'Clear status updates, professional emails, and structured meeting summaries',
      }),
      config_json: JSON.stringify({
        temperature: 0.5,
        maxTokens: 3072,
      }),
    },
    {
      name: 'Quinn Creator',
      role_slug: 'creator',
      persona_json: JSON.stringify({
        personality: 'Versatile, fast-paced, quality-focused content producer',
        expertise: 'Content creation, copywriting, presentation design, report writing, proposals',
        style: 'Client-ready deliverables that match brief requirements and brand guidelines',
      }),
      config_json: JSON.stringify({
        temperature: 0.7,
        maxTokens: 4096,
      }),
    },
    {
      name: 'Drew Deliverer',
      role_slug: 'deliverer',
      persona_json: JSON.stringify({
        personality: 'Organized, detail-oriented, quality-assurance focused executor',
        expertise: 'Final review, formatting, packaging deliverables, handoff documentation',
        style: 'Polished final outputs with delivery notes, revision tracking, and handoff checklists',
      }),
      config_json: JSON.stringify({
        temperature: 0.3,
        maxTokens: 2048,
      }),
    },
  ],
  sops: [
    {
      sop_id: 'sop-client-delivery',
      name: 'Client Delivery Flow',
      description: 'Scope → Create → Review → Deliver',
      steps: [
        {
          step_id: 'scope',
          label: 'Project Scoping',
          role_slug: 'account-manager',
          instruction:
            'Review the client brief. Clarify requirements, define deliverables, set timeline, and create a project scope document with milestones.',
          dependencies: [],
          output_key: 'scope_doc',
        },
        {
          step_id: 'create',
          label: 'Content Creation',
          role_slug: 'creator',
          instruction:
            'Based on the project scope, produce the required deliverables. Follow brand guidelines and brief requirements. Flag any ambiguities.',
          dependencies: ['scope'],
          output_key: 'draft_deliverables',
        },
        {
          step_id: 'review',
          label: 'Quality Review',
          role_slug: 'deliverer',
          instruction:
            'Review deliverables for quality, formatting, brand consistency, and completeness. Prepare final versions with a delivery checklist.',
          dependencies: ['create'],
          output_key: 'final_deliverables',
        },
        {
          step_id: 'handoff',
          label: 'Client Handoff',
          role_slug: 'account-manager',
          instruction:
            'Package final deliverables with a summary note. Include revision instructions and next steps. Send handoff communication.',
          dependencies: ['review'],
          output_key: 'handoff_note',
        },
      ],
      created_at: new Date().toISOString(),
    } satisfies SopDefinition,
  ],
};
