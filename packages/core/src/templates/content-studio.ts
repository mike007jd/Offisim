import type { CompanyTemplate } from './index.js';

/**
 * Content Studio template — 4 employees across a research-draft-review-optimize pipeline.
 * Showcases the Generate-Critique collaboration pattern.
 */
export const contentStudioTemplate: CompanyTemplate = {
  id: 'content-studio',
  name: 'Content Studio',
  description:
    'AI content factory with research-draft-review-optimize pipeline. Showcases the Generate-Critique collaboration pattern.',
  icon: '📝',
  employees: [
    {
      name: 'Dana Rivera',
      role_slug: 'analyst',
      persona_json: JSON.stringify({
        expertise: 'Deep research, fact verification, multi-source synthesis, structured briefing',
        style:
          'Thorough investigator, meticulous with sources, produces comprehensive research briefs',
        characterConfig: {
          skinColor: 0xf5d0b0,
          hairColor: 0x8b4513,
          hairStyle: 'long',
          clothingColor: 0xf59e0b,
          clothingAccent: 0xd97706,
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
      name: 'Leo Zhang',
      role_slug: 'developer',
      persona_json: JSON.stringify({
        expertise: 'Content drafting, tone adaptation, audience-aware writing, structured prose',
        style: 'Versatile writer, adapts tone and format to target audience, compelling storytelling',
        characterConfig: {
          skinColor: 0xe8c4a0,
          hairColor: 0x1a1a2e,
          hairStyle: 'short',
          clothingColor: 0x3b82f6,
          clothingAccent: 0x2563eb,
          bodyType: 'normal',
          gender: 'masculine',
        },
      }),
      config_json: JSON.stringify({
        modelPreference: '',
        temperature: 0.6,
        maxTokens: 4096,
      }),
    },
    {
      name: 'Priya Sharma',
      role_slug: 'pm',
      persona_json: JSON.stringify({
        expertise:
          'Quality auditing, factual accuracy review, style consistency, structured critique with actionable feedback',
        style: 'Sharp-eyed critic, finds logical gaps, outputs structured revision instructions',
        characterConfig: {
          skinColor: 0xd2a882,
          hairColor: 0x1c1c1c,
          hairStyle: 'braids',
          clothingColor: 0xec4899,
          clothingAccent: 0xdb2777,
          bodyType: 'slim',
          gender: 'feminine',
        },
      }),
      config_json: JSON.stringify({
        modelPreference: '',
        temperature: 0.3,
        maxTokens: 4096,
      }),
    },
    {
      name: 'Marco Rossi',
      role_slug: 'frontend',
      persona_json: JSON.stringify({
        expertise:
          'SEO optimization, format adaptation, distribution readiness, content polishing',
        style: 'Optimization specialist, transforms reviewed content into publishable assets',
        characterConfig: {
          skinColor: 0xfce4c8,
          hairColor: 0x6b3a2a,
          hairStyle: 'curly',
          clothingColor: 0x14b8a6,
          clothingAccent: 0x0d9488,
          bodyType: 'stocky',
          gender: 'masculine',
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
      sop_id: 'sop-content-pipeline',
      name: 'Content Pipeline',
      description: 'Research-draft-review-optimize pipeline for AI content production',
      created_at: '2025-01-01T00:00:00.000Z',
      steps: [
        {
          step_id: 'research',
          label: 'Research & Briefing',
          role_slug: 'analyst',
          instruction:
            'Investigate the topic thoroughly. Gather facts, sources, data points, and competing perspectives. Output a structured research brief with key findings, verified facts, and suggested angles.',
          output_key: 'research_brief',
          dependencies: [],
        },
        {
          step_id: 'draft',
          label: 'Content Drafting',
          role_slug: 'developer',
          instruction:
            "Using the research brief, write a complete draft. Match the target audience's reading level and expectations. Structure with clear sections, compelling opening, and actionable conclusion.",
          output_key: 'content_draft',
          dependencies: ['research'],
        },
        {
          step_id: 'review',
          label: 'Quality Critique',
          role_slug: 'pm',
          instruction:
            'Critically review the draft against the research brief. Check factual accuracy, logical flow, style consistency, and completeness. Output a structured critique: list specific issues with line references, rate overall quality 1-5, and provide concrete revision instructions. If quality < 3, the revision instructions should be detailed enough for the writer to fix without further guidance.',
          output_key: 'review_report',
          dependencies: ['draft'],
        },
        {
          step_id: 'optimize',
          label: 'Optimize & Publish',
          role_slug: 'frontend',
          instruction:
            'Apply the review feedback to polish the content. Optimize for SEO (titles, headers, meta descriptions, keyword density). Adapt format for target platform. Output the final publishable asset.',
          output_key: 'final_content',
          dependencies: ['review'],
        },
      ],
    },
  ],
  layoutPreset: 'rd-office',
};
