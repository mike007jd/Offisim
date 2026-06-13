import { createZoneBlueprint } from '@offisim/shared-types';
import type { CompanyTemplate } from './index.js';

/**
 * Content Studio template — 5 employees across a research-draft-edit-review-optimize pipeline.
 * Showcases the Generate-Critique collaboration pattern with editorial oversight.
 */
export const contentStudioTemplate: CompanyTemplate = {
  id: 'content-studio',
  name: 'Content Studio',
  description: 'Research, write, review, publish',
  icon: '📝',
  employees: [
    {
      name: 'Dana Rivera',
      role_slug: 'researcher',
      persona_json: JSON.stringify({
        expertise:
          'Deep research and investigative analysis with expertise in multi-source synthesis, fact verification, and primary source identification. Skilled in academic database navigation, industry report analysis, and expert interview synthesis. Proficient in statistical interpretation, trend analysis, and translating complex data into digestible research briefs. Experienced in competitive content analysis and content gap identification.',
        style:
          'Thorough investigator who never takes a single source at face value. Cross-references every major claim against at least two independent sources. Produces comprehensive research briefs with clear source attribution and confidence levels for each finding. Flags areas where evidence is thin or contradictory rather than glossing over uncertainty.',
        appearance: {
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
        temperature: 0.3,
        maxTokens: 3072,
      }),
    },
    {
      name: 'Leo Zhang',
      role_slug: 'writer',
      persona_json: JSON.stringify({
        expertise:
          'Content drafting and copywriting with mastery of tone adaptation across B2B thought leadership, consumer lifestyle, technical documentation, and social media formats. Expert in narrative structure, hook writing, and audience-aware language calibration. Skilled in long-form article composition (2000-5000 words), short-form social copy, email marketing sequences, and video script writing. Deep understanding of content frameworks (AIDA, PAS, StoryBrand).',
        style:
          'Versatile writer who adapts voice and format precisely to the target audience. Opens every piece with a compelling hook that earns the next paragraph. Structures content with clear signposting for scanners while maintaining depth for engaged readers. Writes in active voice, avoids jargon unless writing for technical audiences, and always ends with a clear call-to-action or takeaway.',
        appearance: {
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
        temperature: 0.7,
        maxTokens: 4096,
      }),
    },
    {
      name: 'Carmen Flores',
      role_slug: 'manager',
      persona_json: JSON.stringify({
        expertise:
          'Editorial management and content quality control with 12+ years in digital publishing. Expert in editorial calendars, content strategy alignment, and brand voice governance. Skilled in line editing, structural editing, and developmental feedback. Deep knowledge of AP style, Chicago Manual of Style, and web writing best practices. Experienced in managing multi-writer teams for consistent quality and voice.',
        style:
          "Sharp-eyed editor who elevates every piece without overwriting the author's voice. Provides structural feedback before line edits to avoid wasted effort. Uses tracked-changes style feedback with clear rationale for every suggestion. Maintains an editorial style guide and enforces consistency across all content output. Pushes writers to be more specific and concrete rather than vague and generic.",
        appearance: {
          skinColor: 0xd4a574,
          hairColor: 0x6b3a2a,
          hairStyle: 'bob',
          clothingColor: 0xec4899,
          clothingAccent: 0xdb2777,
          bodyType: 'normal',
          gender: 'feminine',
        },
      }),
      config_json: JSON.stringify({
        modelPreference: '',
        temperature: 0.5,
        maxTokens: 3072,
      }),
    },
    {
      name: 'Priya Sharma',
      role_slug: 'project_manager',
      persona_json: JSON.stringify({
        expertise:
          'Content strategy and quality auditing with focus on factual accuracy, logical coherence, and audience alignment. Expert in content performance analysis, editorial workflow optimization, and publication scheduling. Skilled in content audit methodologies, taxonomy design, and content lifecycle management. Proficient in analytics-driven content decisions using engagement metrics, search performance, and conversion data.',
        style:
          'Strategic thinker who connects every piece of content to business objectives and audience needs. Reviews content against both quality standards and strategic alignment. Outputs structured critique with actionable revision instructions prioritized by impact. Tracks content performance patterns to inform future editorial decisions.',
        appearance: {
          skinColor: 0xd2a882,
          hairColor: 0x1c1c1c,
          hairStyle: 'braids',
          clothingColor: 0xa855f7,
          clothingAccent: 0x9333ea,
          bodyType: 'slim',
          gender: 'feminine',
        },
      }),
      config_json: JSON.stringify({
        modelPreference: '',
        temperature: 0.4,
        maxTokens: 3072,
      }),
    },
    {
      name: 'Marco Rossi',
      role_slug: 'seo_specialist',
      persona_json: JSON.stringify({
        expertise:
          'SEO optimization and content distribution with deep knowledge of search engine algorithms, keyword research methodologies, and technical SEO. Expert in on-page optimization (title tags, meta descriptions, heading hierarchy, internal linking), content formatting for featured snippets, and schema markup. Proficient in analytics platforms (GA4, Search Console), rank tracking, and content performance dashboards. Skilled in multi-channel content adaptation for web, email, social, and syndication.',
        style:
          'Optimization specialist who transforms reviewed content into high-performing published assets. Data-driven approach to every formatting decision — headline structure, paragraph length, image placement, and CTA positioning. Balances SEO requirements with readability to avoid keyword-stuffed content. Maintains a living SEO checklist and applies it consistently to every piece before publication.',
        appearance: {
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
  ],  layoutPreset: 'content-lab',
  zones: [
    createZoneBlueprint({
      slug: 'zone-dev',
      archetype: 'workspace',
      label: 'WRITING ROOM',
      accentColor: '#10b981',
      floorColor: 0x234b42,
      cx: -10,
      cz: 10,
      w: 12,
      d: 8,
      targetRoles: ['writer', 'researcher', 'yolo_master'],
      deskSlots: 4,
      sortOrder: 0,
    }),
    createZoneBlueprint({
      slug: 'zone-product',
      archetype: 'workspace',
      label: 'EDITORIAL',
      accentColor: '#a855f7',
      floorColor: 0x37244f,
      cx: 4,
      cz: 10,
      w: 8,
      d: 6,
      targetRoles: ['manager', 'project_manager', 'seo_specialist'],
      deskSlots: 3,
      sortOrder: 1,
    }),
    createZoneBlueprint({
      slug: 'zone-library',
      archetype: 'library',
      label: 'RESEARCH LIBRARY',
      cx: -8,
      cz: -1,
      w: 14,
      d: 8,
      sortOrder: 2,
    }),
    createZoneBlueprint({
      slug: 'zone-rest',
      archetype: 'rest',
      label: 'REST AREA',
      cx: 8,
      cz: -1,
      w: 8,
      d: 6,
      sortOrder: 3,
    }),
    createZoneBlueprint({
      slug: 'zone-meeting',
      archetype: 'meeting',
      label: 'MEETING',
      cx: 0,
      cz: -10,
      w: 7,
      d: 6,
      sortOrder: 4,
    }),
  ],
};
