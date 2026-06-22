import { createZoneBlueprint } from '@offisim/shared-types';
import type { CompanyTemplateDefinition } from './index.js';

/**
 * Content Studio — research → draft → edit/review → visual packaging → publish.
 *
 * Source plan §3.2: a Content Designer / Illustrator is added so the wizard's
 * "Design & illustration" promise is truthfully backed by a real creative role
 * and a Creative Studio workspace, and the editor (Carmen) and strategist
 * (Priya) are distinct roles rather than one blurred "manager".
 *
 * Zones: Writing Room + Editorial + Creative Studio (workspace), Research
 * Library (knowledge), Meeting, Rest.
 */
export const contentStudioTemplate: CompanyTemplateDefinition = {
  id: 'content-studio',
  name: 'Content Studio',
  description: 'Research, write, edit, design, and publish content with a full editorial pipeline.',
  presentation: {
    icon: 'PenTool',
    accent: '#10b981',
    tagline: 'Create, edit, and publish content at scale',
    bestFor: ['Content Marketing', 'Publishing', 'Creative'],
    capabilities: ['Article & blog writing', 'Design & illustration', 'Editorial workflow'],
  },
  layoutPreset: 'content-lab',
  performance: { family: 'editorial', pace: 'deliberate', collaborationBias: 'pair', motifWeights: {} },
  zones: [
    createZoneBlueprint({
      slug: 'zone-writing',
      archetype: 'workspace',
      label: 'WRITING ROOM',
      accentColor: '#10b981',
      floorColor: 0x234b42,
      cx: -13.2,
      cz: 10.6,
      w: 12.4,
      d: 8.8,
      targetRoles: ['writer', 'researcher'],
      deskSlots: 3,
      sortOrder: 0,
    }),
    createZoneBlueprint({
      slug: 'zone-editorial',
      archetype: 'workspace',
      label: 'EDITORIAL',
      accentColor: '#0ea5e9',
      floorColor: 0x1e3a5c,
      cx: -0.2,
      cz: 10.6,
      w: 11.2,
      d: 8.8,
      targetRoles: ['manager', 'project_manager', 'seo_specialist'],
      deskSlots: 3,
      sortOrder: 1,
    }),
    createZoneBlueprint({
      slug: 'zone-creative',
      archetype: 'workspace',
      label: 'CREATIVE STUDIO',
      accentColor: '#ec4899',
      floorColor: 0x5c2a44,
      cx: 12.4,
      cz: 10.6,
      w: 11.2,
      d: 8.8,
      targetRoles: ['graphic_designer', 'ui_designer', 'designer', 'artist'],
      deskSlots: 2,
      sortOrder: 2,
    }),
    createZoneBlueprint({
      slug: 'zone-library',
      archetype: 'library',
      label: 'RESEARCH LIBRARY',
      cx: -11.3,
      cz: 0.7,
      w: 13.2,
      d: 7.6,
      sortOrder: 3,
    }),
    createZoneBlueprint({
      slug: 'zone-rest',
      archetype: 'rest',
      label: 'REST AREA',
      cx: 6.3,
      cz: 0.7,
      w: 13.8,
      d: 7.6,
      sortOrder: 4,
    }),
    createZoneBlueprint({
      slug: 'zone-meeting',
      archetype: 'meeting',
      label: 'MEETING ROOM',
      cx: -9.4,
      cz: -8.8,
      w: 15.2,
      d: 7.4,
      sortOrder: 5,
    }),
  ],
  employees: [
    {
      key: 'dana-rivera',
      name: 'Dana Rivera',
      roleSlug: 'researcher',
      displayTitle: 'Researcher',
      capabilities: ['research', 'source-verification', 'analysis', 'briefing'],
      persona: {
        schemaVersion: 2,
        profile: {
          expertise:
            'Investigative research and source verification across primary and secondary sources. Skilled in synthesizing complex topics into clear briefs, fact-checking claims, and assembling annotated reference packs. Strong at competitive landscape scans and structured note-taking.',
          workingStyle:
            'Thorough and skeptical. Verifies before asserting, separates fact from inference, and hands writers a clean, sourced brief. Flags gaps and uncertainty explicitly rather than papering over them.',
          communication: 'medium',
          risk: 'conservative',
          decisionStyle: 'analytical',
          customInstructions: '',
        },
        appearance: {
          skinColor: 0xf0d5c0,
          hairColor: 0x3a2a1a,
          hairStyle: 'long',
          clothingColor: 0xf59e0b,
          clothingAccent: 0xd97706,
          bodyType: 'normal',
          gender: 'feminine',
        },
      },
    },
    {
      key: 'leo-zhang',
      name: 'Leo Zhang',
      roleSlug: 'writer',
      displayTitle: 'Writer',
      capabilities: ['copywriting', 'storytelling', 'long-form', 'editing'],
      persona: {
        schemaVersion: 2,
        profile: {
          expertise:
            'Long-form and short-form writing across editorial, marketing, and technical registers. Strong narrative structure, hook craft, and audience-tuned voice. Comfortable turning a research brief into a publication-ready draft with clear sectioning and citations.',
          workingStyle:
            'Versatile and fast on a first draft, then ruthless in self-editing. Welcomes editorial critique, iterates quickly, and keeps a consistent voice across a piece.',
          communication: 'high',
          risk: 'balanced',
          decisionStyle: 'intuitive',
          customInstructions: '',
        },
        appearance: {
          skinColor: 0xe8c4a0,
          hairColor: 0x1a1a2e,
          hairStyle: 'short',
          clothingColor: 0x3b82f6,
          clothingAccent: 0x2563eb,
          bodyType: 'normal',
          gender: 'masculine',
        },
      },
    },
    {
      key: 'carmen-flores',
      name: 'Carmen Flores',
      roleSlug: 'manager',
      displayTitle: 'Editorial Director',
      capabilities: ['editing', 'style-guides', 'voice-consistency', 'publishing'],
      persona: {
        schemaVersion: 2,
        profile: {
          expertise:
            'Editorial direction with a sharp eye for weak prose, structure problems, and voice drift. Owns the style guide, sets quality bars, and runs the writer–editor review loop. Experienced in publication workflows and final ship-readiness checks.',
          workingStyle:
            'Sharp and direct in feedback, warm in intent. Edits for clarity and consistency, defends the reader, and signs off only when a piece meets the bar. Coordinates the pipeline end to end.',
          communication: 'high',
          risk: 'balanced',
          decisionStyle: 'directive',
          customInstructions: '',
        },
        appearance: {
          skinColor: 0xfce4c8,
          hairColor: 0x6b3a2a,
          hairStyle: 'bob',
          clothingColor: 0xa855f7,
          clothingAccent: 0x9333ea,
          bodyType: 'normal',
          gender: 'feminine',
        },
      },
    },
    {
      key: 'priya-sharma',
      name: 'Priya Sharma',
      roleSlug: 'project_manager',
      displayTitle: 'Content Strategist / Quality Reviewer',
      capabilities: ['content-strategy', 'analytics', 'quality-review', 'auditing'],
      persona: {
        schemaVersion: 2,
        profile: {
          expertise:
            'Content strategy tied to measurable business impact. Plans editorial calendars, audits performance against goals, and reviews drafts for strategic alignment and quality. Skilled in analytics interpretation and turning data into content decisions.',
          workingStyle:
            'Strategic and outcomes-driven. Connects every piece to a goal, audits before and after publish, and keeps the team honest about what is actually working.',
          communication: 'medium',
          risk: 'balanced',
          decisionStyle: 'analytical',
          customInstructions: '',
        },
        appearance: {
          skinColor: 0xd2a882,
          hairColor: 0x1c1c1c,
          hairStyle: 'braids',
          clothingColor: 0x8b5cf6,
          clothingAccent: 0x7c3aed,
          bodyType: 'slim',
          gender: 'feminine',
        },
      },
    },
    {
      key: 'marco-rossi',
      name: 'Marco Rossi',
      roleSlug: 'seo_specialist',
      displayTitle: 'SEO & Distribution Specialist',
      capabilities: ['seo', 'distribution', 'analytics', 'formatting'],
      persona: {
        schemaVersion: 2,
        profile: {
          expertise:
            'Search optimization and multi-channel distribution. Thinks in search intent, keyword clustering, and on-page structure. Formats and packages finished content for each channel and tracks reach and engagement.',
          workingStyle:
            'Data-driven and pragmatic. Optimizes without sacrificing readability, and measures distribution outcomes instead of guessing.',
          communication: 'medium',
          risk: 'balanced',
          decisionStyle: 'analytical',
          customInstructions: '',
        },
        appearance: {
          skinColor: 0xfce4c8,
          hairColor: 0x6b3a2a,
          hairStyle: 'curly',
          clothingColor: 0x14b8a6,
          clothingAccent: 0x0d9488,
          bodyType: 'stocky',
          gender: 'masculine',
        },
      },
    },
    {
      key: 'iris-moreau',
      name: 'Iris Moreau',
      roleSlug: 'graphic_designer',
      displayTitle: 'Content Designer / Illustrator',
      capabilities: ['illustration', 'visual-content', 'layout', 'infographics'],
      persona: {
        schemaVersion: 2,
        profile: {
          expertise:
            'Editorial illustration and content design: article hero art, infographics, social cards, and layout systems. Strong at translating a narrative into visual packaging and maintaining a consistent visual language across a publication.',
          workingStyle:
            'Visual storyteller who pairs tightly with writers and the editor. Iterates on concepts quickly, delivers export-ready assets, and keeps brand and accessibility in mind.',
          communication: 'medium',
          risk: 'aggressive',
          decisionStyle: 'intuitive',
          customInstructions: '',
        },
        appearance: {
          skinColor: 0xe8c4a0,
          hairColor: 0x5d4e37,
          hairStyle: 'ponytail',
          clothingColor: 0xec4899,
          clothingAccent: 0xdb2777,
          bodyType: 'normal',
          gender: 'feminine',
        },
      },
    },
  ],
};
