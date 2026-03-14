import type { CompanyTemplate } from './index.js';

/**
 * Agency Lite template — 5 employees for a freelancer/small studio setup.
 * Focused on client communication, creative delivery, and quality assurance.
 * Includes 2 SOPs: Client Brief Intake and Deliverable Review.
 */
export const agencyLiteTemplate: CompanyTemplate = {
  id: 'agency-lite',
  name: 'Agency Lite',
  description:
    'Freelancer/small studio setup with client management, creative production, and quality delivery. Includes Client Brief Intake and Deliverable Review SOPs.',
  icon: '🏗️',
  employees: [
    // ── Client-facing ──
    {
      name: 'Nina Vasquez',
      role_slug: 'manager',
      persona_json: JSON.stringify({
        expertise:
          'Client communication, project scoping, status updates, stakeholder management',
        style:
          'Empathetic communicator, structured proposals, keeps clients informed with clear timelines',
        characterConfig: {
          skinColor: 0xe8c4a0,
          hairColor: 0x4a3728,
          hairStyle: 'bob',
          clothingColor: 0x6366f1,
          clothingAccent: 0x4f46e5,
          bodyType: 'normal',
          gender: 'feminine',
        },
      }),
      config_json: JSON.stringify({
        modelPreference: '',
        temperature: 0.6,
        maxTokens: 4096,
      }),
    },
    // ── Coordination ──
    {
      name: 'Ray Chen',
      role_slug: 'pm',
      persona_json: JSON.stringify({
        expertise:
          'Task breakdown, timeline management, deliverable tracking, resource allocation',
        style:
          'Organized, milestone-driven, maintains clear task boards and progress reports',
        characterConfig: {
          skinColor: 0xf0d5c0,
          hairColor: 0x1a1a2e,
          hairStyle: 'short',
          clothingColor: 0x0ea5e9,
          clothingAccent: 0x0284c7,
          bodyType: 'normal',
          gender: 'masculine',
        },
      }),
      config_json: JSON.stringify({
        modelPreference: '',
        temperature: 0.5,
        maxTokens: 4096,
      }),
    },
    // ── Creative ──
    {
      name: 'Amara Obi',
      role_slug: 'designer',
      persona_json: JSON.stringify({
        expertise:
          'Visual design, brand guidelines, creative direction, layout composition',
        style:
          'Bold creative thinker, strong visual intuition, balances aesthetics with usability',
        characterConfig: {
          skinColor: 0xd4a574,
          hairColor: 0x1c1c1c,
          hairStyle: 'braids',
          clothingColor: 0xf97316,
          clothingAccent: 0xea580c,
          bodyType: 'slim',
          gender: 'feminine',
        },
      }),
      config_json: JSON.stringify({
        modelPreference: '',
        temperature: 0.7,
        maxTokens: 4096,
      }),
    },
    // ── Implementation ──
    {
      name: 'Liam Burke',
      role_slug: 'developer',
      persona_json: JSON.stringify({
        expertise:
          'Full-stack implementation, code delivery, technical solutions, API integration',
        style:
          'Pragmatic builder, clean code, prefers iterative delivery with working demos',
        characterConfig: {
          skinColor: 0xfce4c8,
          hairColor: 0x8b4513,
          hairStyle: 'curly',
          clothingColor: 0x10b981,
          clothingAccent: 0x059669,
          bodyType: 'stocky',
          gender: 'masculine',
        },
      }),
      config_json: JSON.stringify({
        modelPreference: '',
        temperature: 0.6,
        maxTokens: 4096,
      }),
    },
    // ── Quality ──
    {
      name: 'Suki Tanaka',
      role_slug: 'analyst',
      persona_json: JSON.stringify({
        expertise:
          'Quality assurance, deliverable review, client-ready polishing, acceptance testing',
        style:
          'Meticulous reviewer, catches edge cases, ensures deliverables meet client expectations',
        characterConfig: {
          skinColor: 0xf5d6b8,
          hairColor: 0x2c1810,
          hairStyle: 'ponytail',
          clothingColor: 0xa855f7,
          clothingAccent: 0x9333ea,
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
  ],
  sops: [
    {
      sop_id: 'sop-client-brief-intake',
      name: 'Client Brief Intake',
      description: 'Structured client requirement gathering and project scoping',
      created_at: '2025-01-01T00:00:00.000Z',
      steps: [
        {
          step_id: 'gather-requirements',
          label: 'Gather Requirements',
          role_slug: 'manager',
          instruction:
            'Interview the client to understand their goals, constraints, timeline, and success criteria. Produce a structured brief document with: project summary, target audience, key deliverables, technical requirements, brand guidelines (if any), and timeline milestones.',
          output_key: 'client_brief',
          dependencies: [],
        },
        {
          step_id: 'scope-and-plan',
          label: 'Scope & Plan',
          role_slug: 'pm',
          instruction:
            'Review the client brief and break it down into actionable work packages. Create a project plan with task assignments, dependencies, effort estimates, and delivery milestones. Flag any risks or ambiguities that need client clarification.',
          output_key: 'project_plan',
          dependencies: ['gather-requirements'],
        },
        {
          step_id: 'creative-direction',
          label: 'Creative Direction',
          role_slug: 'designer',
          instruction:
            'Based on the client brief and project plan, define the creative direction. Produce mood boards, style guidelines, and initial layout concepts that align with the client\'s brand and goals.',
          output_key: 'creative_direction',
          dependencies: ['scope-and-plan'],
        },
      ],
    },
    {
      sop_id: 'sop-deliverable-review',
      name: 'Deliverable Review',
      description: 'Quality check and polishing before client handoff',
      created_at: '2025-01-01T00:00:00.000Z',
      steps: [
        {
          step_id: 'qa-review',
          label: 'QA Review',
          role_slug: 'analyst',
          instruction:
            'Review the deliverable against the original client brief and acceptance criteria. Check for: completeness, quality, consistency, edge cases, and client expectations. Produce a structured review with issues categorized by severity (critical/major/minor) and specific fix instructions.',
          output_key: 'review_report',
          dependencies: [],
        },
        {
          step_id: 'fix-and-polish',
          label: 'Fix & Polish',
          role_slug: 'developer',
          instruction:
            'Address all issues from the QA review. Fix critical and major issues first, then polish minor items. Ensure the deliverable is production-ready and matches the client\'s quality expectations.',
          output_key: 'polished_deliverable',
          dependencies: ['qa-review'],
        },
        {
          step_id: 'client-handoff',
          label: 'Client Handoff',
          role_slug: 'manager',
          instruction:
            'Prepare the final client delivery package. Write a delivery summary covering: what was delivered, how it meets the brief, any deviations from the original scope, and recommended next steps. Format for client presentation.',
          output_key: 'delivery_summary',
          dependencies: ['fix-and-polish'],
        },
      ],
    },
  ],
  layoutPreset: 'agency',
};
