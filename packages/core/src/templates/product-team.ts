import type { SopDefinition } from '@aics/shared-types';

import type { CompanyTemplate } from './index.js';

export const productTeamTemplate: CompanyTemplate = {
  id: 'product-team',
  name: 'Product Team',
  description: 'A cross-functional product team with PM, research, design, and QA capabilities.',
  icon: '🚀',
  layoutPreset: '2x2',
  employees: [
    {
      name: 'Morgan PM',
      role_slug: 'product-manager',
      persona_json: JSON.stringify({
        personality: 'Strategic, user-focused, data-driven decision maker',
        expertise: 'Product strategy, roadmap planning, user story writing, prioritization frameworks',
        style: 'Clear PRDs, user stories with acceptance criteria, and prioritized backlogs',
      }),
      config_json: JSON.stringify({
        temperature: 0.5,
        maxTokens: 4096,
      }),
    },
    {
      name: 'Casey Researcher',
      role_slug: 'researcher',
      persona_json: JSON.stringify({
        personality: 'Empathetic, systematic, insight-driven user advocate',
        expertise: 'User research, usability testing, survey design, interview synthesis',
        style: 'Research reports with persona profiles, journey maps, and evidence-backed recommendations',
      }),
      config_json: JSON.stringify({
        temperature: 0.4,
        maxTokens: 4096,
      }),
    },
    {
      name: 'Riley Designer',
      role_slug: 'designer',
      persona_json: JSON.stringify({
        personality: 'Creative, systematic, accessibility-conscious UX thinker',
        expertise: 'UI/UX design, wireframing, design systems, interaction patterns, accessibility',
        style: 'Structured design specs with component hierarchy, interaction flows, and accessibility notes',
      }),
      config_json: JSON.stringify({
        temperature: 0.6,
        maxTokens: 3072,
      }),
    },
    {
      name: 'Taylor QA',
      role_slug: 'qa-engineer',
      persona_json: JSON.stringify({
        personality: 'Meticulous, skeptical, edge-case obsessed quality guardian',
        expertise: 'Test planning, test case design, regression testing, bug reporting, acceptance testing',
        style: 'Detailed test plans with pass/fail criteria, edge cases, and reproducible bug reports',
      }),
      config_json: JSON.stringify({
        temperature: 0.2,
        maxTokens: 3072,
      }),
    },
  ],
  sops: [
    {
      sop_id: 'sop-product-research',
      name: 'Product Research Sprint',
      description: 'User research → insights → PM synthesis → design exploration',
      steps: [
        {
          step_id: 'user-research',
          label: 'User Research',
          role_slug: 'researcher',
          instruction:
            'Conduct user research on the assigned topic. Create interview guides, synthesize findings into personas and pain points. Deliver a research report.',
          dependencies: [],
          output_key: 'research_report',
        },
        {
          step_id: 'requirements',
          label: 'Requirements Definition',
          role_slug: 'product-manager',
          instruction:
            'Based on research findings, define user stories with acceptance criteria. Prioritize using RICE or MoSCoW framework. Produce a mini-PRD.',
          dependencies: ['user-research'],
          output_key: 'requirements_doc',
        },
        {
          step_id: 'design-exploration',
          label: 'Design Exploration',
          role_slug: 'designer',
          instruction:
            'Based on requirements, create wireframes and interaction flows. Document component needs and propose 2-3 design approaches with trade-offs.',
          dependencies: ['requirements'],
          output_key: 'design_options',
        },
        {
          step_id: 'test-plan',
          label: 'Test Plan',
          role_slug: 'qa-engineer',
          instruction:
            'Based on requirements and design, create a test plan covering happy paths, edge cases, and accessibility checks. Include test data requirements.',
          dependencies: ['requirements'],
          output_key: 'test_plan',
        },
      ],
      created_at: new Date().toISOString(),
    } satisfies SopDefinition,
    {
      sop_id: 'sop-design-review',
      name: 'Design Review Cycle',
      description: 'Design → QA review → PM approval',
      steps: [
        {
          step_id: 'design-spec',
          label: 'Design Specification',
          role_slug: 'designer',
          instruction:
            'Produce final design specification: component list, interaction states, responsive behavior, and accessibility requirements.',
          dependencies: [],
          output_key: 'design_spec',
        },
        {
          step_id: 'qa-review',
          label: 'QA Design Review',
          role_slug: 'qa-engineer',
          instruction:
            'Review design spec for testability, missing states, edge cases, and accessibility gaps. Provide a review report with flagged issues.',
          dependencies: ['design-spec'],
          output_key: 'qa_review',
        },
        {
          step_id: 'pm-approval',
          label: 'PM Approval',
          role_slug: 'product-manager',
          instruction:
            'Review design and QA feedback. Make final decisions on flagged issues. Approve or request changes with specific action items.',
          dependencies: ['qa-review'],
          output_key: 'approval_decision',
        },
      ],
      created_at: new Date().toISOString(),
    } satisfies SopDefinition,
  ],
};
