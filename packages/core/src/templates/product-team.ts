import type { CompanyTemplate } from './index.js';

/**
 * Product Team template — 4 employees across a specify-design-implement-review pipeline.
 * Showcases the Spec-Driven collaboration pattern.
 */
export const productTeamTemplate: CompanyTemplate = {
  id: 'product-team',
  name: 'Product Team',
  description:
    'AI development squad with specify-design-implement-review pipeline. Showcases the Spec-Driven collaboration pattern.',
  icon: '🚀',
  employees: [
    {
      name: 'Ava Mitchell',
      role_slug: 'pm',
      persona_json: JSON.stringify({
        expertise:
          'Requirements analysis, acceptance criteria definition, edge case identification, structured specification',
        style: 'Precise thinker, turns vague ideas into actionable specs with clear acceptance criteria',
        characterConfig: {
          skinColor: 0xf0d5c0,
          hairColor: 0x4a3728,
          hairStyle: 'ponytail',
          clothingColor: 0x8b5cf6,
          clothingAccent: 0x7c3aed,
          bodyType: 'normal',
          gender: 'feminine',
        },
      }),
      config_json: JSON.stringify({
        modelPreference: '',
        temperature: 0.4,
        maxTokens: 4096,
      }),
    },
    {
      name: 'Noah Kim',
      role_slug: 'backend',
      persona_json: JSON.stringify({
        expertise: 'System design, API contract definition, data modeling, component boundary design',
        style: 'Methodical architect, designs clean interfaces and data flows',
        characterConfig: {
          skinColor: 0xe8c8a0,
          hairColor: 0x2c1810,
          hairStyle: 'short',
          clothingColor: 0x059669,
          clothingAccent: 0x047857,
          bodyType: 'stocky',
          gender: 'masculine',
        },
      }),
      config_json: JSON.stringify({
        modelPreference: '',
        temperature: 0.3,
        maxTokens: 4096,
      }),
    },
    {
      name: 'Elena Volkov',
      role_slug: 'fullstack',
      persona_json: JSON.stringify({
        expertise:
          'Production-grade implementation, test coverage, error handling, code documentation',
        style: 'Disciplined implementer, writes clean code with thorough test coverage',
        characterConfig: {
          skinColor: 0xfce4c8,
          hairColor: 0xc0392b,
          hairStyle: 'bob',
          clothingColor: 0x0ea5e9,
          clothingAccent: 0x0284c7,
          bodyType: 'slim',
          gender: 'feminine',
        },
      }),
      config_json: JSON.stringify({
        modelPreference: '',
        temperature: 0.4,
        maxTokens: 4096,
      }),
    },
    {
      name: 'Raj Patel',
      role_slug: 'analyst',
      persona_json: JSON.stringify({
        expertise:
          'Code review, security analysis, performance audit, structured critique with severity ratings',
        style: 'Thorough reviewer, categorizes issues by severity, provides specific fix suggestions',
        characterConfig: {
          skinColor: 0xd4a574,
          hairColor: 0x1c1c1c,
          hairStyle: 'spiky',
          clothingColor: 0xf97316,
          clothingAccent: 0xea580c,
          bodyType: 'normal',
          gender: 'masculine',
        },
      }),
      config_json: JSON.stringify({
        modelPreference: '',
        temperature: 0.3,
        maxTokens: 4096,
      }),
    },
  ],
  sops: [
    {
      sop_id: 'sop-build-cycle',
      name: 'Build Cycle',
      description: 'Specify-design-implement-review pipeline for spec-driven AI development',
      created_at: '2025-01-01T00:00:00.000Z',
      steps: [
        {
          step_id: 'specify',
          label: 'Requirements Specification',
          role_slug: 'pm',
          instruction:
            'Analyze the request and produce a precise specification. Define: functional requirements, acceptance criteria, edge cases, out-of-scope items, and constraints. Use structured format with numbered requirements.',
          output_key: 'spec_doc',
          dependencies: [],
        },
        {
          step_id: 'design',
          label: 'Technical Design',
          role_slug: 'backend',
          instruction:
            'Design the technical solution based on the spec. Define: architecture, data models, API contracts, component boundaries, and error handling strategy. Output a design document with interface definitions.',
          output_key: 'design_doc',
          dependencies: ['specify'],
        },
        {
          step_id: 'implement',
          label: 'Implementation',
          role_slug: 'fullstack',
          instruction:
            'Implement the solution following the design document exactly. Write production-quality code with proper error handling and test coverage. Output the implementation with inline documentation for non-obvious decisions.',
          output_key: 'implementation',
          dependencies: ['design'],
        },
        {
          step_id: 'review',
          label: 'Code Review',
          role_slug: 'analyst',
          instruction:
            'Review the implementation against both the spec and design docs. Check: correctness vs spec, adherence to design, error handling, edge cases, security, performance. Output a structured review with issues categorized by severity (critical/major/minor) and specific fix suggestions.',
          output_key: 'review_report',
          dependencies: ['implement'],
        },
      ],
    },
  ],
  layoutPreset: 'rd-office',
};
