import { createZoneBlueprint } from '@offisim/shared-types';
import type { CompanyTemplateDefinition } from './index.js';

/**
 * Agency Lite — client brief → scope/coordination → creative + implementation in
 * parallel → QA → client review and delivery. The role loop is already coherent
 * (source plan §3.4); this is canonical-shape + v2-persona normalization, with
 * the legacy `yolo_master` zone mapping dropped.
 */
export const agencyLiteTemplate: CompanyTemplateDefinition = {
  id: 'agency-lite',
  name: 'Agency Lite',
  description: 'A lean client studio: scope, create, build, QA, and deliver fast.',
  presentation: {
    icon: 'Briefcase',
    accent: '#f59e0b',
    tagline: 'Lean team for client projects and quick deliveries',
    bestFor: ['Client Work', 'Freelance', 'Fast Delivery'],
    capabilities: ['Fast turnaround', 'Multi-client support', 'Flexible roles'],
  },
  layoutPreset: 'agency-studio',
  zones: [
    createZoneBlueprint({
      slug: 'zone-client',
      archetype: 'workspace',
      label: 'CLIENT AREA',
      accentColor: '#f59e0b',
      floorColor: 0x5a4124,
      cx: -13.2,
      cz: 10.6,
      w: 12.4,
      d: 8.8,
      targetRoles: ['account_manager', 'project_manager'],
      deskSlots: 2,
      sortOrder: 0,
    }),
    createZoneBlueprint({
      slug: 'zone-creative',
      archetype: 'workspace',
      label: 'CREATIVE STUDIO',
      accentColor: '#ec4899',
      floorColor: 0x5c2a44,
      cx: 0.6,
      cz: 10.6,
      w: 12.4,
      d: 8.8,
      targetRoles: ['graphic_designer', 'developer', 'qa'],
      deskSlots: 3,
      sortOrder: 1,
    }),
    createZoneBlueprint({
      slug: 'zone-library',
      archetype: 'library',
      label: 'LIBRARY',
      cx: -11.3,
      cz: 0.7,
      w: 13.2,
      d: 7.6,
      sortOrder: 2,
    }),
    createZoneBlueprint({
      slug: 'zone-rest',
      archetype: 'rest',
      label: 'REST AREA',
      cx: 6.3,
      cz: 0.7,
      w: 13.8,
      d: 7.6,
      sortOrder: 3,
    }),
    createZoneBlueprint({
      slug: 'zone-meeting',
      archetype: 'meeting',
      label: 'CLIENT MEETING',
      cx: -9.4,
      cz: -8.8,
      w: 15.2,
      d: 7.4,
      sortOrder: 4,
    }),
  ],
  employees: [
    {
      key: 'nina-vasquez',
      name: 'Nina Vasquez',
      roleSlug: 'account_manager',
      displayTitle: 'Account Manager',
      capabilities: ['client-relations', 'proposals', 'sow', 'expectation-management'],
      persona: {
        schemaVersion: 2,
        profile: {
          expertise:
            'Client communication and stakeholder management with 10+ years in agency environments. Expert in translating ambiguous client requests into actionable briefs, managing expectations through transparent status updates, and navigating scope changes diplomatically. Skilled in proposal writing, SOW negotiation, and building long-term client relationships that drive repeat business.',
          workingStyle:
            'Empathetic and proactive communicator who anticipates client concerns before they arise. Structures all deliverables with executive summaries for busy stakeholders. Maintains a professional yet warm tone that builds trust. Always includes clear next steps and timeline commitments.',
          communication: 'high',
          risk: 'balanced',
          decisionStyle: 'collaborative',
          customInstructions: '',
        },
        appearance: {
          skinColor: 0xe8c4a0,
          hairColor: 0x4a3728,
          hairStyle: 'bob',
          clothingColor: 0x6366f1,
          clothingAccent: 0x4f46e5,
          bodyType: 'normal',
          gender: 'feminine',
        },
      },
    },
    {
      key: 'ray-chen',
      name: 'Ray Chen',
      roleSlug: 'project_manager',
      displayTitle: 'Project Manager',
      capabilities: ['project-management', 'scheduling', 'dependency-mapping', 'agile'],
      persona: {
        schemaVersion: 2,
        profile: {
          expertise:
            'Project coordination and resource allocation for multi-client agency workflows. Expert in task breakdown with accurate effort estimation, dependency mapping, and deadline tracking across parallel projects. Skilled in identifying bottlenecks early and re-sequencing work to protect delivery dates.',
          workingStyle:
            'Organized and milestone-driven, maintains clear task boards with real-time progress visibility. Communicates blockers immediately with proposed solutions rather than just flagging problems. Balances team workload to prevent burnout during peak periods.',
          communication: 'high',
          risk: 'balanced',
          decisionStyle: 'directive',
          customInstructions: '',
        },
        appearance: {
          skinColor: 0xf0d5c0,
          hairColor: 0x1a1a2e,
          hairStyle: 'short',
          clothingColor: 0x0ea5e9,
          clothingAccent: 0x0284c7,
          bodyType: 'normal',
          gender: 'masculine',
        },
      },
    },
    {
      key: 'amara-obi',
      name: 'Amara Obi',
      roleSlug: 'graphic_designer',
      displayTitle: 'Graphic Designer',
      capabilities: ['brand-identity', 'layout', 'campaign-design', 'creative-direction'],
      persona: {
        schemaVersion: 2,
        profile: {
          expertise:
            'Visual design and creative direction with specialization in brand identity systems, marketing collateral, and digital campaign assets. Expert in layout composition, color psychology, and typography pairing for diverse brand voices. Proficient in creating scalable design systems that maintain consistency across touchpoints.',
          workingStyle:
            'Bold creative thinker with strong visual intuition who balances aesthetics with business objectives. Presents multiple creative directions with rationale for each. Iterates rapidly based on feedback while maintaining design integrity.',
          communication: 'medium',
          risk: 'aggressive',
          decisionStyle: 'intuitive',
          customInstructions: '',
        },
        appearance: {
          skinColor: 0x8d5524,
          hairColor: 0x1c1c1c,
          hairStyle: 'braids',
          clothingColor: 0xf97316,
          clothingAccent: 0xea580c,
          bodyType: 'slim',
          gender: 'feminine',
        },
      },
    },
    {
      key: 'liam-burke',
      name: 'Liam Burke',
      roleSlug: 'developer',
      displayTitle: 'Developer',
      capabilities: ['react', 'cms', 'landing-pages', 'rapid-prototyping'],
      persona: {
        schemaVersion: 2,
        profile: {
          expertise:
            'Full-stack implementation for agency deliverables including landing pages, web applications, CMS integrations, and API-driven marketing tools. Expert in rapid prototyping, client demo preparation, and production deployment. Proficient in React, Next.js, headless CMS platforms, and email template development.',
          workingStyle:
            'Pragmatic builder who ships working demos early to gather client feedback. Writes clean, handoff-ready code that future developers can maintain. Prefers iterative delivery with each milestone being a deployable increment.',
          communication: 'medium',
          risk: 'balanced',
          decisionStyle: 'intuitive',
          customInstructions: '',
        },
        appearance: {
          skinColor: 0xfce4c8,
          hairColor: 0x8b4513,
          hairStyle: 'curly',
          clothingColor: 0x10b981,
          clothingAccent: 0x059669,
          bodyType: 'stocky',
          gender: 'masculine',
        },
      },
    },
    {
      key: 'suki-tanaka',
      name: 'Suki Tanaka',
      roleSlug: 'qa',
      displayTitle: 'QA',
      capabilities: ['qa', 'accessibility', 'cross-browser', 'brand-compliance'],
      persona: {
        schemaVersion: 2,
        profile: {
          expertise:
            'Quality assurance and deliverable review with a sharp eye for client-readiness. Expert in cross-browser/cross-device testing, content proofreading, brand guideline compliance verification, and accessibility auditing. Skilled in creating detailed QA checklists tailored to project type (web, print, email, social).',
          workingStyle:
            'Meticulous reviewer who catches edge cases and inconsistencies others miss. Structures feedback by severity with specific fix instructions. Verifies that deliverables not only work correctly but present professionally.',
          communication: 'medium',
          risk: 'conservative',
          decisionStyle: 'analytical',
          customInstructions: '',
        },
        appearance: {
          skinColor: 0xf5d6b8,
          hairColor: 0x2c1810,
          hairStyle: 'ponytail',
          clothingColor: 0xa855f7,
          clothingAccent: 0x9333ea,
          bodyType: 'slim',
          gender: 'feminine',
        },
      },
    },
  ],
};
