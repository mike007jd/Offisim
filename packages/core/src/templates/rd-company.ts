import type { CompanyTemplate } from './index.js';

/**
 * R&D Company template — 8 employees across 3 departments (DEV, PROD, ART).
 * Each employee has a unique CharacterConfig for the puppet system stored in persona_json.
 */
export const rdCompanyTemplate: CompanyTemplate = {
  id: 'rd-company',
  name: 'R&D Company',
  description:
    'A full R&D company with developers, product managers, and designers — the default starting template.',
  icon: '🏢',
  employees: [
    // ── DEV department (4 devs) ──
    {
      name: 'Alex Chen',
      role_slug: 'developer',
      persona_json: JSON.stringify({
        expertise: 'Full-stack development, React, Node.js, system architecture',
        style: 'Pragmatic, clean-code advocate, prefers working in focused sprints',
        characterConfig: {
          skinColor: 0xf5d6b8,
          hairColor: 0x2c1810,
          hairStyle: 'short',
          clothingColor: 0x3b82f6,
          clothingAccent: 0x1d4ed8,
          bodyType: 'normal',
          gender: 'masculine',
        },
      }),
      config_json: JSON.stringify({
        modelPreference: '',
        temperature: 0.4,
        maxTokens: 4096,
      }),
    },
    {
      name: 'Maya Lin',
      role_slug: 'frontend',
      persona_json: JSON.stringify({
        expertise: 'Frontend development, CSS, animations, accessibility',
        style: 'Detail-oriented, pixel-perfect, loves interactive prototypes',
        characterConfig: {
          skinColor: 0xe8c4a0,
          hairColor: 0x1a1a2e,
          hairStyle: 'ponytail',
          clothingColor: 0x6366f1,
          clothingAccent: 0x4f46e5,
          bodyType: 'slim',
          gender: 'feminine',
        },
      }),
      config_json: JSON.stringify({
        modelPreference: '',
        temperature: 0.5,
        maxTokens: 4096,
      }),
    },
    {
      name: 'Marcus Johnson',
      role_slug: 'backend',
      persona_json: JSON.stringify({
        expertise: 'Backend systems, databases, distributed computing, DevOps',
        style: 'Methodical, loves optimization, strong testing discipline',
        characterConfig: {
          skinColor: 0xd4a574,
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
        temperature: 0.3,
        maxTokens: 4096,
      }),
    },
    {
      name: 'Kai Nakamura',
      role_slug: 'fullstack',
      persona_json: JSON.stringify({
        expertise: 'Full-stack TypeScript, API design, real-time systems',
        style: 'Fast learner, collaborative, favors iterative development',
        characterConfig: {
          skinColor: 0xf0d5c0,
          hairColor: 0x4a3728,
          hairStyle: 'spiky',
          clothingColor: 0x0ea5e9,
          clothingAccent: 0x0284c7,
          bodyType: 'normal',
          gender: 'masculine',
        },
      }),
      config_json: JSON.stringify({
        modelPreference: '',
        temperature: 0.4,
        maxTokens: 4096,
      }),
    },
    // ── PROD department (2 PMs) ──
    {
      name: 'Sophie Park',
      role_slug: 'pm',
      persona_json: JSON.stringify({
        expertise: 'Product strategy, user research, roadmapping, data-driven decisions',
        style: 'Strategic thinker, excellent communicator, prioritizes user impact',
        characterConfig: {
          skinColor: 0xfce4c8,
          hairColor: 0x6b3a2a,
          hairStyle: 'bob',
          clothingColor: 0xa855f7,
          clothingAccent: 0x9333ea,
          bodyType: 'normal',
          gender: 'feminine',
        },
      }),
      config_json: JSON.stringify({
        modelPreference: '',
        temperature: 0.5,
        maxTokens: 4096,
      }),
    },
    {
      name: 'Ryan Torres',
      role_slug: 'analyst',
      persona_json: JSON.stringify({
        expertise: 'Data analysis, metrics, A/B testing, user behavior modeling',
        style: 'Analytical, evidence-based, loves dashboards and reports',
        characterConfig: {
          skinColor: 0xe8c8a0,
          hairColor: 0x1c1c1c,
          hairStyle: 'short',
          clothingColor: 0x8b5cf6,
          clothingAccent: 0x7c3aed,
          bodyType: 'slim',
          gender: 'masculine',
        },
      }),
      config_json: JSON.stringify({
        modelPreference: '',
        temperature: 0.3,
        maxTokens: 4096,
      }),
    },
    // ── ART department (2 designers) ──
    {
      name: 'Zara Okafor',
      role_slug: 'designer',
      persona_json: JSON.stringify({
        expertise: 'UI/UX design, visual design, prototyping, design systems',
        style: 'Creative, user-empathetic, strong visual intuition',
        characterConfig: {
          skinColor: 0xf5d0b0,
          hairColor: 0xc0392b,
          hairStyle: 'long',
          clothingColor: 0xf97316,
          clothingAccent: 0xea580c,
          bodyType: 'slim',
          gender: 'feminine',
        },
      }),
      config_json: JSON.stringify({
        modelPreference: '',
        temperature: 0.6,
        maxTokens: 3072,
      }),
    },
    {
      name: 'Jamie Reeves',
      role_slug: 'ui_designer',
      persona_json: JSON.stringify({
        expertise: 'Visual design, motion design, iconography, brand identity',
        style: 'Experimental, trend-aware, loves micro-interactions',
        characterConfig: {
          skinColor: 0xd2a882,
          hairColor: 0x5d4e37,
          hairStyle: 'braids',
          clothingColor: 0xef4444,
          clothingAccent: 0xdc2626,
          bodyType: 'normal',
          gender: 'neutral',
        },
      }),
      config_json: JSON.stringify({
        modelPreference: '',
        temperature: 0.6,
        maxTokens: 3072,
      }),
    },
  ],
  sops: [
    {
      sop_id: 'sop-feature-dev',
      name: 'Feature Development',
      description: 'Standard feature development flow from requirements to deployment',
      created_at: new Date().toISOString(),
      steps: [
        {
          step_id: 'requirements',
          label: 'Requirements Analysis',
          role_slug: 'pm',
          instruction: 'Analyze the feature request, define requirements and acceptance criteria.',
          output_key: 'requirements_doc',
          dependencies: [],
        },
        {
          step_id: 'design',
          label: 'UI/UX Design',
          role_slug: 'designer',
          instruction: 'Create wireframes and visual mockups based on the requirements.',
          output_key: 'design_assets',
          dependencies: ['requirements'],
        },
        {
          step_id: 'implementation',
          label: 'Development',
          role_slug: 'developer',
          instruction: 'Implement the feature according to design specs and requirements.',
          output_key: 'code_changes',
          dependencies: ['design'],
        },
        {
          step_id: 'review',
          label: 'Code Review & QA',
          role_slug: 'analyst',
          instruction: 'Review implementation quality, run tests, verify acceptance criteria.',
          output_key: 'review_report',
          dependencies: ['implementation'],
        },
      ],
    },
  ],
  layoutPreset: 'rd-office',
};
