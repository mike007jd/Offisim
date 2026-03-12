import type { SopDefinition } from '@aics/shared-types';

import type { CompanyTemplate } from './index.js';

export const contentStudioTemplate: CompanyTemplate = {
  id: 'content-studio',
  name: 'Content Studio',
  description: 'A creative team for content creation, research, and social media operations.',
  icon: '✍️',
  layoutPreset: '2x2',
  employees: [
    {
      name: 'Alex Writer',
      role_slug: 'writer',
      persona_json: JSON.stringify({
        personality: 'Creative, articulate, detail-oriented storyteller',
        expertise: 'Blog posts, articles, copywriting, creative writing, content strategy',
        style: 'Engaging, clear, audience-aware prose with strong narrative structure',
      }),
      config_json: JSON.stringify({
        temperature: 0.8,
        maxTokens: 4096,
      }),
    },
    {
      name: 'Sam Researcher',
      role_slug: 'researcher',
      persona_json: JSON.stringify({
        personality: 'Analytical, thorough, evidence-driven investigator',
        expertise: 'Market research, competitive analysis, data synthesis, fact-checking',
        style: 'Structured reports with citations, data tables, and actionable insights',
      }),
      config_json: JSON.stringify({
        temperature: 0.3,
        maxTokens: 4096,
      }),
    },
    {
      name: 'Jordan Designer',
      role_slug: 'designer',
      persona_json: JSON.stringify({
        personality: 'Visually-minded, trend-aware, user-centric creative',
        expertise: 'Visual design briefs, brand guidelines, layout suggestions, design critique',
        style: 'Concise visual direction with mood references and layout specifications',
      }),
      config_json: JSON.stringify({
        temperature: 0.6,
        maxTokens: 2048,
      }),
    },
  ],
  sops: [
    {
      sop_id: 'sop-content-creation',
      name: 'Content Creation Flow',
      description: 'Research → Write → Design direction → Review cycle',
      steps: [
        {
          step_id: 'research',
          label: 'Topic Research',
          role_slug: 'researcher',
          instruction:
            'Research the assigned topic. Gather key facts, statistics, competitor examples, and audience insights. Produce a research brief with sources.',
          dependencies: [],
          output_key: 'research_brief',
        },
        {
          step_id: 'write',
          label: 'Content Drafting',
          role_slug: 'writer',
          instruction:
            'Using the research brief, write a complete draft. Include headline, body, and call-to-action. Follow brand voice guidelines.',
          dependencies: ['research'],
          output_key: 'draft',
        },
        {
          step_id: 'design',
          label: 'Visual Direction',
          role_slug: 'designer',
          instruction:
            'Based on the draft content, create a visual direction brief: suggested imagery, layout, color palette, and typography recommendations.',
          dependencies: ['write'],
          output_key: 'design_brief',
        },
      ],
      created_at: new Date().toISOString(),
    } satisfies SopDefinition,
    {
      sop_id: 'sop-social-media',
      name: 'Social Media Campaign',
      description: 'Parallel research + writing → design → publish brief',
      steps: [
        {
          step_id: 'audience-research',
          label: 'Audience Research',
          role_slug: 'researcher',
          instruction:
            'Analyze target audience demographics, trending topics, and competitor social media strategies. Deliver a 1-page audience brief.',
          dependencies: [],
          output_key: 'audience_brief',
        },
        {
          step_id: 'copy',
          label: 'Social Copy',
          role_slug: 'writer',
          instruction:
            'Write social media posts for 3 platforms (Twitter/X, LinkedIn, Instagram) based on the audience brief. Include hashtag suggestions.',
          dependencies: ['audience-research'],
          output_key: 'social_copy',
        },
        {
          step_id: 'visual-assets',
          label: 'Visual Asset Brief',
          role_slug: 'designer',
          instruction:
            'Create visual asset specifications for each platform post: dimensions, style guide adherence, image descriptions for generation.',
          dependencies: ['copy'],
          output_key: 'visual_specs',
        },
      ],
      created_at: new Date().toISOString(),
    } satisfies SopDefinition,
  ],
};
